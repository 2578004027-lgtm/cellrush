// CellRush - all tunable constants live here.
window.G = window.G || {};
G.CFG = {
  worldSize: 6000,            // square world: 0..worldSize on both axes

  // food
  foodCount: 1200,
  foodMass: 1,

  // players / cells
  startMass: 200,
  botStartMass: 50,          // bots stay lighter so one human room does not become CPU-heavy
  botCount: 24,
  maxCells: 16,

  // mass <-> size <-> speed
  massToRadius: 6,           // radius = sqrt(mass/PI) * massToRadius
  speedBase: 1300,           // speed = speedBase * mass^speedExp  (world units / sec)
  speedExp: -0.44,
  speedMin: 60,
  speedMax: 660,

  // eating
  eatRatio: 1.25,            // eater.mass must be >= prey.mass * this
  eatOverlap: 0.6,           // prey center must be this-deep inside eater
  splitEatRatio: 1.16,       // split attacks should reliably catch visibly smaller targets
  splitEatOverlap: 0.12,

  // split (Space)
  splitMin: 35,
  splitImpulse: 620,         // minimum launch speed of the new piece (world u/s)
  splitLaunchRadii: 1.15,    // velocity chosen so large pieces glide about this many radii
  splitImpulseMax: 2400,     // cap radius-scaled split speed
  splitStartSeparation: 2.03, // immediate center distance in radii after splitting
  splitBackPush: 0.0,        // how much the old half is pushed backward on split
  mergeBase: 2.0,            // smallest split pieces can re-merge quickly
  mergePerCell: 0.35,        // more pieces add a little delay
  mergePerMass: 0.085,       // larger pieces wait longer
  mergeMin: 1.2,
  mergeMax: 3.0,

  // eject (W)
  ejectMin: 35,
  ejectMass: 13,
  ejectLoss: 18,
  ejectSpeed: 1000,
  ejectTTL: Infinity,        // ejected pellets persist until eaten or used to feed a virus
  ejectMax: 900,             // hard cap for persistent pellets

  // passive mass decay (big cells slowly shrink)
  decayRate: 0.0016,         // fraction of mass lost per second
  decayMin: 200,             // only cells above this decay

  // viruses
  virusMass: 130,
  virusCount: 18,
  virusFeedShoot: 7,         // ejected hits to make a virus shoot a new one
  virusShootSpeed: 880,

  // cohesion / friction
  cohesion: 1.05,            // how strongly merge-ready cells drift back together
  splitCohesion: 0.04,       // keep freshly split cells from being pulled back too early
  frictionPerSec: 5,         // damping of split/eject momentum

  gridCell: 140,             // spatial-hash cell size

  // camera
  view: { base: 360, margin: 1.45, zoomExp: 0.10, min: 0.22, max: 1.8 },

  // color palette offered in the menu (HSL hues)
  hues: [145, 205, 260, 320, 0, 30, 55, 95, 175, 235, 290, 340],


  // bundled local skins used by the menu and bots
  skinPresets: [
    '',
    '/assets/skins/ring.svg',
    '/assets/skins/halo.svg',
    '/assets/skins/circles.svg',
    '/assets/skins/wolf.svg',
    '/assets/skins/dragon.svg',
    '/assets/skins/magatama.svg',
    '/assets/skins/ghost.svg',
    '/assets/skins/bat.svg',
    '/assets/skins/daemon.svg',
    '/assets/skins/star.svg',
  ],
  // active skills (key -> effect). cd/dur in seconds.
  skills: {
    dash:   { key: 'Q', name: '\u51b2\u523a',   cd: 8,  dur: 0.35, mult: 3.4, color: '#ffd166', cost: 0, base: true },
    shield: { key: 'E', name: '\u62a4\u76fe', cd: 22, dur: 4.0,            color: '#6cf0ff', cost: 0, base: true },
    magnet: { key: 'R', name: '\u78c1\u5438', cd: 16, dur: 5.0, range: 430, speed: 760, color: '#b98cff', cost: 0, base: true },
    merge:  { key: 'F', name: '\u5408\u4f53',  cd: 16, dur: 2.2, cohesion: 14, color: '#7CFFB0', cost: 0, base: true },
    revenge: { key: '1', name: '\u53cd\u566c', cd: 24, dur: 4.0,  color: '#ff6b8a', cost: 120, special: true },
    grow:    { key: '2', name: '\u53d8\u5927',    cd: 24, dur: 5.0,  massMult: 1.45, color: '#7CFFB0', cost: 130, special: true },
    thorn:   { key: '3', name: '\u5410\u523a',   cd: 10, dur: 0.0,  speed: 1180, mass: 130, loss: 25, color: '#76ff45', cost: 150, special: true },
    poison:  { key: '4', name: '\u5410\u6bd2',  cd: 14, dur: 0.0,  speed: 1120, mass: 20, poisonDelay: 3.0, poisonShrink: 0.18, color: '#31d46a', cost: 160, special: true },
    silence: { key: '5', name: '\u9759\u9ed8', cd: 20, dur: 0.0,  speed: 1080, mass: 13, silenceDur: 4.5, color: '#8aa0ff', cost: 170, special: true },
  },
  skillOrder: ['dash', 'shield', 'magnet', 'merge'],
  specialSkillOrder: ['revenge', 'grow', 'thorn', 'poison', 'silence'],
  // admin / god mode
  admin: { speedMult: 1.6, growStep: 60 },
};

// runtime, user-toggleable settings (changed in the in-game settings menu)
G.settings = { sound: true, names: true, minimap: true, admin: false, visualSkins: false, visualStatus: false, visualFx: false, visualAllNames: false, visualSqueeze: true };

// WebSocket server. url '' = auto (same origin the page is served from).
// For a separately-hosted server, set e.g. 'wss://your-host.onrender.com'.
G.NET = { url: '' };
