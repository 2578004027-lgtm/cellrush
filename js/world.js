// CellRush — authoritative world simulation. Pure logic, no DOM.
// This is the module that could run unchanged on a Node server later.
(function (G) {
  const CFG = G.CFG, U = G.util;

  const radius = (m) => Math.sqrt(m / Math.PI) * CFG.massToRadius;
  const speed = (m) => U.clamp(CFG.speedBase * Math.pow(m, CFG.speedExp), CFG.speedMin, CFG.speedMax);
  G.radius = radius;
  G.speed = speed;

  function World() {
    this.size = CFG.worldSize;
    this.time = 0;                       // simulation seconds
    this.players = new Map();            // id -> player
    this.food = [];
    this.viruses = [];
    this.ejected = [];
    this.events = [];                     // one-shot visual events drained by the renderer
    this.hash = new U.SpatialHash(CFG.gridCell);
    for (let i = 0; i < CFG.foodCount; i++) this.food.push(this._spawnFood());
    for (let i = 0; i < CFG.virusCount; i++) this.viruses.push(this._spawnVirus());
  }

  World.prototype._spawnFood = function () {
    return { id: U.uid(), x: U.rand(this.size), y: U.rand(this.size), mass: CFG.foodMass,
      color: U.colorFromHue(U.randInt(0, 359)).css };
  };
  World.prototype._spawnVirus = function () {
    return { id: U.uid(), x: U.rand(this.size), y: U.rand(this.size), mass: CFG.virusMass, feed: 0, vx: 0, vy: 0 };
  };
  World.prototype._newCell = function (p, x, y, mass) {
    return { id: U.uid(), ownerId: p.id, x, y, mass, vx: 0, vy: 0, mergeAt: this.time + CFG.mergeBase };
  };

  // ---- players ----
  World.prototype.addPlayer = function (opts) {
    const p = {
      id: opts.id || ('p' + U.uid()),
      name: opts.name || 'anon',
      color: opts.color || U.randColor(),
      skin: opts.skin || '',
      isBot: !!opts.isBot,
      cells: [], input: { tx: 0, ty: 0, split: false, eject: false },
      alive: false, maxMass: 0, bornAt: this.time, ai: {},
      cd: { dash: 0, shield: 0, magnet: 0, merge: 0 },   // time when each skill is ready again
      fx: { dash: 0, shield: 0, magnet: 0, merge: 0 },   // time until each effect ends
      admin: false,
    };
    this.players.set(p.id, p);
    this.spawnPlayer(p);
    return p;
  };
  World.prototype.spawnPlayer = function (p) {
    p.alive = true;
    p.maxMass = CFG.startMass;
    p.bornAt = this.time;
    const x = U.rand(this.size * 0.1, this.size * 0.9), y = U.rand(this.size * 0.1, this.size * 0.9);
    p.cells = [this._newCell(p, x, y, CFG.startMass)];
    p.input.tx = x; p.input.ty = y;
  };

  World.prototype.removePlayer = function (id) { this.players.delete(id); };

  World.prototype.applyInput = function (playerId, input) {
    const p = this.players.get(playerId);
    if (!p || !p.alive) return;
    p.input.tx = input.tx; p.input.ty = input.ty;
    if (input.split) this._split(p);
    if (input.eject) this._eject(p);
    if (input.skill) this._useSkill(p, input.skill);
    if (p.admin && input.adminGrow) for (const c of p.cells) c.mass += CFG.admin.growStep;
    if (p.admin && input.adminShrink) for (const c of p.cells) c.mass = Math.max(CFG.startMass, c.mass - CFG.admin.growStep);
  };

  World.prototype._useSkill = function (p, name) {
    const def = CFG.skills[name];
    if (!def) return;
    if (this.time < (p.cd[name] || 0)) return;     // still on cooldown
    p.cd[name] = p.admin ? 0 : this.time + def.cd;  // admin: no cooldown
    p.fx[name] = this.time + (def.dur || 0);
    if (name === 'merge') for (const c of p.cells) c.mergeAt = this.time;   // allow immediate recombine
  };

  World.prototype._split = function (p) {
    const snapshot = p.cells.slice();
    for (const c of snapshot) {
      if (p.cells.length >= CFG.maxCells) break;
      if (c.mass < CFG.splitMin) continue;
      const half = c.mass / 2;
      c.mass = half;
      const ang = Math.atan2(p.input.ty - c.y, p.input.tx - c.x);
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const r = radius(half);
      const launch = U.clamp(
        Math.max(CFG.splitImpulse, r * (CFG.splitLaunchRadii || 4.4) * CFG.frictionPerSec),
        CFG.splitImpulse,
        CFG.splitImpulseMax || 12000
      );
      const sep = r * (CFG.splitStartSeparation || 2.15);
      const back = sep * (CFG.splitBackPush || 0.35);
      c.x = U.clamp(c.x - ca * back, r, this.size - r);
      c.y = U.clamp(c.y - sa * back, r, this.size - r);
      const nc = this._newCell(p,
        U.clamp(c.x + ca * sep, r, this.size - r),
        U.clamp(c.y + sa * sep, r, this.size - r),
        half
      );
      nc.vx = ca * launch;
      nc.vy = sa * launch;
      p.cells.push(nc);
      const mAt = this.time + CFG.mergeBase + p.cells.length * CFG.mergePerCell;  // more pieces -> longer
      nc.mergeAt = mAt; c.mergeAt = mAt;
      this.events.push({ type: 'split', x: nc.x, y: nc.y, r: radius(half), color: p.color.css });
    }
  };

  World.prototype._eject = function (p) {
    for (const c of p.cells) {
      if (c.mass < CFG.ejectMin) continue;
      const ang = Math.atan2(p.input.ty - c.y, p.input.tx - c.x);
      c.mass -= CFG.ejectLoss;
      const r = radius(c.mass);
      this.ejected.push({
        id: U.uid(), x: c.x + Math.cos(ang) * r, y: c.y + Math.sin(ang) * r, mass: CFG.ejectMass,
        vx: Math.cos(ang) * CFG.ejectSpeed, vy: Math.sin(ang) * CFG.ejectSpeed, color: p.color.css, ttl: CFG.ejectTTL,
      });
    }
  };

  // ---- main tick ----
  World.prototype.step = function (dt) {
    this.time += dt;
    this._dt = dt;
    const fr = Math.exp(-CFG.frictionPerSec * dt);

    // 1) move player cells
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const dashing = this.time < p.fx.dash;
      for (const c of p.cells) {
        const dx = p.input.tx - c.x, dy = p.input.ty - c.y;
        const d = Math.hypot(dx, dy) || 1;
        let v = speed(c.mass);
        if (dashing) v *= CFG.skills.dash.mult;
        if (p.admin) v *= CFG.admin.speedMult;
        const r = radius(c.mass);
        if (d < r && !dashing) v *= d / r;            // ease as pointer gets close
        c.x += (dx / d * v + c.vx) * dt;
        c.y += (dy / d * v + c.vy) * dt;
        c.vx *= fr; c.vy *= fr;
      }
      this._resolveOwnCells(p, dt);
      for (const c of p.cells) {
        const r = radius(c.mass);
        c.x = U.clamp(c.x, r, this.size - r);
        c.y = U.clamp(c.y, r, this.size - r);
      }
    }

    // 2) ejected mass & shot viruses move
    for (const e of this.ejected) {
      e.x += e.vx * dt; e.y += e.vy * dt; e.vx *= fr; e.vy *= fr; e.ttl -= dt;
      const r = radius(e.mass);
      e.x = U.clamp(e.x, r, this.size - r); e.y = U.clamp(e.y, r, this.size - r);
    }
    this.ejected = this.ejected.filter((e) => e.ttl > 0);
    for (const v of this.viruses) {
      if (v.vx || v.vy) {
        v.x += v.vx * dt; v.y += v.vy * dt; v.vx *= fr; v.vy *= fr;
        if (Math.hypot(v.vx, v.vy) < 8) { v.vx = 0; v.vy = 0; }
        const r = radius(v.mass);
        v.x = U.clamp(v.x, r, this.size - r); v.y = U.clamp(v.y, r, this.size - r);
      }
    }

    // 3) eating
    this._resolveEats();

    // 4) decay + bookkeeping + death
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      let tot = 0;
      for (const c of p.cells) {
        if (!p.admin && c.mass > CFG.decayMin) c.mass -= c.mass * CFG.decayRate * dt;
        tot += c.mass;
      }
      if (tot > p.maxMass) p.maxMass = tot;
      if (p.cells.length === 0) p.alive = false;
    }

    // 5) replenish food
    while (this.food.length < CFG.foodCount) this.food.push(this._spawnFood());
  };

  // same-owner cells: merge when ready, otherwise don't overlap; gentle cohesion
  World.prototype._resolveOwnCells = function (p, dt) {
    const cs = p.cells;
    for (let i = 0; i < cs.length; i++) {
      for (let j = i + 1; j < cs.length; j++) {
        const a = cs[i], b = cs[j];
        if (a.mass <= 0 || b.mass <= 0) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const ra = radius(a.mass), rb = radius(b.mass);
        if (this.time >= a.mergeAt && this.time >= b.mergeAt) {
          if (d < Math.max(ra, rb) * 0.6) {            // merge smaller into larger
            const big = a.mass >= b.mass ? a : b, small = a.mass >= b.mass ? b : a;
            big.mass += small.mass; small.mass = 0;
            this.events.push({ type: 'merge', x: big.x, y: big.y, r: radius(big.mass), color: p.color.css });
          }
        } else {
          const overlap = ra + rb - d;
          if (overlap > 0) {
            const nx = dx / d, ny = dy / d, push = overlap / 2;
            a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
          }
        }
      }
    }
    if (cs.some((c) => c.mass <= 0)) p.cells = cs.filter((c) => c.mass > 0);
    if (p.cells.length > 1) {                          // cohesion toward centroid
      let cx = 0, cy = 0, tm = 0;
      for (const c of p.cells) { cx += c.x * c.mass; cy += c.y * c.mass; tm += c.mass; }
      cx /= tm; cy /= tm;
      const mergeReady = cs.every((c) => this.time >= c.mergeAt);
      const coh = this.time < p.fx.merge ? CFG.skills.merge.cohesion : (mergeReady ? CFG.cohesion : (CFG.splitCohesion || 0.04));
      for (const c of p.cells) { c.x += (cx - c.x) * coh * dt; c.y += (cy - c.y) * coh * dt; }
    }
  };

  World.prototype._allCells = function () {
    const out = [];
    for (const p of this.players.values()) if (p.alive) for (const c of p.cells) out.push(c);
    return out;
  };

  World.prototype._resolveEats = function () {
    const cells = this._allCells();
    const H = this.hash;

    // --- cells eat food ---
    H.clear();
    for (const f of this.food) H.insert(f);

    // magnet skill: active players drag nearby food toward their cells
    const mdt = this._dt || 1 / 30;
    for (const p of this.players.values()) {
      if (!p.alive || this.time >= p.fx.magnet) continue;
      const def = CFG.skills.magnet;
      for (const c of p.cells) {
        H.query(c.x, c.y, def.range, (f) => {
          const dx = c.x - f.x, dy = c.y - f.y, d = Math.hypot(dx, dy) || 1;
          if (d < def.range) { const sp = def.speed * (1 - d / def.range); f.x += dx / d * sp * mdt; f.y += dy / d * sp * mdt; }
        });
      }
    }

    const eatenFood = new Set();
    for (const c of cells) {
      const r = radius(c.mass);
      H.query(c.x, c.y, r, (f) => {
        if (eatenFood.has(f.id)) return;
        if (U.dist(c.x, c.y, f.x, f.y) < r) { eatenFood.add(f.id); c.mass += f.mass; }
      });
    }
    if (eatenFood.size) this.food = this.food.filter((f) => !eatenFood.has(f.id));

    // --- ejected mass: feed viruses, else get eaten by cells ---
    const remEject = new Set();
    for (const e of this.ejected) {
      for (const v of this.viruses) {
        if (U.dist(e.x, e.y, v.x, v.y) < radius(v.mass)) {
          v.mass += e.mass; v.feed++; remEject.add(e.id);
          if (v.feed >= CFG.virusFeedShoot) this._virusShoot(v, e.vx, e.vy);
          break;
        }
      }
    }
    H.clear();
    for (const e of this.ejected) if (!remEject.has(e.id)) H.insert(e);
    for (const c of cells) {
      const r = radius(c.mass);
      H.query(c.x, c.y, r, (e) => {
        if (remEject.has(e.id)) return;
        if (U.dist(c.x, c.y, e.x, e.y) < r) { remEject.add(e.id); c.mass += e.mass; }
      });
    }
    if (remEject.size) this.ejected = this.ejected.filter((e) => !remEject.has(e.id));

    // --- cells vs viruses & other cells ---
    H.clear();
    for (const c of cells) H.insert(c);
    const dead = new Set();
    let virusPopped = false;
    for (const c of cells) {
      if (dead.has(c.id)) continue;
      const cp = this.players.get(c.ownerId);
      const r = radius(c.mass);
      const ratio = (cp && cp.admin) ? 1.0 : CFG.eatRatio;
      // viruses: a big cell that covers one pops into pieces (admin cells just absorb)
      for (const v of this.viruses) {
        if (v._dead) continue;
        if (c.mass > v.mass * 1.15 && U.dist(c.x, c.y, v.x, v.y) < r - radius(v.mass) * 0.6) {
          c.mass += v.mass; v._dead = true; virusPopped = true;
          this.events.push({ type: 'pop', x: c.x, y: c.y, r: radius(c.mass), color: '#7be37b' });
          if (!(cp && cp.admin)) this._popCell(c);
        }
      }
      // other cells
      H.query(c.x, c.y, r, (t) => {
        if (t === c || dead.has(t.id) || dead.has(c.id) || t.ownerId === c.ownerId) return;
        const tp = this.players.get(t.ownerId);
        if (tp && (this.time < tp.fx.shield || tp.admin)) return;   // shielded / admin cannot be eaten
        if (c.mass >= t.mass * ratio && U.dist(c.x, c.y, t.x, t.y) < r - radius(t.mass) * CFG.eatOverlap) {
          dead.add(t.id); c.mass += t.mass;
        }
      });
    }
    if (dead.size) {
      for (const p of this.players.values()) if (p.alive) p.cells = p.cells.filter((c) => !dead.has(c.id));
      this._lastEaten = dead;     // for event hooks (audio)
    }
    if (virusPopped) {
      this.viruses = this.viruses.filter((v) => !v._dead);
      while (this.viruses.length < CFG.virusCount) this.viruses.push(this._spawnVirus());
    }
  };

  // explode a cell that swallowed a virus into many small pieces
  World.prototype._popCell = function (c) {
    const p = this.players.get(c.ownerId);
    if (!p) return;
    const pieces = Math.min(CFG.maxCells - p.cells.length, 7);
    if (pieces <= 0) return;
    const each = c.mass / (pieces + 1);
    c.mass = each;
    const merge = this.time + CFG.mergeBase + (p.cells.length + pieces) * CFG.mergePerCell;
    c.mergeAt = merge;
    for (let i = 0; i < pieces; i++) {
      const ang = U.rand(U.TAU);
      const nc = this._newCell(p, c.x, c.y, each);
      nc.vx = Math.cos(ang) * CFG.splitImpulse * 1.1;
      nc.vy = Math.sin(ang) * CFG.splitImpulse * 1.1;
      nc.mergeAt = merge;
      p.cells.push(nc);
    }
  };

  World.prototype._virusShoot = function (v, dx, dy) {
    const ang = Math.atan2(dy, dx);
    const nv = {
      id: U.uid(), mass: CFG.virusMass, feed: 0,
      x: v.x + Math.cos(ang) * (radius(v.mass) + 6),
      y: v.y + Math.sin(ang) * (radius(v.mass) + 6),
      vx: Math.cos(ang) * CFG.virusShootSpeed, vy: Math.sin(ang) * CFG.virusShootSpeed,
    };
    v.mass = CFG.virusMass; v.feed = 0;
    this.viruses.push(nv);
  };

  // Build a render-ready, viewport-culled snapshot for one player. Used by the
  // server (authoritative) to broadcast; the client just renders what it gets.
  // Does NOT clear events — the server clears world.events once after broadcasting to all.
  World.prototype.buildSnapshot = function (playerId, view) {
    const w = this, radius = G.radius;
    const out = { cells: [], food: [], viruses: [], ejected: [], leaderboard: [], players: [], events: [], me: null, world: w.size };
    const inView = (x, y, r) => x + r > view.x0 && x - r < view.x1 && y + r > view.y0 && y - r < view.y1;

    for (const f of w.food) if (inView(f.x, f.y, 8)) out.food.push({ id: f.id, x: f.x, y: f.y, r: radius(f.mass), color: f.color });
    for (const e of w.ejected) { const r = radius(e.mass); if (inView(e.x, e.y, r)) out.ejected.push({ id: e.id, x: e.x, y: e.y, r, color: e.color }); }
    for (const v of w.viruses) { const r = radius(v.mass); if (inView(v.x, v.y, r)) out.viruses.push({ id: v.id, x: v.x, y: v.y, r, mass: v.mass }); }

    for (const p of w.players.values()) {
      if (!p.alive) continue;
      let cx = 0, cy = 0, tm = 0;
      for (const c of p.cells) {
        cx += c.x * c.mass; cy += c.y * c.mass; tm += c.mass;
        const r = radius(c.mass);
        if (inView(c.x, c.y, r))
          out.cells.push({ id: c.id, x: c.x, y: c.y, r, mass: c.mass, color: p.color.css, dark: p.color.dark, skin: p.skin || '',
            name: p.name, isMe: p.id === playerId,
            shield: w.time < (p.fx.shield || 0), admin: p.admin, dashing: w.time < (p.fx.dash || 0),
            mergeIn: (p.id === playerId && p.cells.length > 1) ? Math.max(0, c.mergeAt - w.time) : 0 });
      }
      if (tm > 0) { cx /= tm; cy /= tm; out.players.push({ x: cx, y: cy, mass: tm, isMe: p.id === playerId }); }
    }

    const named = [];
    for (const p of w.players.values()) { if (!p.alive) continue; let m = 0; for (const c of p.cells) m += c.mass; named.push({ name: p.name, mass: m, isMe: p.id === playerId }); }
    named.sort((a, b) => b.mass - a.mass);
    out.leaderboard = named.slice(0, 10);

    const me = w.players.get(playerId);
    if (me && me.alive && me.cells.length) {
      let cx = 0, cy = 0, tm = 0;
      for (const c of me.cells) { cx += c.x * c.mass; cy += c.y * c.mass; tm += c.mass; }
      out.me = { x: cx / tm, y: cy / tm, mass: tm, maxMass: me.maxMass, cells: me.cells.length, admin: me.admin };
      out.me.skills = CFG.skillOrder.map((k) => {
        const def = CFG.skills[k];
        return { key: def.key, name: def.name, color: def.color, remain: Math.max(0, (me.cd[k] || 0) - w.time), cd: def.cd, active: w.time < (me.fx[k] || 0) };
      });
    }

    for (const ev of w.events) if (inView(ev.x, ev.y, (ev.r || 30) * 3)) out.events.push(ev);
    return out;
  };

  G.World = World;
})(window.G);
