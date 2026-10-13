/**
 * Player bot (first AI type): a full human faction driven by a scripted build order.
 * It uses exactly the same command interface as human players — no cheats.
 */
import { content } from '../../engine/registry';
import type { ResKey } from '../../content/types';
import { placementError } from '../commands';
import type { Sim } from '../sim';
import { EVIL, NEUTRAL, type Entity, type Faction } from '../types';
import { nearestResource } from './behavior';

export function botSystem(sim: Sim) {
  for (const f of sim.world.factions) {
    if (f.kind !== 'bot') continue;
    const cfg = content.balance.bot[f.difficulty];
    f.bot ??= { nextThink: 0, step: '' };
    if (sim.time < f.bot.nextThink) continue;
    f.bot.nextThink = sim.time + cfg.think;
    try {
      think(sim, f);
    } catch (e) {
      console.error('[bot]', e);
    }
  }
}

function think(sim: Sim, f: Faction) {
  const cfg = content.balance.bot[f.difficulty];
  const hero = sim.get(f.heroId);
  const heroUp = hero && hero.respawnAt == null ? hero : undefined;
  const th = sim.townhall(f.id, false);
  const base = th ?? ({ x: f.start.x, y: f.start.y } as Entity);
  const soldiers = sim.units.filter((u) => u.owner === f.id && u.def === 'soldier');
  const villagers = sim.units.filter((u) => u.owner === f.id && u.def === 'villager');
  const pop = sim.population(f.id), cap = sim.housing(f.id);
  const send = (c: any) => sim.enqueue({ f: f.id, ...c });
  const step = (s: string) => (f.bot!.step = s);

  // ---- 0. threats near home come first
  let threat: Entity | undefined;
  for (const u of sim.units) if (sim.isEnemy(u, { owner: f.id }) && Math.hypot(u.x - base.x, u.y - base.y) < 13) { threat = u; break; }
  if (threat) {
    if (f.army.order !== 'defend') send({ t: 'army', order: 'defend' });
    if (heroUp && heroUp.order?.type !== 'attack') send({ t: 'heroAttack', target: threat.id });
    step('Оборона');
    return;
  }
  // ally asked for help (ping) and we have spare soldiers
  if (f.ping && sim.time - f.ping.at < 90 && soldiers.length >= 2) {
    if (f.army.order !== 'attack' || f.army.x !== f.ping.x) send({ t: 'army', order: 'attack', x: f.ping.x, y: f.ping.y });
  } else if (f.ping && sim.time - f.ping.at >= 90 && f.army.order === 'attack' && !f.bot!.attackStarted) {
    send({ t: 'army', order: 'return' });
    f.ping = undefined;
  }

  // ---- food deficit check
  const farms = sim.countBuildings(f.id, 'farm');
  const farmsAll = sim.countBuildings(f.id, 'farm', false);
  const farmers = villagers.filter((v) => v.role === 'farmer').length;
  const spare = villagers.filter((v) => v.role === 'free' || v.role == null || v.role === 'builder' || v.role === 'miner').length;
  const neededFarms = Math.ceil((pop * content.balance.upkeepPerMin + 1) / (content.buildings.farm.produces!.perMin * 0.95));
  if (f.stats.foodIn < f.stats.foodOut && f.res.food < 25 && th?.built) {
    if (farms > farmers) {
      // empty farms: staff them first, pulling miners/builders if needed
      if (f.jobs.farmer < farms) send({ t: 'jobs', role: 'farmer', count: farms });
      if (spare <= 1 && f.jobs.miner > 0) send({ t: 'jobs', role: 'miner', count: 0 });
      if (heroUp && pop < cap && f.res.food >= content.balance.recruitCost) {
        const t = nearestTraveler(sim, f, heroUp);
        if (t) { if (heroUp.order?.type !== 'interact') send({ t: 'heroInteract', target: t.id }); return step('Люди для ферм'); }
      }
      if (heroUp) heroGather(sim, f, heroUp, 'food');
      return step('Шукаю фермерів');
    } else if (farmsAll < neededFarms + 1 && spare > 0 && tryBuild(sim, f, 'farm')) return step('Ферма (дефіцит їжі)');
  }

  // ---- 1. town hall and the first three travelers
  if (!th) {
    if (sim.canAfford(f, content.buildings.townhall.cost)) {
      const spot = findSpot(sim, f, 'townhall', f.start.x, f.start.y);
      if (spot) { send({ t: 'place', def: 'townhall', x: spot[0], y: spot[1] }); step('Ставлю ратушу'); return; }
    }
    heroGather(sim, f, heroUp, 'wood');
    return step('Збираю дерево на ратушу');
  }
  if (!th.built) {
    if (heroUp && heroUp.order?.type !== 'build') send({ t: 'heroBuild', target: th.id });
    return step('Будую ратушу');
  }
  if (f.jobs.builder < 1) send({ t: 'jobs', role: 'builder', count: 1 });
  const recruitsDone = ((f as any).recruits ?? 0) >= 3;
  if (!recruitsDone && pop < cap && f.res.food >= content.balance.recruitCost && heroUp) {
    const t = nearestTraveler(sim, f, heroUp);
    if (t) { if (heroUp.order?.type !== 'interact') send({ t: 'heroInteract', target: t.id }); return step('Наймаю мандрівників'); }
  }

  // ---- 2. farm + sawmill with workers
  const mills = sim.countBuildings(f.id, 'sawmill');
  if (sim.countBuildings(f.id, 'farm', false) === 0) { if (tryBuild(sim, f, 'farm')) return step('Ферма'); return gatherFor(sim, f, heroUp, 'wood', 'Збираю дерево на ферму'); }
  if (sim.countBuildings(f.id, 'sawmill', false) === 0) { if (tryBuild(sim, f, 'sawmill')) return step('Лісопильня'); return gatherFor(sim, f, heroUp, 'wood', 'Збираю дерево на лісопильню'); }
  if (f.jobs.farmer < farms) send({ t: 'jobs', role: 'farmer', count: farms });
  if (f.jobs.lumber < mills) send({ t: 'jobs', role: 'lumber', count: mills });

  if (farmsAll < neededFarms && f.stats.foodIn < f.stats.foodOut + 1 && spare > 0) {
    if (tryBuild(sim, f, 'farm')) return step('Ще одна ферма');
  }
  if (f.jobs.farmer < farms) send({ t: 'jobs', role: 'farmer', count: farms });

  // ---- 3. housing when fewer than two free places
  const thCap = content.buildings.townhall.popCap![(th.level ?? 1) - 1];
  const housingTotal = sim.buildings.filter((b) => b.owner === f.id).reduce((s, b) => s + (b.built ? sim.bDef(b).housing : 0), 0);
  const pendingHouse = sim.buildings.some((b) => b.owner === f.id && b.def === 'house' && !b.built);
  if (cap - pop < 2 && housingTotal < thCap && !pendingHouse) {
    if (tryBuild(sim, f, 'house')) return step('Будинок');
    return gatherFor(sim, f, heroUp, 'wood', 'Дерево на будинок');
  }

  // ---- 4. recruit when food and housing allow
  if (pop < cap && f.res.food >= content.balance.recruitCost + 5 && heroUp) {
    const t = nearestTraveler(sim, f, heroUp);
    if (t) { if (heroUp.order?.type !== 'interact') send({ t: 'heroInteract', target: t.id }); return step('Наймаю людей'); }
  }

  // ---- 5. barracks and first two soldiers
  const barracks = sim.buildings.find((b) => b.owner === f.id && b.def === 'barracks');
  if (!barracks) { if (tryBuild(sim, f, 'barracks')) return step('Казарма'); return gatherFor(sim, f, heroUp, 'wood', 'Дерево на казарму'); }
  if (!barracks.built) return step('Будується казарма');
  const queued = soldiers.length + (barracks.trainQueue ?? 0);
  // keep enough workers to feed everyone: farmers for the whole population + a lumberjack + a builder
  const canDraft = villagers.length - 1 > Math.max(2, neededFarms + 2) && f.res.food > 10;
  if (queued < 2 && canDraft) {
    if (sim.canAfford(f, content.balance.soldier.cost)) { send({ t: 'train', id: barracks.id }); return step('Тренування солдатів'); }
    return gatherFor(sim, f, heroUp, 'wood', 'Дерево на солдатів');
  }

  // ---- 6. tower and town hall upgrade with stable stock
  const stableFood = f.stats.foodIn >= f.stats.foodOut || f.res.food > 40;
  if (stableFood) {
    if (f.res.stone < 30) markStone(sim, f);
    if (sim.countBuildings(f.id, 'tower', false) === 0) {
      if (tryBuild(sim, f, 'tower')) return step('Вежа');
      return gatherFor(sim, f, heroUp, f.res.stone < 15 ? 'stone' : 'wood', 'Ресурси на вежу');
    }
    if ((th.level ?? 1) < 2 && !th.upgrading) {
      if (sim.canAfford(f, content.buildings.townhall.upgrade!.cost)) { send({ t: 'upgrade', id: th.id }); return step('Покращення ратуші'); }
      return gatherFor(sim, f, heroUp, f.res.stone < 30 ? 'stone' : 'wood', 'Ресурси на покращення');
    }
    if ((th.level ?? 1) >= 2 && !f.militia && !barracks.researching && sim.canAfford(f, content.balance.militia.cost)) {
      send({ t: 'research', id: barracks.id, tech: 'militia' });
      return step('Навчене ополчення');
    }
  }

  // ---- 7. grow the army to the limit while keeping farmers
  if (queued < cfg.maxSoldiers && canDraft && (barracks.trainQueue ?? 0) < 2) {
    if (sim.canAfford(f, content.balance.soldier.cost)) send({ t: 'train', id: barracks.id });
    if (farmsAll < neededFarms) tryBuild(sim, f, 'farm');
    step('Армія');
  }
  if (cap - pop < 2 && housingTotal < thCap && !pendingHouse) tryBuild(sim, f, 'house');

  // ---- 8. normal bots attack an enemy faction after 20 minutes with a defensive reserve
  if (sim.time > cfg.attackAfterMin * 60 && soldiers.length >= cfg.maxSoldiers - 1 && f.res.food > 30) {
    const enemy = sim.world.factions.find((o) => o.team !== f.team && sim.townhall(o.id));
    if (enemy && f.army.order !== 'attack') {
      send({ t: 'army', order: 'attack', target: sim.townhall(enemy.id)!.id });
      f.bot!.attackStarted = true;
      step('Атака на ворога');
    }
  }

  // idle hero: gather what we lack most
  if (heroUp && (heroUp.order?.type === 'idle' || !heroUp.order)) {
    const need: ResKey = f.res.wood < 60 ? 'wood' : f.res.stone < 30 ? 'stone' : f.res.food < 30 ? 'food' : 'wood';
    heroGather(sim, f, heroUp, need);
  }
}

