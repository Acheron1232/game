/** Per-unit decision making for every unit type. */
import { content } from '../../engine/registry';
import type { HeroDef, ResKey } from '../../content/types';
import type { Sim } from '../sim';
import { EVIL, NEUTRAL, type Entity, type Faction } from '../types';
import { engage, findEnemy } from './combat';

export function behaviorSystem(sim: Sim, dt: number) {
  for (const e of sim.units) {
    if (e.hitAt != null) continue; // committed to a swing
    if (sim.isHero(e)) heroBrain(sim, e, dt);
    else if (e.def === 'villager') villagerBrain(sim, e, dt);
    else if (e.def === 'soldier') soldierBrain(sim, e);
    else if (e.owner === EVIL) undeadBrain(sim, e);
    else if (e.def === 'traveler') travelerBrain(sim, e);
    else genericBrain(sim, e);
  }
}

// ------------------------------------------------------------------ shared work helpers

/** Applies construction / upgrade / repair work to a building. Returns true while there is work left. */
export function workOnBuilding(sim: Sim, b: Entity, worker: Entity, dt: number): boolean {
  const d = sim.bDef(b);
  const f = sim.faction(b.owner);
  const rate = f ? sim.workRate(f) : 1;
  b.lastHurtAt = b.lastHurtAt; // no-op, keeps shape stable
  (b as any).lastWorkAt = sim.time;
  if (!b.built) {
    const dp = (dt / d.buildTime) * rate;
    b.progress = Math.min(1, (b.progress ?? 0) + dp);
    b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.9 * dp);
    if (b.progress >= 1) completeBuilding(sim, b);
    return !b.built;
  }
  if (b.upgrading) {
    const up = d.upgrade!;
    b.level2Progress = Math.min(1, (b.level2Progress ?? 0) + (dt / up.time) * rate);
    if (b.level2Progress >= 1) {
      b.upgrading = false;
      b.level = (b.level ?? 1) + 1;
      const old = b.maxHp;
      b.maxHp = sim.maxHpOf(b);
      b.hp += b.maxHp - old;
      sim.events.emit('upgraded', { id: b.id, def: b.def, level: b.level });
      sim.notice(b.owner, 'Ратушу покращено до кам’яної!', 'good');
      if (f && !f.firstBuilt['townhall2']) {
        f.firstBuilt['townhall2'] = true;
        const h = sim.get(f.heroId);
        if (h) sim.addXp(h, content.balance.heroXpBuilding);
      }
    }
    return true;
  }
  if (b.hp < b.maxHp) {
    b.hp = Math.min(b.maxHp, b.hp + (b.maxHp / d.buildTime) * dt * 0.5 * rate);
    return b.hp < b.maxHp;
  }
  return false;
}

export function completeBuilding(sim: Sim, b: Entity) {
  b.built = true;
  b.progress = 1;
  const f = sim.faction(b.owner);
  sim.events.emit('built', { id: b.id, def: b.def, owner: b.owner });
  if (!f) return;
  if (b.def === 'townhall') f.hadTownhall = true;
  // experience only for the first completion of each building type (no infinite xp from rebuilding)
  if (!f.firstBuilt[b.def]) {
    f.firstBuilt[b.def] = true;
    const h = sim.get(f.heroId);
    if (h && h.respawnAt == null) sim.addXp(h, content.balance.heroXpBuilding);
  }
  sim.notice(b.owner, `${sim.bDef(b).name}: будівництво завершено`, 'good');
}

function needsWork(b: Entity) {
  return !b.built || b.upgrading || b.hp < b.maxHp * 0.98;
}

/** Swing a tool periodically while working (drives the work animation). */
function workSwing(sim: Sim, e: Entity, period = 0.9) {
  e.state = 'work';
  if ((e.attackCd ?? 0) <= sim.time) {
    e.swingAt = sim.time;
    e.attackCd = sim.time + period;
  }
}

function near(sim: Sim, e: Entity, t: Entity, d = 0.9) {
  return sim.dist(e, t) <= d;
}

function goWork(sim: Sim, e: Entity, t: Entity): boolean {
  if (near(sim, e, t)) {
    if (e.goalX != null) sim.stop(e);
    if (Math.abs(t.x - e.x) > 0.1) e.facing = t.x > e.x ? 1 : -1;
    return true;
  }
  const [x, y] = sim.approachPoint(e, t);
  sim.moveTo(e, x, y);
  if (e.status === 'no-path') {
    e.status = 'Немає шляху';
    // remember unreachable targets so free workers pick another one
    (e as any).avoid = t.id;
    if (e.workId === t.id) e.workId = undefined;
  }
  return false;
}

