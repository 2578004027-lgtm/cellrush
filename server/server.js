// CellRush - authoritative game server.
// Serves the static client and WebSocket on one port.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

global.window = global;
const ROOT = path.join(__dirname, '..');
for (const n of ['config', 'util', 'world', 'bots']) {
  // eslint-disable-next-line no-eval
  eval(fs.readFileSync(path.join(ROOT, 'js', n + '.js'), 'utf8'));
}
const api = global.window.G;
const CFG = api.CFG;
const ADMIN_KEY = process.env.CELLRUSH_ADMIN_KEY || process.env.ADMIN_KEY || '';
const ADMIN_USER = (process.env.CELLRUSH_ADMIN_USER || process.env.ADMIN_USER || 'admin').toLowerCase();
const ADMIN_PASSWORD = process.env.CELLRUSH_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '13916';
const DATA_DIR = path.join(__dirname, 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');

process.on('uncaughtException', (e) => console.error('[server] uncaught:', (e && e.stack) || e));
function loadAccounts() {
  try { return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')); }
  catch (e) { return { users: {} }; }
}
function saveAccounts() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2)); }
  catch (e) { console.error('[server] account save failed:', e.message); }
}
function cleanAccountName(v) {
  v = (typeof v === 'string' ? v : '').trim().toLowerCase();
  return /^[a-z0-9_]{3,16}$/.test(v) ? v : '';
}
function hashPassword(pass, salt) {
  return crypto.createHash('sha256').update(salt + ':' + pass).digest('hex');
}
function publicAccount(u) {
  return { name: u.name, diamonds: u.diamonds || 0, unlockedSkills: u.unlockedSkills || [], admin: !!u.admin, qq: u.qq || '' };
}
function attachAccount(p, u) {
  p.account = u.name;
  p.diamonds = u.diamonds || 0;
  p.unlockedSkills = Array.from(new Set(u.unlockedSkills || []));
  p.qq = u.qq || '';
}
function sendAccount(ws, ok, u, error) {
  if (ws.readyState !== 1) return;
  const msg = { t: 'account', ok: !!ok };
  if (u) msg.account = publicAccount(u);
  if (error) msg.error = error;
  ws.send(JSON.stringify(msg));
}
function loginAccount(p, ws, rawName, rawPass) {
  const name = cleanAccountName(rawName);
  const pass = typeof rawPass === 'string' ? rawPass : '';
  if (!name && !pass) return;
  if (!name) return sendAccount(ws, false, null, '\u8d26\u53f7\u5fc5\u987b\u662f 3-16 \u4f4d\u82f1\u6587\u3001\u6570\u5b57\u6216\u4e0b\u5212\u7ebf\u3002');
  if (pass.length < 4 || pass.length > 40) return sendAccount(ws, false, null, '\u5bc6\u7801\u5fc5\u987b\u662f 4-40 \u4f4d\u3002');
  let u = accounts.users[name];
  const isAdminLogin = name === ADMIN_USER && pass === ADMIN_PASSWORD;
  if (isAdminLogin) {
    const salt = (u && u.salt) || crypto.randomBytes(12).toString('hex');
    u = accounts.users[name] = {
      name, salt, passHash: hashPassword(pass, salt), diamonds: 999999,
      unlockedSkills: Array.from(new Set(CFG.specialSkillOrder || [])), admin: true,
    };
    saveAccounts();
  } else if (!u) {
    const salt = crypto.randomBytes(12).toString('hex');
    u = accounts.users[name] = { name, salt, passHash: hashPassword(pass, salt), diamonds: 99999, unlockedSkills: [] };
    saveAccounts();
  } else if (u.passHash !== hashPassword(pass, u.salt)) {
    return sendAccount(ws, false, null, '\u5bc6\u7801\u9519\u8bef\u3002');
  }
  if (!u.admin && (u.diamonds || 0) < 99999) { u.diamonds = 99999; saveAccounts(); }
  attachAccount(p, u);
  p.admin = !!u.admin;
  sendAccount(ws, true, u);
}

