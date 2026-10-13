/**
 * Hand-authored map presets. A preset is deterministic data + a seeded decoration pass,
 * so every session on the same preset is identical (one "verified" map, as the design asks).
 */
import { content } from '../engine/registry';
import { fbm, hash2 } from '../engine/rng';
import { Nav } from './nav';
import { Sim, newFaction } from './sim';
import { EVIL, NEUTRAL, Terrain, type Camp, type Faction, type World } from './types';

export interface StartZone {
  x: number;
  y: number;
  name: string;
}

export interface MapPreset {
  id: string;
  name: string;
  description: string;
  W: number;
  H: number;
  seed: number;
  starts: StartZone[];
  evil: { core: [number, number]; graveyard: [number, number] };
  build(world: World, sim: Sim): void;
}

export const maps: Record<string, MapPreset> = {};

// ---------------------------------------------------------------- "Попелиста долина"
const ASH_VALLEY: MapPreset = {
  id: 'ash_valley',
  name: 'Попелиста долина',
  description: 'Чотири стартові долини навколо озера. На сході — проклята земля Темного осердя.',
  W: 128,
  H: 96,
  seed: 1337,
  starts: [
    { x: 20, y: 22, name: 'Північно-західний гай' },
    { x: 20, y: 74, name: 'Південно-західні луки' },
    { x: 62, y: 15, name: 'Північний перевал' },
    { x: 62, y: 81, name: 'Південний брід' },
  ],
  evil: { core: [111, 45], graveyard: [103, 50] },
  build(world, sim) {
    const { W, H } = world;
    const seed = this.seed;
    const lake = { x: 46, y: 48, rx: 11, ry: 7.5 };
    const evilC = { x: 108, y: 48 };
    const T = world.terrain;
    const set = (x: number, y: number, t: Terrain) => { if (x >= 0 && y >= 0 && x < W && y < H) T[y * W + x] = t; };
    const roads: [number, number][][] = [
      [[20, 22], [34, 30], [48, 34], [66, 36], [82, 42], [100, 48]],
      [[20, 74], [34, 66], [48, 62], [66, 60], [82, 54], [100, 50]],
      [[62, 15], [64, 26], [66, 36]],
      [[62, 81], [64, 70], [66, 60]],
      [[66, 36], [72, 48], [66, 60]],
    ];
    const distToRoad = (x: number, y: number) => {
      let best = Infinity;
      for (const r of roads) for (let i = 0; i < r.length - 1; i++) {
        const [ax, ay] = r[i], [bx, by] = r[i + 1];
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
        best = Math.min(best, Math.hypot(x - (ax + dx * t), y - (ay + dy * t)));
      }
      return best;
    };
    const nearStart = (x: number, y: number, r: number) => this.starts.some((s) => Math.hypot(s.x - x, s.y - y) < r);
    const lakeD = (x: number, y: number) => Math.hypot((x - lake.x) / lake.rx, (y - lake.y) / lake.ry) + (fbm(x * 0.15, y * 0.15, seed + 9) - 0.5) * 0.35;

    // ---- terrain
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let t = Terrain.Grass;
      const n = fbm(x * 0.06, y * 0.06, seed);
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
      if (n > 0.6 || edge < 4 + fbm(x * 0.2, y * 0.2, seed + 3) * 4) t = Terrain.Forest;
      const ld = lakeD(x, y);
      if (ld < 1) t = Terrain.Water;
      else if (ld < 1.22) t = Terrain.Sand;
      const ed = Math.hypot(x - evilC.x, (y - evilC.y) * 1.1) + (fbm(x * 0.12, y * 0.12, seed + 5) - 0.5) * 8;
      if (ed < 17) t = Terrain.Cursed;
      if (t !== Terrain.Water && distToRoad(x, y) < 1.3 + fbm(x * 0.3, y * 0.3, seed + 7) * 0.8) t = Terrain.Dirt;
      if (nearStart(x, y, 7) && t === Terrain.Forest) t = Terrain.Grass;
      set(x, y, t);
    }
    // small pond near the south-west start for variety
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = Math.hypot((x - 34) / 3.5, (y - 86) / 2.5);
      if (d < 1) set(x, y, Terrain.Water); else if (d < 1.4 && T[y * W + x] !== Terrain.Water) set(x, y, Terrain.Sand);
    }
    for (let i = 0; i < W * H; i++) sim.nav.setBase(i, T[i] === Terrain.Water ? 255 : T[i] === Terrain.Forest ? 6 : 0);

    const free = (x: number, y: number) => sim.nav.walkable(x, y) && T[(y | 0) * W + (x | 0)] !== Terrain.Water;
    const place = (def: string, x: number, y: number, variant?: number) => {
      if (!free(x, y)) return null;
      return sim.spawnResource(def, Math.floor(x) + 0.5, Math.floor(y) + 0.5, variant);
    };

    // ---- evil base
    const [cx, cy] = this.evil.core;
    const core = sim.spawnBuilding('dark_core', EVIL, cx, cy, true);
    const [gx, gy] = this.evil.graveyard;
    const yard = sim.spawnBuilding('graveyard', EVIL, gx, gy, true);
    world.evil.coreId = core.id;
    world.evil.graveyardId = yard.id;
    world.evil.graveyardPos = { x: yard.x, y: yard.y };

    // ---- start areas: berries, stone, groves, traveler camps
    this.starts.forEach((s, i) => {
      const away = Math.atan2(s.y - 48, s.x - 64);
      // grove behind the start
      for (let k = 0; k < 26; k++) {
        const a = away + (hash2(i, k, seed) - 0.5) * 2.2, r = 8 + hash2(k, i, seed + 1) * 5;
        place(hash2(k, i, 4) < 0.35 ? 'pine' : 'tree', s.x + Math.cos(a) * r, s.y + Math.sin(a) * r * 0.85);
      }
      // berries close by
      for (let k = 0; k < 4; k++) {
        const a = away + Math.PI * 0.5 + k * 0.45, r = 4.5 + (k % 2);
        place('berry', s.x + Math.cos(a) * r, s.y + Math.sin(a) * r);
      }
      // stone deposits
      for (let k = 0; k < 3; k++) {
        const a = away - Math.PI * 0.55 - k * 0.32, r = 8 + k * 0.7;
        place('rock', s.x + Math.cos(a) * r, s.y + Math.sin(a) * r);
      }
      // traveler camp
      const ca = away + Math.PI * 0.95;
      const camp: Camp = { id: i, x: s.x + Math.cos(ca) * 6.5, y: s.y + Math.sin(ca) * 5.5, reservedFor: -1, regenAt: 0 };
      world.camps.push(camp);
      place('tent', camp.x - 1, camp.y - 1);
      place('campfire', camp.x + 1, camp.y);
      for (let k = 0; k < 3; k++) sim.spawnUnit('traveler', NEUTRAL, camp.x - 1 + k, camp.y + 1.5, { campId: camp.id, homeX: camp.x, homeY: camp.y + 1 });
      place('deco', s.x + 3.5, s.y - 3.5);
    });

    // ---- forests
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      if (T[y * W + x] !== Terrain.Forest || nearStart(x, y, 9)) continue;
      const h = hash2(x, y, seed + 11);
      if (h < 0.42) place(fbm(x * 0.1, y * 0.1, seed + 2) > 0.55 ? 'pine' : 'tree', x + 0.5, y + 0.5);
    }
    // scattered trees on meadows
    for (let k = 0; k < 140; k++) {
      const x = 6 + hash2(k, 1, seed) * (W - 12), y = 6 + hash2(k, 2, seed) * (H - 12);
      if (T[(y | 0) * W + (x | 0)] !== Terrain.Grass || nearStart(x, y, 9) || distToRoad(x, y) < 2.5) continue;
      place('tree', x, y);
    }
    // contested stone + berries in the middle
    for (const [x, y] of [[66, 46], [68, 50], [80, 30], [81, 66], [40, 42], [42, 56], [92, 26], [92, 70]]) place('rock', x, y);
    for (const [x, y] of [[58, 30], [60, 66], [74, 24], [75, 72], [30, 48], [86, 48]]) place('berry', x, y);

    // ---- ruins and rune stones (lights, atmosphere)
    for (const [x, y, d] of [
      [70, 44, 'runestone'], [56, 40, 'ruin'], [57, 57, 'ruin'], [78, 48, 'ruin'], [38, 36, 'runestone'], [38, 61, 'runestone'],
      [86, 36, 'ruin'], [86, 61, 'ruin'], [52, 24, 'ruin'], [50, 72, 'ruin'], [94, 48, 'runestone'], [28, 48, 'ruin'],
    ] as [number, number, string][]) place(d, x, y);
    for (const [x, y] of [[66, 36], [66, 60], [72, 48], [82, 42], [82, 54]]) place('torch', x + 1.5, y - 1);

    // ---- cursed land decoration
    for (let k = 0; k < 90; k++) {
      const a = hash2(k, 7, seed) * Math.PI * 2, r = 5 + hash2(k, 8, seed) * 12;
      const x = evilC.x + Math.cos(a) * r, y = evilC.y + Math.sin(a) * r;
      if (T[(y | 0) * W + (x | 0)] !== Terrain.Cursed) continue;
      if (Math.hypot(x - (gx + 2), y - (gy + 4)) < 4.5) continue; // keep the spawn yard open
      if (Math.abs(y - 49) < 2.5 && x < evilC.x) continue; // keep the western approach open
      place(hash2(k, 9, seed) < 0.45 ? 'deadtree' : 'tomb', x, y);
    }
    for (const [x, y] of [[100, 44], [100, 54], [106, 41], [106, 58]]) place('brazier', x, y);

    // ---- grass tufts / flowers
    for (let k = 0; k < 420; k++) {
      const x = 2 + hash2(k, 21, seed) * (W - 4), y = 2 + hash2(k, 22, seed) * (H - 4);
      const t = T[(y | 0) * W + (x | 0)];
      if (t !== Terrain.Grass || !free(x, y)) continue;
      sim.spawnResource('grass', x, y);
    }
  },
};
maps[ASH_VALLEY.id] = ASH_VALLEY;

