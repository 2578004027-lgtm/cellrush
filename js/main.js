// CellRush — boot + render loop for the ONLINE build.
// The server runs the authoritative world; this client sends input and renders
// the snapshots it receives. Swap NetTransport here if you ever change backends.
(function (G) {
  let transport = null, last = 0, playing = false, paused = false, camInit = false;
  let fpsEl = null, frames = 0, fpsAcc = 0;

  function startGame(name, color) {
    if (transport) transport.close();
    G.Render._lerp.clear();
    camInit = false; playing = true; paused = false;
    G.Audio.resume();
    transport = new G.NetTransport({
      name, color,
      onWelcome: () => {},
      onDead: (m) => { playing = false; G.UI.showDeath({ maxMass: m.maxMass }, m.survived || 0); },
      onClose: () => { if (playing) { playing = false; G.UI.showError('与服务器断开了'); } },
      onError: () => { playing = false; G.UI.showError('连不上服务器。先在终端运行  node server/server.js  再用它给的地址打开。'); },
    });
    if (G.settings.admin) transport.setAdmin(true);
  }
  function respawn(name, color) {
    if (!transport || !transport.ws || transport.ws.readyState > 1) return startGame(name, color);
    transport.respawnMe(name, color);
    if (G.settings.admin) transport.setAdmin(true);
    camInit = false; playing = true; paused = false;
  }

  function loop(t) {
    requestAnimationFrame(loop);
    const now = t / 1000;
    let dt = now - last; last = now;
    if (dt > 0.25) dt = 0.25;

    if (transport) {
      const input = (playing && !paused) ? G.Input.sample(G.Render.camera) : null;
      transport.update(dt, input);
      const snap = transport.getSnapshot();
      if (playing && snap.me && !camInit) { G.Render.centerOn(snap.me.x, snap.me.y); G.Render.camera.scale = 1; camInit = true; }
      G.Render.frame(snap, dt, input);
      frames++; fpsAcc += dt;
      if (fpsAcc > 0.5) { if (fpsEl) fpsEl.textContent = Math.round(frames / fpsAcc) + ' fps'; frames = 0; fpsAcc = 0; }
    } else {
      G.Render.clear();
    }
  }

  window.addEventListener('load', () => {
    G.Render.init(document.getElementById('game'));
    G.Input.init();
    fpsEl = document.getElementById('fps');
    G.UI.init({
      onPlay: startGame,
      onRespawn: respawn,
      onPause: (v) => { paused = v; },
      onAdmin: (on) => { G.settings.admin = on; if (transport) transport.setAdmin(on); },
      onBackToMenu: () => { playing = false; paused = false; if (transport) transport.close(); transport = null; G.Render._lerp.clear(); },
      isPlaying: () => playing,
    });
    last = performance.now() / 1000;
    requestAnimationFrame(loop);
  });
})(window.G);