function cleanQQ(v) {
  v = (typeof v === 'string' ? v : '').trim();
  return /^[1-9][0-9]{4,11}$/.test(v) ? v : '';
}
function bindQQ(p, ws, rawQQ) {
  if (!p.account) return sendAccount(ws, false, null, '\u8bf7\u5148\u767b\u5f55\u8d26\u53f7\u3002');
  const qq = cleanQQ(rawQQ);
  if (!qq) return sendAccount(ws, false, accounts.users[p.account] || null, '\u8bf7\u8f93\u5165\u6b63\u786e\u7684 QQ \u53f7\u3002');
  const u = accounts.users[p.account];
  if (!u) return sendAccount(ws, false, null, '\u8bf7\u5148\u767b\u5f55\u8d26\u53f7\u3002');
  u.qq = qq;
  saveAccounts();
  attachAccount(p, u);
  sendAccount(ws, true, u);
}

function buySkill(p, ws, skill) {
  if (!p.account) return sendAccount(ws, false, null, '\u8bf7\u5148\u767b\u5f55\u3002');
  const def = CFG.skills[skill];
  if (!def) return sendAccount(ws, false, null, '\u672a\u77e5\u6280\u80fd\u3002');
  const u = accounts.users[p.account];
  if (!u) return sendAccount(ws, false, null, '\u8bf7\u5148\u767b\u5f55\u3002');
  u.unlockedSkills = Array.from(new Set(u.unlockedSkills || []));
  if (!u.unlockedSkills.includes(skill)) {
    const cost = def.cost || 0;
    if ((u.diamonds || 0) < cost) return sendAccount(ws, false, u, '\u94bb\u77f3\u4e0d\u8db3\u3002');
    u.diamonds = (u.diamonds || 0) - cost;
    u.unlockedSkills.push(skill);
    saveAccounts();
  }
  if (!u.admin && (u.diamonds || 0) < 99999) { u.diamonds = 99999; saveAccounts(); }
  attachAccount(p, u);
  sendAccount(ws, true, u);
}
function awardDiamonds(p, amount) {
  if (!p || !p.account || amount <= 0) return 0;
  const u = accounts.users[p.account];
  if (!u) return 0;
  u.diamonds = (u.diamonds || 0) + amount;
  saveAccounts();
  if (!u.admin && (u.diamonds || 0) < 99999) { u.diamonds = 99999; saveAccounts(); }
  attachAccount(p, u);
  return amount;
}
const accounts = loadAccounts();

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.task': 'application/octet-stream' };
const httpServer = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/api/status') {
    const body = JSON.stringify(statusPayload());
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(body); return;
  }
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
const TUNABLES = {
  startMass: { path: ['startMass'], min: 35, max: 2000, int: true },
  botStartMass: { path: ['botStartMass'], min: 20, max: 500, int: true },
  mergeMin: { path: ['mergeMin'], min: 0.3, max: 3 },
  mergeMax: { path: ['mergeMax'], min: 0.5, max: 10 },
  splitLaunchRadii: { path: ['splitLaunchRadii'], min: 0.4, max: 3 },
  splitImpulse: { path: ['splitImpulse'], min: 200, max: 3000, int: true },
  splitStartSeparation: { path: ['splitStartSeparation'], min: 1.4, max: 3 },
  foodCount: { path: ['foodCount'], min: 200, max: 3000, int: true },
  ejectMax: { path: ['ejectMax'], min: 100, max: 3000, int: true },
  virusCount: { path: ['virusCount'], min: 0, max: 80, int: true },
  poisonDelay: { path: ['skills', 'poison', 'poisonDelay'], min: 0.5, max: 8 },
  poisonShrink: { path: ['skills', 'poison', 'poisonShrink'], min: 0.05, max: 0.9 },
};
function tuneGet(pathParts) {
  let o = CFG;
  for (const k of pathParts) o = o && o[k];
  return o;
}
function tuneSet(pathParts, value) {
  let o = CFG;
  for (let i = 0; i < pathParts.length - 1; i++) o = o[pathParts[i]];
  o[pathParts[pathParts.length - 1]] = value;
}
function tuningSnapshot() {
  const out = {};
  for (const k of Object.keys(TUNABLES)) out[k] = tuneGet(TUNABLES[k].path);
  return out;
}

