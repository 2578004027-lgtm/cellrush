// CellRush - input. Translates mouse/touch/keys into the {tx,ty,split,eject,skill,...} intent.
(function (G) {
  const Input = {
    mouseX: window.innerWidth / 2, mouseY: window.innerHeight / 2,
    _split: false, _eject: false, _skill: null, _adminGrow: false, _adminShrink: false,
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
  function fireButton(btn) {
    const action = btn.dataset.action;
    const skill = btn.dataset.skill;
    if (action === 'split') Input._split = true;
    else if (action === 'eject') Input._eject = true;
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

      if (e.code === 'Space') { Input._split = true; e.preventDefault(); return; }
      const k = e.key.toLowerCase();
      if (k === 'w') { Input._eject = true; return; }
      if (SKILL_KEYS[k]) { Input._skill = SKILL_KEYS[k]; return; }
      if (k === ']' || k === '=' ) { Input._adminGrow = true; return; }
      if (k === '[' || k === '-') { Input._adminShrink = true; return; }
    });
  };

  Input.sample = function (camera) {
    const w = G.Render.screenToWorld(Input.mouseX, Input.mouseY, camera);
    const inp = {
      tx: w.x, ty: w.y,
      split: Input._split, eject: Input._eject, skill: Input._skill,
      adminGrow: Input._adminGrow, adminShrink: Input._adminShrink,
    };
    Input._split = false; Input._eject = false; Input._skill = null;
    Input._adminGrow = false; Input._adminShrink = false;
    return inp;
  };

  G.Input = Input;
})(window.G);