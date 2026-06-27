// CellRush - menu, settings, death and respawn UI.
(function (G) {
  const CFG = G.CFG, U = G.util;
  const UI = {};
  const PRESET_SKINS = [
    '',
    'https://cwal.io/skins/ring.png',
    'https://cwal.io/skins/h.png',
    'https://cwal.io/skins/circles.png',
    'https://cwal.io/skins/w.png',
    'https://cwal.io/skins/wolf.png',
    'https://cwal.io/skins/dragon.png',
    'https://cwal.io/skins/magatama.png',
    'https://cwal.io/skins/ghost.png',
    'https://cwal.io/skins/bat.png',
    'https://cwal.io/skins/daemon.png',
  ];

  UI.init = function (cbs) {
    this.cbs = cbs;
    this.menu = document.getElementById('menu');
    this.death = document.getElementById('death');
    this.nameInput = document.getElementById('name');
    this.skinInput = document.getElementById('skin-url');
    this.skinsEl = document.getElementById('skins');
    this.preview = document.getElementById('avatar-preview');
    this.playBtn = document.getElementById('play');
    this.respawnBtn = document.getElementById('respawn');
    this.deathStats = document.getElementById('death-stats');
    this.selectedHue = U.pick(CFG.hues);
    this.selectedSkin = '';

    const safeUrl = (url) => (url || '').trim().replace(/"/g, '%22');
    const applyPreview = () => {
      const c = U.colorFromHue(this.selectedHue);
      const skin = (this.skinInput.value || this.selectedSkin || '').trim();
      if (!this.preview) return;
      this.preview.style.backgroundColor = c.css;
      this.preview.style.backgroundImage = skin ? 'url("' + safeUrl(skin) + '")' : '';
      this.preview.style.backgroundSize = 'cover';
      this.preview.style.backgroundPosition = 'center';
      this.preview.style.boxShadow = '0 0 32px 16px ' + c.dark.replace('hsl', 'hsla').replace(')', ',0.42)');
    };
    const selectSkinEl = (el) => {
      this.skinsEl.querySelectorAll('.swatch').forEach((s) => s.classList.remove('sel'));
      if (el) el.classList.add('sel');
    };
    const wireSwatch = (d, skin, hue) => {
      d.type = 'button';
      d.classList.add('swatch');
      if (skin) {
        d.dataset.skin = skin;
        d.style.backgroundImage = 'url("' + safeUrl(skin) + '")';
        d.style.backgroundSize = 'cover';
        d.style.backgroundPosition = 'center';
      } else if (typeof hue === 'number') {
        d.dataset.hue = '' + hue;
        d.style.background = 'hsl(' + hue + ',70%,56%)';
      }
      d.addEventListener('click', () => {
        const h = Number(d.dataset.hue);
        if (!Number.isNaN(h)) this.selectedHue = h;
        this.selectedSkin = d.dataset.skin || '';
        this.skinInput.value = this.selectedSkin;
        selectSkinEl(d);
        applyPreview();
      });
    };

    if (!this.skinsEl.children.length) {
      PRESET_SKINS.forEach((skin, i) => {
        const d = document.createElement('button');
        d.textContent = skin ? (skin.split('/').pop() || 'skin').replace('.png', '') : 'Pure';
        d.title = skin || 'Pure color';
        if (i === 0) d.classList.add('sel');
        wireSwatch(d, skin, null);
        this.skinsEl.appendChild(d);
      });
    } else {
      Array.from(this.skinsEl.querySelectorAll('.swatch')).forEach((d) => wireSwatch(d, d.dataset.skin || '', null));
    }
    CFG.hues.forEach((h) => {
      const d = document.createElement('button');
      d.textContent = '';
      d.title = 'Color ' + h;
      wireSwatch(d, '', h);
      this.skinsEl.appendChild(d);
    });

    try {
      const ln = localStorage.getItem('cr_name'); if (ln) this.nameInput.value = ln;
      const skin = localStorage.getItem('cr_skin'); if (skin) { this.selectedSkin = skin; this.skinInput.value = skin; }
    } catch (e) { /* localStorage may be blocked */ }
    if (this.selectedSkin) {
      const saved = this.skinsEl.querySelector('[data-skin="' + this.selectedSkin.replace(/"/g, '\\"') + '"]');
      if (saved) selectSkinEl(saved);
    }
    this.skinInput.addEventListener('input', applyPreview);
    applyPreview();

    const go = (fn) => {
      const name = (this.nameInput.value || 'Player').trim().slice(0, 14) || 'Player';
      const skin = (this.skinInput.value || this.selectedSkin || '').trim();
      try { localStorage.setItem('cr_name', name); localStorage.setItem('cr_skin', skin); } catch (e) { /* ignore */ }
      const color = U.colorFromHue(this.selectedHue);
      const ne = document.getElementById('neterr'); if (ne) ne.classList.add('hidden');
      this.menu.classList.add('hidden');
      this.death.classList.add('hidden');
      fn(name, color, skin);
    };
    this.playBtn.addEventListener('click', () => go(this.cbs.onPlay));
    this.nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(this.cbs.onPlay); });
    this.skinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(this.cbs.onPlay); });
    this.respawnBtn.addEventListener('click', () => go(this.cbs.onRespawn));

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
    if (!this.cbs.isPlaying()) return;
    this.settings.classList.remove('hidden');
    this.cbs.onPause(true);
  };
  UI.closeSettings = function () {
    if (this.settings.classList.contains('hidden')) return;
    this.settings.classList.add('hidden');
    this.cbs.onPause(false);
  };

  UI.showError = function (msg) {
    this.death.classList.add('hidden');
    if (this.settings) this.settings.classList.add('hidden');
    this.menu.classList.remove('hidden');
    const el = document.getElementById('neterr');
    if (el) { el.textContent = msg; el.classList.remove('hidden'); }
  };

  UI.showDeath = function (stats, survived) {
    this.deathStats.innerHTML =
      'Best mass <b>' + Math.floor(stats.maxMass || 0) + '</b><br>Survived <b>' + survived.toFixed(0) + '</b>s';
    this.death.classList.remove('hidden');
  };

  G.UI = UI;
})(window.G);