function aliveStats() {
  let humans = 0, botsAlive = 0, spectators = 0, alive = 0;
  for (const p of world.players.values()) {
    if (p.spectator) spectators++;
    if (!p.alive) continue;
    alive++;
    if (p.isBot) botsAlive++; else humans++;
  }
  return { humans, bots: botsAlive, spectators, alive };
}
function statusPayload() {
  const st = aliveStats();
  return {
    ok: true, room: 'default', region: 'Shanghai', world: world.size,
    clients: clients.size, humans: st.humans, bots: st.bots, spectators: st.spectators, alive: st.alive,
    food: world.food.length, viruses: world.viruses.length, ejected: world.ejected.length, cells: cellCount(), time: Math.round(world.time || 0), now: Date.now()
  };
}

function applyAdminTuning(params) {
  if (params && typeof params === 'object') {
    for (const k of Object.keys(params)) {
      const def = TUNABLES[k];
      if (!def) continue;
      let v = Number(params[k]);
      if (!Number.isFinite(v)) continue;
      v = Math.max(def.min, Math.min(def.max, v));
      if (def.int) v = Math.round(v);
      tuneSet(def.path, v);
    }
    if (CFG.mergeMax < CFG.mergeMin) CFG.mergeMax = CFG.mergeMin;
    while (world.food.length > CFG.foodCount) world.food.pop();
    while (world.food.length < CFG.foodCount) world.food.push(world._spawnFood());
    while (world.viruses.length > CFG.virusCount) world.viruses.pop();
    while (world.viruses.length < CFG.virusCount) world.viruses.push(world._spawnVirus());
    for (const b of bots) b.spawnMass = CFG.botStartMass || 50;
  }
  return tuningSnapshot();
}
function sendAdminTune(ws, ok, tuning, error) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'adminTune', ok: !!ok, tuning: tuning || tuningSnapshot(), error: error || '' }));
}
function botSkin() {
  const skins = (CFG.skinPresets || []).filter(Boolean);
  return skins.length ? api.util.pick(skins) : '';
}
for (let i = 0; i < CFG.botCount; i++) bots.push(world.addPlayer({ name: api.Bots.name(), color: api.util.randColor(), skin: botSkin(), isBot: true, startMass: CFG.botStartMass || 50 }));

const wss = new WebSocketServer({ server: httpServer });
let nextId = 1;
const clients = new Map();