export function recruit(sim: Sim, f: Faction, t: Entity): boolean {
  if (t.def !== 'traveler' || t.owner !== NEUTRAL) return false;
  const camp = sim.world.camps.find((c) => c.id === t.campId);
  if (camp && camp.reservedFor !== f.id) {
    const owner = sim.faction(camp.reservedFor);
    if (owner && !owner.firstRecruitDone) {
      sim.notice(f.id, 'Ці мандрівники чекають на іншого лідера', 'error');
      return false;
    }
  }
  const cost = content.balance.recruitCost;
  if (f.res.food < cost) { sim.notice(f.id, `Потрібно ${cost} їжі, щоб найняти мандрівника`, 'error'); return false; }
  if (sim.population(f.id) >= sim.housing(f.id)) { sim.notice(f.id, 'Немає вільного житла', 'error'); return false; }
  f.res.food -= cost;
  t.def = 'villager';
  t.owner = f.id;
  t.role = 'free';
  t.campId = undefined;
  t.maxHp = sim.maxHpOf(t);
  t.hp = t.maxHp;
  t.order = { type: 'idle' };
  sim.stop(t);
  f.stats.foodOut += 0;
  (f as any).recruits = ((f as any).recruits ?? 0) + 1;
  if ((f as any).recruits >= 3) f.firstRecruitDone = true;
  if (camp && camp.regenAt < sim.time) camp.regenAt = sim.time + content.balance.camp.regenSeconds;
  sim.events.emit('recruited', { id: t.id, owner: f.id });
  sim.notice(f.id, 'Мандрівник приєднався до поселення', 'good');
  return true;
}

// ------------------------------------------------------------------ hero

function heroBrain(sim: Sim, e: Entity, dt: number) {
  const f = sim.faction(e.owner);
  if (!f) return;
  const d = content.heroes[e.def] as HeroDef;
  const o = e.order ?? { type: 'idle' };
  switch (o.type) {
    case 'move':
      if (e.goalX == null) e.order = { type: 'idle' };
      return;
    case 'attack':
      if (!engage(sim, e, sim.get(o.target))) e.order = { type: 'idle' };
      return;
    case 'gather': {
      let r = sim.get(o.target);
      if (!r || !r.amount) {
        r = nearestResource(sim, e.x, e.y, (r?.res ?? 'wood') as ResKey, 7);
        if (!r) { e.order = { type: 'idle' }; return; }
        e.order = { type: 'gather', target: r.id };
      }
      if (!goWork(sim, e, r)) return;
      e.state = 'work';
      if ((e.attackCd ?? 0) <= sim.time) {
        e.swingAt = sim.time;
        e.attackCd = sim.time + d.gatherTime / sim.workRate(f);
        takeResource(sim, f, r, content.balance.gather.heroPerTrip, e);
      }
      return;
    }
    case 'build': {
      const b = sim.get(o.target);
      if (!b || b.kind !== 'building' || !needsWork(b)) { e.order = { type: 'idle' }; return; }
      if (!goWork(sim, e, b)) return;
      workSwing(sim, e, 0.8);
      workOnBuilding(sim, b, e, dt);
      return;
    }
    case 'interact': {
      const t = sim.get(o.target);
      if (!t) { e.order = { type: 'idle' }; return; }
      if (t.kind === 'building' && t.owner === e.owner) { e.order = { type: 'build', target: t.id }; return; }
      if (t.kind === 'resource') { e.order = { type: 'gather', target: t.id }; return; }
      if (sim.isEnemy(e, t)) { e.order = { type: 'attack', target: t.id }; return; }
      if (sim.dist(e, t) > 1.4) { sim.moveTo(e, t.x, t.y); return; }
      sim.stop(e);
      recruit(sim, f, t);
      e.order = { type: 'idle' };
      return;
    }
    default: {
      // idle: defend self / auto-acquire like WC3 heroes
      const cur = sim.get(e.targetId);
      if (cur && sim.isEnemy(e, cur) && sim.dist(e, cur) < d.aggro * 1.6 && engage(sim, e, cur)) return;
      const en = findEnemy(sim, e, d.aggro);
      if (en) { engage(sim, e, en); return; }
      e.targetId = undefined;
      if (e.goalX == null) e.state = 'idle';
    }
  }
}

