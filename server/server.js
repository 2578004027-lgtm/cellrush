// CellRush — authoritative game server.
// Serves the static client AND the WebSocket on ONE port, so `node server/server.js`
// then opening the printed URL is all you need. Multiple tabs = multiple players.
// Reuses the EXACT client sim files (js/world.js, js/bots.js, ...) unchanged.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

// ---- load the shared simulation (same files the browser uses) ----
global.window = global;                              // browser semantics so bare `G` resolves
const ROOT = path.join(__dirname, '..');
for (const n of ['config', 'util', 'world', 'bots']) {
  // eslint-disable-next-line no-eval
  eval(fs.readFileSync(path.join(ROOT, 'js', n + '.js'), 'utf8'));
}
const api = global.window.G;                         // NOT named `G` — config.js uses a bare global `G`
const CFG = api.CFG;

// safety net: never let one bad client or edge case take down the whole server
process.on('uncaughtException', (e) => console.error('[server] uncaught:', (e && e.stack) || e));

// ---- static file server (serves the cellrush/ folder) ----
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.task': 'application/octet-stream' };
const httpServer = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---- the one shared world + its bots ----
const world = new api.World();
const bots = [];
for (let i = 0; i < CFG.botCount; i++) bots.push(world.addPlayer({ name: api.Bots.name(), color: api.util.randColor(), isBot: true }));

// ---- websocket: one connection == one human player ----
const wss = new WebSocketServer({ server: httpServer });
let nextId = 1;
const clients = new Map();   // ws -> { id, deadNotified }

function applyColor(p, c) { if (c && typeof c.h === 'number') p.color = api.util.colorFromHue(c.h); }

wss.on('connection', (ws) => {
  const id = 'h' + (nextId++);
  world.addPlayer({ id, name: '玩家', color: api.util.randColor(), isBot: false });
  const client = { id, deadNotified: false };
  clients.set(ws, client);
  ws.send(JSON.stringify({ t: 'welcome', id, world: world.size }));

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    const p = world.players.get(id); if (!p) return;
    if (m.t === 'join') { p.name = (m.name || '玩家').slice(0, 14); applyColor(p, m.color); }
    else if (m.t === 'input') { world.applyInput(id, m); }
    else if (m.t === 'respawn') { if (m.name) p.name = ('' + m.name).slice(0, 14); applyColor(p, m.color); world.spawnPlayer(p); client.deadNotified = false; }
    else if (m.t === 'admin') { p.admin = !!m.on; }
  });
  ws.on('close', () => { world.removePlayer(id); clients.delete(ws); });
  ws.on('error', () => {});
});

// ---- authoritative simulation loop (30 Hz) ----
let lastT = Date.now();
setInterval(() => {
  const now = Date.now();
  let dt = (now - lastT) / 1000; lastT = now;
  if (dt > 0.1) dt = 0.1;
  for (const b of bots) {
    if (!b.alive) { world.spawnPlayer(b); b.name = api.Bots.name(); b.color = api.util.randColor(); }
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

// ---- broadcast snapshots (20 Hz), culled per player, then clear events ----
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
    ws.send(JSON.stringify({ t: 'snap', snap: world.buildSnapshot(c.id, viewFor(p)) }));
  }
  world.events.length = 0;
}, 1000 / 30);

const PORT = process.env.PORT || 8137;
httpServer.listen(PORT, () => {
  console.log('CellRush server running:');
  console.log('  play here ->  http://localhost:' + PORT);
  console.log('  (open multiple tabs/devices to play together)');
});
