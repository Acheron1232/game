import { content } from '../../engine/registry';
import type { Sim } from '../sim';
import type { Entity } from '../types';

/** Swing duration used for both simulation timing and animation playback. */
export function swingDuration(sim: Sim, e: Entity) {
  return Math.min(0.75, sim.cooldownOf(e) * 0.8);
}

/** Nearest enemy within radius; units preferred over buildings. */
export function findEnemy(sim: Sim, e: Entity, radius: number, filter?: (t: Entity) => boolean): Entity | undefined {
  let best: Entity | undefined, bestScore = Infinity;
  sim.spatial.query(e.x, e.y, radius, (t) => {
    if (t === e || t.dead || !sim.isEnemy(e, t)) return;
    if (t.kind === 'building' && !t.built && t.owner !== 99 && (t.progress ?? 0) < 0.05) return;
    if (filter && !filter(t)) return;
    const d = sim.dist(e, t);
    if (d > radius) return;
    const score = d + (t.kind === 'building' ? 3 : 0);
    if (score < bestScore) { bestScore = score; best = t; }
  });
  return best;
}

export function inRange(sim: Sim, e: Entity, t: Entity) {
  const r = e.kind === 'building' ? sim.bDef(e).attack?.range ?? 0 : sim.uDef(e).range;
  return sim.dist(e, t) <= r + 0.05;
}

/** Engage target: approach, then swing on cooldown. Returns false if target invalid. */
export function engage(sim: Sim, e: Entity, t: Entity | undefined): boolean {
  if (!t || t.dead || t.respawnAt != null) return false;
  if (inRange(sim, e, t)) {
    if (e.goalX != null) sim.stop(e);
    e.state = 'attack';
    e.targetId = t.id;
    if (Math.abs(t.x - e.x) > 0.05) e.facing = t.x > e.x ? 1 : -1;
    if ((e.attackCd ?? 0) <= sim.time && e.hitAt == null) startSwing(sim, e, t);
  } else {
    const [ax, ay] = sim.approachPoint(e, t);
    sim.moveTo(e, ax, ay);
    // chase moving targets
    if (t.kind === 'unit' && e.goalX != null && Math.hypot(e.goalX - t.x, e.goalY! - t.y) > 1) e.repathAt = Math.min(e.repathAt ?? 0, sim.time + 0.4);
    e.targetId = t.id;
  }
  return true;
}

export function startSwing(sim: Sim, e: Entity, t: Entity) {
  const cd = sim.cooldownOf(e);
  const dur = swingDuration(sim, e);
  const hf = e.kind === 'unit' ? sim.uDef(e).hitFrame ?? 0.6 : 0.5;
  e.swingAt = sim.time;
  e.hitAt = sim.time + dur * hf;
  e.attackCd = sim.time + cd;
  e.targetId = t.id;
  sim.events.emit('swing', { id: e.id, target: t.id });
}

/** Resolves pending hits, tower attacks and projectiles. */
export function combatSystem(sim: Sim, dt: number) {
  const t = sim.time;
  for (const e of sim.units) {
    if (e.hitAt == null || t < e.hitAt) continue;
    e.hitAt = undefined;
    const target = sim.get(e.targetId);
    if (!target || target.respawnAt != null) continue;
    const d = sim.uDef(e);
    if (d.projectile) fire(sim, e, target, d.projectile, sim.damageOf(e), d.splash ?? 0);
    else if (sim.dist(e, target) <= d.range + 0.6) sim.damage(target, sim.damageOf(e), e.id);
  }
  // towers
  for (const b of sim.buildings) {
    const atk = b.built && sim.bDef(b)?.attack;
    if (!atk) continue;
    if ((b.attackCd ?? 0) > t) continue;
    let target = sim.get(b.targetId);
    if (!target || target.respawnAt != null || sim.dist(b, target) > atk.range) target = findEnemy(sim, b, atk.range, (x) => x.kind === 'unit');
    if (!target) { b.targetId = undefined; continue; }
    b.targetId = target.id;
    b.attackCd = t + sim.cooldownOf(b);
    fire(sim, b, target, atk.projectile, atk.damage, 0);
  }
  // projectiles
  for (const p of sim.world.entities.values()) {
    if (p.kind !== 'projectile' || p.dead) continue;
    const tgt = sim.get(p.targetId);
    if (tgt && tgt.respawnAt == null) { p.toX = tgt.x; p.toY = tgt.y; }
    const dx = p.toX! - p.x, dy = p.toY! - p.y, dist = Math.hypot(dx, dy);
    const step = p.speed! * dt;
    if (dist <= step + 0.15 || t - (p.born ?? t) > 4) {
      p.x = p.toX!; p.y = p.toY!;
      const src = sim.get(p.src) ?? ({ owner: p.owner } as Entity);
      if (p.splash) {
        const hits: Entity[] = [];
        sim.spatial.query(p.x, p.y, p.splash, (e, d2) => { if (!e.dead && sim.isEnemy(src, e) && (e.kind === 'building' ? sim.dist({ ...p, kind: 'prop' } as Entity, e) <= p.splash! : d2 <= p.splash! * p.splash!)) hits.push(e); });
        for (const h of hits) sim.damage(h, h === tgt ? p.damage! : p.damage! * 0.6, p.src);
      } else if (tgt) sim.damage(tgt, p.damage!, p.src);
      sim.events.emit('impact', { x: p.x, y: p.y, ptype: p.ptype!, splash: p.splash ?? 0 });
      sim.remove(p);
      continue;
    }
    p.x += (dx / dist) * step;
    p.y += (dy / dist) * step;
    p.vx = dx / dist; p.vy = dy / dist;
  }
}

export function fire(sim: Sim, src: Entity, target: Entity, ptype: 'arrow' | 'orb', damage: number, splash: number) {
  const p: Entity = {
    id: sim.nextId(), kind: 'projectile', def: ptype, owner: src.owner, x: src.x, y: src.y, hp: 1, maxHp: 1,
    src: src.id, targetId: target.id, speed: ptype === 'arrow' ? 15 : 10, damage, splash, ptype,
    fromX: src.x, fromY: src.y, toX: target.x, toY: target.y, born: sim.time, variant: src.kind === 'building' ? 1 : 0,
  };
  sim.world.entities.set(p.id, p);
  sim.events.emit('shoot', { id: src.id, projectile: p.id, ptype });
}

export const isMelee = (sim: Sim, e: Entity) => !content.unit(e.def)?.projectile;
