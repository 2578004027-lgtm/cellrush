// CellRush - boot and render loop for the online build.
(function (G) {
  let transport = null, last = 0, playing = false, paused = false, camInit = false;
  let frames = 0, fpsAcc = 0;

  function startGame(name, color, skin) {
    if (transport) transport.close();
    G.Render._lerp.clear();
    camInit = false; playing = true; paused = false;
    G.Audio.resume();
    transport = new G.NetTransport({
      name, color, skin,
      onWelcome: () => {},
      onDead: (m) => { playing = false; G.UI.showDeath({ maxMass: m.maxMass }, m.survived || 0); },
      onClose: () => { if (playing) { playing = false; G.UI.showError('连接已断开。'); } },
      onError: () => { playing = false; G.UI.showError('连接不上服务器。请先运行 node server/server.js，再打开服务器给出的地址。'); },
    });
    if (G.settings.admin) transport.setAdmin(true);
  }

  function respawn(name, color, skin) {
    if (!transport || !transport.ws || transport.ws.readyState > 1) return startGame(name, color, skin);
    transport.respawnMe(name, color, skin);
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
      if (fpsAcc > 0.5) { G.Render.fps = Math.round(frames / fpsAcc); frames = 0; fpsAcc = 0; }
    } else {
      G.Render.clear();
    }
  }

  window.addEventListener('load', () => {
    G.Render.init(document.getElementById('game'));
    G.Input.init();
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