// ---------------------------------------------------------------- world construction

export interface PlayerSetup {
  name: string;
  color: number;
  team: number;
  kind: 'human' | 'bot';
  difficulty: 'easy' | 'normal';
  heroClass: string;
  start: number;
}

export interface GameSetup {
  mapId: string;
  calm: boolean;
  players: PlayerSetup[];
}

export function emptyWorld(W: number, H: number, setup: { mapId: string; calm: boolean; seed: number }): World {
  return {
    version: 1, time: 0, tick: 0, W, H, terrain: new Uint8Array(W * H), entities: new Map(), nextId: 1, factions: [],
    evil: {
      coreId: -1, graveyardId: -1, graveyardPos: { x: 0, y: 0 }, points: 0, level: 1, graveyardRestoreAt: 0, destroyed: false, destroyedAt: 0,
      queuePos: 0, waves: [], pending: null, lastDispatchAt: -1e9, waveSeq: 0, nextSpawnAt: 0,
    },
    camps: [], settings: { calm: setup.calm, mapId: setup.mapId, seed: setup.seed }, rng: { s: setup.seed }, result: null, started: false,
  };
}

export function createGame(setup: GameSetup, wasm: ConstructorParameters<typeof Nav>[2]): Sim {
  const preset = maps[setup.mapId] ?? Object.values(maps)[0];
  const world = emptyWorld(preset.W, preset.H, { mapId: preset.id, calm: setup.calm, seed: preset.seed });
  const nav = new Nav(preset.W, preset.H, wasm);
  const sim = new Sim(world, nav);
  preset.build(world, sim);
  setup.players.forEach((p, i) => {
    const s = preset.starts[p.start] ?? preset.starts[i];
    const f: Faction = newFaction({ id: i, name: p.name, color: p.color, team: p.team, kind: p.kind, difficulty: p.difficulty, heroClass: p.heroClass, start: { x: s.x, y: s.y } });
    world.factions.push(f);
    const camp = world.camps.find((c) => c.id === p.start);
    if (camp) camp.reservedFor = f.id;
    const hero = sim.spawnUnit(p.heroClass, f.id, s.x, s.y + 1);
    f.heroId = hero.id;
  });
  // unused camps belong to nobody
  for (const c of world.camps) if (c.reservedFor === -1) c.reservedFor = 9999;
  return sim;
}

export const factionColors = [0x3d7bff, 0xe8423f, 0x34c06b, 0xf2b630, 0xa05cff, 0x1fc8d6];
export const factionColorNames = ['Синій', 'Червоний', 'Зелений', 'Жовтий', 'Фіолетовий', 'Бірюзовий'];

export function propDef(id: string) {
  return content.props[id];
}