export function nearestResource(sim: Sim, x: number, y: number, res: ResKey, radius: number, filter?: (r: Entity) => boolean): Entity | undefined {
  let best: Entity | undefined, bd = radius * radius;
  for (const r of sim.world.entities.values()) {
    if (r.kind !== 'resource' || r.dead || r.res !== res || !r.amount || r.amount < 1) continue;
    const d2 = (r.x - x) ** 2 + (r.y - y) ** 2;
    if (d2 < bd && (!filter || filter(r))) { bd = d2; best = r; }
  }
  return best;
}

function takeResource(sim: Sim, f: Faction, r: Entity, amount: number, by: Entity) {
  const got = Math.min(amount, r.amount ?? 0);
  if (got <= 0) return 0;
  r.amount! -= got;
  sim.gain(f, r.res!, got);
  sim.events.emit('gathered', { id: by.id, res: r.res!, amount: got, x: r.x, y: r.y, owner: f.id });
  if (r.amount! < 1 && content.props[r.def]?.regen == null) {
    sim.remove(r);
    sim.events.emit('depleted', { id: r.id, x: r.x, y: r.y });
  }
  return got;
}

/** Continuous production while working a resource node (per-minute rate). */
function workResource(sim: Sim, f: Faction, e: Entity, r: Entity, perMin: number, dt: number) {
  const amount = (perMin / 60) * dt * sim.workRate(f);
  e.workAcc = (e.workAcc ?? 0) + amount;
  sim.produce(f, r.res!, amount);
  r.amount = (r.amount ?? 0) - amount;
  if (e.workAcc >= 1) {
    e.workAcc -= 1;
    sim.events.emit('gathered', { id: e.id, res: r.res!, amount: 1, x: r.x, y: r.y, owner: f.id });
  }
  if (r.amount <= 0) {
    if (content.props[r.def]?.regen == null) {
      sim.remove(r);
      sim.events.emit('depleted', { id: r.id, x: r.x, y: r.y });
    } else r.amount = 0;
    e.workId = undefined;
  }
}

// ------------------------------------------------------------------ villager

function villagerBrain(sim: Sim, e: Entity, dt: number) {
  const f = sim.faction(e.owner);
  if (!f) return;
  const th = sim.townhall(f.id, false);
  // 1. flee from enemies
  const threat = findEnemy(sim, e, 4.5, (t) => t.kind === 'unit');
  if (threat) {
    const safe = th && Math.hypot(th.x - threat.x, th.y - threat.y) > 5 ? th : undefined;
    let tx: number, ty: number;
    if (safe) [tx, ty] = sim.approachPoint(e, safe);
    else {
      const dx = e.x - threat.x, dy = e.y - threat.y, d = Math.hypot(dx, dy) || 1;
      tx = e.x + (dx / d) * 6; ty = e.y + (dy / d) * 6;
    }
    sim.moveTo(e, tx, ty);
    e.status = 'Небезпечно';
    return;
  }
  if (e.status === 'Небезпечно') e.status = undefined;

  // 2. going to barracks to become a soldier
  if (e.status === 'trainee') {
    const b = sim.get(e.jobId);
    if (!b || !b.built) { e.status = undefined; e.jobId = undefined; return; }
    if (goWork(sim, e, b)) {
      e.inside = b.id;
      b.training = { villager: e.id, startedAt: sim.time, doneAt: sim.time + content.balance.soldier.trainTime };
    }
    return;
  }

  // 3. assigned job
  switch (e.role) {
    case 'farmer': {
      const farm = sim.get(e.jobId);
      if (!farm || !farm.built) { e.role = 'free'; e.jobId = undefined; break; }
      const prod = sim.bDef(farm).produces!;
      if (!goWork(sim, e, farm)) return;
      e.facing = ((sim.time / 6 + e.id) | 0) % 2 ? 1 : -1;
      workSwing(sim, e, 1.1);
      sim.produce(f, 'food', (prod.perMin / 60) * dt * sim.workRate(f));
      e.status = undefined;
      return;
    }
    case 'lumber': {
      const mill = sim.get(e.jobId);
      if (!mill || !mill.built) { e.role = 'free'; e.jobId = undefined; break; }
      let tree = sim.get(e.workId);
      if (!tree || !tree.amount) {
        tree = nearestResource(sim, mill.x, mill.y, 'wood', 11);
        e.workId = tree?.id;
      }
      const perMin = sim.bDef(mill).produces!.perMin;
      if (tree) {
        if (!goWork(sim, e, tree)) return;
        workSwing(sim, e, 0.85);
        workResource(sim, f, e, tree, perMin, dt);
      } else {
        // no trees in reach: saw planks at the mill
        if (!goWork(sim, e, mill)) return;
        workSwing(sim, e, 0.85);
        sim.produce(f, 'wood', (perMin / 60) * dt * sim.workRate(f) * 0.5);
        e.status = 'Немає дерев поруч';
      }
      return;
    }
    case 'miner': {
      const rock = sim.get(e.jobId);
      if (!rock || !rock.amount || !rock.marked?.includes(f.id)) { e.role = 'free'; e.jobId = undefined; break; }
      if (!goWork(sim, e, rock)) return;
      workSwing(sim, e, 0.95);
      workResource(sim, f, e, rock, content.balance.gather.stonePerMin, dt);
      return;
    }
    case 'builder': {
      if (buildSomething(sim, f, e, dt)) return;
      break;
    }
  }
  // 4. free: help construction, then auxiliary gathering, then wait
  if (buildSomething(sim, f, e, dt)) return;
  const home = th ?? { x: f.start.x, y: f.start.y };
  let bush = sim.get(e.workId);
  if (!bush || bush.res !== 'food' || (bush.amount ?? 0) < 1) {
    bush = nearestResource(sim, home.x, home.y, 'food', 14, (r) => r.id !== (e as any).avoid && !claimed(sim, r, e));
    e.workId = bush?.id;
  }
  if (bush) {
    if (!goWork(sim, e, bush)) return;
    workSwing(sim, e, 1.0);
    workResource(sim, f, e, bush, content.balance.gather.berriesPerMin, dt);
    return;
  }
  e.status = 'Очікує';
  idleWander(sim, e, home.x, home.y + 2.5, 3);
}

