// CellRush — input. Translates mouse/keys into the {tx,ty,split,eject,skill,...} intent.
(function (G) {
  const Input = {
    mouseX: window.innerWidth / 2, mouseY: window.innerHeight / 2,
    _split: false, _eject: false, _skill: null, _adminGrow: false, _adminShrink: false,
  };

  const SKILL_KEYS = { q: 'dash', e: 'shield', r: 'magnet', f: 'merge' };

  Input.init = function () {
    window.addEventListener('mousemove', (e) => { Input.mouseX = e.clientX; Input.mouseY = e.clientY; });
    window.addEventListener('keydown', (e) => {
      // don't hijack typing in the nickname field
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;

      if (e.code === 'Space') { Input._split = true; e.preventDefault(); return; }
      const k = e.key.toLowerCase();
      if (k === 'w') { Input._eject = true; return; }
      if (SKILL_KEYS[k]) { Input._skill = SKILL_KEYS[k]; return; }
      if (k === ']' || k === '=' ) { Input._adminGrow = true; return; }
      if (k === '[' || k === '-') { Input._adminShrink = true; return; }
    });
  };

  // build the input for one sim tick. one-shot flags are consumed here.
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
