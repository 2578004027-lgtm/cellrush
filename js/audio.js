// CellRush — tiny procedural sound effects via WebAudio (no asset files).
(function (G) {
  let ac = null;
  function ctx() {
    if (!ac) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) ac = new AC(); }
    return ac;
  }
  function blip(freq, dur, type, vol) {
    const a = ctx(); if (!a) return;
    try {
      const o = a.createOscillator(), g = a.createGain();
      o.type = type || 'sine'; o.frequency.value = freq;
      g.gain.value = vol || 0.05;
      o.connect(g); g.connect(a.destination);
      const t = a.currentTime;
      o.start(t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.stop(t + dur);
    } catch (e) { /* ignore */ }
  }
  G.Audio = {
    enabled: true,
    resume() { const a = ctx(); if (a && a.state === 'suspended') a.resume(); },
    eat() { if (this.enabled) blip(380 + Math.random() * 120, 0.07, 'sine', 0.03); },
    split() { if (this.enabled) blip(240, 0.12, 'square', 0.05); },
    pop() { if (this.enabled) blip(150, 0.22, 'sawtooth', 0.06); },
    death() { if (this.enabled) blip(120, 0.5, 'sawtooth', 0.08); },
  };
})(window.G);
