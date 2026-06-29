// Headless smoke test of the pure simulation (no DOM). Run with: node test_sim.js
global.window = global;        // browser semantics: window === global, so bare `G` resolves
const fs = require('fs');
['config', 'util', 'world', 'bots'].forEach((n) => {
  eval(fs.readFileSync(__dirname + '/js/' + n + '.js', 'utf8'));
});
const api = global.window.G;

function botSkin() {
  const skins = (api.CFG.skinPresets || []).filter(Boolean);
  return skins.length ? api.util.pick(skins) : '';
}

function fullView() {
  return { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 };
}

const world = new api.World();
for (let i = 0; i < api.CFG.botCount; i++) {
  world.addPlayer({
    name: api.Bots.name(),
    color: api.util.randColor(),
    skin: botSkin(),
    isBot: true,
    startMass: api.CFG.botStartMass || 50,
  });
}
world.addPlayer({ id: 'you', name: 'tester', color: api.util.colorFromHue(200), isBot: false });

let everSplit = false, startMass = 0, dashCdSeen = false, massBeforeAdmin = 0, adminCd0 = false, mergeUsed = false;
for (let i = 0; i < 900; i++) {
  const me = world.players.get('you');
  if (!me.alive) break;
  const c = me.cells[0];
  // chase nearest food so the cell actually grows
  let bx = c.x, by = c.y, bd = 1e18;
  for (const f of world.food) {
    const d = (f.x - c.x) ** 2 + (f.y - c.y) ** 2;
    if (d < bd) { bd = d; bx = f.x; by = f.y; }
  }
  const mass = me.cells.reduce((s, k) => s + k.mass, 0);
  if (i === 0) startMass = mass;

  let skill = null;
  if (i === 100) skill = 'dash';
  if (i === 130) skill = 'shield';
  if (i === 160) skill = 'magnet';
  if (i === 190) skill = 'merge';
  const admin = i >= 600;
  if (i === 600) { me.admin = true; massBeforeAdmin = mass; }
  if (admin && i % 5 === 0) skill = 'dash';      // spam: admin cooldown should stay 0

  const inp = {
    tx: bx, ty: by,
    split: mass > 50 && me.cells.length < 6 && i % 150 === 0,
    eject: i === 300 && mass > 40,
    skill, adminGrow: admin && i % 40 === 0,
  };

  for (const b of world.players.values()) {
    if (!b.isBot) continue;
    if (!b.alive) world.spawnPlayer(b);
    else world.applyInput(b.id, api.Bots.think(world, b));
  }
  world.applyInput('you', inp);
  world.step(1 / 30);

  const meNow = world.players.get('you');
  if (meNow.cells.length > 1) everSplit = true;
  if (i === 105 && world.time < meNow.cd.dash) dashCdSeen = true;   // dash went on cooldown
  if (i === 195 && world.time < meNow.cd.merge) mergeUsed = true;   // merge skill registered
  if (i === 610 && meNow.cd.dash === 0) adminCd0 = true;            // admin: no cooldown
}

const me = world.players.get('you');
const myMass = me.cells.reduce((s, c) => s + c.mass, 0);
console.log('me: alive=%s cells=%d mass=%s maxMass=%d', me.alive, me.cells.length, myMass.toFixed(1), Math.floor(me.maxMass));
console.log('world: players=%d food=%d viruses=%d ejected=%d', world.players.size, world.food.length, world.viruses.length, world.ejected.length);

const snap = world.buildSnapshot('you', fullView());
console.log('snapshot: cells=%d food=%d viruses=%d leaderboard=%d me=%s players=%d',
  snap.cells.length, snap.food.length, snap.viruses.length, snap.leaderboard.length, !!snap.me, snap.players.length);

let bad = [];
if (!(myMass > 0)) bad.push('player mass not positive');
if (!(myMass > startMass + 20)) bad.push('player did not grow by eating (start ' + startMass.toFixed(0) + ' -> ' + myMass.toFixed(0) + ')');
if (!everSplit) bad.push('split never produced extra cells');
if (!dashCdSeen) bad.push('dash skill did not register a cooldown');
if (!mergeUsed) bad.push('merge (F) skill did not register');
if (!adminCd0) bad.push('admin did not zero skill cooldown');
if (!snap.me || !snap.me.skills || snap.me.skills.length !== 4) bad.push('snapshot missing skills (expected 4)');
if (!Array.isArray(snap.events)) bad.push('snapshot has no events array');
if (!snap.me || !snap.me.admin) bad.push('admin flag not in snapshot');
if (!(myMass > massBeforeAdmin)) bad.push('admin grow did not increase mass');
if (snap.food.length === 0) bad.push('no food');
if (snap.leaderboard.length === 0) bad.push('empty leaderboard');
if (world.players.size !== api.CFG.botCount + 1) bad.push('player count wrong: ' + world.players.size);
if (snap.leaderboard.some((e) => isNaN(e.mass))) bad.push('NaN in leaderboard');
if (me.cells.some((c) => isNaN(c.x) || isNaN(c.y) || isNaN(c.mass))) bad.push('NaN in player cells');

console.log('grew %d -> %d, everSplit=%s, dashCd=%s, admin=%s', Math.floor(startMass), Math.floor(myMass), everSplit, dashCdSeen, !!(snap.me && snap.me.admin));
console.log('skills:', snap.me && snap.me.skills ? snap.me.skills.map((s) => s.key + '(' + s.remain.toFixed(1) + 's)').join(' ') : 'none');
console.log(bad.length ? 'FAIL: ' + bad.join('; ') : 'PASS: eat/grow/split/skills/admin all working');
process.exit(bad.length ? 1 : 0);