function claimed(sim: Sim, r: Entity, me: Entity) {
  for (const u of sim.units) if (u !== me && u.workId === r.id && u.def === 'villager') return true;
  return false;
}

function buildSomething(sim: Sim, f: Faction, e: Entity, dt: number): boolean {
  let b = sim.get(e.workId);
  if (!b || b.kind !== 'building' || b.owner !== f.id || !needsWork(b)) {
    b = undefined;
    let bd = Infinity;
    for (const x of sim.buildings) {
      if (x.owner !== f.id || !needsWork(x)) continue;
      if (x.built && !x.upgrading && x.lastHurtAt != null && sim.time - x.lastHurtAt < 3) continue; // don't repair under fire
      // limit crowding: at most 3 workers per site
      let n = 0;
      for (const u of sim.units) if (u !== e && u.workId === x.id) n++;
      if (n >= 3) continue;
      const d = Math.hypot(x.x - e.x, x.y - e.y) + (x.built ? 20 : 0);
      if (d < bd) { bd = d; b = x; }
    }
    e.workId = b?.id;
  }
  if (!b) return false;
  if (!goWork(sim, e, b)) return true;
  workSwing(sim, e, 0.8);
  workOnBuilding(sim, b, e, dt);
  e.status = undefined;
  return true;
}

function idleWander(sim: Sim, e: Entity, hx: number, hy: number, r: number) {
  if (e.goalX != null) return;
  e.state = 'idle';
  if ((e.wanderAt ?? 0) > sim.time) return;
  e.wanderAt = sim.time + sim.rng.range(4, 10);
  if (Math.hypot(e.x - hx, e.y - hy) > r * 2 || sim.rng.chance(0.5)) {
    const p = sim.nav.nearestWalkable(hx + sim.rng.range(-r, r), hy + sim.rng.range(-r, r), 4);
    if (p) sim.moveTo(e, p[0], p[1]);
  }
}

// ------------------------------------------------------------------ soldier

