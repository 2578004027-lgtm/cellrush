// CellRush — all canvas rendering. Reads snapshots; never touches the sim.
// Jitter fix: entities are eased toward their latest sim position every render
// frame (framerate-independent), and the camera is locked to the player's
// smoothed centroid, so neither you nor enemies stutter at any refresh rate.
(function (G) {
  const CFG = G.CFG, U = G.util;

  const Render = {
    canvas: null, ctx: null, dpr: 1, w: 0, h: 0,
    camera: { x: CFG.worldSize / 2, y: CFG.worldSize / 2, scale: 1 },
    _lerp: new Map(),       // id -> {x,y} eased draw positions
    _fx: [],                // transient visual effects (split/merge/pop rings)
  };

  Render.init = function (canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  };
  Render.resize = function () {
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);   // cap for fill-rate / fps
    this.w = window.innerWidth; this.h = window.innerHeight;
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
  };

  Render.screenToWorld = function (sx, sy, cam) {
    cam = cam || Render.camera;
    return { x: (sx - Render.w / 2) / cam.scale + cam.x, y: (sy - Render.h / 2) / cam.scale + cam.y };
  };
  Render.viewBounds = function () {
    const c = this.camera, hw = this.w / 2 / c.scale, hh = this.h / 2 / c.scale;
    return { x0: c.x - hw, x1: c.x + hw, y0: c.y - hh, y1: c.y + hh };
  };
  Render.cullBounds = function () {           // slightly larger than the view so eased cells don't pop at edges
    const v = this.viewBounds(), m = 260;
    return { x0: v.x0 - m, x1: v.x1 + m, y0: v.y0 - m, y1: v.y1 + m };
  };
  Render.centerOn = function (x, y) { this.camera.x = x; this.camera.y = y; };

  // ease others toward latest server pos; PREDICT your own cells from your input
  // (so your control feels instant despite 20–30Hz network updates)
  Render._smooth = function (snap, dt, input) {
    const k = 1 - Math.exp(-22 * dt);
    const store = this._lerp, seen = new Set();
    for (const c of snap.cells) {
      const id = 'c' + c.id; seen.add(id);
      let p = store.get(id);
      if (!p) { p = { x: c.x, y: c.y }; store.set(id, p); }
      if (c.isMe) {
        p.x += (c.x - p.x) * 0.20;          // gently reconcile toward authoritative server pos
        p.y += (c.y - p.y) * 0.20;
        if (input) {                         // then advance locally by your own input
          const dx = input.tx - p.x, dy = input.ty - p.y, d = Math.hypot(dx, dy) || 1;
          let v = G.speed(c.mass);
          if (d < c.r) v *= d / c.r;
          p.x += dx / d * v * dt;
          p.y += dy / d * v * dt;
        }
      } else {
        p.x += (c.x - p.x) * k;
        p.y += (c.y - p.y) * k;
      }
      c.x = p.x; c.y = p.y;
    }
    const ease = (arr, pfx) => {
      for (const e of arr) {
        const id = pfx + e.id; seen.add(id);
        let s = store.get(id);
        if (!s) { s = { x: e.x, y: e.y }; store.set(id, s); }
        else { s.x += (e.x - s.x) * k; s.y += (e.y - s.y) * k; }
        e.x = s.x; e.y = s.y;
      }
    };
    ease(snap.viruses, 'v'); ease(snap.ejected, 'e');
    for (const key of store.keys()) if (!seen.has(key)) store.delete(key);
  };

  // lock camera to the player's smoothed centroid; ease only the zoom
  Render._camera = function (snap, dt) {
    const cam = this.camera;
    if (snap.me) {
      let cx = 0, cy = 0, tm = 0;
      for (const c of snap.cells) if (c.isMe) { cx += c.x * c.mass; cy += c.y * c.mass; tm += c.mass; }
      if (tm > 0) { cam.x = cx / tm; cam.y = cy / tm; }
      const want = U.clamp((this.h / 2) / (CFG.view.margin * (G.radius(snap.me.mass) + CFG.view.base)), CFG.view.min, CFG.view.max);
      cam.scale += (want - cam.scale) * (dt ? 1 - Math.exp(-6 * dt) : 1);
    }
  };

  Render.clear = function () {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#0d1020';
    ctx.fillRect(0, 0, this.w, this.h);
  };

  // one full frame: smooth/predict -> camera -> draw
  Render.frame = function (snap, dt, input) {
    this._smooth(snap, dt, input);
    this._camera(snap, dt);
    const ctx = this.ctx, cam = this.camera;
    this.clear();
    ctx.save();
    ctx.translate(this.w / 2, this.h / 2);
    ctx.scale(cam.scale, cam.scale);
    ctx.translate(-cam.x, -cam.y);

    this._grid(ctx);
    ctx.strokeStyle = 'rgba(120,140,220,0.35)';
    ctx.lineWidth = 6 / cam.scale;
    ctx.strokeRect(0, 0, snap.world, snap.world);

    for (const f of snap.food) { ctx.fillStyle = f.color; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, U.TAU); ctx.fill(); }
    for (const e of snap.ejected) { ctx.fillStyle = e.color; ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, U.TAU); ctx.fill(); }

    // cells + viruses interleaved by mass: big cells cover viruses, small cells hide under them
    const stack = snap.cells.slice();
    for (const v of snap.viruses) { v._isVirus = true; stack.push(v); }
    stack.sort((a, b) => (a.mass || 0) - (b.mass || 0));
    for (const o of stack) { if (o._isVirus) this._virus(ctx, o); else this._cell(ctx, o); }
    this._spawnFx(snap.events); this._drawFx(ctx, dt);

    ctx.restore();

    this._leaderboard(snap);
    if (G.settings.minimap) this._minimap(snap);
    this._skillbar(snap);
    this._hud(snap);
  };

  Render._grid = function (ctx) {
    const v = this.viewBounds(), step = 50;
    const x0 = Math.floor(v.x0 / step) * step, x1 = Math.ceil(v.x1 / step) * step;
    const y0 = Math.floor(v.y0 / step) * step, y1 = Math.ceil(v.y1 / step) * step;
    ctx.lineWidth = 1 / this.camera.scale;
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.beginPath();
    for (let x = x0; x <= x1; x += step) { ctx.moveTo(x, v.y0); ctx.lineTo(x, v.y1); }
    for (let y = y0; y <= y1; y += step) { ctx.moveTo(v.x0, y); ctx.lineTo(v.x1, y); }
    ctx.stroke();
  };

  Render._cell = function (ctx, c) {
    ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, U.TAU);
    ctx.fillStyle = c.color; ctx.fill();
    ctx.lineWidth = Math.max(2, c.r * 0.05);
    ctx.strokeStyle = c.dark || 'rgba(0,0,0,0.25)'; ctx.stroke();

    if (c.shield) {
      ctx.beginPath(); ctx.arc(c.x, c.y, c.r + 6 / this.camera.scale + c.r * 0.06, 0, U.TAU);
      ctx.lineWidth = Math.max(2, c.r * 0.09); ctx.strokeStyle = 'rgba(108,240,255,0.9)'; ctx.stroke();
    }
    if (c.admin) {
      ctx.beginPath(); ctx.arc(c.x, c.y, c.r + 10 / this.camera.scale + c.r * 0.08, 0, U.TAU);
      ctx.lineWidth = Math.max(2, c.r * 0.07); ctx.strokeStyle = 'rgba(255,210,80,0.95)'; ctx.setLineDash([8, 6]); ctx.stroke(); ctx.setLineDash([]);
    }
    if (c.mergeIn && c.mergeIn > 0.05) {            // can't re-merge yet -> countdown arc + seconds
      const frac = U.clamp(c.mergeIn / 22, 0, 1);
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r + 5 / this.camera.scale, -Math.PI / 2, -Math.PI / 2 + U.TAU * frac);
      ctx.lineWidth = Math.max(2, c.r * 0.07); ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.stroke();
      if (c.r * this.camera.scale > 24) {
        ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const fs = Math.max(10, c.r * 0.32); ctx.font = '700 ' + fs + 'px sans-serif';
        ctx.fillText(Math.ceil(c.mergeIn) + 's', c.x, c.y - c.r * 0.5);
        ctx.restore();
      }
    }

    const px = c.r * this.camera.scale;
    if (px > 20) {
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineJoin = 'round';
      let yOff = 0;
      if (G.settings.names && c.name) {
        const fs = Math.max(11, c.r * 0.42);
        ctx.font = '700 ' + fs + 'px "Microsoft YaHei", sans-serif'; ctx.lineWidth = fs * 0.14;
        ctx.strokeText(c.name, c.x, c.y); ctx.fillText(c.name, c.x, c.y);
        yOff = fs * 0.85;
      }
      const ms = '' + Math.floor(c.mass), fs2 = Math.max(9, c.r * 0.26);
      ctx.font = '600 ' + fs2 + 'px sans-serif'; ctx.lineWidth = fs2 * 0.16;
      ctx.strokeText(ms, c.x, c.y + yOff); ctx.fillText(ms, c.x, c.y + yOff);
      ctx.restore();
    }
  };

  Render._virus = function (ctx, v) {
    const spikes = 20, r = v.r, ir = r * 0.86;
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const ang = Math.PI * i / spikes, rr = (i % 2) ? ir : r * 1.05;
      const x = v.x + Math.cos(ang) * rr, y = v.y + Math.sin(ang) * rr;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(70,225,100,0.82)'; ctx.fill();
    ctx.lineWidth = Math.max(2, r * 0.04); ctx.strokeStyle = '#2a9f44'; ctx.stroke();
  };

  // turn sim events into transient ring effects
  Render._spawnFx = function (events) {
    if (!events) return;
    for (const ev of events) {
      if (ev.type === 'split') this._fx.push({ x: ev.x, y: ev.y, r0: ev.r * 0.5, r1: ev.r * 2.6, age: 0, ttl: 0.40, color: ev.color });
      else if (ev.type === 'merge') this._fx.push({ x: ev.x, y: ev.y, r0: ev.r * 1.9, r1: ev.r * 0.6, age: 0, ttl: 0.40, color: ev.color, flash: true });
      else if (ev.type === 'pop') for (let i = 0; i < 3; i++) this._fx.push({ x: ev.x, y: ev.y, r0: ev.r * 0.5, r1: ev.r * (2.4 + i), age: -i * 0.06, ttl: 0.55, color: ev.color });
    }
  };
  Render._drawFx = function (ctx, dt) {
    for (const f of this._fx) f.age += dt;
    this._fx = this._fx.filter((f) => f.age < f.ttl);
    for (const f of this._fx) {
      if (f.age < 0) continue;
      const t = U.clamp(f.age / f.ttl, 0, 1), r = U.lerp(f.r0, f.r1, t);
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.beginPath(); ctx.arc(f.x, f.y, Math.max(0.5, r), 0, U.TAU);
      ctx.lineWidth = Math.max(1.5, r * 0.14); ctx.strokeStyle = f.color; ctx.stroke();
      if (f.flash) { ctx.globalAlpha = (1 - t) * 0.3; ctx.fillStyle = '#fff'; ctx.fill(); }
      ctx.restore();
    }
  };

  Render._round = function (ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  Render._leaderboard = function (snap) {
    const ctx = this.ctx, lb = snap.leaderboard;
    const w = 178, x = this.w - w - 16, y = 16, h = 34 + lb.length * 22;
    ctx.fillStyle = 'rgba(8,10,24,0.5)'; this._round(ctx, x, y, w, h, 12); ctx.fill();
    ctx.fillStyle = '#ffe27a'; ctx.font = '700 16px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('排行榜', x + w / 2, y + 23);
    ctx.font = '600 13px "Microsoft YaHei", sans-serif';
    lb.forEach((e, i) => {
      const ty = y + 44 + i * 22;
      ctx.textAlign = 'left'; ctx.fillStyle = e.isMe ? '#7CFFB0' : '#dfe6ff';
      let nm = (i + 1) + '. ' + e.name;
      if (nm.length > 13) nm = nm.slice(0, 13) + '…';
      ctx.fillText(nm, x + 12, ty);
      ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText(Math.floor(e.mass), x + w - 12, ty);
    });
  };

  Render._minimap = function (snap) {
    const ctx = this.ctx, s = 148, pad = 16;
    const x = this.w - s - pad, y = this.h - s - pad, k = s / snap.world;
    ctx.fillStyle = 'rgba(8,10,24,0.45)'; this._round(ctx, x, y, s, s, 12); ctx.fill();
    for (const p of snap.players) {
      ctx.fillStyle = p.isMe ? '#7CFFB0' : 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.arc(x + p.x * k, y + p.y * k, p.isMe ? 4 : 2 + Math.min(4, p.mass / 500), 0, U.TAU);
      ctx.fill();
    }
  };

  // skill bar at bottom-center with cooldown sweep
  Render._skillbar = function (snap) {
    if (!snap.me || !snap.me.skills) return;
    const ctx = this.ctx, sk = snap.me.skills;
    const sz = 56, gap = 12, total = sk.length * sz + (sk.length - 1) * gap;
    let x = this.w / 2 - total / 2, y = this.h - sz - 18;
    for (const s of sk) {
      this._round(ctx, x, y, sz, sz, 10);
      ctx.fillStyle = 'rgba(8,10,24,0.7)'; ctx.fill();
      ctx.lineWidth = s.active ? 3 : 2;
      ctx.strokeStyle = s.active ? '#fff' : s.color; ctx.stroke();
      // key + name
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = s.remain > 0 ? 'rgba(220,228,255,0.45)' : s.color;
      ctx.font = '800 22px sans-serif'; ctx.fillText(s.key, x + sz / 2, y + sz / 2 - 4);
      ctx.fillStyle = 'rgba(220,228,255,0.7)'; ctx.font = '600 11px "Microsoft YaHei", sans-serif';
      ctx.fillText(s.name, x + sz / 2, y + sz - 11);
      // cooldown overlay (dark fill shrinking from top) + seconds
      if (s.remain > 0) {
        const f = Math.min(1, s.remain / s.cd);
        ctx.save();
        this._round(ctx, x, y, sz, sz, 10); ctx.clip();
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x, y, sz, sz * f);
        ctx.restore();
        ctx.fillStyle = '#fff'; ctx.font = '700 16px sans-serif';
        ctx.fillText(s.remain.toFixed(s.remain < 1 ? 1 : 0), x + sz / 2, y + sz / 2 - 2);
      }
      x += sz + gap;
    }
  };

  Render._hud = function (snap) {
    const ctx = this.ctx;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#fff'; ctx.font = '700 19px "Microsoft YaHei", sans-serif';
    ctx.fillText('质量 ' + (snap.me ? Math.floor(snap.me.mass) : 0), 16, this.h - 38);
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = '600 13px "Microsoft YaHei", sans-serif';
    ctx.fillText('最高 ' + (snap.me ? Math.floor(snap.me.maxMass) : 0), 16, this.h - 18);
    if (snap.me && snap.me.admin) {
      ctx.fillStyle = '#ffd24f'; ctx.font = '700 14px "Microsoft YaHei", sans-serif';
      ctx.fillText('管理员模式  [ / ] 增减质量', 16, this.h - 60);
    }
  };

  G.Render = Render;
})(window.G);
