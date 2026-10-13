export type ResKey = 'wood' | 'stone' | 'food';
export type Cost = Partial<Record<ResKey, number>>;
export type Role = 'free' | 'farmer' | 'lumber' | 'miner' | 'builder';

export interface UnitDef {
  id: string;
  name: string;
  /** asset key in manifest.units (falls back to procedural art) */
  sprite: string;
  hp: number;
  damage: number;
  /** seconds between attacks */
  attackCooldown: number;
  /** attack reach in tiles (melee ~1) */
  range: number;
  /** tiles per second */
  speed: number;
  /** auto-acquire radius in tiles */
  aggro: number;
  /** collision radius in tiles */
  radius: number;
  /** world render scale of the 2x atlas */
  scale: number;
  projectile?: 'arrow' | 'orb' | null;
  splash?: number;
  /** food per minute */
  upkeep: number;
  /** xp given to a nearby hero when killed */
  xp: number;
  /** evil production cost */
  points?: number;
  tags: string[];
  /** fraction of the attack animation at which the hit lands */
  hitFrame?: number;
  light?: { color: number; radius: number; intensity: number };
  sound?: { attack?: string; hit?: string; death?: string };
}

export interface AbilityDef {
  id: string;
  name: string;
  description: string;
  cooldown: number;
  /** effect id implemented in sim/abilities.ts (mods can add new ones) */
  effect: string;
  radius: number;
  damage: number;
  range?: number;
}

export interface HeroDef extends UnitDef {
  title: string;
  description: string;
  portrait: string;
  levelHp: number;
  levelDamage: number;
  /** cumulative xp needed for levels 2..N */
  xpLevels: number[];
  gatherTime: number;
  ability: string;
}

export interface BuildingDef {
  id: string;
  name: string;
  description: string;
  sprite: string;
  /** sprite per town-hall level (index = level-1) */
  levelSprites?: string[];
  /** footprint in tiles */
  size: [number, number];
  cost: Cost;
  buildTime: number;
  hp: number;
  housing: number;
  /** population cap granted by town hall levels */
  popCap?: number[];
  produces?: { res: ResKey; perMin: number; role: Role; workers: number };
  attack?: { damage: number; cooldown: number; range: number; projectile: 'arrow' | 'orb' };
  requires?: { townhallLevel?: number; building?: string };
  upgrade?: { cost: Cost; time: number; requiresBuilt?: boolean };
  /** render scale of the 2x sprite */
  scale: number;
  icon: string;
  hotkey: string;
  order: number;
  evil?: boolean;
  buildable?: boolean;
  /** light anchors relative to sprite bottom-center in sprite px (merged with auto-detected ones) */
  lights?: { x: number; y: number; color: number; radius: number }[];
}

export interface PropDef {
  id: string;
  sprites: string[];
  res?: ResKey;
  amount?: number;
  regen?: number;
  blocks: boolean;
  scale: number;
  sway?: number;
}

export interface WaveRow {
  budget: number;
}

export interface BalanceDef {
  tileSize: number;
  tickRate: number;
  start: { wood: number; stone: number; food: number };
  recruitCost: number;
  upkeepPerMin: number;
  hungerPenalty: number;
  maxPopulation: number;
  cancelRefund: number;
  healRate: number;
  healRadius: number;
  heroRespawn: number;
  heroXpBuilding: number;
  noTownhallProtection: number;
  camp: { max: number; regenSeconds: number };
  gather: { berriesPerMin: number; stonePerMin: number; lumberPerMin: number; heroPerTrip: number };
  militia: { cost: Cost; hp: number; damage: number };
  soldier: { cost: Cost; trainTime: number };
  evil: {
    pointSeconds: number;
    maxPoints: number;
    garrisonCap: number[];
    levelMinutes: number[];
    graveyardRestore: number;
    graceMinutes: number;
    warningSeconds: number;
    budgets: number[];
    calmFactor: number;
    sameFactionGap: number;
    afterWaveGap: number;
    globalGap: number;
    maxActive: number;
    marchTime: number;
    coreHp: number;
    graveyardHp: number;
    dissolveSeconds: number;
  };
  bot: {
    easy: { think: number; maxSoldiers: number; attackAfterMin: number };
    normal: { think: number; maxSoldiers: number; attackAfterMin: number };
  };
  dayLength: number;
}
