/** Server-side validation and application of player/bot commands. */
import { content } from '../engine/registry';
import type { ResKey } from '../content/types';
import { commandHandlers, type Sim } from './sim';
import type { Entity } from './types';

const hero = (sim: Sim, f: number) => {
  const fac = sim.faction(f);
  const h = fac && sim.get(fac.heroId);
  return h && h.respawnAt == null ? h : undefined;
};

export function placementError(sim: Sim, f: number, def: string, tx: number, ty: number): string | null {
  const d = content.buildings[def];
  if (!d || !d.buildable) return 'Невідома споруда';
  const fac = sim.faction(f);
  if (!fac) return 'Немає фракції';
  const [w, h] = d.size;
  if (tx < 1 || ty < 1 || tx + w > sim.world.W - 1 || ty + h > sim.world.H - 1) return 'За межами карти';
  if (!sim.nav.areaFree(tx, ty, w, h)) return 'Місце зайняте';
  // keep 1 free tile ring around the footprint so workers can always reach buildings
  for (const b of sim.buildings) {
    if (b.tx == null) continue;
    if (tx < b.tx + b.w! + 1 && tx + w + 1 > b.tx && ty < b.ty! + b.h! + 1 && ty + h + 1 > b.ty!) return 'Занадто близько до іншої споруди';
  }
  const core = sim.get(sim.world.evil.coreId);
  if (core && Math.hypot(core.x - (tx + w / 2), core.y - (ty + h / 2)) < 16) return 'Проклята земля';
  for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) if (sim.world.terrain[y * sim.world.W + x] === 5) return 'Проклята земля';
  // units standing on the spot
  for (const u of sim.units) if (u.x > tx - 0.2 && u.x < tx + w + 0.2 && u.y > ty - 0.2 && u.y < ty + h + 0.2 && sim.isEnemy(u, { owner: f })) return 'Вороги поруч';
  if (def !== 'townhall') {
    if (d.requires?.building && !sim.townhall(f, false)) return 'Спершу побудуйте ратушу';
    let near = false;
    for (const b of sim.buildings) if (b.owner === f && Math.hypot(b.x - (tx + w / 2), b.y - (ty + h / 2)) < 15) near = true;
    if (!near) return 'Занадто далеко від поселення';
  } else if (sim.townhall(f, false)) return 'Ратуша вже є';
  return null;
}

commandHandlers.heroMove = (sim, c) => {
  const h = hero(sim, c.f);
  if (!h) return;
  h.order = { type: 'move', x: c.x, y: c.y };
  h.targetId = undefined;
  sim.moveTo(h, c.x, c.y);
};
commandHandlers.heroStop = (sim, c) => {
  const h = hero(sim, c.f);
  if (!h) return;
  h.order = { type: 'idle' };
  sim.stop(h);
};
commandHandlers.heroAttack = (sim, c) => {
  const h = hero(sim, c.f), t = sim.get(c.target);
  if (!h || !t || !sim.isEnemy(h, t)) return;
  h.order = { type: 'attack', target: t.id };
};
commandHandlers.heroGather = (sim, c) => {
  const h = hero(sim, c.f), t = sim.get(c.target);
  if (!h || !t || t.kind !== 'resource' || !t.amount) return;
  h.order = { type: 'gather', target: t.id };
};
commandHandlers.heroBuild = (sim, c) => {
  const h = hero(sim, c.f), t = sim.get(c.target);
  if (!h || !t || t.kind !== 'building' || t.owner !== c.f) return;
  if (t.built && !t.upgrading && t.hp >= t.maxHp) return;
  h.order = { type: 'build', target: t.id };
};
commandHandlers.heroInteract = (sim, c) => {
  const h = hero(sim, c.f), t = sim.get(c.target);
  if (!h || !t) return;
  h.order = { type: 'interact', target: t.id };
};
commandHandlers.heroAbility = (sim, c) => {
  const h = hero(sim, c.f);
  if (!h) return;
  useAbility(sim, h, c.x, c.y);
};

