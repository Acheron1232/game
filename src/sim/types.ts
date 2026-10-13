import type { ResKey, Role } from '../content/types';

export const NEUTRAL = -1;
export const EVIL = 99;

export type EntityKind = 'unit' | 'building' | 'resource' | 'prop' | 'projectile';

export type Order =
  | { type: 'idle' }
  | { type: 'move'; x: number; y: number }
  | { type: 'attack'; target: number }
  | { type: 'gather'; target: number }
  | { type: 'build'; target: number }
  | { type: 'interact'; target: number };

export type UnitState = 'idle' | 'move' | 'attack' | 'work' | 'dead';

/** Plain, JSON-serializable entity. Cross-entity references are ids only. */
export interface Entity {
  id: number;
  kind: EntityKind;
  def: string;
  owner: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  dead?: boolean;
  /** visual variant (sprite index for props) */
  variant?: number;

  // ---- units ----
  state?: UnitState;
  facing?: 1 | -1;
  order?: Order;
  path?: number[];
  pathI?: number;
  goalX?: number;
  goalY?: number;
  repathAt?: number;
  targetId?: number;
  attackCd?: number;
  /** world time when the current attack/work swing started (drives animation sync) */
  swingAt?: number;
  /** pending hit time for the current swing */
  hitAt?: number;
  lastHurtAt?: number;
  lastMoveAt?: number;
  stuckSince?: number;
  role?: Role;
  /** building or resource this worker is bound to */
  jobId?: number;
  /** resource currently being worked */
  workId?: number;
  workAcc?: number;
  /** status shown in UI for idle workers */
  status?: string;
  inside?: number; // building id a unit is inside of (training)
  level?: number;
  xp?: number;
  respawnAt?: number;
  abilityReadyAt?: number;
  waveId?: number;
  garrison?: boolean;
  dissolveAt?: number;
  campId?: number;
  homeX?: number;
  homeY?: number;
  wanderAt?: number;

  // ---- buildings ----
  built?: boolean;
  progress?: number;
  level2Progress?: number; // town hall upgrade progress 0..1 while upgrading
  upgrading?: boolean;
  paid?: Partial<Record<ResKey, number>>;
  training?: { villager: number; doneAt: number; startedAt: number } | null;
  trainQueue?: number;
  researching?: { tech: string; doneAt: number } | null;
  tx?: number; // footprint top-left
  ty?: number;
  w?: number;
  h?: number;

  // ---- resources ----
  amount?: number;
  maxAmount?: number;
  res?: ResKey;
  marked?: number[]; // factions that marked this deposit for mining

  // ---- projectiles ----
  src?: number;
  vx?: number;
  vy?: number;
  speed?: number;
  damage?: number;
  splash?: number;
  ptype?: 'arrow' | 'orb';
  fromX?: number;
  fromY?: number;
  toX?: number;
  toY?: number;
  flight?: number;
  born?: number;
}

export interface Faction {
  id: number;
  name: string;
  color: number;
  team: number;
  kind: 'human' | 'bot';
  difficulty: 'easy' | 'normal';
  heroClass: string;
  heroId: number;
  res: Record<ResKey, number>;
  /** fractional accumulators so per-minute rates add up exactly */
  acc: Record<ResKey, number>;
  start: { x: number; y: number };
  jobs: { farmer: number; lumber: number; miner: number; builder: number };
  army: { order: 'defend' | 'attack' | 'return'; target?: number; x?: number; y?: number };
  militia: boolean;
  firstBuilt: Record<string, boolean>;
  waveCount: number;
  lastWaveSentAt: number;
  lastWaveEndedAt: number;
  protectedUntil: number;
  hadTownhall: boolean;
  firstRecruitDone: boolean;
  hungry: boolean;
  stats: { foodIn: number; foodOut: number; woodIn: number; stoneIn: number };
  bot?: BotState;
  ping?: { x: number; y: number; at: number };
  defeatedNotice?: boolean;
}

export interface BotState {
  nextThink: number;
  step: string;
  attackStarted?: boolean;
  lastAction?: string;
}

export interface Wave {
  id: number;
  faction: number;
  units: number[];
  sentAt: number;
  state: 'march' | 'retreat';
  bestDist: number;
  lastProgressAt: number;
}