function gatherFor(sim: Sim, f: Faction, hero: Entity | undefined, res: ResKey, label: string) {
  if (res === 'stone') markStone(sim, f);
  heroGather(sim, f, hero, res);
  f.bot!.step = label;
}

function heroGather(sim: Sim, f: Faction, hero: Entity | undefined, res: ResKey) {
  if (!hero) return;
  if (hero.order?.type === 'gather' && sim.get((hero.order as any).target)?.res === res) return;
  if (hero.order?.type === 'build' || hero.order?.type === 'interact') return;
  const th = sim.townhall(f.id, false);
  const base = th ?? { x: f.start.x, y: f.start.y };
  const r = nearestResource(sim, base.x, base.y, res, 18) ?? nearestResource(sim, hero.x, hero.y, res, 30);
  if (r) sim.enqueue({ t: 'heroGather', f: f.id, target: r.id });
}

function markStone(sim: Sim, f: Faction) {
  const th = sim.townhall(f.id, false);
  if (!th) return;
  const already = [...sim.world.entities.values()].some((r) => r.kind === 'resource' && !r.dead && r.res === 'stone' && r.marked?.includes(f.id));
  if (!already) {
    const r = nearestResource(sim, th.x, th.y, 'stone', 20);
    if (r) sim.enqueue({ t: 'mark', f: f.id, id: r.id, on: true });
  }
  if (f.jobs.miner < 1) sim.enqueue({ t: 'jobs', f: f.id, role: 'miner', count: 1 });
}

