// CellRush — menus: start screen (nickname + color), death/respawn screen.
(function (G) {
  const CFG = G.CFG, U = G.util;
  const UI = {};

  UI.init = function (cbs) {
    this.cbs = cbs;
    this.menu = document.getElementById('menu');
    this.death = document.getElementById('death');
    this.nameInput = document.getElementById('name');
    this.skinsEl = document.getElementById('skins');
    this.playBtn = document.getElementById('play');
    this.respawnBtn = document.getElementById('respawn');
    this.deathStats = document.getElementById('death-stats');
    this.selectedHue = U.pick(CFG.hues);

    CFG.hues.forEach((h) => {
      const d = document.createElement('div');
      d.className = 'swatch';
      d.style.background = `hsl(${h},70%,56%)`;
      if (h === this.selectedHue) d.classList.add('sel');
      d.addEventListener('click', () => {
        this.selectedHue = h;
        this.skinsEl.querySelectorAll('.swatch').forEach((s) => s.classList.remove('sel'));
        d.classList.add('sel');
      });
      this.skinsEl.appendChild(d);
    });

    try { const ln = localStorage.getItem('cr_name'); if (ln) this.nameInput.value = ln; } catch (e) { /* */ }

    const go = (fn) => {
      const name = (this.nameInput.value || '你').trim().slice(0, 14) || '你';
      try { localStorage.setItem('cr_name', name); } catch (e) { /* */ }
      const color = U.colorFromHue(this.selectedHue);
      const ne = document.getElementById('neterr'); if (ne) ne.classList.add('hidden');
      this.menu.classList.add('hidden');
      this.death.classList.add('hidden');
      fn(name, color);
    };
    this.playBtn.addEventListener('click', () => go(this.cbs.onPlay));
    this.nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(this.cbs.onPlay); });
    this.respawnBtn.addEventListener('click', () => go(this.cbs.onRespawn));

    // ---- in-game settings ----
    this.settings = document.getElementById('settings');
    const sound = document.getElementById('set-sound');
    const names = document.getElementById('set-names');
    const minimap = document.getElementById('set-minimap');
    const admin = document.getElementById('set-admin');
    sound.checked = G.settings.sound; names.checked = G.settings.names;
    minimap.checked = G.settings.minimap; admin.checked = G.settings.admin;
    sound.addEventListener('change', () => { G.settings.sound = sound.checked; G.Audio.enabled = sound.checked; });
    names.addEventListener('change', () => { G.settings.names = names.checked; });
    minimap.addEventListener('change', () => { G.settings.minimap = minimap.checked; });
    admin.addEventListener('change', () => { this.cbs.onAdmin(admin.checked); });

    document.getElementById('gear').addEventListener('click', () => this.openSettings());
    document.getElementById('resume').addEventListener('click', () => this.closeSettings());
    document.getElementById('tomenu').addEventListener('click', () => {
      this.closeSettings();
      this.cbs.onBackToMenu();
      this.menu.classList.remove('hidden');
    });
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.settings.classList.contains('hidden')) this.openSettings();
      else this.closeSettings();
    });
  };

  UI.openSettings = function () {
    if (!this.cbs.isPlaying()) return;        // only meaningful during a game
    this.settings.classList.remove('hidden');
    this.cbs.onPause(true);
  };
  UI.closeSettings = function () {
    if (this.settings.classList.contains('hidden')) return;
    this.settings.classList.add('hidden');
    this.cbs.onPause(false);
  };

  // surface a connection problem: drop back to the menu with a red message
  UI.showError = function (msg) {
    this.death.classList.add('hidden');
    if (this.settings) this.settings.classList.add('hidden');
    this.menu.classList.remove('hidden');
    const el = document.getElementById('neterr');
    if (el) { el.textContent = msg; el.classList.remove('hidden'); }
  };

  UI.showDeath = function (stats, survived) {
    this.deathStats.innerHTML =
      `最高质量 <b>${Math.floor(stats.maxMass || 0)}</b><br>存活 <b>${survived.toFixed(0)}</b> 秒`;
    this.death.classList.remove('hidden');
  };

  G.UI = UI;
})(window.G);
