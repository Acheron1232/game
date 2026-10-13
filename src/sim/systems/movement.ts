import type { Sim } from '../sim';
import type { Entity } from '../types';

/** Path following + soft separation between units. */
export function movementSystem(sim: Sim, dt: number) {
  const t = sim.time;
  for (const e of sim.units) {
    if (e.goalX == null || e.respawnAt != null) continue;
    const d = sim.uDef(e);
    if (!d) continue;
    if (!e.path || (e.repathAt != null && t > e.repathAt && e.pathI! < e.path.length)) {
      if (!sim.requestPath(e)) continue;
      if (e.path!.length === 0) {
        // no movement possible: we're as close as we can get
        e.status = 'no-path';
        sim.stop(e);
        continue;
      }
    }
    const path = e.path!;
    let i = e.pathI ?? 0;
    // final waypoint is the precise goal instead of a cell center
    let tx = i >= path.length / 2 - 1 && sim.nav.walkable(e.goalX, e.goalY!) ? e.goalX : path[i * 2];
    let ty = i >= path.length / 2 - 1 && sim.nav.walkable(e.goalX, e.goalY!) ? e.goalY! : path[i * 2 + 1];
    let dx = tx - e.x, dy = ty - e.y;
    let dist = Math.hypot(dx, dy);
    let speed = d.speed;
    const f = sim.faction(e.owner);
    if (f?.hungry && e.def === 'villager') speed *= sim.workRate(f);
    let step = speed * dt;
    while (dist <= step && i < path.length / 2 - 1) {
      i++;
      tx = path[i * 2];
      ty = path[i * 2 + 1];
      if (i === path.length / 2 - 1 && sim.nav.walkable(e.goalX, e.goalY!)) { tx = e.goalX; ty = e.goalY!; }
      dx = tx - e.x; dy = ty - e.y; dist = Math.hypot(dx, dy);
    }
    e.pathI = i;
    if (dist <= step) {
      e.x = tx; e.y = ty;
      sim.stop(e);
      e.status = undefined;
      continue;
    }
    const nx = e.x + (dx / dist) * step, ny = e.y + (dy / dist) * step;
    // units caught inside a blocked cell (e.g. a building placed on them) may always walk out
    if (sim.nav.walkable(nx, ny) || !sim.nav.walkable(e.x, e.y)) { e.x = nx; e.y = ny; }
    else if (sim.nav.walkable(nx, e.y)) e.x = nx;
    else if (sim.nav.walkable(e.x, ny)) e.y = ny;
    else e.repathAt = 0;
    if (Math.abs(dx) > 0.05) e.facing = dx > 0 ? 1 : -1;
    e.state = 'move';
    e.lastMoveAt = t;
  }
  separate(sim, dt);
}

function separate(sim: Sim, dt: number) {
  for (const a of sim.units) {
    const ra = sim.uDef(a)?.radius ?? 0.3;
    let px = 0, py = 0;
    sim.spatial.query(a.x, a.y, ra * 2 + 0.5, (b, d2) => {
      if (b === a || b.kind !== 'unit') return;
      const rb = sim.uDef(b)?.radius ?? 0.3;
      const min = ra + rb;
      if (d2 >= min * min) return;
      const d = Math.sqrt(d2) || 0.01;
      const push = (min - d) / min;
      // deterministic jitter for perfectly overlapping units
      const ux = d2 < 1e-6 ? Math.cos(a.id) : (a.x - b.x) / d;
      const uy = d2 < 1e-6 ? Math.sin(a.id) : (a.y - b.y) / d;
      // moving units yield less to idle/working ones
      const w = a.state === 'move' && b.state !== 'move' ? 0.4 : 1;
      px += ux * push * w;
      py += uy * push * w;
    }, 1);
    if (px || py) {
      const k = Math.min(1, dt * 6);
      const nx = a.x + px * k, ny = a.y + py * k;
      if (sim.nav.walkable(nx, ny)) { a.x = nx; a.y = ny; }
    }
  }
}

export function arrived(e: Entity) {
  return e.goalX == null;
}