function cleanChatText(v) {
  return (typeof v === 'string' ? v : '').replace(/[\r\n\t]/g, ' ').trim().slice(0, 120);
}
function broadcastChat(msg) {
  const payload = JSON.stringify({ t: 'chat', name: msg.name || '', text: msg.text || '', system: !!msg.system, at: Date.now() });
  for (const ws of clients.keys()) if (ws.readyState === 1) ws.send(payload);
}
function systemChat(text) { broadcastChat({ system: true, text }); }
function broadcastKill(msg) {
  const payload = JSON.stringify({ t: 'kill', killer: msg.killer || '', victim: msg.victim || '', kills: msg.kills || 0, maxMass: msg.maxMass || 0, at: Date.now() });
  for (const ws of clients.keys()) if (ws.readyState === 1) ws.send(payload);
}

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
    lastChatAt: 0,
    lastSignalAt: 0,
    lastSpectateAt: 0,
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
  world.addPlayer({ id, name: 'Player', color: api.util.randColor(), isBot: false });
  const client = makeClient(id);
  clients.set(ws, client);
  ws.send(JSON.stringify({ t: 'welcome', id, world: world.size }));

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    const p = world.players.get(id); if (!p) return;
    if (m.t === 'join') {
      p.name = (typeof m.name === 'string' ? m.name : 'Player').slice(0, 14); applyColor(p, m.color); applySkin(p, m.skin);
      if (m.spectate) { p.spectator = true; p.alive = false; p.cells = []; p.spectateIndex = 0; systemChat(p.name + ' \u5f00\u59cb\u89c2\u6218'); }
      else { p.spectator = false; if (!p.alive || !p.cells.length) world.spawnPlayer(p); loginAccount(p, ws, m.account, m.password); systemChat(p.name + ' \u52a0\u5165\u4e86\u6e38\u620f'); }
    }
    else if (m.t === 'input') {
      if (m.signal) {
        const nowSignal = Date.now();
        if (nowSignal - (client.lastSignalAt || 0) > 1200) {
          client.lastSignalAt = nowSignal;
          const sx = Math.max(0, Math.min(world.size, Number(m.tx) || 0));
          const sy = Math.max(0, Math.min(world.size, Number(m.ty) || 0));
          const payload = JSON.stringify({ t: 'signal', name: p.name || 'Player', x: sx, y: sy, color: (p.color && p.color.css) || '#7cffb0', at: nowSignal });
          for (const qws of clients.keys()) if (qws.readyState === 1) qws.send(payload);
        }
      }
      if (p.spectator && m.spectateDir) {
        const nowSpectate = Date.now();
        if (nowSpectate - (client.lastSpectateAt || 0) > 120) {
          client.lastSpectateAt = nowSpectate;
          p.spectateIndex = (p.spectateIndex || 0) + (Number(m.spectateDir) > 0 ? 1 : -1);
        }
      }
      world.applyInput(id, m);
    }
    else if (m.t === 'respawn') { if (m.name) p.name = ('' + m.name).slice(0, 14); applyColor(p, m.color); applySkin(p, m.skin); p.spectator = false; p.spectateIndex = 0; world.spawnPlayer(p); client.deadNotified = false; }
    else if (m.t === 'adminAuth') {
      const ok = !!(ADMIN_KEY && typeof m.key === 'string' && m.key === ADMIN_KEY);
      p.admin = ok;
      if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'adminAuth', ok }));
    } else if (m.t === 'buySkill') {
      buySkill(p, ws, m.skill);
    } else if (m.t === 'bindQQ') {
      bindQQ(p, ws, m.qq);
    } else if (m.t === 'adminTune') {
      if (!p.admin) sendAdminTune(ws, false, null, '\u6ca1\u6709\u6743\u9650');
      else sendAdminTune(ws, true, applyAdminTuning(m.params || null));
    } else if (m.t === 'chat') {
      const text = cleanChatText(m.text);
      const nowChat = Date.now();
      if (text && nowChat - (client.lastChatAt || 0) > 800) { client.lastChatAt = nowChat; broadcastChat({ name: p.name || 'Player', text, system: false }); }
    } else if (m.t === 'admin') {
      if (p.admin && m.on === false) p.admin = false;
    }
  });
  ws.on('close', () => { world.removePlayer(id); clients.delete(ws); });
  ws.on('error', () => {});
});

