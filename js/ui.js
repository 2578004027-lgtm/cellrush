// CellRush - menu, settings, death and respawn UI.
(function (G) {
  const CFG = G.CFG, U = G.util;
  const UI = {};
  const PRESET_SKINS = CFG.skinPresets || [''];

  UI.init = function (cbs) {
    this.cbs = cbs;
    this.menu = document.getElementById('menu');
    this.death = document.getElementById('death');
    this.nameInput = document.getElementById('name');
    this.skinInput = document.getElementById('skin-url');
    this.accountInput = document.getElementById('account');
    this.passwordInput = document.getElementById('password');
    this.accountStatus = document.getElementById('account-status');
    this.skillShop = document.getElementById('skill-shop');
    this.account = null;
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
        d.textContent = skin ? (skin.split('/').pop() || 'skin').replace('.png', '').replace('.svg', '') : '\u7eaf\u8272';
        d.title = skin || '\u7eaf\u8272';
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
      d.title = '\u989c\u8272 ' + h;
      wireSwatch(d, '', h);
      this.skinsEl.appendChild(d);
    });

    try {
      const ln = localStorage.getItem('cr_name'); if (ln) this.nameInput.value = ln;
      const la = localStorage.getItem('cr_account'); if (la && this.accountInput) this.accountInput.value = la;
      let skin = localStorage.getItem('cr_skin');
      if (skin && skin.indexOf('cwal.io/skins/') >= 0) skin = '/assets/skins/' + skin.split('/').pop().replace('.png', '.svg').replace('h.svg', 'halo.svg').replace('w.svg', 'star.svg');
      if (skin) { this.selectedSkin = skin; this.skinInput.value = skin; }
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
      const account = this.accountInput ? this.accountInput.value.trim() : '';
      const password = this.passwordInput ? this.passwordInput.value : '';
      try { localStorage.setItem('cr_name', name); localStorage.setItem('cr_skin', skin); if (account) localStorage.setItem('cr_account', account); } catch (e) { /* ignore */ }
      const color = U.colorFromHue(this.selectedHue);
      const ne = document.getElementById('neterr'); if (ne) ne.classList.add('hidden');
      this.menu.classList.add('hidden');
      this.death.classList.add('hidden');
      fn(name, color, skin, account, password);
    };
    this.playBtn.addEventListener('click', () => go(this.cbs.onPlay));
    this.nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(this.cbs.onPlay); });
    this.skinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(this.cbs.onPlay); });
    if (this.accountInput) this.accountInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(this.cbs.onPlay); });
    if (this.passwordInput) this.passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(this.cbs.onPlay); });
    this.respawnBtn.addEventListener('click', () => go(this.cbs.onRespawn));

    this.settings = document.getElementById('settings');
    const sound = document.getElementById('set-sound');
    const names = document.getElementById('set-names');
    const minimap = document.getElementById('set-minimap');
    const adminKey = document.getElementById('set-admin-key');
    const adminLogin = document.getElementById('set-admin-login');
    sound.checked = G.settings.sound; names.checked = G.settings.names;
    minimap.checked = G.settings.minimap;
    sound.addEventListener('change', () => { G.settings.sound = sound.checked; G.Audio.enabled = sound.checked; });
    names.addEventListener('change', () => { G.settings.names = names.checked; });
    minimap.addEventListener('change', () => { G.settings.minimap = minimap.checked; });
    const unlockAdmin = () => {
      const key = adminKey ? adminKey.value.trim() : '';
      if (!key) return;
      this.cbs.onAdminKey(key);
      adminKey.value = '';
    };
    if (adminLogin) adminLogin.addEventListener('click', unlockAdmin);
    if (adminKey) adminKey.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); unlockAdmin(); } });
    this.renderSkillShop();

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
      '\u6700\u9ad8\u8d28\u91cf <b>' + Math.floor(stats.maxMass || 0) + '</b><br>\u5b58\u6d3b <b>' + survived.toFixed(0) + '</b> \u79d2<br>\u94bb\u77f3 +<b>' + Math.floor(stats.diamondsEarned || 0) + '</b>';
    this.death.classList.remove('hidden');
  };

  UI.setAccount = function (msg) {
    if (msg && msg.ok && msg.account) this.account = msg.account;
    if (this.accountStatus) {
      if (this.account) this.accountStatus.textContent = this.account.name + (this.account.admin ? ' - \u7ba1\u7406\u5458' : '') + ' - \u94bb\u77f3 ' + (this.account.diamonds || 0);
      else this.accountStatus.textContent = (msg && msg.error) ? msg.error : '\u6e38\u5ba2 - \u94bb\u77f3 99999';
    }
    this.renderSkillShop();
  };

  UI.renderSkillShop = function () {
    if (!this.skillShop) return;
    const account = this.account;
    const unlocked = new Set((account && account.unlockedSkills) || []);
    const diamonds = account ? (account.diamonds || 0) : 99999;
    this.skillShop.innerHTML = '';
    for (const id of (G.CFG.specialSkillOrder || [])) {
      const def = G.CFG.skills[id];
      if (!def) continue;
      const isOpen = !account || unlocked.has(id) || (account && account.admin);
      const card = document.createElement('div');
      card.className = 'skill-card ' + (isOpen ? 'unlocked' : 'locked');
      const info = document.createElement('div');
      info.innerHTML = '<b>' + def.key + ' ' + def.name + '</b><small>' + (isOpen ? '\u5df2\u89e3\u9501' : (def.cost || 0) + ' \u94bb\u77f3') + '</small>';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = isOpen ? '\u5df2\u62e5\u6709' : '\u8d2d\u4e70';
      btn.disabled = isOpen || !account || diamonds < (def.cost || 0);
      btn.addEventListener('click', () => { if (this.cbs.onBuySkill) this.cbs.onBuySkill(id); });
      card.appendChild(info); card.appendChild(btn); this.skillShop.appendChild(card);
    }
  };

  G.UI = UI;
})(window.G);
