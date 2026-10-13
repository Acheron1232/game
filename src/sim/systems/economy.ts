/** Jobs, food, hunger, healing, traveler camps, hero respawn, training and research. */
import { content } from '../../engine/registry';
import type { Role } from '../../content/types';
import type { Sim } from '../sim';
import { EVIL, NEUTRAL, type Entity, type Faction } from '../types';

export function jobsSystem(sim: Sim) {
  if (sim.world.tick % 10 !== 0) return; // twice a second
  for (const f of sim.world.factions) assignJobs(sim, f);
}

function assignJobs(sim: Sim, f: Faction) {
  const vill = sim.units.filter((u) => u.owner === f.id && u.def === 'villager' && u.status !== 'trainee');
  const farms = sim.buildings.filter((b) => b.owner === f.id && b.def === 'farm' && b.built);
  const mills = sim.buildings.filter((b) => b.owner === f.id && b.def === 'sawmill' && b.built);
  const deposits: Entity[] = [];
  for (const r of sim.world.entities.values()) if (r.kind === 'resource' && !r.dead && r.res === 'stone' && (r.amount ?? 0) > 0 && r.marked?.includes(f.id)) deposits.push(r);

  // validate existing bindings
  for (const v of vill) {
    if (v.role === 'farmer' && !farms.some((b) => b.id === v.jobId)) free(v);
    if (v.role === 'lumber' && !mills.some((b) => b.id === v.jobId)) free(v);
    if (v.role === 'miner' && !deposits.some((r) => r.id === v.jobId)) free(v);
  }
  const want: Record<Exclude<Role, 'free'>, number> = {
    farmer: Math.min(f.jobs.farmer, farms.length * (content.buildings.farm.produces?.workers ?? 1)),
    lumber: Math.min(f.jobs.lumber, mills.length * (content.buildings.sawmill.produces?.workers ?? 1)),
    miner: Math.min(f.jobs.miner, deposits.length * 2),
    builder: f.jobs.builder,
  };
  // release extras
  for (const role of Object.keys(want) as (keyof typeof want)[]) {
    const cur = vill.filter((v) => v.role === role);
    for (let i = want[role]; i < cur.length; i++) free(cur[i]);
  }
  const take = (x: number, y: number) => {
    let best: Entity | undefined, bd = Infinity;
    for (const v of vill) {
      if (v.role && v.role !== 'free') continue;
      const d = (v.x - x) ** 2 + (v.y - y) ** 2;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  };
  const fill = (role: Exclude<Role, 'free'>, slots: Entity[], perSlot: number) => {
    let have = vill.filter((v) => v.role === role).length;
    for (const s of slots) {
      let n = vill.filter((v) => v.role === role && v.jobId === s.id).length;
      while (have < want[role] && n < perSlot) {
        const v = take(s.x, s.y);
        if (!v) return;
        v.role = role; v.jobId = s.id; v.workId = undefined; v.status = undefined;
        have++; n++;
      }
    }
  };
  fill('farmer', farms, content.buildings.farm.produces?.workers ?? 1);
  fill('lumber', mills, content.buildings.sawmill.produces?.workers ?? 1);
  fill('miner', deposits, 2);
  let builders = vill.filter((v) => v.role === 'builder').length;
  const th = sim.townhall(f.id, false) ?? { x: f.start.x, y: f.start.y };
  while (builders < want.builder) {
    const v = take(th.x, th.y);
    if (!v) break;
    v.role = 'builder'; v.jobId = undefined; builders++;
  }
}

function free(v: Entity) {
  v.role = 'free';
  v.jobId = undefined;
  v.workId = undefined;
}

/** Pick a villager for soldier training: never the last farmer while people need food. */
export function pickTrainee(sim: Sim, f: Faction, near: Entity): Entity | undefined {
  const vill = sim.units.filter((u) => u.owner === f.id && u.def === 'villager' && u.status !== 'trainee');
  const order: (Role | undefined)[] = ['free', undefined, 'builder', 'lumber', 'miner', 'farmer'];
  const farmers = vill.filter((v) => v.role === 'farmer').length;
  for (const role of order) {
    const cands = vill.filter((v) => (v.role ?? undefined) === role || (role === 'free' && v.role == null));
    if (role === 'farmer' && farmers <= 1) continue;
    cands.sort((a, b) => Math.hypot(a.x - near.x, a.y - near.y) - Math.hypot(b.x - near.x, b.y - near.y));
    if (cands[0]) return cands[0];
  }
  return undefined;
}

export function economySystem(sim: Sim, dt: number) {
  const w = sim.world;
  const bal = content.balance;
  for (const f of w.factions) {
    const pop = sim.population(f.id);
    // food upkeep: 1 per citizen per minute
    const out = (pop * bal.upkeepPerMin) / 60;
    f.res.food = Math.max(0, f.res.food - out * dt);
    f.hungry = pop > 0 && f.res.food <= 0;
    // rolling per-minute rates for UI
    f.stats.foodOut = pop * bal.upkeepPerMin;
    if (w.tick % 20 === 0) {
      let inRate = 0;
      for (const u of sim.units) {
        if (u.owner !== f.id || u.def !== 'villager' || u.state !== 'work') continue;
        if (u.role === 'farmer') inRate += content.buildings.farm.produces!.perMin;
        else if (sim.get(u.workId)?.res === 'food') inRate += bal.gather.berriesPerMin;
      }
      f.stats.foodIn = inRate * sim.workRate(f);
    }
  }

  // resources regrow (berries)
  if (w.tick % 20 === 0) {
    for (const r of w.entities.values()) {
      if (r.kind !== 'resource' || r.dead) continue;
      const regen = content.props[r.def]?.regen;
      if (regen && (r.amount ?? 0) < (r.maxAmount ?? 0)) r.amount = Math.min(r.maxAmount!, (r.amount ?? 0) + regen);
    }
  }

  // healing near town hall when out of combat
  for (const u of sim.units) {
    if (u.owner === EVIL || u.owner === NEUTRAL || u.hp >= u.maxHp) continue;
    if (u.lastHurtAt != null && sim.time - u.lastHurtAt < 5) continue;
    const th = sim.townhall(u.owner);
    if (th && Math.hypot(th.x - u.x, th.y - u.y) <= bal.healRadius) u.hp = Math.min(u.maxHp, u.hp + bal.healRate * dt);
  }

  // traveler camps refill one candidate every 3 minutes up to 3
  for (const c of w.camps) {
    let n = 0;
    for (const u of w.entities.values()) if (!u.dead && u.def === 'traveler' && u.campId === c.id) n++;
    if (n >= bal.camp.max) { c.regenAt = 0; continue; }
    if (!c.regenAt) c.regenAt = sim.time + bal.camp.regenSeconds;
    if (sim.time >= c.regenAt) {
      sim.spawnUnit('traveler', NEUTRAL, c.x + sim.rng.range(-1.5, 1.5), c.y + sim.rng.range(0.5, 2), { campId: c.id });
      c.regenAt = n + 1 < bal.camp.max ? sim.time + bal.camp.regenSeconds : 0;
    }
  }

  // hero respawn (30s, at the town hall, or at the start zone without one)
  for (const f of w.factions) {
    const h = w.entities.get(f.heroId);
    if (!h || h.respawnAt == null || sim.time < h.respawnAt) continue;
    const th = sim.townhall(f.id);
    const [x, y] = th ? sim.approachPoint({ ...h, x: th.x, y: th.y + 3 } as Entity, th) : [f.start.x, f.start.y];
    h.respawnAt = undefined;
    h.x = x; h.y = y;
    h.maxHp = sim.maxHpOf(h);
    h.hp = h.maxHp;
    h.state = 'idle';
    h.order = { type: 'idle' };
    h.lastHurtAt = undefined;
    sim.events.emit('heroRespawned', { id: h.id, owner: f.id });
  }

  // live stat refresh: definitions may change at runtime (inspector, mods, HMR)
  if (w.tick % 20 === 5) {
    for (const e of w.entities.values()) {
      if (e.dead || (e.kind !== 'unit' && e.kind !== 'building')) continue;
      const m = sim.maxHpOf(e);
      if (m !== e.maxHp) {
        // max health grows without a full heal; shrinks clamp current health
        if (m > e.maxHp && e.kind === 'building' && !e.built) e.hp *= m / e.maxHp;
        e.maxHp = m;
        e.hp = Math.min(e.hp, m);
      }
    }
  }
}

export function buildingSystem(sim: Sim) {
  const t = sim.time;
  for (const b of sim.buildings) {
    if (b.owner === EVIL) continue;
    const f = sim.faction(b.owner);
    if (!f) continue;
    // construction status for UI
    if (!b.built) {
      const last = (b as any).lastWorkAt ?? -1e9;
      const danger = sim.units.some((u) => sim.isEnemy(u, b) && Math.hypot(u.x - b.x, u.y - b.y) < 6);
      (b as any).status = danger ? 'Небезпечно' : t - last > 2 ? 'Немає працівника' : 'Будується';
    }
    if (b.def !== 'barracks' || !b.built) continue;
    // training soldiers from villagers
    if (b.training) {
      if (t >= b.training.doneAt) {
        const v = sim.world.entities.get(b.training.villager);
        if (v && !v.dead) {
          const ratio = v.hp / v.maxHp;
          sim.remove(v);
          const [x, y] = sim.nav.nearestWalkable(b.x, b.ty! + b.h! + 0.6, 5) ?? [b.x, b.y + 2];
          const s = sim.spawnUnit('soldier', f.id, x, y);
          s.hp = Math.max(1, Math.round(s.maxHp * ratio));
          sim.events.emit('trained', { id: s.id, owner: f.id });
        }
        b.training = null;
        b.trainQueue = Math.max(0, (b.trainQueue ?? 0) - 1);
      }
    } else if ((b.trainQueue ?? 0) > 0) {
      const enRoute = sim.units.some((u) => u.status === 'trainee' && u.jobId === b.id);
      if (!enRoute) {
        const v = pickTrainee(sim, f, b);
        if (v) { v.status = 'trainee'; v.jobId = b.id; v.role = 'free'; v.workId = undefined; (b as any).status = undefined; }
        else (b as any).status = 'Немає вільних жителів';
      }
    }
    if (b.researching && t >= b.researching.doneAt) {
      f.militia = true;
      b.researching = null;
      sim.events.emit('research', { owner: f.id, tech: 'militia' });
      sim.notice(f.id, '«Навчене ополчення» вивчено: +10 здоров’я, +1 шкоди', 'good');
    }
  }
}

/** Town hall loss → temporary protection from targeted waves; trainees inside destroyed barracks pop out. */
export function registerFactionHooks(sim: Sim) {
  sim.deathHooks.faction = (e) => {
    if (e.kind !== 'building') return;
    if (e.def === 'barracks' && e.training) {
      const v = sim.world.entities.get(e.training.villager);
      if (v) { v.inside = undefined; v.status = undefined; }
    }
    if (e.def !== 'townhall') return;
    const f = sim.faction(e.owner);
    if (!f || sim.buildings.some((b) => b !== e && !b.dead && b.owner === f.id && b.def === 'townhall')) return;
    f.protectedUntil = sim.time + content.balance.noTownhallProtection;
    sim.notice(f.id, 'Ратушу зруйновано! 5 хвилин захисту від хвиль. Відбудуйтеся.', 'warn');
    for (const w of sim.world.evil.waves) if (w.faction === f.id) w.state = 'retreat';
    if (sim.world.evil.pending?.faction === f.id) sim.world.evil.pending = null;
  };
}
