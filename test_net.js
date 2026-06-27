// Headless online smoke test: connect, join, send input, verify snapshots.
// Run with the server already up: node test_net.js
const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:8137');
let gotWelcome = false, myId = null, snaps = 0, snapInfo = null, sawSplitGrowth = false;

ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'join', name: 'tester', color: { h: 200 } }));
  let i = 0;
  const iv = setInterval(() => {
    if (ws.readyState !== 1) return clearInterval(iv);
    ws.send(JSON.stringify({ t: 'input', tx: 3000, ty: 3000, split: i === 6, eject: false, skill: i === 10 ? 'dash' : null }));
    if (++i > 40) clearInterval(iv);
  }, 33);
});

ws.on('message', (raw) => {
  let m; try { m = JSON.parse(raw); } catch (e) { return; }
  if (m.t === 'welcome') { gotWelcome = true; myId = m.id; }
  else if (m.t === 'snap') {
    snaps++;
    const s = m.snap;
    snapInfo = { cells: s.cells.length, food: s.food.length, viruses: s.viruses.length, me: !!s.me, lb: s.leaderboard.length, players: s.players.length, skills: s.me && s.me.skills ? s.me.skills.length : 0 };
    if (s.me && s.me.cells > 1) sawSplitGrowth = true;
  }
});
ws.on('error', (e) => { console.log('FAIL: socket error', e.message); process.exit(1); });

setTimeout(() => {
  const bad = [];
  if (!gotWelcome) bad.push('no welcome');
  if (!myId) bad.push('no player id');
  if (snaps < 3) bad.push('too few snapshots (' + snaps + ')');
  if (!snapInfo || snapInfo.food === 0) bad.push('no food in snapshot');
  if (!snapInfo || !snapInfo.me) bad.push('no "me" in snapshot');
  if (!snapInfo || snapInfo.skills !== 4) bad.push('snapshot missing 4 skills');
  console.log('welcome=%s id=%s snaps=%d split=%s', gotWelcome, myId, snaps, sawSplitGrowth);
  console.log('lastSnap=', JSON.stringify(snapInfo));
  console.log(bad.length ? 'FAIL: ' + bad.join('; ') : 'PASS: online flow works (join -> welcome -> authoritative snapshots)');
  ws.close();
  process.exit(bad.length ? 1 : 0);
}, 2500);