export function useAbility(sim: Sim, h: Entity, x: number, y: number) {
  const hd = content.heroes[h.def];
  const ab = hd && content.abilities[hd.ability];
  if (!ab) return;
  if ((h.abilityReadyAt ?? 0) > sim.time) return;
  let cx = h.x, cy = h.y;
  if (ab.effect === 'aoe_target') {
    const d = Math.hypot(x - h.x, y - h.y), r = ab.range ?? 6;
    const k = d > r ? r / d : 1;
    cx = h.x + (x - h.x) * k;
    cy = h.y + (y - h.y) * k;
  }
  const effect = abilityEffects[ab.effect];
  if (!effect) return;
  h.abilityReadyAt = sim.time + ab.cooldown;
  h.swingAt = sim.time;
  h.facing = cx >= h.x ? 1 : -1;
  effect(sim, h, cx, cy, ab.radius, ab.damage + ((h.level ?? 1) - 1) * 2);
  sim.events.emit('ability', { id: h.id, ability: ab.id, x: cx, y: cy, radius: ab.radius });
}

/** Ability effects registry (extensible by mods). */
export const abilityEffects: Record<string, (sim: Sim, src: Entity, x: number, y: number, r: number, dmg: number) => void> = {
  aoe_self: (sim, src, x, y, r, dmg) => areaDamage(sim, src, x, y, r, dmg),
  aoe_target: (sim, src, x, y, r, dmg) => areaDamage(sim, src, x, y, r, dmg),
};

export function areaDamage(sim: Sim, src: Entity, x: number, y: number, r: number, dmg: number) {
  const hits: Entity[] = [];
  sim.spatial.query(x, y, r, (e, d2) => {
    if (e.dead || !sim.isEnemy(src, e)) return;
    if (e.kind === 'building' ? sim.dist({ ...src, x, y, kind: 'prop' } as Entity, e) <= r : d2 <= r * r) hits.push(e);
  });
  for (const e of hits) sim.damage(e, dmg, src.id);
}

