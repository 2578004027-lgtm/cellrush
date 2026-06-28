// CellRush - boot and render loop for the online build.
(function (G) {
  let transport = null, last = 0, playing = false, paused = false, camInit = false;
  let frames = 0, fpsAcc = 0;

  function startGame(name, color, skin, account, password, spectate) {
    if (transport) transport.close();
    G.Render._lerp.clear();
    camInit = false; playing = true; paused = false;
    G.Audio.resume();
    transport = new G.NetTransport({
      name, color, skin, account, password, spectate: !!spectate,
      onWelcome: () => {},
      onAccount: (m) => G.UI.setAccount(m),
      onAdminTune: (m) => G.UI.setAdminTuning(m),
      onDead: (m) => { playing = false; G.UI.showDeath({ maxMass: m.maxMass, diamondsEarned: m.diamondsEarned || 0, diamonds: m.diamonds || 0 }, m.survived || 0); },
      onClose: () => { if (playing) { playing = false; G.UI.showError('\\u8fde\\u63a5\\u5df2\\u65ad\\u5f00\\u3002'); } },
      onError: () => { playing = false; G.UI.showError('\\u8fde\\u63a5\\u4e0d\\u4e0a\\u670d\\u52a1\\u5668\\uff0c\\u8bf7\\u5148\\u542f\\u52a8\\u672c\\u5730\\u670d\\u52a1\\u3002'); },
    });

  }

  function respawn(name, color, skin) {
    if (!transport || !transport.ws || transport.ws.readyState > 1) return startGame(name, color, skin);
    transport.respawnMe(name, color, skin);

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
      G.Render.menuFrame(dt);
    }
  }

  window.addEventListener('load', () => {
    G.Render.init(document.getElementById('game'));
    G.Input.init();
    G.UI.init({
      onPlay: startGame,
      onSpectate: (name, color, skin, account, password) => startGame(name, color, skin, account, password, true),
      onRespawn: respawn,
      onPause: (v) => { paused = v; },
      onAdminKey: (key) => { if (transport) transport.adminLogin(key); },
      onBuySkill: (skill) => { if (transport) transport.buySkill(skill); },
      onAdminTune: (params) => { if (transport) transport.adminTune(params); },
      onBackToMenu: () => { playing = false; paused = false; if (transport) transport.close(); transport = null; G.Render._lerp.clear(); },
      isPlaying: () => playing,
      isAdmin: () => !!(transport && transport.latest && transport.latest.me && transport.latest.me.admin),
    });
    last = performance.now() / 1000;
    requestAnimationFrame(loop);
  });
})(window.G);
