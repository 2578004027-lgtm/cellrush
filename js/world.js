// CellRush - authoritative world simulation. Pure logic, no DOM.
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
      spawnMass: opts.startMass || (opts.isBot ? (CFG.botStartMass || CFG.startMass) : CFG.startMass),
      cells: [], input: { tx: 0, ty: 0, split: false, eject: false },
      alive: false, maxMass: 0, bornAt: this.time, ai: {},
      account: '', diamonds: 99999, unlockedSkills: [], poisonUntil: 0, poisonRate: 0, silenceUntil: 0, _growth: null, _magnetUntil: 0, _poisonBomb: null,
      cd: { dash: 0, shield: 0, magnet: 0, merge: 0, revenge: 0, grow: 0, thorn: 0, poison: 0, silence: 0 },   // time when each skill is ready again
      fx: { dash: 0, shield: 0, magnet: 0, merge: 0, revenge: 0, grow: 0, thorn: 0, poison: 0, silence: 0 },   // time until each effect ends
      admin: false,
    };
    this.players.set(p.id, p);
    this.spawnPlayer(p);
    return p;
  };
  World.prototype.spawnPlayer = function (p) {
    p.alive = true;
    const spawnMass = p.spawnMass || CFG.startMass;
    p.maxMass = spawnMass;
    p.bornAt = this.time;
    const x = U.rand(this.size * 0.1, this.size * 0.9), y = U.rand(this.size * 0.1, this.size * 0.9);
    p.cells = [this._newCell(p, x, y, spawnMass)];
    p.input.tx = x; p.input.ty = y;
    p.poisonUntil = 0; p.poisonRate = 0; p.silenceUntil = 0; p._growth = null; p._magnetUntil = 0; p._poisonBomb = null;
    for (const k in p.fx) p.fx[k] = 0;
  };

  World.prototype.removePlayer = function (id) { this.players.delete(id); };

  World.prototype.applyInput = function (playerId, input) {
    const p = this.players.get(playerId);
    if (!p || !p.alive) return;
    p.input.tx = input.tx; p.input.ty = input.ty;
    const splitCount = Math.max(input.split ? 1 : 0, Math.min(4, Math.floor(input.splitCount || 0)));
    if (splitCount > 0 && this.time >= (p.silenceUntil || 0)) for (let i = 0; i < splitCount; i++) this._split(p);
    const ejectCount = Math.max(input.eject ? 1 : 0, Math.min(8, Math.floor(input.ejectCount || 0)));
    if (ejectCount > 0) for (let i = 0; i < ejectCount; i++) this._eject(p);
    if (input.skill) this._useSkill(p, input.skill);
    if (p.admin && input.adminGrow) for (const c of p.cells) c.mass += CFG.admin.growStep;
    if (p.admin && input.adminShrink) for (const c of p.cells) c.mass = Math.max(CFG.startMass, c.mass - CFG.admin.growStep);
  };

  World.prototype._useSkill = function (p, name) {
    const def = CFG.skills[name];
    if (!def) return;
    if (this.time < (p.cd[name] || 0)) return;
    const cdMult = (def.special && !p.admin && !p.account) ? 2.2 : 1;
    p.cd[name] = p.admin ? 0 : this.time + def.cd * cdMult;
    p.fx[name] = this.time + (def.dur || 0);
    if (name === 'merge') for (const c of p.cells) c.mergeAt = this.time;
    else if (name === 'grow') this._startGrow(p, def);
    else if (name === 'thorn' || name === 'poison' || name === 'silence') this._shootSkillProjectile(p, name, def);
    else if (name === 'magnet') p._magnetUntil = p.fx.magnet;
  };

  World.prototype._mainCell = function (p) {
    let best = null;
    for (const c of p.cells) if (!best || c.mass > best.mass) best = c;
    return best;
  };

  World.prototype._startGrow = function (p, def) {
    if (p._growth && this.time < p._growth.until) return;
    const mult = def.massMult || 1.4;
    p._growth = { until: this.time + (def.dur || 4), mult };
    for (const c of p.cells) c.mass *= mult;
    if (p.cells[0]) this.events.push({ type: 'grow', x: p.cells[0].x, y: p.cells[0].y, r: radius(p.cells[0].mass), color: def.color });
  };

  World.prototype._shootSkillProjectile = function (p, kind, def) {
    const c = this._mainCell(p);
    if (!c || c.mass < CFG.ejectMin) return;
    const ang = Math.atan2(p.input.ty - c.y, p.input.tx - c.x);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const lossMass = def.loss || def.mass || CFG.ejectMass;
    const loss = Math.min(lossMass, Math.max(0, c.mass - CFG.startMass));
    c.mass -= loss;
    const r = radius(c.mass);
    this.ejected.push({
      id: U.uid(), x: c.x + ca * (r + 10), y: c.y + sa * (r + 10), mass: def.mass || CFG.ejectMass,
      vx: ca * (def.speed || CFG.ejectSpeed), vy: sa * (def.speed || CFG.ejectSpeed), color: def.color || p.color.css,
      ttl: Infinity, ownerId: p.id, kind, angle: ang, poisonDelay: def.poisonDelay || 3, poisonShrink: def.poisonShrink || 0.65, silenceDur: def.silenceDur || def.dur || 0,
    });
    this.events.push({ type: kind, x: c.x + ca * r, y: c.y + sa * r, r: radius(def.mass || CFG.ejectMass), color: def.color || p.color.css });
  };

  World.prototype._silenceArea = function (p, def) {
    const range = def.range || 480;
    for (const q of this.players.values()) {
      if (!q.alive || q.id === p.id || q.admin) continue;
      let hit = false;
      for (const a of p.cells) for (const b of q.cells) if (U.dist(a.x, a.y, b.x, b.y) < range + radius(a.mass)) hit = true;
      if (hit) {
        q.silenceUntil = Math.max(q.silenceUntil || 0, this.time + (def.dur || 4));
        if (q.cells[0]) this.events.push({ type: 'silence', x: q.cells[0].x, y: q.cells[0].y, r: radius(q.cells[0].mass), color: def.color });
      }
    }
  };

  World.prototype._convertCell = function (cell, fromP, toP, color) {
    if (!cell || !fromP || !toP || fromP.id === toP.id) return;
    fromP.cells = fromP.cells.filter((c) => c !== cell);
    cell.ownerId = toP.id;
    cell.splitAttackUntil = 0;
    cell.mergeAt = this.time + 2;
    toP.cells.push(cell);
    this.events.push({ type: 'revenge', x: cell.x, y: cell.y, r: radius(cell.mass), color: color || toP.color.css });
  };
  World.prototype._mergeDelay = function (mass, cellCount) {
    const byMass = Math.sqrt(Math.max(1, mass)) * (CFG.mergePerMass || 0);
    const byCells = Math.max(0, cellCount - 1) * (CFG.mergePerCell || 0);
    return U.clamp((CFG.mergeBase || 2) + byMass + byCells, CFG.mergeMin || 1.2, CFG.mergeMax || 3);
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
        Math.max(CFG.splitImpulse, r * (CFG.splitLaunchRadii || 3.0) * CFG.frictionPerSec),
        CFG.splitImpulse,
        CFG.splitImpulseMax || 6500
      );
      const sep = r * (CFG.splitStartSeparation || 2.03);
      const back = sep * (CFG.splitBackPush || 0);
      c.x = U.clamp(c.x - ca * back, r, this.size - r);
      c.y = U.clamp(c.y - sa * back, r, this.size - r);
      const nc = this._newCell(p,
        U.clamp(c.x + ca * sep, r, this.size - r),
        U.clamp(c.y + sa * sep, r, this.size - r),
        half
      );
      nc.vx = ca * launch;
      nc.vy = sa * launch;
      nc.splitAttackUntil = this.time + 1.4;
      p.cells.push(nc);
      const mAt = this.time + this._mergeDelay(half, p.cells.length);
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

  World.prototype._capEjected = function () {
    const max = CFG.ejectMax || 900;
    if (this.ejected.length > max) this.ejected.splice(0, this.ejected.length - max);
  };
  // ---- main tick ----
  World.prototype.step = function (dt) {
    this.time += dt;
    this._dt = dt;
    const fr = Math.exp(-CFG.frictionPerSec * dt);

    // 1) move player cells
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (p._growth && this.time >= p._growth.until) { for (const c of p.cells) c.mass = Math.max(CFG.startMass, c.mass / p._growth.mult); p._growth = null; }
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
      e.x += e.vx * dt; e.y += e.vy * dt; e.vx *= fr; e.vy *= fr; if (e.ttl !== Infinity) e.ttl -= dt;
      const r = radius(e.mass);
      e.x = U.clamp(e.x, r, this.size - r); e.y = U.clamp(e.y, r, this.size - r);
    }
    this.ejected = this.ejected.filter((e) => e.ttl > 0);
    this._capEjected();
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
      if (!p.admin && p._poisonBomb && this.time >= p._poisonBomb.at) {
        const ids = new Set(p._poisonBomb.cellIds || []);
        const unchanged = p.cells.length === ids.size && p.cells.every((c) => ids.has(c.id));
        if (unchanged) {
          for (const c of p.cells) this._poisonBurstCell(p, c, p._poisonBomb);
        }
        p._poisonBomb = null;
      }
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


  World.prototype._poisonBurstCell = function (p, c, bomb) {
    const oldMass = c.mass;
    const targetMass = Math.max(CFG.splitMin, oldMass * (bomb.shrink || 0.18));
    const lost = Math.max(0, oldMass - targetMass);
    c.mass = targetMass;
    const color = bomb.color || CFG.skills.poison.color;
    if (lost <= 0) { this.events.push({ type: 'poison', x: c.x, y: c.y, r: radius(c.mass), color }); return; }
    const count = Math.min(28, Math.max(8, Math.floor(lost / Math.max(14, CFG.ejectMass * 1.25))));
    const baseR = radius(c.mass);
    for (let i = 0; i < count; i++) {
      const a = U.TAU * (i / count) + U.rand(-0.18, 0.18);
      const sp = U.rand(260, 720);
      const m = Math.max(4, Math.min(CFG.ejectMass, lost / count));
      this.ejected.push({
        id: U.uid(), x: c.x + Math.cos(a) * (baseR + U.rand(4, 18)), y: c.y + Math.sin(a) * (baseR + U.rand(4, 18)),
        mass: m, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, color, ttl: CFG.ejectTTL, ownerId: p.id,
      });
    }
    this.events.push({ type: 'poison', x: c.x, y: c.y, r: radius(c.mass), color });
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

  World.prototype._leaderPlayerInfo = function () {
    let best = null;
    for (const p of this.players.values()) {
      if (!p.alive || p.spectator) continue;
      let cx = 0, cy = 0, tm = 0;
      for (const c of p.cells) { cx += c.x * c.mass; cy += c.y * c.mass; tm += c.mass; }
      if (tm > 0 && (!best || tm > best.mass)) best = { p, x: cx / tm, y: cy / tm, mass: tm };
    }
    return best;
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
      if (!p.alive || !p._magnetUntil || this.time >= p._magnetUntil) continue;
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
        if (U.dist(c.x, c.y, e.x, e.y) >= r) return;
        if (e.ownerId && e.ownerId === c.ownerId) { remEject.add(e.id); c.mass += e.mass; return; }
        if (e.kind === 'thorn') {
          remEject.add(e.id);
          if (c.mass > CFG.splitMin * 2.2) this._popCell(c);
          else c.mass = Math.max(CFG.startMass, c.mass - e.mass);
          this.events.push({ type: 'thorn', x: c.x, y: c.y, r: radius(c.mass), color: e.color });
          return;
        }
        if (e.kind === 'poison') {
          const tp = this.players.get(c.ownerId);
          remEject.add(e.id);
          if (tp && !tp.admin) tp._poisonBomb = { at: this.time + (e.poisonDelay || 3), cellIds: tp.cells.map((pc) => pc.id), shrink: e.poisonShrink || 0.18, color: e.color };
          this.events.push({ type: 'poison', x: c.x, y: c.y, r: radius(c.mass), color: e.color });
          return;
        }
        if (e.kind === 'silence') {
          const tp = this.players.get(c.ownerId);
          remEject.add(e.id);
          if (tp && !tp.admin) tp.silenceUntil = Math.max(tp.silenceUntil || 0, this.time + (e.silenceDur || 4.5));
          this.events.push({ type: 'silence', x: c.x, y: c.y, r: radius(c.mass), color: e.color });
          return;
        }
        remEject.add(e.id); c.mass += e.mass;
      });
    }
    if (remEject.size) this.ejected = this.ejected.filter((e) => !remEject.has(e.id));
    this._capEjected();

    // --- cells vs viruses & other cells ---
    H.clear();
    for (const c of cells) H.insert(c);
    const dead = new Set();
    const converted = new Set();
    let virusPopped = false;
    for (const c of cells) {
      if (dead.has(c.id) || converted.has(c.id)) continue;
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
        if (t === c || dead.has(t.id) || dead.has(c.id) || converted.has(c.id) || t.ownerId === c.ownerId) return;
        const tp = this.players.get(t.ownerId);
        if (tp && (this.time < tp.fx.shield || tp.admin)) return;
        const splitAttack = c.splitAttackUntil && this.time < c.splitAttackUntil;
        const eatRatio = splitAttack ? (CFG.splitEatRatio || CFG.eatRatio) : ratio;
        const eatOverlap = splitAttack ? (typeof CFG.splitEatOverlap === 'number' ? CFG.splitEatOverlap : 0.12) : CFG.eatOverlap;
        if (c.mass >= t.mass * eatRatio && U.dist(c.x, c.y, t.x, t.y) < r - radius(t.mass) * eatOverlap) {
          if (splitAttack && tp && this.time < (tp.fx.revenge || 0) && !(cp && cp.admin)) { converted.add(c.id); this._convertCell(c, cp, tp, CFG.skills.revenge.color); return; }
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
    const merge = this.time + this._mergeDelay(each, p.cells.length + pieces);
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
  // Does NOT clear events; the server clears world.events once after broadcasting to all.
  World.prototype.buildSnapshot = function (playerId, view) {
    const w = this, radius = G.radius;
    const out = { cells: [], food: [], viruses: [], ejected: [], leaderboard: [], players: [], events: [], me: null, world: w.size, stats: { humans: 0, bots: 0, alive: 0 } };
    const inView = (x, y, r) => x + r > view.x0 && x - r < view.x1 && y + r > view.y0 && y - r < view.y1;

    for (const f of w.food) if (inView(f.x, f.y, 8)) out.food.push({ id: f.id, x: f.x, y: f.y, r: radius(f.mass), color: f.color });
    for (const e of w.ejected) { const r = radius(e.mass); if (inView(e.x, e.y, r)) out.ejected.push({ id: e.id, x: e.x, y: e.y, r, color: e.color, kind: e.kind || '', angle: e.angle || 0 }); }
    for (const v of w.viruses) { const r = radius(v.mass); if (inView(v.x, v.y, r)) out.viruses.push({ id: v.id, x: v.x, y: v.y, r, mass: v.mass }); }

    for (const p of w.players.values()) {
      if (p.alive) { out.stats.alive++; if (p.isBot) out.stats.bots++; else out.stats.humans++; }
      if (!p.alive) continue;
      let cx = 0, cy = 0, tm = 0;
      for (const c of p.cells) {
        cx += c.x * c.mass; cy += c.y * c.mass; tm += c.mass;
        const r = radius(c.mass);
        if (inView(c.x, c.y, r))
          out.cells.push({ id: c.id, x: c.x, y: c.y, vx: c.vx || 0, vy: c.vy || 0, r, mass: c.mass, color: p.color.css, dark: p.color.dark, skin: p.skin || '',
            name: p.name, isMe: p.id === playerId,
            shield: w.time < (p.fx.shield || 0), admin: p.admin, dashing: w.time < (p.fx.dash || 0),
            mergeIn: (p.id === playerId && p.cells.length > 1) ? Math.max(0, c.mergeAt - w.time) : 0,
            revenge: w.time < (p.fx.revenge || 0), growth: !!p._growth, poisoned: w.time < (p.poisonUntil || 0) || !!(p._poisonBomb && w.time < p._poisonBomb.at), silenced: w.time < (p.silenceUntil || 0) });
      }
      if (tm > 0) { cx /= tm; cy /= tm; out.players.push({ x: cx, y: cy, mass: tm, isMe: p.id === playerId }); }
    }

    const named = [];
    for (const p of w.players.values()) { if (!p.alive || p.spectator) continue; let m = 0; for (const c of p.cells) m += c.mass; named.push({ name: p.name, mass: m, cells: p.cells.length, bot: !!p.isBot, isMe: p.id === playerId }); }
    named.sort((a, b) => b.mass - a.mass);
    out.leaderboard = named.slice(0, 24);

    const me = w.players.get(playerId);
    if (me && me.spectator) {
      const lead = me._spectateView || w._leaderPlayerInfo();
      const targetName = lead ? (lead.name || (lead.p && lead.p.name) || '') : '';
      const targetRank = lead ? (lead.rank || 1) : 0;
      const targetCells = lead ? (lead.cells || (lead.p && lead.p.cells && lead.p.cells.length) || 0) : 0;
      out.me = { x: lead ? lead.x : w.size / 2, y: lead ? lead.y : w.size / 2, mass: lead ? lead.mass : CFG.startMass, maxMass: lead ? lead.mass : 0, cells: 0, admin: false, spectator: true, account: '', diamonds: 0, skills: [], specials: [], targetName, targetRank, targetCells };
    } else if (me && me.alive && me.cells.length) {
      let cx = 0, cy = 0, tm = 0;
      for (const c of me.cells) { cx += c.x * c.mass; cy += c.y * c.mass; tm += c.mass; }
      out.me = { x: cx / tm, y: cy / tm, mass: tm, maxMass: me.maxMass, cells: me.cells.length, admin: me.admin, spectator: false,
        account: me.account || '', diamonds: me.diamonds || 99999 };
      out.me.skills = CFG.skillOrder.map((k) => {
        const def = CFG.skills[k];
        const unlocked = !def.special || me.admin || (me.unlockedSkills || []).includes(k);
        return { id: k, key: def.key, name: def.name, color: def.color, cost: def.cost || 0, locked: !unlocked,
          remain: unlocked ? Math.max(0, (me.cd[k] || 0) - w.time) : 0, cd: def.cd, active: unlocked && w.time < (me.fx[k] || 0) };
      });
      out.me.specials = (CFG.specialSkillOrder || []).map((k) => {
        const def = CFG.skills[k];
        const unlocked = true;
        return { id: k, key: def.key, name: def.name, color: def.color, cost: def.cost || 0, locked: !unlocked,
          remain: unlocked ? Math.max(0, (me.cd[k] || 0) - w.time) : 0, cd: def.cd, active: unlocked && w.time < (me.fx[k] || 0) };
      });
    }
    for (const ev of w.events) if (inView(ev.x, ev.y, (ev.r || 30) * 3)) out.events.push(ev);
    return out;
  };

  G.World = World;
})(window.G);
