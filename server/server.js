// CellRush - authoritative game server.
// Serves the static client and WebSocket on one port.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

global.window = global;
const ROOT = path.join(__dirname, '..');
for (const n of ['config', 'util', 'world', 'bots']) {
  // eslint-disable-next-line no-eval
  eval(fs.readFileSync(path.join(ROOT, 'js', n + '.js'), 'utf8'));
}
const api = global.window.G;
const CFG = api.CFG;

process.on('uncaughtException', (e) => console.error('[server] uncaught:', (e && e.stack) || e));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.task': 'application/octet-stream' };
const httpServer = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

const world = new api.World();
const bots = [];
function botSkin() {
  const skins = (CFG.skinPresets || []).filter(Boolean);
  return skins.length ? api.util.pick(skins) : '';
}
for (let i = 0; i < CFG.botCount; i++) bots.push(world.addPlayer({ name: api.Bots.name(), color: api.util.randColor(), skin: botSkin(), isBot: true }));

const wss = new WebSocketServer({ server: httpServer });
let nextId = 1;
const clients = new Map();

function applyColor(p, c) { if (c && typeof c.h === 'number') p.color = api.util.colorFromHue(c.h); }
function applySkin(p, skin) {
  if (typeof skin !== 'string') return;
  skin = skin.trim();
  if (!skin) { p.skin = ''; return; }
  if (skin.length > 256) skin = skin.slice(0, 256);
  if (/^(https?:)?\/\//i.test(skin) || skin.startsWith('/')) p.skin = skin;
}
function makeClient(id) {
  return {
    id,
    deadNotified: false,
    seen: { food: new Map(), viruses: new Map(), ejected: new Map() },
    forceFull: { food: true, viruses: true, ejected: true },
  };
}
function changed(prev, obj, fields) {
  if (!prev) return true;
  for (const f of fields) {
    const a = prev[f], b = obj[f];
    if (typeof a === 'number' && typeof b === 'number') {
      if (Math.abs(a - b) > 0.5) return true;
    } else if (a !== b) return true;
  }
  return false;
}
function remember(obj, fields) {
  const out = {};
  for (const f of fields) out[f] = obj[f];
  return out;
}
function applyEntityDelta(client, snap, key, fields) {
  const arr = snap[key] || [];
  const seen = client.seen[key];
  const next = new Map();
  const add = [], update = [], remove = [];
  for (const obj of arr) {
    next.set(obj.id, remember(obj, fields));
    const prev = seen.get(obj.id);
    if (!prev) add.push(obj);
    else if (changed(prev, obj, fields)) update.push(obj);
  }
  for (const id of seen.keys()) if (!next.has(id)) remove.push(id);

  snap[key + 'Total'] = arr.length;
  if (client.forceFull[key]) {
    snap[key + 'Reset'] = true;
    snap[key + 'Add'] = [];
    snap[key + 'Update'] = [];
    snap[key + 'Remove'] = [];
    client.forceFull[key] = false;
  } else {
    snap[key + 'Reset'] = false;
    snap[key] = [];
    snap[key + 'Add'] = add;
    snap[key + 'Update'] = update;
    snap[key + 'Remove'] = remove;
  }
  client.seen[key] = next;
}
function applyNearbyDeltas(client, snap) {
  applyEntityDelta(client, snap, 'food', ['x', 'y']);
  applyEntityDelta(client, snap, 'viruses', ['x', 'y', 'r', 'mass']);
  applyEntityDelta(client, snap, 'ejected', ['x', 'y', 'r', 'color']);
}

wss.on('connection', (ws) => {
  const id = 'h' + (nextId++);
  world.addPlayer({ id, name: '玩家', color: api.util.randColor(), isBot: false });
  const client = makeClient(id);
  clients.set(ws, client);
  ws.send(JSON.stringify({ t: 'welcome', id, world: world.size }));

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    const p = world.players.get(id); if (!p) return;
    if (m.t === 'join') { p.name = (m.name || '玩家').slice(0, 14); applyColor(p, m.color); applySkin(p, m.skin); }
    else if (m.t === 'input') { world.applyInput(id, m); }
    else if (m.t === 'respawn') { if (m.name) p.name = ('' + m.name).slice(0, 14); applyColor(p, m.color); applySkin(p, m.skin); world.spawnPlayer(p); client.deadNotified = false; }
    else if (m.t === 'admin') { p.admin = !!m.on; }
  });
  ws.on('close', () => { world.removePlayer(id); clients.delete(ws); });
  ws.on('error', () => {});
});

let lastT = Date.now();
setInterval(() => {
  const now = Date.now();
  let dt = (now - lastT) / 1000; lastT = now;
  if (dt > 0.1) dt = 0.1;
  for (const b of bots) {
    if (!b.alive) { world.spawnPlayer(b); b.name = api.Bots.name(); b.color = api.util.randColor(); b.skin = botSkin(); }
    else world.applyInput(b.id, api.Bots.think(world, b));
  }
  world.step(dt);
  for (const [ws, c] of clients) {
    const p = world.players.get(c.id);
    if (p && !p.alive && !c.deadNotified) {
      c.deadNotified = true;
      if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'dead', maxMass: p.maxMass, survived: world.time - p.bornAt }));
    }
  }
}, 1000 / 30);

function viewFor(p) {
  let cx = world.size / 2, cy = world.size / 2, mass = CFG.startMass;
  if (p && p.alive && p.cells.length) {
    let tm = 0; cx = 0; cy = 0;
    for (const c of p.cells) { cx += c.x * c.mass; cy += c.y * c.mass; tm += c.mass; }
    cx /= tm; cy /= tm; mass = tm;
  }
  const half = (api.radius(mass) + CFG.view.base) * 2.4;
  return { x0: cx - half * 1.4, x1: cx + half * 1.4, y0: cy - half, y1: cy + half };
}
setInterval(() => {
  for (const [ws, c] of clients) {
    if (ws.readyState !== 1) continue;
    const p = world.players.get(c.id);
    const snap = world.buildSnapshot(c.id, viewFor(p));
    applyNearbyDeltas(c, snap);
    ws.send(JSON.stringify({ t: 'snap', time: world.time, snap }));
  }
  world.events.length = 0;
}, 1000 / 30);

const PORT = process.env.PORT || 8137;
httpServer.listen(PORT, () => {
  console.log('CellRush server running:');
  console.log('  play here ->  http://localhost:' + PORT);
  console.log('  (open multiple tabs/devices to play together)');
});