# CellRush 交接日志 / Handoff

> 给接手者(Codex 或其他)。这是一个 agar.io 风格的**在线多人**网页游戏。本文档说明:它是什么、架构、怎么开发部署、**当前未解决的问题**、以及**用户提出但还没做的需求**。

最后更新:2026-06-27。作者:Claude(上一任)。

---

## 1. 这是什么

- 浏览器多人 .io 游戏(吞噬/变大,类 agar.io)。
- **客户端**:纯 vanilla JS + Canvas 2D,无框架、无构建步骤(classic `<script>` 标签,全局命名空间 `window.G`)。
- **服务端**:Node.js 权威服务器,WebSocket(`ws`),**同一个端口同时托管静态客户端 + WS**。
- 目前是**纯在线**(单机模式已按用户要求移除)。

## 2. 仓库与线上环境

- **GitHub**:https://github.com/2578004027-lgtm/cellrush
- **线上服务器**:阿里云轻量,IP `39.96.9.193`,系统 Alibaba Cloud Linux 4(RPM/dnf 系),用户 `admin`,Node v22,pm2 进程名 `cellrush`,端口 **8137**。
- **访问**:http://39.96.9.193:8137 (http + ws,免证书免备案)
- **部署/更新流程**(改完代码后):
  ```bash
  # 本地
  git push
  # 服务器 (ssh admin@39.96.9.193)
  cd ~/cellrush && git pull && pm2 restart cellrush
  # 浏览器 Ctrl+Shift+R 硬刷新拿新客户端
  ```

## 3. 架构(关键:第一天就按在线设计,world 可直接跑在服务器)

| 文件 | 作用 |
|---|---|
| `js/world.js` | **权威纯模拟**(无 DOM)。实体:players(每人多个 cell)、food、viruses、ejected。方法 `step(dt)`、`applyInput(id,input)`、`buildSnapshot(playerId,view)`、技能、admin、事件队列 `events`。**服务器和客户端共用此文件。** |
| `js/config.js` | 所有常量 `G.CFG` + `G.settings`(运行时开关)+ `G.NET`(服务器地址,空=同源)。 |
| `js/util.js` | 数学、RNG、`SpatialHash`(均匀网格碰撞)。 |
| `js/bots.js` | 机器人 AI(服务器端跑),产出和真人**一样的 input 格式**。 |
| `js/transport-net.js` | 客户端 `NetTransport`:连 WS、发 input、收 snapshot。`update/getSnapshot/isMeAlive/respawnMe/setAdmin`。 |
| `js/render.js` | Canvas 渲染:相机、平滑插值、HUD、排行榜、小地图、技能栏、特效。 |
| `js/input.js` | 鼠标/键盘 → `{tx,ty,split,eject,skill,adminGrow,adminShrink}`。 |
| `js/audio.js` | WebAudio 音效。 |
| `js/ui.js` | 菜单(开始/死亡/设置)。 |
| `js/main.js` | 启动 + 渲染循环,**唯一引用具体 transport 的地方**(这里换 NetTransport)。 |
| `server/server.js` | Node http(静态)+ ws(WebSocket)同端口。用 `eval` + `global.window=global` 加载 world/bots/config/util。30Hz 跑模拟,20Hz 广播快照。 |
| `package.json` | 唯一依赖 `ws`;`npm start` = `node server/server.js`。 |

**协议**:
- client→server:`{t:'join',name,color:{h}}`、`{t:'input',tx,ty,split,eject,skill}`、`{t:'respawn',name,color}`、`{t:'admin',on}`
- server→client:`{t:'welcome',id,world}`、`{t:'snap',snap}`、`{t:'dead',maxMass,survived}`
- snapshot 形状:`{cells[],food[],viruses[],ejected[],leaderboard[],players[],events[],me,world}`;`me={x,y,mass,maxMass,cells,admin,skills[]}`。

## 4. 已完成且能用

- 核心:鼠标移动、吃食物/吃小球、长大、越大越慢、世界边界、相机随体型缩放。
- 机器人 24 个(逃/猎/觅食)、排行榜、死亡/重生。
- 分裂(空格)、吐质量(W)、多 cell 内聚 + 合并(**合并时间随分身数量增长**)。
- 病毒:大球撞上炸成多块、吃喷射物长大、喂满射出新病毒、**z 序已修(大球能盖住病毒)**。
- 技能(**当前是 4 个**:Q 冲刺 / E 护盾 / R 磁吸 / F 合体),带冷却 + 底部技能栏。
- 设置菜单(ESC 或左上齿轮,会暂停):音效/显示名字/小地图/管理员/返回主菜单。
- 特效:分裂/合并/炸裂的环形动画;合并倒计时弧 + 秒数。
- 在线:权威服务器 + 服务器端机器人、按玩家视野裁剪快照、客户端插值平滑。

## 5. ⚠️ 当前未解决的问题:性能 / 卡顿

