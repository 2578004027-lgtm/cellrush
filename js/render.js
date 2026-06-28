// CellRush - all canvas rendering. Reads snapshots; never touches the sim.
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
    _feed: [],              // short combat/event messages
    _squeeze: new Map(),
    _skins: new Map(),      // url -> HTMLImageElement cache for cell skins
};

  Render.init = function (canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  };
  Render.resize = function () {
    this.dpr = 1;   // render at CSS resolution (1x) for max fps; biggest fill-rate win on HiDPI
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
  Render._sectorInfo = function (x, y, world) {
    const s = world || CFG.worldSize;
    const col = U.clamp(Math.floor(x / (s / 3)), 0, 2);
    const row = U.clamp(Math.floor(y / (s / 3)), 0, 2);
    return { row, col, id: row * 3 + col + 1 };
  };
  Render._skinImage = function (url) {
    if (!url) return null;
    let img = this._skins.get(url);
    if (!img) {
      img = new Image();
      img.decoding = 'async';
      img.src = url;
      this._skins.set(url, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  };

  // ease every moving entity toward its latest server position (smooth, cheap, no jitter)
  Render._smooth = function (snap, dt) {
    if (snap._interpolated) { this._lerp.clear(); return; }
    const k = 1 - Math.exp(-20 * dt);
    const store = this._lerp, seen = new Set();
    const ease = (arr, pfx) => {
      for (const e of arr) {
        const id = pfx + e.id; seen.add(id);
        let s = store.get(id);
        if (!s) { s = { x: e.x, y: e.y }; store.set(id, s); }
        else { s.x += (e.x - s.x) * k; s.y += (e.y - s.y) * k; }
        e.x = s.x; e.y = s.y;
      }
    };
    ease(snap.cells, 'c'); ease(snap.viruses, 'v'); ease(snap.ejected, 'e');
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

  Render._menuInit = function () {
    if (this._menuBlobs && this._menuBlobs.length) return;
    const names = ['CellRush', 'rush', 'split', 'dash', 'poison', 'cwal', 'bot', 'virus'];
    this._menuBlobs = [];
    for (let i = 0; i < 22; i++) {
      const hue = CFG.hues[i % CFG.hues.length];
      this._menuBlobs.push({
        x: Math.random() * Math.max(1, this.w), y: Math.random() * Math.max(1, this.h),
        r: 18 + Math.random() * 78, vx: (Math.random() - 0.5) * 24, vy: (Math.random() - 0.5) * 24,
        hue, name: names[i % names.length], phase: Math.random() * U.TAU,
      });
    }
  };
  Render.menuFrame = function (dt) {
    const ctx = this.ctx;
    this._menuInit();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const grd = ctx.createRadialGradient(this.w * 0.5, this.h * 0.44, 40, this.w * 0.5, this.h * 0.44, Math.max(this.w, this.h) * 0.78);
    grd.addColorStop(0, '#171b31'); grd.addColorStop(0.55, '#0b1023'); grd.addColorStop(1, '#050508');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, this.w, this.h);

    const step = this.w < 760 ? 44 : 58;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.beginPath();
    for (let x = -((performance.now() * 0.006) % step); x < this.w + step; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, this.h); }
    for (let y = -((performance.now() * 0.004) % step); y < this.h + step; y += step) { ctx.moveTo(0, y); ctx.lineTo(this.w, y); }
    ctx.stroke();

    // tiny square food in the distance, cheap but makes the menu feel alive
    const t = performance.now() / 1000;
    for (let i = 0; i < 90; i++) {
      const x = (i * 97 + t * 13) % (this.w + 80) - 40;
      const y = (i * 53 + Math.sin(t * 0.6 + i) * 16) % (this.h + 80) - 40;
      ctx.fillStyle = 'hsla(' + ((i * 37) % 360) + ',75%,60%,0.22)';
      ctx.fillRect(x, y, 4, 4);
    }

    for (const b of this._menuBlobs) {
      b.phase += dt * 1.4;
      b.x += b.vx * dt; b.y += b.vy * dt;
      const pad = b.r + 24;
      if (b.x < -pad) b.x = this.w + pad; else if (b.x > this.w + pad) b.x = -pad;
      if (b.y < -pad) b.y = this.h + pad; else if (b.y > this.h + pad) b.y = -pad;
      const pulse = 1 + Math.sin(b.phase) * 0.025;
      const r = b.r * pulse;
      ctx.save();
      ctx.globalAlpha = b.r > 70 ? 0.28 : 0.22;
      ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, U.TAU);
      ctx.fillStyle = 'hsl(' + b.hue + ',70%,56%)'; ctx.fill();
      ctx.lineWidth = Math.max(2, r * 0.045); ctx.strokeStyle = 'hsla(' + b.hue + ',70%,24%,0.8)'; ctx.stroke();
      if (r > 36) {
        ctx.globalAlpha *= 0.9;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineJoin = 'round';
        ctx.font = '700 ' + Math.max(11, r * 0.28) + 'px sans-serif'; ctx.lineWidth = Math.max(2, r * 0.035);
        ctx.strokeText(b.name, b.x, b.y); ctx.fillText(b.name, b.x, b.y);
      }
      ctx.restore();
    }

    ctx.fillStyle = 'rgba(0,0,0,0.18)';
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

    const cb = this.cullBounds();
    for (const f of snap.food) {
      if (f.x < cb.x0 || f.x > cb.x1 || f.y < cb.y0 || f.y > cb.y1) continue;
      const s = Math.max(3 / cam.scale, f.r * 1.55);
      ctx.fillStyle = f.color; ctx.fillRect(f.x - s * 0.5, f.y - s * 0.5, s, s);
    }
    for (const e of snap.ejected) {
      if (e.x + e.r < cb.x0 || e.x - e.r > cb.x1 || e.y + e.r < cb.y0 || e.y - e.r > cb.y1) continue;
      this._ejected(ctx, e);
    }

    // cells + viruses interleaved by mass: big cells cover viruses, small cells hide under them
    const stack = snap.cells.slice();
    for (const v of snap.viruses) { v._isVirus = true; stack.push(v); }
    stack.sort((a, b) => (a.mass || 0) - (b.mass || 0));
    const squeeze = G.settings.visualSqueeze ? this._squeezeMap(stack, dt) : null;
    for (const o of stack) { if (o._isVirus) this._virus(ctx, o); else this._cell(ctx, o, squeeze && squeeze.get(o.id)); }
    this._assists(ctx, snap, input);
    this._spawnFx(snap.events); this._drawFx(ctx, dt);

    ctx.restore();

    this._leaderboard(snap);
    if (G.settings.minimap) this._minimap(snap);
    this._skillbar(snap);
    this._hud(snap);
    this._statsPanels(snap);
    this._feedPanel(dt);
  };

  Render._splitReach = function (mass) {
    const r = G.radius(mass / 2);
    const launch = U.clamp(
      Math.max(CFG.splitImpulse, r * (CFG.splitLaunchRadii || 1.15) * CFG.frictionPerSec),
      CFG.splitImpulse,
      CFG.splitImpulseMax || 2400
    );
    const sep = r * (CFG.splitStartSeparation || 2.03);
    return sep + launch / Math.max(1, CFG.frictionPerSec) * 0.82;
  };
  Render._splitPreview = function (ctx, cell, input) {
    if (!G.settings.splitPreview || !input || !cell || cell.mass < (CFG.splitMin || 35)) return;
    const scale = this.camera.scale || 1;
    const dx = input.tx - cell.x, dy = input.ty - cell.y, d = Math.hypot(dx, dy) || 1;
    const ca = dx / d, sa = dy / d;
    const half = cell.mass / 2, r = G.radius(half), reach = this._splitReach(cell.mass);
    const ex = cell.x + ca * reach, ey = cell.y + sa * reach;
    ctx.save();
    ctx.lineWidth = Math.max(1.5 / scale, 2);
    ctx.strokeStyle = 'rgba(255,210,80,0.58)';
    ctx.setLineDash([14 / scale, 9 / scale]);
    ctx.beginPath(); ctx.moveTo(cell.x, cell.y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.18; ctx.fillStyle = '#ffd250';
    ctx.beginPath(); ctx.arc(ex, ey, r, 0, U.TAU); ctx.fill();
    ctx.globalAlpha = 0.75; ctx.strokeStyle = 'rgba(255,210,80,0.92)'; ctx.lineWidth = Math.max(2 / scale, 2);
    ctx.beginPath(); ctx.arc(ex, ey, r, 0, U.TAU); ctx.stroke();
    ctx.restore();
  };

  Render._assists = function (ctx, snap, input) {
    if (!snap || !snap.me) return;
    const meCells = (snap.cells || []).filter((c) => c.isMe);
    if (!meCells.length) return;
    let cx = 0, cy = 0, tm = 0, myMax = 0;
    let mainCell = meCells[0];
    for (const c of meCells) { cx += c.x * c.mass; cy += c.y * c.mass; tm += c.mass; if (c.mass > myMax) { myMax = c.mass; mainCell = c; } }
    cx /= tm; cy /= tm;
    const scale = this.camera.scale || 1;

    this._splitPreview(ctx, mainCell, input);

    if (G.settings.cursorLine && input) {
      const dx = input.tx - cx, dy = input.ty - cy, d = Math.hypot(dx, dy);
      if (d > 8) {
        ctx.save();
        ctx.lineWidth = Math.max(1.2, 1.7 / scale);
        ctx.strokeStyle = 'rgba(255,255,255,0.34)';
        ctx.setLineDash([18 / scale, 12 / scale]);
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(input.tx, input.ty); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,255,255,0.72)';
        ctx.beginPath(); ctx.arc(input.tx, input.ty, Math.max(3 / scale, 5), 0, U.TAU); ctx.fill();
        ctx.restore();
      }
    }

    if (G.settings.autosplitAlert) {
      let alert = null;
      for (const mine of meCells) {
        for (const e of snap.cells || []) {
          if (e.isMe || e.mass <= 0) continue;
          const canSplitEat = (e.mass / 2) >= mine.mass * (CFG.splitEatRatio || CFG.eatRatio || 1.2);
          if (!canSplitEat || e.mass < (CFG.splitMin || 35)) continue;
          const dist = Math.hypot(e.x - mine.x, e.y - mine.y);
          const reach = this._splitReach(e.mass) + e.r + mine.r * 0.35;
          if (dist < reach) {
            const margin = reach - dist;
            if (!alert || margin > alert.margin) alert = { mine, e, margin };
          }
        }
      }
      if (alert) {
        ctx.save();
        const a = 0.55 + 0.22 * Math.sin((performance.now() || 0) / 90);
        ctx.lineWidth = Math.max(3 / scale, alert.mine.r * 0.055);
        ctx.strokeStyle = 'rgba(255,80,105,' + a.toFixed(2) + ')';
        ctx.beginPath(); ctx.arc(alert.mine.x, alert.mine.y, alert.mine.r + Math.max(16 / scale, alert.mine.r * 0.16), 0, U.TAU); ctx.stroke();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const fs = Math.max(12 / scale, Math.min(20 / scale, alert.mine.r * 0.22));
        ctx.font = '900 ' + fs + 'px "Microsoft YaHei", sans-serif'; ctx.lineWidth = Math.max(2 / scale, fs * 0.16);
        ctx.strokeStyle = 'rgba(0,0,0,0.68)'; ctx.fillStyle = 'rgba(255,92,118,0.96)';
        const txt = '\u5206\u88c2\u5371\u9669';
        ctx.strokeText(txt, alert.mine.x, alert.mine.y - alert.mine.r - Math.max(24 / scale, alert.mine.r * 0.22));
        ctx.fillText(txt, alert.mine.x, alert.mine.y - alert.mine.r - Math.max(24 / scale, alert.mine.r * 0.22));
        ctx.restore();
      }
    }

    if (!G.settings.enemyHint && !G.settings.massMarker) return;
    const enemies = [];
    for (const c of snap.cells || []) {
      if (c.isMe || c.mass <= 0) continue;
      const eatable = myMax >= c.mass * (CFG.eatRatio || 1.25);
      const splitEatable = (myMax / 2) >= c.mass * (CFG.splitEatRatio || CFG.eatRatio || 1.25);
      const dangerous = c.mass >= myMax * (CFG.eatRatio || 1.25);
      if (!eatable && !splitEatable && !dangerous) continue;
      enemies.push({ c, eatable, splitEatable, dangerous, score: Math.abs(c.x - cx) + Math.abs(c.y - cy) });
    }
    enemies.sort((a, b) => a.score - b.score);
    const maxDraw = this.w < 760 ? 8 : 14;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (const it of enemies.slice(0, maxDraw)) {
      const c = it.c;
      const color = it.dangerous ? '255,92,118' : (it.splitEatable ? '255,210,80' : '124,255,176');
      if (G.settings.enemyHint) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r + Math.max(8 / scale, c.r * 0.08), 0, U.TAU);
        ctx.lineWidth = Math.max(2, c.r * 0.045);
        ctx.strokeStyle = 'rgba(' + color + ',0.88)';
        if (it.splitEatable && !it.eatable) ctx.setLineDash([8 / scale, 6 / scale]);
        ctx.stroke(); ctx.setLineDash([]);
      }
      if (G.settings.massMarker && c.r * scale > 13) {
        const label = it.dangerous ? '\u5371\u9669' : (it.splitEatable && !it.eatable ? '\u5206\u88c2' : '\u53ef\u5403');
        const fs = Math.max(10 / scale, Math.min(15 / scale, c.r * 0.18));
        ctx.font = '800 ' + fs + 'px "Microsoft YaHei", sans-serif';
        ctx.lineWidth = Math.max(2 / scale, fs * 0.18);
        ctx.strokeStyle = 'rgba(0,0,0,0.62)'; ctx.fillStyle = 'rgba(' + color + ',0.96)';
        ctx.strokeText(label, c.x, c.y - c.r - Math.max(13 / scale, c.r * 0.12));
        ctx.fillText(label, c.x, c.y - c.r - Math.max(13 / scale, c.r * 0.12));
      }
    }
    ctx.restore();
  };

  Render._ejected = function (ctx, e) {
    if (e.kind === 'thorn') {
      const spikes = 14, r = Math.max(e.r, 10), ir = r * 0.58, a0 = e.angle || 0;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(a0);
      ctx.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const a = Math.PI * i / spikes;
        const rr = (i % 2) ? ir : r * 1.35;
        const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = e.color || '#76ff45'; ctx.fill();
      ctx.lineWidth = Math.max(2, r * 0.12); ctx.strokeStyle = '#249b38'; ctx.stroke();
      ctx.restore();
      return;
    }
    ctx.fillStyle = e.color;
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, U.TAU); ctx.fill();
    if (e.kind === 'silence') {
      ctx.lineWidth = Math.max(1.5, e.r * 0.22); ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(e.x - e.r * 0.45, e.y + e.r * 0.45); ctx.lineTo(e.x + e.r * 0.45, e.y - e.r * 0.45); ctx.stroke();
    }
  };
  Render._grid = function (ctx) {
    const v = this.viewBounds(), step = 50, world = CFG.worldSize;
    const x0 = Math.floor(v.x0 / step) * step, x1 = Math.ceil(v.x1 / step) * step;
    const y0 = Math.floor(v.y0 / step) * step, y1 = Math.ceil(v.y1 / step) * step;
    ctx.lineWidth = 1 / this.camera.scale;
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.beginPath();
    for (let x = x0; x <= x1; x += step) { ctx.moveTo(x, v.y0); ctx.lineTo(x, v.y1); }
    for (let y = y0; y <= y1; y += step) { ctx.moveTo(v.x0, y); ctx.lineTo(v.x1, y); }
    ctx.stroke();

    const major = world / 3;
    ctx.save();
    ctx.lineWidth = 3 / this.camera.scale;
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      const p = major * i;
      ctx.moveTo(p, 0); ctx.lineTo(p, world);
      ctx.moveTo(0, p); ctx.lineTo(world, p);
    }
    ctx.stroke();

    const px = this.camera.scale;
    if (px > 0.18) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '800 ' + Math.max(90, 130 / px) + 'px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.055)';
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          const cx = major * (col + 0.5), cy = major * (row + 0.5);
          if (cx > v.x0 - major && cx < v.x1 + major && cy > v.y0 - major && cy < v.y1 + major) {
            ctx.fillText('' + (row * 3 + col + 1), cx, cy);
          }
        }
      }
    }
    ctx.restore();
  };

  Render._squeezeMap = function (stack, dt) {
    const cells = stack.filter((c) => !c._isVirus && c.r > 8);
    const targets = new Map(), seen = new Set();
    for (const c of cells) seen.add(c.id);

    const addContact = (c, angle, amt) => {
      let arr = targets.get(c.id);
      if (!arr) { arr = []; targets.set(c.id, arr); }
      arr.push({ angle, amt });
    };

    for (let i = 0; i < cells.length; i++) {
      const a = cells[i];
      for (let j = i + 1; j < cells.length; j++) {
        const b = cells[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const near = (a.r + b.r) * 1.035;
        if (d >= near) continue;
        const minR = Math.max(8, Math.min(a.r, b.r));
        const overlap = near - d;
        const pressure = U.clamp(overlap / Math.max(12, minR * 0.72), 0, 1);
        const rel = Math.hypot((a.vx || 0) - (b.vx || 0), (a.vy || 0) - (b.vy || 0));
        const amt = U.clamp(pressure * 0.34 + Math.min(0.07, rel / 11000), 0, 0.38);
        if (amt <= 0.012) continue;
        const ang = Math.atan2(dy, dx);
        addContact(a, ang, amt);
        addContact(b, ang + Math.PI, amt);
      }
    }

    const out = new Map();
    const step = Math.min(0.05, Math.max(0.001, dt || 1 / 60));
    for (const c of cells) {
      const raw = (targets.get(c.id) || []).sort((a, b) => b.amt - a.amt).slice(0, 4);
      const targetAmt = raw.length ? raw[0].amt : 0;
      const prev = this._squeeze.get(c.id) || { amp: 0, vel: 0, angle: 0, wobble: 0 };
      const accel = (targetAmt - prev.amp) * 130 - prev.vel * 18;
      const vel = prev.vel + accel * step;
      const amp = U.clamp(prev.amp + vel * step, 0, 0.42);
      const angle = raw.length ? raw[0].angle : prev.angle;
      const wobble = (prev.wobble || 0) + step * (raw.length ? 22 : 13);
      const scale = targetAmt > 0.0001 ? amp / targetAmt : 0;
      const contacts = raw.map((r) => ({ angle: r.angle, amt: U.clamp(r.amt * scale, 0, 0.42) }));
      const sq = { amp, vel, angle, wobble, contacts };
      this._squeeze.set(c.id, sq);
      if (amp > 0.004 || Math.abs(vel) > 0.012) out.set(c.id, sq);
    }
    for (const id of this._squeeze.keys()) if (!seen.has(id)) this._squeeze.delete(id);
    return out;
  };

  Render._cellPath = function (ctx, c, sq) {
    if (!sq || !sq.contacts || !sq.contacts.length || sq.amp <= 0.006) {
      ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, U.TAU); return;
    }
    const pts = [];
    const n = c.r > 70 ? 34 : 26;
    const wob = Math.sin(sq.wobble || 0);
    for (let i = 0; i < n; i++) {
      const th = U.TAU * i / n;
      let deform = 0;
      for (const contact of sq.contacts) {
        const d = Math.atan2(Math.sin(th - contact.angle), Math.cos(th - contact.angle));
        const ad = Math.abs(d);
        const front = Math.exp(-(ad * ad) / 0.20);                    // dent at contact point
        const side = Math.exp(-Math.pow(ad - Math.PI / 2, 2) / 0.34); // soft sideways bulge
        const back = Math.exp(-Math.pow(Math.PI - ad, 2) / 0.55);     // tiny recoil at back
        deform += contact.amt * (-0.36 * front + 0.13 * side + 0.035 * back);
      }
      deform += Math.sin(th * 3 + (sq.wobble || 0)) * sq.amp * 0.018;
      deform += wob * sq.amp * 0.012;
      const rr = c.r * U.clamp(1 + deform, 0.68, 1.18);
      pts.push({ x: c.x + Math.cos(th) * rr, y: c.y + Math.sin(th) * rr });
    }
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const p0 = pts[i], p1 = pts[(i + 1) % pts.length];
      const mx = (p0.x + p1.x) * 0.5, my = (p0.y + p1.y) * 0.5;
      if (i === 0) ctx.moveTo(mx, my);
      ctx.quadraticCurveTo(p1.x, p1.y, (p1.x + pts[(i + 2) % pts.length].x) * 0.5, (p1.y + pts[(i + 2) % pts.length].y) * 0.5);
    }
    ctx.closePath();
  };

  Render._cell = function (ctx, c, sq) {
    this._cellPath(ctx, c, sq);
    ctx.fillStyle = c.color; ctx.fill();
    const skin = G.settings.visualSkins ? this._skinImage(c.skin) : null;
    if (skin) {
      ctx.save();
      this._cellPath(ctx, c, sq);
      ctx.clip();
      ctx.drawImage(skin, c.x - c.r, c.y - c.r, c.r * 2, c.r * 2);
      ctx.restore();
      this._cellPath(ctx, c, sq);
    }
    ctx.lineWidth = Math.max(2, c.r * 0.05);
    ctx.strokeStyle = c.dark || 'rgba(0,0,0,0.25)'; ctx.stroke();

    if (G.settings.visualStatus) {
      if (c.revenge) { ctx.beginPath(); ctx.arc(c.x, c.y, c.r + 7 / this.camera.scale + c.r * 0.06, 0, U.TAU); ctx.lineWidth = Math.max(2, c.r * 0.09); ctx.strokeStyle = 'rgba(255,107,138,0.9)'; ctx.stroke(); }
      if (c.poisoned) { ctx.beginPath(); ctx.arc(c.x, c.y, c.r + 4 / this.camera.scale, 0, U.TAU); ctx.lineWidth = Math.max(2, c.r * 0.06); ctx.strokeStyle = 'rgba(49,212,106,0.85)'; ctx.stroke(); }
      if (c.silenced) { ctx.beginPath(); ctx.arc(c.x, c.y, c.r + 11 / this.camera.scale, 0, U.TAU); ctx.lineWidth = Math.max(2, c.r * 0.055); ctx.strokeStyle = 'rgba(138,160,255,0.9)'; ctx.setLineDash([5, 5]); ctx.stroke(); ctx.setLineDash([]); }
      if (c.shield) { ctx.beginPath(); ctx.arc(c.x, c.y, c.r + 6 / this.camera.scale + c.r * 0.06, 0, U.TAU); ctx.lineWidth = Math.max(2, c.r * 0.09); ctx.strokeStyle = 'rgba(108,240,255,0.9)'; ctx.stroke(); }
      if (c.admin) { ctx.beginPath(); ctx.arc(c.x, c.y, c.r + 10 / this.camera.scale + c.r * 0.08, 0, U.TAU); ctx.lineWidth = Math.max(2, c.r * 0.07); ctx.strokeStyle = 'rgba(255,210,80,0.95)'; ctx.setLineDash([8, 6]); ctx.stroke(); ctx.setLineDash([]); }
      if (c.mergeIn && c.mergeIn > 0.05) { const frac = U.clamp(c.mergeIn / (CFG.mergeMax || 3), 0, 1); ctx.beginPath(); ctx.arc(c.x, c.y, c.r + 5 / this.camera.scale, -Math.PI / 2, -Math.PI / 2 + U.TAU * frac); ctx.lineWidth = Math.max(2, c.r * 0.07); ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.stroke(); }
    }

    const px = c.r * this.camera.scale;
    if ((c.isMe || G.settings.visualAllNames || px > 90) && px > 20) {
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
    if (!G.settings.visualFx || !events) return;
    for (const ev of events) {
      let msg = null;
      if (ev.type === 'split') continue;
      else if (ev.type === 'merge') { this._fx.push({ x: ev.x, y: ev.y, r0: ev.r * 1.9, r1: ev.r * 0.6, age: 0, ttl: 0.40, color: ev.color, flash: true }); msg = '\u5408\u4f53\u5b8c\u6210'; }
      else if (ev.type === 'pop') { for (let i = 0; i < 3; i++) this._fx.push({ x: ev.x, y: ev.y, r0: ev.r * 0.5, r1: ev.r * (2.4 + i), age: -i * 0.06, ttl: 0.55, color: ev.color }); msg = '\u7eff\u523a\u7206\u5f00'; }
      else if (ev.type === 'revenge') { this._fx.push({ x: ev.x, y: ev.y, r0: ev.r * 0.7, r1: ev.r * 2.2, age: 0, ttl: 0.45, color: ev.color }); msg = '\u53cd\u566c\u6210\u529f'; }
      else if (ev.type === 'grow') { this._fx.push({ x: ev.x, y: ev.y, r0: ev.r * 0.5, r1: ev.r * 1.8, age: 0, ttl: 0.55, color: ev.color }); msg = '\u53d8\u5927'; }
      else if (ev.type === 'thorn') { this._fx.push({ x: ev.x, y: ev.y, r0: ev.r * 0.5, r1: ev.r * 2.5, age: 0, ttl: 0.42, color: ev.color }); msg = '\u5410\u523a'; }
      else if (ev.type === 'poison') { this._fx.push({ x: ev.x, y: ev.y, r0: ev.r * 0.5, r1: ev.r * 2.0, age: 0, ttl: 0.5, color: ev.color }); msg = '\u4e2d\u6bd2'; }
      else if (ev.type === 'silence') { this._fx.push({ x: ev.x, y: ev.y, r0: ev.r * 1.8, r1: ev.r * 0.8, age: 0, ttl: 0.45, color: ev.color }); msg = '\u9759\u9ed8'; }
      if (msg && (!this._feed.length || this._feed[this._feed.length - 1].text !== msg || this._feed[this._feed.length - 1].age > 0.5)) {
        this._feed.push({ text: msg, age: 0, ttl: 3.2 });
        if (this._feed.length > 6) this._feed.shift();
      }
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
    const ctx = this.ctx, lb = snap.leaderboard || [], mobile = this.w < 760;
    const w = mobile ? 158 : 218, x = this.w - w - (mobile ? 6 : 10), y = mobile ? 6 : 10;
    const maxRows = mobile ? 5 : 10, rowH = mobile ? 18 : 23;
    ctx.save();
    ctx.fillStyle = 'rgba(20,20,24,0.34)'; this._round(ctx, x, y, w, (mobile ? 31 : 38) + Math.min(lb.length, maxRows) * rowH, 4); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(235,235,235,0.94)';
    ctx.font = (mobile ? '700 15px ' : '700 24px ') + '"Microsoft YaHei", sans-serif';
    ctx.fillText('\u6392\u884c\u699c', x + w - 9, y + (mobile ? 19 : 27));
    ctx.font = (mobile ? '600 11px ' : '600 12.5px ') + '"Microsoft YaHei", sans-serif';
    lb.slice(0, maxRows).forEach((e, i) => {
      const rowY = y + (mobile ? 33 : 42) + i * rowH;
      let nm = e.name || 'Player';
      if (nm.length > (mobile ? 9 : 14)) nm = nm.slice(0, mobile ? 9 : 14) + '...';
      const mass = Math.floor(e.mass || 0);
      const label = (i + 1) + '. ' + nm + '  ' + mass;
      const tw = Math.min(w - 10, Math.max(mobile ? 92 : 112, ctx.measureText(label).width + 14));
      const gx = x + w - tw - 6;
      const gy = rowY - 13;
      const g = ctx.createLinearGradient(gx, gy, gx + tw, gy);
      if (e.isMe) { g.addColorStop(0, 'rgba(22,141,232,0.88)'); g.addColorStop(1, 'rgba(255,144,0,0.58)'); }
      else { g.addColorStop(0, 'rgba(54,54,58,0.58)'); g.addColorStop(1, 'rgba(30,30,34,0.45)'); }
      ctx.fillStyle = g; this._round(ctx, gx, gy, tw, mobile ? 16 : 19, 2); ctx.fill();
      ctx.fillStyle = e.isMe ? '#ffffff' : 'rgba(245,245,245,0.90)';
      ctx.fillText(label, x + w - 12, rowY);
    });
    ctx.restore();
  };

  Render._minimap = function (snap) {
    const ctx = this.ctx, mobile = this.w < 760;
    const s = mobile ? 108 : 166, pad = mobile ? 10 : 16;
    const x = mobile ? pad : this.w - s - pad;
    const y = mobile ? 122 : this.h - s - pad;
    const k = s / snap.world;
    const me = snap.me ? this._sectorInfo(snap.me.x, snap.me.y, snap.world) : null;
    ctx.save();
    ctx.fillStyle = 'rgba(8,10,24,0.48)'; this._round(ctx, x, y, s, s, mobile ? 6 : 12); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.09)'; ctx.lineWidth = 1; ctx.stroke();

    if (me) {
      const gx = x + me.col * s / 3, gy = y + me.row * s / 3;
      const grad = ctx.createLinearGradient(gx, gy, gx + s / 3, gy + s / 3);
      grad.addColorStop(0, 'rgba(22,141,232,0.34)'); grad.addColorStop(1, 'rgba(255,144,0,0.20)');
      ctx.fillStyle = grad; ctx.fillRect(gx, gy, s / 3, s / 3);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      const p = i * s / 3;
      ctx.moveTo(x + p, y); ctx.lineTo(x + p, y + s);
      ctx.moveTo(x, y + p); ctx.lineTo(x + s, y + p);
    }
    ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = (mobile ? '800 9px ' : '800 11px ') + 'sans-serif';
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
      const id = row * 3 + col + 1;
      ctx.fillStyle = me && me.id === id ? 'rgba(255,255,255,0.98)' : 'rgba(255,255,255,0.30)';
      ctx.fillText('' + id, x + (col + 0.5) * s / 3, y + (row + 0.5) * s / 3);
    }

    for (const p of snap.players) {
      const px = x + p.x * k, py = y + p.y * k;
      ctx.fillStyle = p.isMe ? '#7CFFB0' : 'rgba(255,255,255,0.46)';
      ctx.beginPath();
      ctx.arc(px, py, p.isMe ? (mobile ? 3.8 : 5) : 2 + Math.min(mobile ? 2 : 4, p.mass / 500), 0, U.TAU);
      ctx.fill();
      if (p.isMe) { ctx.strokeStyle = 'rgba(124,255,176,0.55)'; ctx.beginPath(); ctx.arc(px, py, mobile ? 7 : 9, 0, U.TAU); ctx.stroke(); }
    }
    ctx.restore();
  };

  // skill bar at bottom-center with cooldown sweep
  Render._skillbar = function (snap) {
    if (!snap.me || !snap.me.skills) return;
    const ctx = this.ctx, mobile = this.w < 760;
    const drawRow = (sk, y, sz, gap, lockText) => {
      const total = sk.length * sz + (sk.length - 1) * gap;
      let x = mobile ? 10 : this.w / 2 - total / 2;
      for (const s of sk) {
        this._round(ctx, x, y, sz, sz, mobile ? 6 : 10);
        const bg = ctx.createLinearGradient(x, y, x, y + sz);
        bg.addColorStop(0, 'rgba(34,36,48,0.82)'); bg.addColorStop(1, 'rgba(8,10,24,0.74)');
        ctx.fillStyle = bg; ctx.fill();
        ctx.lineWidth = s.active ? 3 : 2;
        ctx.strokeStyle = s.active ? '#fff' : s.color; ctx.stroke();
        if (s.active) { ctx.save(); ctx.globalAlpha = 0.18; ctx.fillStyle = s.color; this._round(ctx, x + 3, y + 3, sz - 6, sz - 6, mobile ? 5 : 8); ctx.fill(); ctx.restore(); }
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = s.locked ? 'rgba(220,228,255,0.25)' : (s.remain > 0 ? 'rgba(220,228,255,0.45)' : s.color);
        ctx.font = '800 ' + Math.max(12, sz * 0.4) + 'px sans-serif';
        ctx.fillText(s.key, x + sz / 2, y + sz / 2 - (mobile ? 1 : 4));
        if (sz >= 30) {
          ctx.fillStyle = 'rgba(220,228,255,0.78)';
          ctx.font = '600 ' + (mobile ? '8.5px ' : '10px ') + '"Microsoft YaHei", sans-serif';
          ctx.fillText(s.name, x + sz / 2, y + sz - (mobile ? 6 : 10));
        }
        if (s.locked) {
          ctx.fillStyle = 'rgba(0,0,0,0.58)'; this._round(ctx, x, y, sz, sz, mobile ? 6 : 10); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.font = '800 ' + Math.max(9, sz * 0.23) + 'px sans-serif';
          ctx.fillText(lockText || '\u9501', x + sz / 2, y + sz / 2 + 1);
        } else if (s.remain > 0) {
          const f = Math.min(1, s.remain / s.cd);
          ctx.save(); this._round(ctx, x, y, sz, sz, mobile ? 6 : 10); ctx.clip();
          ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x, y, sz, sz * f); ctx.restore();
          ctx.fillStyle = '#fff'; ctx.font = '700 ' + Math.max(10, sz * 0.28) + 'px sans-serif';
          ctx.fillText(s.remain.toFixed(s.remain < 1 ? 1 : 0), x + sz / 2, y + sz / 2 - 1);
        }
        x += sz + gap;
      }
    };
    const baseSz = mobile ? 38 : 56, gap = mobile ? 6 : 12;
    const baseY = mobile ? this.h - baseSz - 12 : this.h - baseSz - 18;
    drawRow(snap.me.skills || [], baseY, baseSz, gap, '\u9501');
    if (snap.me.specials && snap.me.specials.length) {
      const spSz = mobile ? 30 : 38;
      drawRow(snap.me.specials, baseY - spSz - (mobile ? 6 : 8), spSz, mobile ? 5 : 8, '\u4e70');
    }
  };

  Render._hud = function (snap) {
    const ctx = this.ctx, net = snap._net || {}, mobile = this.w < 760;
    ctx.save();
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = (mobile ? '600 11px ' : '600 12.5px ') + '"Microsoft YaHei", sans-serif';
    const fps = typeof this.fps === 'number' ? this.fps : 0;
    const rows = mobile ? [
      'FPS ' + fps,
      'SNAP ' + (net.snapHz || 0) + 'Hz',
      'DLT ' + (net.deltaCount || 0),
    ] : [
      'FPS ' + fps,
      'SNAP ' + (net.snapHz || 0) + 'Hz',
      'JIT ' + (net.jitterMs || 0) + 'ms',
      'DLT ' + (net.deltaCount || 0),
      'BUF ' + (net.bufferMs || 0) + 'ms',
    ];
    if (!(G.settings.perfStats && !mobile)) {
      const hx = mobile ? 10 : 62, hy = mobile ? 52 : 10, hw = mobile ? 94 : 116, hh = mobile ? 62 : 99;
      ctx.fillStyle = 'rgba(37,37,37,0.52)'; this._round(ctx, hx, hy, hw, hh, 2); ctx.fill();
      rows.forEach((r, i) => {
        const bad = (i === 0 && fps < 45) || (!mobile && i === 2 && (net.jitterMs || 0) > 35);
        ctx.fillStyle = bad ? '#ff7a90' : 'rgba(245,245,245,0.92)';
        ctx.fillText(r, hx + 9, hy + 20 + i * (mobile ? 14 : 17));
      });
    }

    const mass = snap.me ? Math.floor(snap.me.mass) : 0;
    const maxMass = snap.me ? Math.floor(snap.me.maxMass) : 0;
    const sector = snap.me ? this._sectorInfo(snap.me.x, snap.me.y, snap.world || CFG.worldSize).id : 0;
    const dia = snap.me ? Math.floor(snap.me.diamonds || 0) : 0;
    if (!G.settings.gameStats) {
      const text = mobile ? ('\u8d28\u91cf ' + mass + '  \u94bb\u77f3 ' + dia + (sector ? '  S' + sector : '')) : ('\u8d28\u91cf ' + mass + '   \u6700\u9ad8 ' + maxMass + '   \u94bb\u77f3 ' + dia + (sector ? '   \u533a\u57df ' + sector : '') + (snap.me && snap.me.cells > 1 ? '   \u5206\u8eab ' + snap.me.cells : ''));
      const w = mobile ? Math.min(this.w - 24, Math.max(210, ctx.measureText(text).width + 20)) : Math.max(230, ctx.measureText(text).width + 28);
      const x = mobile ? (this.w - w) / 2 : (this.w - w) / 2;
      const y = mobile ? 10 : this.h - 29;
      ctx.fillStyle = 'rgba(37,37,37,0.52)'; this._round(ctx, x, y, w, mobile ? 24 : 24, 2); ctx.fill();
      ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.94)'; ctx.font = (mobile ? '500 13px ' : '500 16px ') + '"Microsoft YaHei", sans-serif';
      ctx.fillText(text, this.w / 2, y + (mobile ? 17 : 17));
    }
    if (snap.me && snap.me.admin && !mobile) {
      ctx.textAlign = 'left'; ctx.fillStyle = '#ffd24f'; ctx.font = '700 13px "Microsoft YaHei", sans-serif';
      ctx.fillText('\u7ba1\u7406\u5458\u6a21\u5f0f  [ / ] \u8c03\u8d28\u91cf', 16, this.h - 60);
    }
    ctx.restore();
  };
  Render._fmtMass = function (n) {
    n = Math.max(0, Number(n) || 0);
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'm';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return '' + Math.floor(n);
  };
  Render._statsPanels = function (snap) {
    if (!snap || !snap.me) return;
    const ctx = this.ctx, mobile = this.w < 760, net = snap._net || {}, st = snap.stats || {};
    ctx.save();
    ctx.textBaseline = 'middle';

    if (G.settings.gameStats) {
      const cells = snap.me.cells || 1;
      const score = this._fmtMass(snap.me.maxMass || snap.me.mass || 0);
      const mass = this._fmtMass(snap.me.mass || 0);
      const text = '\u5206\u6570 ' + score + '     \u8d28\u91cf ' + mass + '     ' + cells + '/16';
      ctx.font = (mobile ? '600 12px ' : '600 16px ') + '"Microsoft YaHei", sans-serif';
      const w = Math.min(this.w - 22, Math.max(mobile ? 210 : 310, ctx.measureText(text).width + 28));
      const h = mobile ? 22 : 25, x = (this.w - w) / 2, y = this.h - h - (mobile ? 62 : 0);
      ctx.fillStyle = 'rgba(37,37,37,0.50)'; this._round(ctx, x, y, w, h, 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.94)'; ctx.textAlign = 'center';
      ctx.fillText(text, x + w / 2, y + h / 2 + 1);
    }

    if (G.settings.perfStats && !mobile) {
      const rows = [
        ['FPS', this.fps || 0], ['SNAP', (net.snapHz || 0) + 'Hz'], ['JIT', (net.jitterMs || 0) + 'ms'],
        ['DLT', net.deltaCount || 0], ['BUF', (net.bufferMs || 0) + 'ms'], ['\u5b9e\u4f53', (snap.cells || []).length + '/' + (snap.food || []).length]
      ];
      const x = this.w - 250, y = this.h - 84, w = 240, h = 66;
      ctx.fillStyle = 'rgba(37,37,37,0.42)'; this._round(ctx, x, y, w, h, 2); ctx.fill();
      ctx.font = '600 12px "Microsoft YaHei", sans-serif'; ctx.textAlign = 'left';
      for (let i = 0; i < rows.length; i++) {
        const col = i < 3 ? 0 : 1, row = i % 3;
        const tx = x + 10 + col * 118, ty = y + 13 + row * 19;
        ctx.fillStyle = 'rgba(255,255,255,0.62)'; ctx.fillText(rows[i][0] + ':', tx, ty);
              }
      for (let i = 0; i < rows.length; i++) {
        const col = i < 3 ? 0 : 1, row = i % 3;
        const tx = x + 62 + col * 118, ty = y + 13 + row * 19;
        const bad = rows[i][0] === 'JIT' && (net.jitterMs || 0) > 45;
        ctx.fillStyle = bad ? '#ff7a90' : 'rgba(255,255,255,0.94)'; ctx.fillText(String(rows[i][1]), tx, ty);
      }
    }

    if (G.settings.playerStatus) {
      const x = mobile ? 10 : 250, baseY = this.h - (mobile ? 116 : 58);
      const rows = [
        ['\u73a9', st.humans || 0], ['AI', st.bots || 0], ['\u603b', st.alive || ((st.humans || 0) + (st.bots || 0))]
      ];
      ctx.font = (mobile ? '700 11px ' : '700 13px ') + '"Microsoft YaHei", sans-serif'; ctx.textAlign = 'left';
      rows.forEach((r, i) => {
        const y = baseY + i * (mobile ? 17 : 18);
        ctx.fillStyle = 'rgba(37,37,37,0.42)'; this._round(ctx, x, y - 10, mobile ? 54 : 64, mobile ? 15 : 16, 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.68)'; ctx.fillText(r[0], x + 8, y - 1);
        ctx.fillStyle = 'rgba(255,255,255,0.94)'; ctx.fillText(String(r[1]), x + (mobile ? 34 : 42), y - 1);
      });
    }
    ctx.restore();
  };

  Render._feedPanel = function (dt) {
    if (!this._feed.length) return;
    const ctx = this.ctx, mobile = this.w < 760;
    for (const f of this._feed) f.age += dt;
    this._feed = this._feed.filter((f) => f.age < f.ttl);
    if (!this._feed.length) return;
    const rows = this._feed.slice(mobile ? -3 : -5);
    const x = mobile ? 10 : 14;
    const bottom = mobile ? this.h - 60 : this.h - 16;
    const rowH = mobile ? 17 : 20;
    const w = mobile ? 142 : 184;
    const h = rows.length * rowH + 10;
    const y = bottom - h;
    ctx.save();
    ctx.fillStyle = 'rgba(37,37,37,0.42)'; this._round(ctx, x, y, w, h, 2); ctx.fill();
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = (mobile ? '600 10.5px ' : '600 12px ') + '"Microsoft YaHei", sans-serif';
    rows.forEach((f, i) => {
      const a = Math.max(0, Math.min(1, 1 - Math.max(0, f.age - (f.ttl - 0.7)) / 0.7));
      ctx.fillStyle = 'rgba(245,245,245,' + (0.45 + 0.45 * a).toFixed(2) + ')';
      ctx.fillText(f.text, x + 9, y + 19 + i * rowH);
    });
    ctx.restore();
  };
  G.Render = Render;
})(window.G);
