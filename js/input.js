// CellRush - input. Translates mouse/touch/keys into the {tx,ty,split,eject,skill,...} intent.
(function (G) {
  const Input = {
    mouseX: window.innerWidth / 2, mouseY: window.innerHeight / 2,
    _split: false, _eject: false, _skill: null, _adminGrow: false, _adminShrink: false,
    _touching: false,
  };

  const SKILL_KEYS = { q: 'dash', e: 'shield', r: 'magnet', f: 'merge' };

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

  Input.init = function () {
    window.addEventListener('mousemove', (e) => { setAim(e.clientX, e.clientY); });
    window.addEventListener('pointerdown', (e) => {
      if (e.target && e.target.closest && e.target.closest('button,input,.overlay')) return;
      Input._touching = e.pointerType !== 'mouse';
      setAim(e.clientX, e.clientY);
    }, { passive: true });
    window.addEventListener('pointermove', (e) => {
      if (e.target && e.target.closest && e.target.closest('button,input,.overlay')) return;
      if (e.pointerType !== 'mouse' && !Input._touching) return;
      setAim(e.clientX, e.clientY);
    }, { passive: true });
    window.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') Input._touching = false; }, { passive: true });
    window.addEventListener('touchmove', (e) => {
      if (!e.touches || !e.touches.length) return;
      const t = e.touches[0];
      setAim(t.clientX, t.clientY);
    }, { passive: true });

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