commandHandlers.place = (sim, c) => {
  const f = sim.faction(c.f);
  const d = content.buildings[c.def];
  if (!f || !d) return;
  const err = placementError(sim, c.f, c.def, c.x, c.y);
  if (err) return sim.notice(c.f, err, 'error');
  if (!sim.canAfford(f, d.cost)) return sim.notice(c.f, 'Недостатньо ресурсів', 'error');
  sim.pay(f, d.cost);
  const b = sim.spawnBuilding(c.def, c.f, c.x, c.y, false, { paid: { ...d.cost } });
  // without any villagers the hero is the only builder: send an idle hero to help
  const h = hero(sim, c.f);
  if (h && (!h.order || h.order.type === 'idle' || h.order.type === 'move') && !sim.units.some((u) => u.owner === c.f && u.def === 'villager')) h.order = { type: 'build', target: b.id };
};
commandHandlers.cancel = (sim, c) => {
  const b = sim.get(c.id);
  const f = sim.faction(c.f);
  if (!b || !f || b.owner !== c.f || b.kind !== 'building') return;
  if (b.built && b.upgrading) {
    // cancel town hall upgrade
    const cost = content.buildings[b.def].upgrade!.cost;
    for (const k of Object.keys(cost) as ResKey[]) sim.gain(f, k, Math.floor((cost[k] ?? 0) * content.balance.cancelRefund));
    b.upgrading = false;
    b.level2Progress = 0;
    return;
  }
  if (b.built) return;
  for (const k of Object.keys(b.paid ?? {}) as ResKey[]) sim.gain(f, k, Math.floor((b.paid![k] ?? 0) * content.balance.cancelRefund));
  sim.remove(b);
  sim.events.emit('death', { id: b.id, def: b.def, x: b.x, y: b.y, owner: b.owner, kind: 'building' });
};
commandHandlers.demolish = (sim, c) => {
  const b = sim.get(c.id);
  if (!b || b.owner !== c.f || b.kind !== 'building' || !b.built) return;
  sim.kill(b);
};
commandHandlers.upgrade = (sim, c) => {
  const b = sim.get(c.id), f = sim.faction(c.f);
  if (!b || !f || b.owner !== c.f || b.def !== 'townhall' || !b.built || b.upgrading || (b.level ?? 1) >= 2) return;
  const up = content.buildings.townhall.upgrade!;
  if (!sim.canAfford(f, up.cost)) return sim.notice(c.f, 'Недостатньо ресурсів для покращення', 'error');
  sim.pay(f, up.cost);
  b.upgrading = true;
  b.level2Progress = 0;
};
commandHandlers.train = (sim, c) => {
  const b = sim.get(c.id), f = sim.faction(c.f);
  if (!b || !f || b.owner !== c.f || b.def !== 'barracks' || !b.built) return;
  if ((b.trainQueue ?? 0) >= 5) return;
  if (!sim.canAfford(f, content.balance.soldier.cost)) return sim.notice(c.f, 'Потрібно 10 дерева', 'error');
  sim.pay(f, content.balance.soldier.cost);
  b.trainQueue = (b.trainQueue ?? 0) + 1;
};
commandHandlers.research = (sim, c) => {
  const b = sim.get(c.id), f = sim.faction(c.f);
  if (!b || !f || b.owner !== c.f || b.def !== 'barracks' || !b.built || f.militia || b.researching) return;
  const th = sim.townhall(c.f);
  if (!th || (th.level ?? 1) < 2) return sim.notice(c.f, 'Потрібна ратуша 2 рівня', 'error');
  if (!sim.canAfford(f, content.balance.militia.cost)) return sim.notice(c.f, 'Недостатньо ресурсів', 'error');
  sim.pay(f, content.balance.militia.cost);
  b.researching = { tech: 'militia', doneAt: sim.time + 30 };
};
commandHandlers.jobs = (sim, c) => {
  const f = sim.faction(c.f);
  if (!f || !(c.role in f.jobs)) return;
  f.jobs[c.role as keyof typeof f.jobs] = Math.max(0, Math.min(20, Math.round(c.count)));
};
commandHandlers.mark = (sim, c) => {
  const r = sim.get(c.id);
  if (!r || r.kind !== 'resource' || r.res !== 'stone') return;
  r.marked = (r.marked ?? []).filter((x) => x !== c.f);
  if (c.on) r.marked.push(c.f);
  const f = sim.faction(c.f);
  if (f && c.on && f.jobs.miner === 0) f.jobs.miner = 1;
};
commandHandlers.army = (sim, c) => {
  const f = sim.faction(c.f);
  if (!f) return;
  f.army = { order: c.order, target: c.target, x: c.x, y: c.y };
  for (const u of sim.units) if (u.owner === c.f && u.def === 'soldier') { u.targetId = undefined; sim.stop(u); }
};
commandHandlers.transfer = (sim, c) => {
  const from = sim.faction(c.f), to = sim.faction(c.to);
  if (!from || !to || from === to || !sim.isAlly(c.f, c.to)) return;
  const amount = Math.floor(Math.min(c.amount, from.res[c.res as ResKey]));
  if (!(amount > 0)) return;
  // single atomic move: no duplication possible
  from.res[c.res as ResKey] -= amount;
  to.res[c.res as ResKey] += amount;
  sim.events.emit('transfer', { from: c.f, to: c.to, res: c.res, amount });
  sim.notice(c.to, `${from.name} передає вам ${amount} ${resName(c.res)}`, 'good');
};
commandHandlers.ping = (sim, c) => {
  const f = sim.faction(c.f);
  if (!f) return;
  for (const o of sim.world.factions) if (sim.isAlly(o.id, c.f)) o.ping = { x: c.x, y: c.y, at: sim.time };
  sim.events.emit('ping', { f: c.f, x: c.x, y: c.y });
};

export const resName = (r: string) => ({ wood: 'дерева', stone: 'каменю', food: 'їжі' })[r] ?? r;
