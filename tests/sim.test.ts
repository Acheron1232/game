import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import '../src/content/index';
import '../src/sim/commands';
import { content } from '../src/engine/registry';
import { createGame, maps, type GameSetup } from '../src/sim/map';
import { Nav } from '../src/sim/nav';
import { deserialize, serialize } from '../src/sim/save';
import type { Sim } from '../src/sim/sim';
import { installSystems } from '../src/sim/systems';
import { recruit } from '../src/sim/systems/behavior';
import { waveBudget, waveComposition } from '../src/sim/systems/evil';
import { EVIL } from '../src/sim/types';

const wasmBytes = readFileSync(new URL('../public/wasm/nav.wasm', import.meta.url));

async function game(setup: Partial<GameSetup> = {}) {
  const wasm = await Nav.loadWasm(wasmBytes);
  const sim = createGame(
    {
      mapId: 'ash_valley',
      calm: false,
      players: [
        { name: 'Гравець', color: 0x3d7bff, team: 0, kind: 'human', difficulty: 'normal', heroClass: 'hero_warrior', start: 0 },
        { name: 'Бот', color: 0xe8423f, team: 0, kind: 'bot', difficulty: 'normal', heroClass: 'hero_archer', start: 1 },
      ],
      ...setup,
    },
    wasm,
  );
  installSystems(sim);
  sim.world.started = true;
  return sim;
}

const run = (sim: Sim, seconds: number) => {
  const n = Math.round(seconds * content.balance.tickRate);
  for (let i = 0; i < n; i++) sim.step();
};

describe('navigation', () => {
  it('wasm and ts pathfinding agree on reachability', async () => {
    const sim = await game();
    const ts = new Nav(sim.world.W, sim.world.H, null);
    ts.grid.set(sim.nav.grid);
    for (const s of maps.ash_valley.starts) {
      const a = sim.nav.findPath(s.x, s.y + 2, 103, 55);
      const b = ts.findPath(s.x, s.y + 2, 103, 55);
      expect(a.length).toBeGreaterThan(0);
      expect(b.length).toBeGreaterThan(0);
      // both reach the goal area
      expect(Math.hypot(a.at(-2)! - 103.5, a.at(-1)! - 55.5)).toBeLessThan(2);
      expect(Math.hypot(b.at(-2)! - 103.5, b.at(-1)! - 55.5)).toBeLessThan(2);
    }
    expect(sim.nav.backend).toBe('wasm');
  });
});

describe('economy start', () => {
  it('starts with a hero, 40 wood and 30 food', async () => {
    const sim = await game();
    const f = sim.world.factions[0];
    expect(f.res).toMatchObject({ wood: 40, stone: 0, food: 30 });
    expect(sim.get(f.heroId)?.def).toBe('hero_warrior');
    expect(sim.population(0)).toBe(0);
  });

  it('full housing blocks recruiting; recruiting costs 5 food', async () => {
    const sim = await game();
    const f = sim.world.factions[0];
    const t = [...sim.world.entities.values()].find((e) => e.def === 'traveler' && e.campId === 0)!;
    expect(recruit(sim, f, t)).toBe(false); // no town hall yet → no housing
    sim.send({ t: 'place', f: 0, def: 'townhall', x: f.start.x - 2, y: f.start.y - 5 });
    run(sim, 0.1);
    const th = sim.townhall(0, false)!;
    expect(f.res.wood).toBe(10);
    th.progress = 0.999;
    sim.send({ t: 'heroBuild', f: 0, target: th.id });
    run(sim, 8);
    expect(th.built).toBe(true);
    const food = f.res.food;
    expect(recruit(sim, f, t)).toBe(true);
    expect(f.res.food).toBeCloseTo(food - 5, 5);
  });

  it('cancel refunds 80% rounded down', async () => {
    const sim = await game();
    const f = sim.world.factions[0];
    sim.send({ t: 'place', f: 0, def: 'townhall', x: f.start.x - 2, y: f.start.y - 5 });
    run(sim, 0.1);
    const th = sim.townhall(0, false)!;
    sim.send({ t: 'cancel', f: 0, id: th.id });
    run(sim, 0.1);
    expect(f.res.wood).toBe(10 + 24);
  });

  it('resource transfer between allies never duplicates', async () => {
    const sim = await game({ players: [
      { name: 'A', color: 1, team: 0, kind: 'human', difficulty: 'normal', heroClass: 'hero_warrior', start: 0 },
      { name: 'B', color: 2, team: 0, kind: 'human', difficulty: 'normal', heroClass: 'hero_mage', start: 1 },
    ] });
    const [a, b] = sim.world.factions;
    const total = a.res.wood + b.res.wood;
    sim.send({ t: 'transfer', f: 0, to: 1, res: 'wood', amount: 30 });
    sim.send({ t: 'transfer', f: 0, to: 1, res: 'wood', amount: 30 }); // second exceeds remaining stock
    run(sim, 0.1);
    expect(a.res.wood + b.res.wood).toBe(total);
    expect(a.res.wood).toBe(0);
  });
});