function msNow() { return Number(process.hrtime.bigint()) / 1e6; }
const perf = { simN: 0, simSum: 0, simMax: 0, snapN: 0, snapSum: 0, snapMax: 0 };
function notePerf(kind, ms) {
  const n = kind + 'N', sum = kind + 'Sum', max = kind + 'Max';
  perf[n]++; perf[sum] += ms; if (ms > perf[max]) perf[max] = ms;
}
function cellCount() {
  let n = 0;
  for (const p of world.players.values()) if (p.alive) n += p.cells.length;
  return n;
}
setInterval(() => {
  const simAvg = perf.simN ? perf.simSum / perf.simN : 0;
  const snapAvg = perf.snapN ? perf.snapSum / perf.snapN : 0;
  console.log('[perf] clients=%d bots=%d cells=%d food=%d viruses=%d ejected=%d simAvg=%sms simMax=%sms snapAvg=%sms snapMax=%sms',
    clients.size, bots.length, cellCount(), world.food.length, world.viruses.length, world.ejected.length,
    simAvg.toFixed(2), perf.simMax.toFixed(2), snapAvg.toFixed(2), perf.snapMax.toFixed(2));
  perf.simN = perf.simSum = perf.simMax = perf.snapN = perf.snapSum = perf.snapMax = 0;
}, 5000);
let lastT = Date.now();
setInterval(() => {
  const now = Date.now();
  let dt = (now - lastT) / 1000; lastT = now;
  if (dt > 0.1) dt = 0.1;
  const simStart = msNow();
  for (const b of bots) {
    if (!b.alive) { b.spawnMass = CFG.botStartMass || 50; world.spawnPlayer(b); b.name = api.Bots.name(); b.color = api.util.randColor(); b.skin = botSkin(); }
    else world.applyInput(b.id, api.Bots.think(world, b));
  }
  world.step(dt);
  notePerf('sim', msNow() - simStart);
  for (const [ws, c] of clients) {
    const p = world.players.get(c.id);
    if (p && !p.spectator && !p.alive && !c.deadNotified) {
      c.deadNotified = true;
      const survived = world.time - p.bornAt;
      const reward = Math.min(35, Math.max(1, Math.floor((p.maxMass || 0) / 120) + Math.floor(survived / 60)));
      const earned = awardDiamonds(p, reward);
      if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'dead', maxMass: p.maxMass, survived, kills: p.kills || 0, killedBy: p.killedBy || '', diamondsEarned: earned, diamonds: p.diamonds || 0 }));
      broadcastKill({ killer: p.killedBy || '', victim: p.name || 'Player', kills: p.kills || 0, maxMass: p.maxMass || 0 });
      systemChat(p.killedBy ? ((p.killedBy || 'Player') + ' \u5403\u6389\u4e86 ' + (p.name || 'Player')) : ((p.name || 'Player') + ' \u88ab\u5403\u6389\u4e86'));
    }
  }
}, 1000 / 30);

function rankedViewInfos() {
  const out = [];
  for (const q of world.players.values()) {
    if (!q.alive || q.spectator) continue;
    let cx = 0, cy = 0, tm = 0;
    for (const c of q.cells) { cx += c.x * c.mass; cy += c.y * c.mass; tm += c.mass; }
    if (tm > 0) out.push({ p: q, x: cx / tm, y: cy / tm, mass: tm, cells: q.cells.length, name: q.name || 'Player' });
  }
  out.sort((a, b) => b.mass - a.mass);
  out.forEach((v, i) => { v.rank = i + 1; });
  return out;
}
function leaderViewInfo() { return rankedViewInfos()[0] || null; }
function viewFor(p) {
  let cx = world.size / 2, cy = world.size / 2, mass = CFG.startMass;
  if (p && p.spectator) {
    const ranked = rankedViewInfos();
    if (ranked.length) {
      const idx = ((p.spectateIndex || 0) % ranked.length + ranked.length) % ranked.length;
      p.spectateIndex = idx;
      const lead = ranked[idx];
      p._spectateView = lead;
      cx = lead.x; cy = lead.y; mass = lead.mass;
    } else p._spectateView = null;
  } else if (p && p.alive && p.cells.length) {
    let tm = 0; cx = 0; cy = 0;
    for (const c of p.cells) { cx += c.x * c.mass; cy += c.y * c.mass; tm += c.mass; }
    cx /= tm; cy /= tm; mass = tm;
  }
  const half = (api.radius(mass) + CFG.view.base) * 2.4;
  return { x0: cx - half * 1.4, x1: cx + half * 1.4, y0: cy - half, y1: cy + half };
}
setInterval(() => {
  const snapStart = msNow();
  for (const [ws, c] of clients) {
    if (ws.readyState !== 1) continue;
    const p = world.players.get(c.id);
    const snap = world.buildSnapshot(c.id, viewFor(p));
    applyNearbyDeltas(c, snap);
    ws.send(JSON.stringify({ t: 'snap', time: world.time, snap }));
  }
  world.events.length = 0;
  notePerf('snap', msNow() - snapStart);
}, 1000 / 30);

const PORT = process.env.PORT || 8137;
httpServer.listen(PORT, () => {
  console.log('CellRush server running:');
  console.log('  play here ->  http://localhost:' + PORT);
  console.log('  (open multiple tabs/devices to play together)');
});
