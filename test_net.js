// Headless online smoke test: connect, join, send input, verify nearby delta snapshots.
const WebSocket = require('ws');
const skinUrl = '/assets/skins/ring.svg';
const ws = new WebSocket('ws://127.0.0.1:8137');
let gotWelcome = false, myId = null, snaps = 0, snapInfo = null, sawSplitGrowth = false;
let sawMe = false, sawSkills = false, sawSkin = false;
const caches = { food: new Map(), viruses: new Map(), ejected: new Map() };
const gotReset = { food: false, viruses: false, ejected: false };
const sawDelta = { food: false, viruses: false, ejected: false };

function applyDelta(s, key) {
  const cache = caches[key];
  if (s[key + 'Reset']) {
    gotReset[key] = true;
    cache.clear();
    for (const obj of s[key] || []) cache.set(obj.id, obj);
  } else if (s[key + 'Add'] || s[key + 'Update'] || s[key + 'Remove']) {
    if ((s[key] || []).length === 0 && ((s[key + 'Add'] || []).length || (s[key + 'Update'] || []).length || (s[key + 'Remove'] || []).length || s[key + 'Total'] > 0)) sawDelta[key] = true;
    for (const id of s[key + 'Remove'] || []) cache.delete(id);
    for (const obj of s[key + 'Add'] || []) cache.set(obj.id, obj);
    for (const obj of s[key + 'Update'] || []) cache.set(obj.id, obj);
  } else {
    cache.clear();
    for (const obj of s[key] || []) cache.set(obj.id, obj);
  }
}

ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'join', name: 'tester', color: { h: 200 }, skin: skinUrl }));
  let i = 0;
  const iv = setInterval(() => {
    if (ws.readyState !== 1) return clearInterval(iv);
    ws.send(JSON.stringify({ t: 'input', tx: 3000, ty: 3000, split: i === 6, eject: i === 20, skill: i === 10 ? 'dash' : null }));
    if (++i > 55) clearInterval(iv);
  }, 33);
});

ws.on('message', (raw) => {
  let m; try { m = JSON.parse(raw); } catch (e) { return; }
  if (m.t === 'welcome') { gotWelcome = true; myId = m.id; }
  else if (m.t === 'snap') {
    snaps++;
    const s = m.snap;
    applyDelta(s, 'food');
    applyDelta(s, 'viruses');
    applyDelta(s, 'ejected');
    sawMe = sawMe || !!s.me;
    sawSkills = sawSkills || !!(s.me && s.me.skills && s.me.skills.length === 4);
    sawSkin = sawSkin || s.cells.some((c) => c.isMe && c.skin === skinUrl);
    snapInfo = {
      cells: s.cells.length,
      food: caches.food.size,
      rawFood: (s.food || []).length,
      foodAdd: (s.foodAdd || []).length,
      foodUpdate: (s.foodUpdate || []).length,
      foodRemove: (s.foodRemove || []).length,
      viruses: caches.viruses.size,
      rawViruses: (s.viruses || []).length,
      virusAdd: (s.virusesAdd || []).length,
      virusUpdate: (s.virusesUpdate || []).length,
      virusRemove: (s.virusesRemove || []).length,
      ejected: caches.ejected.size,
      rawEjected: (s.ejected || []).length,
      me: !!s.me,
      lb: s.leaderboard.length,
      players: s.players.length,
      skills: s.me && s.me.skills ? s.me.skills.length : 0,
      skin: s.cells.some((c) => c.isMe && c.skin === skinUrl),
    };
    if (s.me && s.me.cells > 1) sawSplitGrowth = true;
  }
});
ws.on('error', (e) => { console.log('FAIL: socket error', e.message); process.exit(1); });

setTimeout(() => {
  const bad = [];
  if (!gotWelcome) bad.push('no welcome');
  if (!myId) bad.push('no player id');
  if (snaps < 3) bad.push('too few snapshots (' + snaps + ')');
  if (!snapInfo || snapInfo.food === 0) bad.push('no food in cached snapshot');
  if (!snapInfo || snapInfo.viruses === 0) bad.push('no viruses in cached snapshot');
  if (!gotReset.food || !gotReset.viruses || !gotReset.ejected) bad.push('missing initial entity reset');
  if (!sawDelta.food || !sawDelta.viruses) bad.push('nearby delta mode did not activate');
  if (!sawMe) bad.push('no "me" in any snapshot');
  if (!sawSkills) bad.push('snapshot missing 4 skills');
  if (!sawSkin) bad.push('skin not echoed in own cell snapshot');
  console.log('welcome=%s id=%s snaps=%d split=%s resets=%j deltas=%j seen=%j', gotWelcome, myId, snaps, sawSplitGrowth, gotReset, sawDelta, { me: sawMe, skills: sawSkills, skin: sawSkin });
  console.log('lastSnap=', JSON.stringify(snapInfo));
  console.log(bad.length ? 'FAIL: ' + bad.join('; ') : 'PASS: nearby entity delta flow works');
  ws.close();
  process.exit(bad.length ? 1 : 0);
}, 3000);