export interface EvilState {
  coreId: number;
  graveyardId: number;
  graveyardPos: { x: number; y: number };
  points: number;
  level: number;
  graveyardRestoreAt: number;
  destroyed: boolean;
  destroyedAt: number;
  queuePos: number;
  waves: Wave[];
  pending: { faction: number; at: number; budget: number; warnedAt: number } | null;
  lastDispatchAt: number;
  waveSeq: number;
  nextSpawnAt: number;
}

export interface Camp {
  id: number;
  x: number;
  y: number;
  /** faction whose start this camp belongs to (reserved until its first recruitment) */
  reservedFor: number;
  regenAt: number;
}

export interface GameSettings {
  calm: boolean;
  mapId: string;
  seed: number;
}

export interface World {
  version: number;
  time: number;
  tick: number;
  W: number;
  H: number;
  /** terrain type per tile */
  terrain: Uint8Array;
  entities: Map<number, Entity>;
  nextId: number;
  factions: Faction[];
  evil: EvilState;
  camps: Camp[];
  settings: GameSettings;
  rng: { s: number };
  result: null | { type: 'evilDestroyed'; at: number };
  started: boolean;
}

export const enum Terrain {
  Grass = 0,
  Dirt = 1,
  Forest = 2,
  Water = 3,
  Sand = 4,
  Cursed = 5,
}

export type Command =
  | { t: 'heroMove'; f: number; x: number; y: number }
  | { t: 'heroAttack'; f: number; target: number }
  | { t: 'heroGather'; f: number; target: number }
  | { t: 'heroBuild'; f: number; target: number }
  | { t: 'heroInteract'; f: number; target: number }
  | { t: 'heroStop'; f: number }
  | { t: 'heroAbility'; f: number; x: number; y: number }
  | { t: 'place'; f: number; def: string; x: number; y: number }
  | { t: 'cancel'; f: number; id: number }
  | { t: 'demolish'; f: number; id: number }
  | { t: 'upgrade'; f: number; id: number }
  | { t: 'train'; f: number; id: number }
  | { t: 'research'; f: number; id: number; tech: 'militia' }
  | { t: 'jobs'; f: number; role: 'farmer' | 'lumber' | 'miner' | 'builder'; count: number }
  | { t: 'mark'; f: number; id: number; on: boolean }
  | { t: 'army'; f: number; order: 'defend' | 'attack' | 'return'; target?: number; x?: number; y?: number }
  | { t: 'transfer'; f: number; to: number; res: ResKey; amount: number }
  | { t: 'ping'; f: number; x: number; y: number };

export type SimEvents = {
  spawn: { id: number; def: string; x: number; y: number; owner: number };
  death: { id: number; def: string; x: number; y: number; owner: number; kind: EntityKind; killer?: number };
  hit: { id: number; src: number; dmg: number; x: number; y: number };
  swing: { id: number; target: number };
  shoot: { id: number; projectile: number; ptype: string };
  impact: { x: number; y: number; ptype: string; splash: number };
  ability: { id: number; ability: string; x: number; y: number; radius: number };
  built: { id: number; def: string; owner: number };
  placed: { id: number; def: string; owner: number };
  upgraded: { id: number; def: string; level: number };
  levelUp: { id: number; level: number; owner: number };
  recruited: { id: number; owner: number };
  depleted: { id: number; x: number; y: number };
  gathered: { id: number; res: string; amount: number; x: number; y: number; owner: number };
  notice: { f: number | 'all'; text: string; kind?: 'info' | 'warn' | 'error' | 'good' };
  waveWarning: { faction: number; at: number; fromX: number; fromY: number };
  waveSent: { faction: number; wave: number; size: number };
  waveEnded: { faction: number; wave: number };
  evilLevel: { level: number };
  evilDestroyed: {};
  heroDied: { id: number; owner: number; respawnAt: number };
  heroRespawned: { id: number; owner: number };
  trained: { id: number; owner: number };
  research: { owner: number; tech: string };
  ping: { f: number; x: number; y: number };
  transfer: { from: number; to: number; res: string; amount: number };
};
