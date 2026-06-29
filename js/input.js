// CellRush - input. Translates mouse/touch/keys into the {tx,ty,split,eject,skill,...} intent.
(function (G) {
  const Input = {
    mouseX: window.innerWidth / 2, mouseY: window.innerHeight / 2,
    _split: 0, _eject: 0, _skill: null, _signal: false, _adminGrow: false, _adminShrink: false,
    _ejectHeld: false, _lastMacroEject: 0, _pauseToggle: false, _lockMove: false, _lockedAim: null, _showScoreboard: false, _spectateDir: 0,
    _stick: { active: false, id: null, x: 0, y: 0, dx: 0, dy: 0 },
    _stickEl: null, _knobEl: null,
  };

  const SKILL_KEYS = { q: 'dash', e: 'shield', r: 'magnet', f: 'merge', '1': 'revenge', '2': 'grow', '3': 'thorn', '4': 'poison', '5': 'silence' };
  const STICK_RADIUS = 58;
  const AIM_RADIUS = 240;

  function setAim(x, y) {
    Input.mouseX = Math.max(0, Math.min(window.innerWidth, x));
    Input.mouseY = Math.max(0, Math.min(window.innerHeight, y));
  }
  function isTextInput() {
    const ae = document.activeElement;
    return ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
  }
  function pulseButton(btn) {
    btn.classList.remove('triggered');
    void btn.offsetWidth;
    btn.classList.add('triggered');
    clearTimeout(btn._crTriggerTimer);
    btn._crTriggerTimer = setTimeout(() => btn.classList.remove('triggered'), 220);
  }
  function flashControl(selector) {
    const btn = document.querySelector(selector);
    if (btn) pulseButton(btn);
  }
  function fireButton(btn) {
    const now = (window.performance && window.performance.now) ? window.performance.now() : Date.now();
    const last = Number(btn.dataset.fireAt || 0);
    if (now - last < 90) return;
    btn.dataset.fireAt = String(now);
    pulseButton(btn);
    const action = btn.dataset.action;
    const skill = btn.dataset.skill;
    if (action === 'split') Input._split = Math.max(Input._split, 1);
    else if (action === 'split2') Input._split = Math.max(Input._split, 2);
    else if (action === 'split4') Input._split = Math.max(Input._split, 4);
    else if (action === 'eject') Input._eject = Math.max(Input._eject, 1);
    else if (action === 'signal') Input._signal = true;
    else if (skill) Input._skill = skill;
  }
  function isUiTarget(e) {
    return e.target && e.target.closest && e.target.closest('button,input,.overlay,.touch-controls');
  }
  function updateStickVisual() {
    const st = Input._stick;
    if (!Input._stickEl || !Input._knobEl) return;
    if (!st.active) {
      Input._stickEl.classList.remove('active');
      return;
    }
    Input._stickEl.classList.add('active');
    Input._stickEl.style.left = st.x + 'px';
    Input._stickEl.style.top = st.y + 'px';
    Input._knobEl.style.transform = 'translate(' + st.dx + 'px,' + st.dy + 'px)';
  }
  function moveStick(x, y) {
    const st = Input._stick;
    let dx = x - st.x, dy = y - st.y;
    const d = Math.hypot(dx, dy);
    if (d > STICK_RADIUS) { dx = dx / d * STICK_RADIUS; dy = dy / d * STICK_RADIUS; }
    st.dx = dx; st.dy = dy;
    const nx = dx / STICK_RADIUS, ny = dy / STICK_RADIUS;
    setAim(window.innerWidth / 2 + nx * AIM_RADIUS, window.innerHeight / 2 + ny * AIM_RADIUS);
    updateStickVisual();
  }
  function startStick(e) {
    if (isUiTarget(e)) return;
    if (e.pointerType === 'mouse') { setAim(e.clientX, e.clientY); return; }
    const st = Input._stick;
    st.active = true; st.id = e.pointerId; st.x = e.clientX; st.y = e.clientY; st.dx = 0; st.dy = 0;
    setAim(window.innerWidth / 2, window.innerHeight / 2);
    updateStickVisual();
    try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }
  function stopStick(e) {
    const st = Input._stick;
    if (e.pointerType === 'mouse') return;
    if (st.id !== e.pointerId) return;
    st.active = false; st.id = null; st.dx = 0; st.dy = 0;
    setAim(window.innerWidth / 2, window.innerHeight / 2);
    updateStickVisual();
  }

  Input.init = function () {
    this._stickEl = document.getElementById('touch-stick');
    this._knobEl = document.getElementById('touch-stick-knob');

    window.addEventListener('mousemove', (e) => { setAim(e.clientX, e.clientY); });
    window.addEventListener('pointerdown', startStick, { passive: true });
    window.addEventListener('pointermove', (e) => {
      const st = Input._stick;
      if (e.pointerType === 'mouse') {
        if (!isUiTarget(e)) setAim(e.clientX, e.clientY);
        return;
      }
      if (!st.active || st.id !== e.pointerId) return;
      moveStick(e.clientX, e.clientY);
    }, { passive: true });
    window.addEventListener('pointerup', stopStick, { passive: true });
    window.addEventListener('pointercancel', stopStick, { passive: true });

    document.querySelectorAll('[data-action], [data-skill]').forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => { fireButton(btn); e.preventDefault(); });
      btn.addEventListener('click', (e) => { fireButton(btn); e.preventDefault(); });
    });

    window.addEventListener('keydown', (e) => {
      if (isTextInput()) return;

      if (e.code === 'Space') { const count = e.ctrlKey || e.altKey ? 4 : (e.shiftKey ? 2 : 1); Input._split = Math.max(Input._split, count); flashControl(count === 2 ? '[data-action="split2"]' : '[data-action="split"]'); e.preventDefault(); return; }
      if (e.key === 'Tab') { Input._showScoreboard = true; e.preventDefault(); return; }
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { Input._spectateDir = 1; e.preventDefault(); return; }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { Input._spectateDir = -1; e.preventDefault(); return; }
      const k = e.key.toLowerCase();
      if (k === 'w') { Input._eject = Math.max(Input._eject, 1); Input._ejectHeld = true; flashControl('[data-action="eject"]'); return; }
      if (k === 'g') { Input._signal = true; flashControl('[data-action="signal"]'); e.preventDefault(); return; }
      if (k === 'n') { Input._spectateDir = 1; e.preventDefault(); return; }
      if (k === 'b') { Input._spectateDir = -1; e.preventDefault(); return; }
      if (k === 's') { Input._pauseToggle = true; e.preventDefault(); return; }
      if (k === 'l') { Input._lockMove = !Input._lockMove; Input._lockedAim = null; e.preventDefault(); return; }
      if (SKILL_KEYS[k]) { Input._skill = SKILL_KEYS[k]; flashControl('[data-skill="' + SKILL_KEYS[k] + '"]'); return; }
      if (k === ']' || k === '=' ) { Input._adminGrow = true; return; }
      if (k === '[' || k === '-') { Input._adminShrink = true; return; }
    });
    window.addEventListener('keyup', (e) => {
      if ((e.key || '').toLowerCase() === 'w') Input._ejectHeld = false;
      if (e.key === 'Tab') { Input._showScoreboard = false; e.preventDefault(); }
    });
    window.addEventListener('blur', () => { Input._showScoreboard = false; Input._ejectHeld = false; });
  };

  Input.sample = function (camera) {
    let w = G.Render.screenToWorld(Input.mouseX, Input.mouseY, camera);
    if (Input._lockMove) {
      if (!Input._lockedAim) Input._lockedAim = { x: w.x, y: w.y };
      w = Input._lockedAim;
    }
    const now = (performance && performance.now) ? performance.now() : Date.now();
    if (Input._ejectHeld && now - Input._lastMacroEject > 55) { Input._eject = Math.max(Input._eject, 1); Input._lastMacroEject = now; }
    const inp = {
      tx: w.x, ty: w.y,
      split: Input._split, splitCount: Input._split, eject: Input._eject > 0, ejectCount: Input._eject, skill: Input._skill,
      signal: Input._signal,
      adminGrow: Input._adminGrow, adminShrink: Input._adminShrink,
      pauseToggle: Input._pauseToggle, lockMove: Input._lockMove, spectateDir: Input._spectateDir,
    };
    Input._split = 0; Input._eject = 0; Input._skill = null; Input._signal = false; Input._pauseToggle = false; Input._spectateDir = 0;
    Input._adminGrow = false; Input._adminShrink = false;
    return inp;
  };

  G.Input = Input;
})(window.G);