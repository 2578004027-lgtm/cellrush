// CellRush — all tunable constants live here.
window.G = window.G || {};
G.CFG = {
  worldSize: 6000,            // square world: 0..worldSize on both axes

  // food
  foodCount: 1200,
  foodMass: 1,

  // players / cells
  startMass: 20,
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

  // split (Space)
  splitMin: 35,
  splitImpulse: 820,         // launch speed of the new piece (world u/s)
  mergeBase: 6,              // base seconds before split pieces may re-merge
  mergePerCell: 2.0,         // + (cell count) * this  -> more splits = longer to recombine
  mergePerMass: 0.0,         // (kept for reference; merge time is now driven by split count)

  // eject (W)
  ejectMin: 35,
  ejectMass: 13,
  ejectLoss: 18,
  ejectSpeed: 1000,
  ejectTTL: 9,               // seconds an ejected pellet lives

  // passive mass decay (big cells slowly shrink)
  decayRate: 0.0016,         // fraction of mass lost per second
  decayMin: 200,             // only cells above this decay

  // viruses
  virusMass: 130,
  virusCount: 18,
  virusFeedShoot: 7,         // ejected hits to make a virus shoot a new one
  virusShootSpeed: 880,

  // cohesion / friction
  cohesion: 0.65,            // how strongly a player's cells drift back together
  frictionPerSec: 5,         // damping of split/eject momentum

  gridCell: 140,             // spatial-hash cell size

  // camera
  view: { base: 360, margin: 1.45, zoomExp: 0.10, min: 0.22, max: 1.8 },

  // color palette offered in the menu (HSL hues)
  hues: [145, 205, 260, 320, 0, 30, 55, 95, 175, 235, 290, 340],

  // active skills (key -> effect). cd/dur in seconds.
  skills: {
    dash:   { key: 'Q', name: '冲刺', cd: 8,  dur: 0.35, mult: 3.4, color: '#ffd166' },
    shield: { key: 'E', name: '护盾', cd: 22, dur: 4.0,            color: '#6cf0ff' },
    magnet: { key: 'R', name: '磁吸', cd: 16, dur: 5.0, range: 430, speed: 760, color: '#b98cff' },
    merge:  { key: 'F', name: '合体', cd: 18, dur: 1.6, cohesion: 9, color: '#7CFFB0' },
  },
  skillOrder: ['dash', 'shield', 'magnet', 'merge'],

  // admin / god mode
  admin: { speedMult: 1.6, growStep: 60 },
};

// runtime, user-toggleable settings (changed in the in-game settings menu)
G.settings = { sound: true, names: true, minimap: true, admin: false };

// WebSocket server. url '' = auto (same origin the page is served from).
// For a separately-hosted server, set e.g. 'wss://your-host.onrender.com'.
G.NET = { url: '' };