describe('player bot', () => {
  it('goes through the same economic start (town hall, travelers, farm, sawmill)', async () => {
    const sim = await game();
    run(sim, 8 * 60);
    const f = sim.world.factions[1];
    expect(sim.townhall(1)).toBeTruthy();
    expect(sim.population(1)).toBeGreaterThanOrEqual(3);
    expect(sim.countBuildings(1, 'farm', false)).toBeGreaterThanOrEqual(1);
    expect(sim.countBuildings(1, 'sawmill', false)).toBeGreaterThanOrEqual(1);
    console.log('bot after 8 min:', f.bot?.step, f.res, 'pop', sim.population(1), '/', sim.housing(1));
  }, 60000);
});

describe('world evil', () => {
  it('wave budgets follow the table and calm mode', () => {
    expect([0, 1, 2, 3, 4, 7].map((n) => waveBudget(n, false))).toEqual([3, 4, 5, 6, 8, 8]);
    expect(waveBudget(0, true)).toBe(2);
    expect(waveComposition(0, 3, 2)).toEqual({ skeletons: 3, zombies: 0 });
    expect(waveComposition(2, 5, 2)).toEqual({ skeletons: 3, zombies: 1 });
    expect(waveComposition(4, 8, 3)).toEqual({ skeletons: 4, zombies: 2 });
    expect(waveComposition(4, 8, 1)).toEqual({ skeletons: 8, zombies: 0 });
  });

  it('no waves in the first 12 minutes, first wave is 3 skeletons, garrison is capped', async () => {
    const sim = await game({ players: [{ name: 'Бот', color: 0xe8423f, team: 0, kind: 'bot', difficulty: 'normal', heroClass: 'hero_mage', start: 0 }] });
    const sent: number[] = [];
    sim.events.on('waveSent', (e) => sent.push(e.size));
    run(sim, 11.5 * 60);
    expect(sent.length).toBe(0);
    const garrison = sim.units.filter((u) => u.owner === EVIL && u.garrison).reduce((s, u) => s + (sim.uDef(u).points ?? 1), 0);
    expect(garrison).toBeLessThanOrEqual(4);
    let wave: (typeof sim.world.evil.waves)[0] | undefined;
    sim.events.on('waveSent', () => (wave = structuredClone(sim.world.evil.waves.at(-1))));
    run(sim, 1.6 * 60);
    expect(sent).toEqual([3]);
    expect(sim.world.factions[0].waveCount).toBe(1);
    expect(wave!.units.length).toBe(3);
  }, 60000);

  it('destroying the core stops everything and dissolves undead', async () => {
    const sim = await game();
    run(sim, 60);
    const core = sim.get(sim.world.evil.coreId)!;
    sim.kill(core);
    run(sim, 12);
    expect(sim.world.result?.type).toBe('evilDestroyed');
    expect(sim.units.filter((u) => u.owner === EVIL).length).toBe(0);
    run(sim, 60);
    expect(sim.units.filter((u) => u.owner === EVIL).length).toBe(0);
  });

  it('save/load restores an in-flight wave and timers', async () => {
    const sim = await game({ players: [{ name: 'Бот', color: 0xe8423f, team: 0, kind: 'bot', difficulty: 'normal', heroClass: 'hero_warrior', start: 0 }] });
    run(sim, 12 * 60 + 2);
    expect(sim.world.evil.waves.length).toBe(1);
    const save = JSON.parse(JSON.stringify(serialize(sim)));
    const sim2 = deserialize(save, await Nav.loadWasm(wasmBytes));
    installSystems(sim2);
    sim2.world.started = true;
    expect(sim2.world.evil.waves.length).toBe(1);
    expect(sim2.world.time).toBeCloseTo(sim.world.time, 3);
    expect(sim2.world.factions[0].lastWaveSentAt).toBe(sim.world.factions[0].lastWaveSentAt);
    run(sim2, 5);
    expect(sim2.world.evil.waves[0].units.length).toBeGreaterThan(0);
  }, 60000);
});