function nearestTraveler(sim: Sim, f: Faction, hero: Entity) {
  let best: Entity | undefined, bd = Infinity;
  for (const u of sim.units) {
    if (u.def !== 'traveler' || u.owner !== NEUTRAL) continue;
    const camp = sim.world.camps.find((c) => c.id === u.campId);
    const owner = camp && sim.faction(camp.reservedFor);
    if (camp && camp.reservedFor !== f.id && owner && !owner.firstRecruitDone) continue;
    const d = Math.hypot(u.x - hero.x, u.y - hero.y);
    if (d < bd && d < 45) { bd = d; best = u; }
  }
  return best;
}

function tryBuild(sim: Sim, f: Faction, def: string): boolean {
  const d = content.buildings[def];
  if (!sim.canAfford(f, d.cost)) return false;
  const th = sim.townhall(f.id, false);
  const spot = findSpot(sim, f, def, th?.x ?? f.start.x, th?.y ?? f.start.y);
  if (!spot) return false;
  sim.enqueue({ t: 'place', f: f.id, def, x: spot[0], y: spot[1] });
  return true;
}

/** Spiral search around a center for a valid footprint, avoiding the side facing the evil base. */
export function findSpot(sim: Sim, f: Faction, def: string, cx: number, cy: number): [number, number] | null {
  const [w, h] = content.buildings[def].size;
  const core = sim.get(sim.world.evil.coreId);
  for (let r = def === 'townhall' ? 0 : 4; r < 14; r++) {
    const cands: [number, number, number][] = [];
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2 + r * 0.7;
      const x = Math.round(cx + Math.cos(ang) * r - w / 2), y = Math.round(cy + Math.sin(ang) * r * 0.8 - h / 2);
      const toCore = core ? Math.hypot(core.x - x, core.y - y) : 0;
      cands.push([x, y, -toCore]);
    }
    cands.sort((a, b) => a[2] - b[2]);
    for (const [x, y] of cands) if (!placementError(sim, f.id, def, x, y)) return [x, y];
  }
  return null;
}

export const isEvil = (e: Entity) => e.owner === EVIL;