function soldierBrain(sim: Sim, e: Entity) {
  const f = sim.faction(e.owner);
  if (!f) return;
  const d = sim.uDef(e);
  const th = sim.townhall(f.id, false);
  const home = th ? { x: th.x, y: th.y + (th.h ?? 3) / 2 + 1.5 } : f.start;
  const idx = e.id % 12;
  const slot = { x: home.x + Math.cos(idx * 0.52) * (2 + (idx % 3) * 0.8), y: home.y + Math.sin(idx * 0.52) * (1.2 + (idx % 3) * 0.6) };
  const order = f.army.order;
  if (order === 'return') {
    e.targetId = undefined;
    if (Math.hypot(e.x - slot.x, e.y - slot.y) > 1.2) { sim.moveTo(e, slot.x, slot.y); return; }
    sim.stop(e);
    e.state = 'idle';
    // everyone back: switch to defense automatically
    if (sim.units.every((u) => u.owner !== f.id || u.def !== 'soldier' || u.goalX == null)) f.army = { order: 'defend' };
    return;
  }
  if (order === 'defend') {
    const leash = 14;
    const cur = sim.get(e.targetId);
    if (cur && sim.isEnemy(e, cur) && Math.hypot(cur.x - home.x, cur.y - home.y) < leash && engage(sim, e, cur)) return;
    const en = findEnemy(sim, e, d.aggro + 2, (t) => Math.hypot(t.x - home.x, t.y - home.y) < leash);
    if (en) { engage(sim, e, en); return; }
    e.targetId = undefined;
    if (Math.hypot(e.x - slot.x, e.y - slot.y) > 1.5) sim.moveTo(e, slot.x, slot.y);
    else if (e.goalX == null) e.state = 'idle';
    return;
  }
  // attack
  const en = findEnemy(sim, e, d.aggro);
  const cur = sim.get(e.targetId);
  if (cur && sim.isEnemy(e, cur) && sim.dist(e, cur) < d.aggro * 1.5 && engage(sim, e, cur)) return;
  if (en) { engage(sim, e, en); return; }
  const tgt = sim.get(f.army.target);
  if (tgt && sim.isEnemy(e, tgt)) { engage(sim, e, tgt); return; }
  const px = f.army.x ?? tgt?.x, py = f.army.y ?? tgt?.y;
  if (px != null && py != null) {
    const gx = px + Math.cos(idx) * 1.5, gy = py + Math.sin(idx) * 1.5;
    if (Math.hypot(e.x - gx, e.y - gy) > 1.5) sim.moveTo(e, gx, gy);
    else if (e.goalX == null) e.state = 'idle';
  } else if (e.goalX == null) e.state = 'idle';
}

// ------------------------------------------------------------------ undead

function undeadBrain(sim: Sim, e: Entity) {
  const d = sim.uDef(e);
  const ev = sim.world.evil;
  const wave = e.waveId != null ? ev.waves.find((w) => w.id === e.waveId) : undefined;
  if (wave && wave.state === 'march') {
    const cur = sim.get(e.targetId);
    // fight defenders on the way, but never chase the hero across the map
    if (cur && sim.isEnemy(e, cur) && sim.dist(e, cur) < (sim.isHero(cur) ? 3.5 : 6) && engage(sim, e, cur)) return;
    const en = findEnemy(sim, e, d.aggro, (t) => t.kind === 'unit' || t.kind === 'building');
    if (en && engage(sim, e, en)) return;
    let th = sim.townhall(wave.faction, false);
    if (!th) for (const b of sim.buildings) if (b.owner === wave.faction) { th = b; break; }
    if (th) engage(sim, e, th);
    return;
  }
  const gx = ev.graveyardPos.x, gy = ev.graveyardPos.y + 2.5;
  if (wave && wave.state === 'retreat') {
    e.targetId = undefined;
    if (Math.hypot(e.x - gx, e.y - gy) > 3) sim.moveTo(e, gx, gy);
    return;
  }
  // garrison: protect the cursed area only
  const leash = 11;
  const core = sim.get(ev.coreId);
  const hx = core?.x ?? gx, hy = core?.y ?? gy;
  const cur = sim.get(e.targetId);
  if (cur && sim.isEnemy(e, cur) && Math.hypot(cur.x - hx, cur.y - hy) < leash + 3 && engage(sim, e, cur)) return;
  const en = findEnemy(sim, e, d.aggro + 1, (t) => Math.hypot(t.x - hx, t.y - hy) < leash);
  if (en) { engage(sim, e, en); return; }
  e.targetId = undefined;
  idleWander(sim, e, (hx + gx) / 2, (hy + gy) / 2 + 1, 4);
}

function travelerBrain(sim: Sim, e: Entity) {
  if (e.homeX == null) { e.homeX = e.x; e.homeY = e.y; }
  idleWander(sim, e, e.homeX, e.homeY!, 2.5);
}

function genericBrain(sim: Sim, e: Entity) {
  const d = sim.uDef(e);
  if (!d || !d.aggro) return;
  const cur = sim.get(e.targetId);
  if (cur && engage(sim, e, cur)) return;
  const en = findEnemy(sim, e, d.aggro);
  if (en) engage(sim, e, en);
  else if (e.goalX == null) e.state = 'idle';
}
