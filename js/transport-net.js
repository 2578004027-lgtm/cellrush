// CellRush — NetTransport: the online replacement for LocalTransport.
// Sends input over WebSocket, receives authoritative snapshots from the server.
// The renderer already eases entities per-id, which doubles as network
// interpolation, so we just hand it the latest server snapshot.
(function (G) {
  const EMPTY = { cells: [], food: [], viruses: [], ejected: [], leaderboard: [], players: [], events: [], me: null, world: G.CFG.worldSize };

  function serverUrl() {
    if (G.NET && G.NET.url) return G.NET.url;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host;          // same origin (the Node server serves the page too)
  }

  function NetTransport(opts) {
    this.opts = opts;
    this.myId = null;
    this.alive = false;
    this.latest = EMPTY;
    this._pending = { split: false, eject: false, skill: null };
    this._aim = { tx: 0, ty: 0 };
    this._lastSend = 0;
    this._adminWant = false;
    try {
      this.ws = new WebSocket(serverUrl());
    } catch (e) { if (opts.onError) opts.onError(); return; }
    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({ t: 'join', name: opts.name, color: { h: opts.color.h } }));
      if (this._adminWant) this.setAdmin(true);
    };
    this.ws.onmessage = (e) => { try { this._recv(JSON.parse(e.data)); } catch (err) { /* */ } };
    this.ws.onclose = () => { if (opts.onClose) opts.onClose(); };
    this.ws.onerror = () => { if (opts.onError) opts.onError(); };
  }

  NetTransport.prototype._recv = function (m) {
    if (m.t === 'welcome') { this.myId = m.id; this.alive = true; if (this.opts.onWelcome) this.opts.onWelcome(m); }
    else if (m.t === 'snap') { this.latest = m.snap; }
    else if (m.t === 'dead') { this.alive = false; if (this.opts.onDead) this.opts.onDead(m); }
  };

  // called every animation frame with the latest sampled input (or null)
  NetTransport.prototype.update = function (dt, input) {
    if (!this.ws || this.ws.readyState !== 1 || !input) return;
    if (input.split) this._pending.split = true;
    if (input.eject) this._pending.eject = true;
    if (input.skill) this._pending.skill = input.skill;
    this._aim.tx = input.tx; this._aim.ty = input.ty;

    const now = (performance && performance.now) ? performance.now() : 0;
    if (now - this._lastSend < 33) return;        // cap input sends at ~30 Hz
    this._lastSend = now;
    this.ws.send(JSON.stringify({
      t: 'input', tx: this._aim.tx, ty: this._aim.ty,
      split: this._pending.split, eject: this._pending.eject, skill: this._pending.skill,
    }));
    this._pending = { split: false, eject: false, skill: null };
  };

  NetTransport.prototype.getSnapshot = function () { return this.latest || EMPTY; };
  NetTransport.prototype.isMeAlive = function () { return !!(this.alive && this.latest && this.latest.me); };
  NetTransport.prototype.respawnMe = function (name, color) {
    this.alive = true;
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'respawn', name, color: { h: color.h } }));
  };
  NetTransport.prototype.setAdmin = function (on) {
    this._adminWant = on;
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'admin', on }));
  };
  NetTransport.prototype.close = function () { try { this.ws.close(); } catch (e) { /* */ } };

  G.NetTransport = NetTransport;
})(window.G);
