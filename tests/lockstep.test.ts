import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import '../src/content/index';
import '../src/sim/commands';
import { createGame } from '../src/sim/map';
import { Nav } from '../src/sim/nav';
import { applySave, deserialize, serialize } from '../src/sim/save';
import { installSystems } from '../src/sim/systems';
import type { Command } from '../src/sim/types';

it('guest simulation driven by the host tick stream stays in sync', async () => {
  const bytes = readFileSync(new URL('../public/wasm/nav.wasm', import.meta.url));
  const host = createGame({ mapId: 'ash_valley', calm: false, players: [
    { name: 'H', color: 1, team: 0, kind: 'human', difficulty: 'normal', heroClass: 'hero_warrior', start: 0 },
    { name: 'G', color: 2, team: 0, kind: 'human', difficulty: 'normal', heroClass: 'hero_mage', start: 1 },
    { name: 'B', color: 3, team: 1, kind: 'bot', difficulty: 'normal', heroClass: 'hero_archer', start: 2 },
  ] }, await Nav.loadWasm(bytes));
  installSystems(host);
  host.world.started = true;
  for (let i = 0; i < 200; i++) host.step();
  // guest joins from a JSON snapshot
  const guest = deserialize(JSON.parse(JSON.stringify(serialize(host))), await Nav.loadWasm(bytes));
  installSystems(guest);
  guest.world.started = true;
  guest.remote = true;
  const stream: { tick: number; cmds: Command[]; sum: number }[] = [];
  // same message the host broadcasts, including its checksum
  host.onStep = (tick, cmds) => stream.push({ tick, cmds: JSON.parse(JSON.stringify(cmds)), sum: host.checksum() });
  const f0 = host.world.factions[0], f1 = host.world.factions[1];
  host.send({ t: 'place', f: 0, def: 'townhall', x: f0.start.x - 2, y: f0.start.y - 5 });
  host.send({ t: 'place', f: 1, def: 'townhall', x: f1.start.x - 2, y: f1.start.y - 5 });
  for (let i = 0; i < 20 * 60 * 14; i++) {
    if (i === 2000) host.send({ t: 'heroMove', f: 1, x: 60, y: 50 });
    if (i === 4000) host.send({ t: 'transfer', f: 0, to: 1, res: 'food', amount: 5 });
    if (i === 6000) {
      // corrupt the guest, then resync in place from a host snapshot
      guest.world.factions[0].res.wood += 999;
      expect(guest.checksum()).not.toBe(host.checksum());
      expect(applySave(guest, JSON.parse(JSON.stringify(serialize(host))))).toBe(true);
      expect(guest.checksum()).toBe(host.checksum());
    }
    host.step();
    const m = stream.shift()!;
    for (const c of m.cmds) guest.applyRemote(c);
    guest.step();
    expect(guest.world.tick).toBe(m.tick);
    expect(guest.checksum()).toBe(m.sum);
    if (i % 400 === 0) expect(guest.checksum()).toBe(host.checksum());
  }
  expect(guest.checksum()).toBe(host.checksum());
  expect(host.world.evil.waves.length + host.world.factions[0].waveCount).toBeGreaterThan(0);
}, 120000);
