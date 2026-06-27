// CellRush — bot AI. Emits the exact same input object a human produces,
// so bots are portable to a future server with zero changes.
(function (G) {
  const CFG = G.CFG, U = G.util;
  const NAMES = ['小李', '阿强', '喵喵', '吞噬者', '大胃王', '圆滚滚', 'momo', '闪电', '黑洞', '贪吃蛇',
    '球王', '史莱姆', '泡泡', '饕餮', '无敌', '菜鸟', '收割机', '滚雪球', '胖虎', 'noob',
    'pro', '吃豆人', '蓝胖子', '德玛', '老六'];
  let ni = 0;

  G.Bots = {
    name() { return NAMES[(ni++) % NAMES.length] + (Math.random() < 0.35 ? '' + U.randInt(1, 99) : ''); },

    think(world, bot) {
      const c = bot.cells[0];
      if (!c) return { tx: 0, ty: 0, split: false, eject: false };
      const myMass = c.mass;
      let threat = null, td = 1e9, prey = null, pd = 1e9;

      for (const p of world.players.values()) {
        if (p.id === bot.id || !p.alive) continue;
        for (const oc of p.cells) {
          const d = U.dist(c.x, c.y, oc.x, oc.y);
          if (d > 760) continue;
          if (oc.mass >= myMass * CFG.eatRatio) { if (d < td) { td = d; threat = oc; } }
          else if (myMass >= oc.mass * CFG.eatRatio) { if (d < pd) { pd = d; prey = oc; } }
        }
      }

      let tx = c.x, ty = c.y, split = false;

      if (threat && td < G.radius(threat.mass) + G.radius(c.mass) + 170) {
        // flee directly away from the threat
        const ang = Math.atan2(c.y - threat.y, c.x - threat.x);
        tx = c.x + Math.cos(ang) * 450; ty = c.y + Math.sin(ang) * 450;
      } else if (prey) {
        tx = prey.x; ty = prey.y;
        if (pd < G.radius(c.mass) && myMass > prey.mass * 2.2 && myMass > CFG.splitMin * 2 && Math.random() < 0.03) split = true;
      } else {
        // seek nearest food; fall back to a roaming waypoint
        let best = null, bd = 1e9;
        for (const f of world.food) {
          const d = U.dist2(c.x, c.y, f.x, f.y);
          if (d < bd) { bd = d; best = f; }
        }
        const ai = bot.ai;
        if (!ai.wp || U.dist(c.x, c.y, ai.wp.x, ai.wp.y) < 80 || Math.random() < 0.008) {
          ai.wp = { x: U.rand(world.size), y: U.rand(world.size) };
        }
        if (best && bd < 560 * 560) { tx = best.x; ty = best.y; }
        else { tx = ai.wp.x; ty = ai.wp.y; }
      }

      // big bots steer around viruses so they don't pop
      if (myMass > CFG.virusMass * 1.15) {
        for (const v of world.viruses) {
          if (U.dist(c.x, c.y, v.x, v.y) < G.radius(c.mass) + G.radius(v.mass) + 30) {
            const ang = Math.atan2(c.y - v.y, c.x - v.x);
            tx = c.x + Math.cos(ang) * 300; ty = c.y + Math.sin(ang) * 300;
          }
        }
      }

      return { tx, ty, split, eject: false };
    },
  };
})(window.G);
