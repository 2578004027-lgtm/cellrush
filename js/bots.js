// CellRush - bot AI. Emits the exact same input object a human produces,
// so bots are portable to a future server with zero changes.
(function (G) {
  const CFG = G.CFG, U = G.util;
  const NAMES = ['bot', 'nova', 'momo', 'zero', 'spark', 'orbit', 'pixel', 'dash', 'slime', 'blob',
    'noob', 'pro', 'alpha', 'beta', 'ghost', 'wave', 'storm', 'snow', 'mint', 'blue',
    'red', 'lime', 'king', 'round', 'cell'];
  let ni = 0;

  function cellCenter(bot) {
    let x = 0, y = 0, m = 0;
    for (const c of bot.cells) { x += c.x * c.mass; y += c.y * c.mass; m += c.mass; }
    if (!m) return bot.cells[0] || { x: 0, y: 0, mass: 1 };
    return { x: x / m, y: y / m, mass: m };
  }

  function byId(arr, id) {
    if (!id) return null;
    for (const o of arr) if (o.id === id) return o;
    return null;
  }

  function farAim(from, to, distance) {
    const dx = to.x - from.x, dy = to.y - from.y;
    const d = Math.hypot(dx, dy) || 1;
    return { x: from.x + dx / d * distance, y: from.y + dy / d * distance };
  }

  function nearestFood(world, c) {
    let best = null, bd = 1e12;
    for (const f of world.food) {
      const d = U.dist2(c.x, c.y, f.x, f.y);
      if (d < bd) { bd = d; best = f; }
    }
    return best ? { obj: best, d2: bd } : null;
  }

  G.Bots = {
    name() { return NAMES[(ni++) % NAMES.length] + (Math.random() < 0.35 ? U.randInt(1, 99) : ''); },

    think(world, bot) {
      const c = cellCenter(bot);
      if (!bot.cells.length) return { tx: c.x, ty: c.y, split: false, eject: false };
      const ai = bot.ai;
      const now = world.time || 0;
      const myMass = c.mass;
      let threat = null, td = 1e9, prey = null, pd = 1e9;

      for (const p of world.players.values()) {
        if (p.id === bot.id || !p.alive) continue;
        for (const oc of p.cells) {
          const d = U.dist(c.x, c.y, oc.x, oc.y);
          if (d > 720) continue;
          if (oc.mass >= myMass * CFG.eatRatio && d < td) { td = d; threat = oc; }
          else if (myMass >= oc.mass * CFG.eatRatio && d < pd) { pd = d; prey = oc; }
        }
      }

      const danger = threat && td < G.radius(threat.mass) + G.radius(myMass) + 120;
      if (danger) {
        const away = { x: c.x * 2 - threat.x, y: c.y * 2 - threat.y };
        ai.tx = farAim(c, away, 900).x;
        ai.ty = farAim(c, away, 900).y;
        ai.until = now + 0.35;
        ai.foodId = null;
        return { tx: ai.tx, ty: ai.ty, split: false, eject: false };
      }

      if (ai.tx != null && ai.ty != null && now < (ai.until || 0)) {
        return { tx: ai.tx, ty: ai.ty, split: false, eject: false };
      }

      let target = null;
      if (prey && pd < 520) {
        target = prey;
        ai.foodId = null;
        ai.until = now + 0.45;
      } else {
        let food = byId(world.food, ai.foodId);
        if (!food || U.dist(c.x, c.y, food.x, food.y) < 38 || now >= (ai.foodUntil || 0)) {
          const best = nearestFood(world, c);
          food = best && best.d2 < 720 * 720 ? best.obj : null;
          ai.foodId = food ? food.id : null;
          ai.foodUntil = now + 0.9 + Math.random() * 0.4;
        }
        if (food) {
          target = food;
          ai.until = now + 0.35;
        } else {
          if (!ai.wp || U.dist(c.x, c.y, ai.wp.x, ai.wp.y) < 140 || now >= (ai.wpUntil || 0)) {
            ai.wp = { x: U.rand(world.size), y: U.rand(world.size) };
            ai.wpUntil = now + 3.5 + Math.random() * 2.5;
          }
          target = ai.wp;
          ai.until = now + 0.7;
        }
      }

      if (myMass > CFG.virusMass * 1.15) {
        for (const v of world.viruses) {
          if (U.dist(c.x, c.y, v.x, v.y) < G.radius(myMass) + G.radius(v.mass) + 28) {
            target = { x: c.x * 2 - v.x, y: c.y * 2 - v.y };
            ai.until = now + 0.45;
            break;
          }
        }
      }

      const aim = farAim(c, target, 850);
      ai.tx = U.clamp(aim.x, 0, world.size);
      ai.ty = U.clamp(aim.y, 0, world.size);
      return { tx: ai.tx, ty: ai.ty, split: false, eject: false };
    },
  };
})(window.G);