用户反复反馈"**很卡很卡**",且"**预测了更卡了**"。诊断进展:

- 服务器响应很快(用户机器 curl 到 39.96.9.193:8137 仅 **55ms**),新代码已部署 → **不是服务器/网络延迟问题,大概率是客户端帧率(渲染)或网络抖动**。
- 用户机器后台跑着 **Wallpaper Engine(动态壁纸,极吃 GPU/CPU)、QQ、微信、Clash**;可能同时开了多个游戏标签页(每个都满负荷渲染)。
- **已尝试**:客户端预测(**反而更卡,已回退**)、广播 30Hz(已回退到 20Hz)、`dpr` 降到 1(降低填充率)。
- **本次新增**:画布上画了 **实时 FPS 数字**(左上,<45 变红)用来定位——**需要用户报这个数字**。
- 交接前还**杀掉了一个遗留在用户本机的 node 测试服务器**(跑着 24 机器人的模拟一直吃 CPU,可能是卡的元凶之一)。

**下一步该怎么做(重要)**:
1. **先拿到 FPS 数字**,别再盲调。
2. 若 **FPS 低(<40)** → 渲染/机器瓶颈:让用户关掉 Wallpaper Engine 和多余标签页;进一步减少 overdraw;确认 `dpr=1`。
3. 若 **FPS 有 60 但世界一顿一顿** → 网络抖动:实现**正确的快照插值缓冲**(渲染落后真实时间约 100ms,按时间戳在最近两帧之间按实体 id 做线性插值)。当前的"向最新帧缓动"(`render.js` 的 `_smooth`)**不能吸收抖动**,这才是正解的网络做法。注意 food 当前快照里**没有 id**(静态可直接取最新),cells/viruses/ejected 有 id 可插值。

## 6. 用户提出但**还没做**的需求(下一个大波)

> 用户原话整理。这些大多要重做菜单/技能 UI,建议一起做。用户说要**抄 cwal.io 的 UI 和效果**(会提供截图,**记得先要截图**)。

1. **登录系统**;**管理员模式只给店主本人**——做法:登录时填一个密钥,发给服务器校验(服务器用环境变量存密钥),匹配才给 admin;**移除设置里那个随便开的 admin 开关**。
2. **技能登录时只选一个**(不是全有)。要的三个技能:
   - **加速**(=现有 dash)
   - **吐绿刺**(朝鼠标方向喷出一个病毒,消耗自身一点质量)
   - **吐毒**(喷毒;敌人吃到后中毒数秒:**不能分裂 + 持续变小 + 洒出很多孢子**(可被别人吃的小球);具体数值/CD 自定)
3. **两个球接触/包裹时的接触动画**(目前没有)。
4. **地图九宫格标记 1-9 + 更大的小地图**。
5. **抄 cwal.io 的 UI 界面和效果**(等用户截图)。
6. 各种细节打磨。

## 7. 开发/测试与坑

- 本地跑:`node server/server.js` → http://localhost:8137,多开标签页 = 多人。
- 头部无浏览器测试:`node test_net.js`(连本地 8137,验证 join→welcome→snapshot,**可用**)。
- ⚠️ `test_sim.js` **已坏**(引用了被删除的 `LocalTransport`),要么改成直接用 `World`+`buildSnapshot`,要么删掉。
- **坑1**:Windows + Clash 代理会拦截 localhost 的 curl/node,用 `--noproxy '*'` / `NO_PROXY` 绕过;浏览器访问 localhost 没问题。
- **坑2**:端口 8080 被本机一个 Autodesk「ApplicationWebServer」占了(IPv4),所以改用 **8137**。
- **坑3**:`server/server.js` 用 `eval` + `global.window=global` 加载共享 js,句柄命名为 **`api`(不能叫 `G`)**——因为 `config.js` 用了裸全局 `G`,叫 `G` 会 TDZ 崩溃。
- **待清理**:`test_sim.js`(已坏);发布包应去掉 `test_*.js`;**M6 的 README(部署步骤)一直没写**,步骤见本文档第 2 节。

## 8. 主要可调参数(`js/config.js`)

- `worldSize 6000`,`foodCount 1200`,`botCount 24`,`startMass 20`,`maxCells 16`。
- 速度 = `speedBase(1300) * mass^-0.44`,夹在 `[60,660]`。
- `eatRatio 1.25`(吃别人要比对方大 1.25 倍);`splitMin 35`。
- 合并时间 = `mergeBase(6) + cell数 * mergePerCell(2)` 秒。
- 技能 `dash/shield/magnet/merge` 各有 `cd/dur`。

---

**一句话现状**:游戏在线能玩(http://39.96.9.193:8137),核心机制齐全;**卡顿是当前头号待解问题(先看左上 FPS 数字定位)**;一批 UI/技能大改(登录、单选技能、吐绿刺/吐毒、九宫格地图、抄 cwal.io)待做。祝接手顺利。
