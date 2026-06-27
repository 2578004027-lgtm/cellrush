// CellRush - NetTransport: online WebSocket client with buffered snapshot interpolation.
(function (G) {
  const EMPTY = { cells: [], food: [], viruses: [], ejected: [], leaderboard: [], players: [], events: [], me: null, world: G.CFG.worldSize };
  const INTERP_DELAY = 0.075;
  const MAX_HISTORY = 30;

  function nowSec() { return ((performance && performance.now) ? performance.now() : Date.now()) / 1000; }
  function serverUrl() {
    if (G.NET && G.NET.url) return G.NET.url;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host;
  }
  function copyObj(o) { const n = {}; for (const k in o) n[k] = o[k]; return n; }
  function cloneSnap(s, stats) {
    if (!s) s = EMPTY;
    return {
      cells: (s.cells || []).map(copyObj),
      food: s.food || [],
      viruses: (s.viruses || []).map(copyObj),
      ejected: (s.ejected || []).map(copyObj),
      leaderboard: s.leaderboard || [],
      players: s.players || [],
      events: s.events || [],
      me: s.me ? copyObj(s.me) : null,
      world: s.world || G.CFG.worldSize,
      _net: stats || null,
    };
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function indexById(arr) {
    const m = new Map();
    for (const o of arr || []) if (o && o.id !== undefined) m.set(o.id, o);
    return m;
  }
  function interpMoving(prev, next, t) {
    const pm = indexById(prev);
    return (next || []).map((b) => {
      const out = copyObj(b), a = pm.get(b.id);
      if (a) {
        out.x = lerp(a.x, b.x, t); out.y = lerp(a.y, b.y, t);
        if (typeof a.r === 'number' && typeof b.r === 'number') out.r = lerp(a.r, b.r, t);
        if (typeof a.mass === 'number' && typeof b.mass === 'number') out.mass = lerp(a.mass, b.mass, t);
      }
      return out;
    });
  }
  function interpMe(a, b, t) {
    if (!b) return null;
    const out = copyObj(b);
    if (a) {
      out.x = lerp(a.x, b.x, t); out.y = lerp(a.y, b.y, t);
      if (typeof a.mass === 'number' && typeof b.mass === 'number') out.mass = lerp(a.mass, b.mass, t);
      if (typeof a.maxMass === 'number' && typeof b.maxMass === 'number') out.maxMass = Math.max(a.maxMass, b.maxMass);
    }
    return out;
  }
  function interpSnap(a, b, t, stats) {
    return {
      cells: interpMoving(a.cells, b.cells, t),
      food: b.food || [],
      viruses: interpMoving(a.viruses, b.viruses, t),
      ejected: interpMoving(a.ejected, b.ejected, t),
      leaderboard: b.leaderboard || [],
      players: b.players || [],
      events: b.events || [],
      me: interpMe(a.me, b.me, t),
      world: b.world || G.CFG.worldSize,
      _interpolated: true,
      _net: stats || null,
    };
  }

  function NetTransport(opts) {
    this.opts = opts;
    this.myId = null;
    this.alive = false;
    this.latest = EMPTY;
    this.history = [];
    this.entityCache = { food: new Map(), viruses: new Map(), ejected: new Map() };
    this.stats = { snapHz: 0, jitterMs: 0, bufferMs: Math.round(INTERP_DELAY * 1000), deltaCount: 0 };
    this._clockOffset = null;
    this._lastSnapAt = 0;
    this._snapIntervals = [];
    this._snapSeq = 0;
    this._lastEventSeq = 0;
    this._pending = { split: false, eject: false, skill: null };
    this._aim = { tx: 0, ty: 0 };
    this._lastSend = 0;
    this._adminWant = false;
    this.account = null;
    try {
      this.ws = new WebSocket(serverUrl());
    } catch (e) { if (opts.onError) opts.onError(); return; }
    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({ t: 'join', name: opts.name, color: { h: opts.color.h }, skin: opts.skin || '', account: opts.account || '', password: opts.password || '' }));

    };
    this.ws.onmessage = (e) => { try { this._recv(JSON.parse(e.data)); } catch (err) { /* ignore malformed packets */ } };
    this.ws.onclose = () => { if (opts.onClose) opts.onClose(); };
    this.ws.onerror = () => { if (opts.onError) opts.onError(); };
  }

  NetTransport.prototype._noteSnap = function (serverTime) {
    const t = nowSec();
    if (this._lastSnapAt) {
      const dt = (t - this._lastSnapAt) * 1000;
      this._snapIntervals.push(dt);
      if (this._snapIntervals.length > 40) this._snapIntervals.shift();
      const avg = this._snapIntervals.reduce((a, b) => a + b, 0) / this._snapIntervals.length;
      const variance = this._snapIntervals.reduce((a, b) => a + (b - avg) * (b - avg), 0) / this._snapIntervals.length;
      this.stats.snapHz = avg > 0 ? Math.round(1000 / avg) : 0;
      this.stats.jitterMs = Math.round(Math.sqrt(variance));
    }
    this._lastSnapAt = t;
    if (typeof serverTime === 'number') {
      const measured = t - serverTime;
      this._clockOffset = this._clockOffset == null ? measured : this._clockOffset + (measured - this._clockOffset) * 0.08;
    }
  };


  NetTransport.prototype._applyEntityDelta = function (snap, key) {
    const cache = this.entityCache[key];
    if (snap[key + 'Reset']) {
      cache.clear();
      for (const obj of snap[key] || []) cache.set(obj.id, obj);
    } else if (snap[key + 'Add'] || snap[key + 'Update'] || snap[key + 'Remove']) {
      for (const id of snap[key + 'Remove'] || []) cache.delete(id);
      for (const obj of snap[key + 'Add'] || []) cache.set(obj.id, obj);
      for (const obj of snap[key + 'Update'] || []) cache.set(obj.id, obj);
    } else if (snap[key] && snap[key].length) {
      cache.clear();
      for (const obj of snap[key]) cache.set(obj.id, obj);
    }
    const changedCount = (snap[key + 'Add'] || []).length + (snap[key + 'Update'] || []).length + (snap[key + 'Remove'] || []).length;
    snap[key] = Array.from(cache.values());
    return changedCount;
  };
  NetTransport.prototype._applyNearbyDeltas = function (snap) {
    this.stats.deltaCount =
      this._applyEntityDelta(snap, 'food') +
      this._applyEntityDelta(snap, 'viruses') +
      this._applyEntityDelta(snap, 'ejected');
  };
  NetTransport.prototype._recv = function (m) {
    if (m.t === 'welcome') {
      this.myId = m.id; this.alive = true;
      if (this.opts.onWelcome) this.opts.onWelcome(m);
    } else if (m.t === 'snap') {
      const snap = m.snap || EMPTY;
      snap._time = typeof m.time === 'number' ? m.time : nowSec();
      snap._seq = ++this._snapSeq;
      this._applyNearbyDeltas(snap);
      this._noteSnap(snap._time);
      this.latest = snap;
      this.history.push(snap);
      if (this.history.length > MAX_HISTORY) this.history.splice(0, this.history.length - MAX_HISTORY);
      const minTime = snap._time - 2;
      while (this.history.length > 2 && this.history[1]._time < minTime) this.history.shift();
    } else if (m.t === 'adminAuth') {
      this._adminWant = !!m.ok;
    } else if (m.t === 'adminTune') {
      if (this.opts.onAdminTune) this.opts.onAdminTune(m);
    } else if (m.t === 'account') {
      if (m.ok && m.account) this.account = m.account;
      if (this.opts.onAccount) this.opts.onAccount(m);
    } else if (m.t === 'dead') {
      this.alive = false;
      if (this.opts.onDead) this.opts.onDead(m);
    }
  };
  NetTransport.prototype.update = function (dt, input) {
    if (!this.ws || this.ws.readyState !== 1 || !input) return;
    if (input.split) this._pending.split = true;
    if (input.eject) this._pending.eject = true;
    if (input.skill) this._pending.skill = input.skill;
    this._aim.tx = input.tx; this._aim.ty = input.ty;

    const now = (performance && performance.now) ? performance.now() : 0;
    if (now - this._lastSend < 33) return;
    this._lastSend = now;
    this.ws.send(JSON.stringify({
      t: 'input', tx: this._aim.tx, ty: this._aim.ty,
      split: this._pending.split, eject: this._pending.eject, skill: this._pending.skill,
      adminGrow: input.adminGrow, adminShrink: input.adminShrink,
    }));
    this._pending = { split: false, eject: false, skill: null };
  };

  NetTransport.prototype._consumeEvents = function (out, source) {
    if (!source || !source._seq || source._seq === this._lastEventSeq) out.events = [];
    else this._lastEventSeq = source._seq;
    return out;
  };
  NetTransport.prototype.getSnapshot = function () {
    if (!this.history.length || this._clockOffset == null) return this._consumeEvents(cloneSnap(this.latest || EMPTY, this.stats), this.latest);
    const target = nowSec() - this._clockOffset - INTERP_DELAY;
    let a = null, b = null;
    for (let i = 0; i < this.history.length; i++) {
      const s = this.history[i];
      if (s._time <= target) a = s;
      if (s._time >= target) { b = s; break; }
    }
    if (!a || !b) return this._consumeEvents(cloneSnap(this.latest || EMPTY, this.stats), this.latest);
    if (a === b || b._time <= a._time) return this._consumeEvents(cloneSnap(b, this.stats), b);
    return this._consumeEvents(interpSnap(a, b, Math.max(0, Math.min(1, (target - a._time) / (b._time - a._time))), this.stats), b);
  };
  NetTransport.prototype.getStats = function () { return this.stats; };
  NetTransport.prototype.isMeAlive = function () { return !!(this.alive && this.latest && this.latest.me); };
  NetTransport.prototype.respawnMe = function (name, color, skin) {
    this.alive = true;
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'respawn', name, color: { h: color.h }, skin: skin || '' }));
  };
  NetTransport.prototype.buySkill = function (skill) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'buySkill', skill }));
  };
  NetTransport.prototype.adminTune = function (params) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'adminTune', params: params || null }));
  };
  NetTransport.prototype.adminLogin = function (key) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'adminAuth', key: key || '' }));
  };
  NetTransport.prototype.close = function () { try { this.ws.close(); } catch (e) { /* */ } };

  G.NetTransport = NetTransport;
})(window.G);
