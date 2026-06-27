// CellRush — math helpers, RNG, colors, and a uniform-grid spatial hash.
(function (G) {
  const util = {};
  util.TAU = Math.PI * 2;
  util.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  util.lerp = (a, b, t) => a + (b - a) * t;
  util.dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
  util.dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  util.rand = (a, b) => { if (b === undefined) { b = a; a = 0; } return a + Math.random() * (b - a); };
  util.randInt = (a, b) => Math.floor(util.rand(a, b + 1));
  util.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  let _id = 1;
  util.uid = () => _id++;

  // build a color object from an HSL hue
  util.colorFromHue = (h) => ({ h, css: `hsl(${h},70%,56%)`, dark: `hsl(${h},65%,40%)` });
  util.randColor = () => util.colorFromHue(util.randInt(0, 359));

  // Uniform-grid spatial hash. Reused per tick: clear() -> insert() many -> query().
  class SpatialHash {
    constructor(cell) { this.cell = cell; this.map = new Map(); }
    _key(cx, cy) { return cx + ',' + cy; }
    clear() { this.map.clear(); }
    insert(item) {
      const cx = Math.floor(item.x / this.cell), cy = Math.floor(item.y / this.cell);
      const k = this._key(cx, cy);
      let b = this.map.get(k);
      if (!b) { b = []; this.map.set(k, b); }
      b.push(item);
    }
    // call fn(item) for every item in cells overlapping the (x,y,r) circle's bbox
    query(x, y, r, fn) {
      const c = this.cell;
      const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
      const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
      for (let cx = x0; cx <= x1; cx++)
        for (let cy = y0; cy <= y1; cy++) {
          const b = this.map.get(this._key(cx, cy));
          if (b) for (let i = 0; i < b.length; i++) fn(b[i]);
        }
    }
  }
  util.SpatialHash = SpatialHash;

  G.util = util;
})(window.G);
