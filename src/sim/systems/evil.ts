/**
 * World evil controller (second AI type). Separate state from human economies:
 * graveyard points, base level by active time, garrison cap, round-robin wave queue with pressure limits.
 */
import { content } from '../../engine/registry';
import type { Sim } from '../sim';
import { EVIL, type Entity, type Faction, type Wave } from '../types';

export function evilLevelAt(timeSec: number) {
  const [l2, l3] = content.balance.evil.levelMinutes;
  return timeSec < l2 * 60 ? 1 : timeSec < l3 * 60 ? 2 : 3;
}

/** Budget for the n-th wave (0-based) against a faction, per the design table. */
export function waveBudget(n: number, calm: boolean) {
  const e = content.balance.evil;
  let b = e.budgets[Math.min(n, e.budgets.length - 1)];
  if (calm) b = Math.max(2, Math.floor(b * e.calmFactor));
  return b;
}

/** Composition: first wave is skeletons only; zombies need base level 2, at most 2 per wave. */
export function waveComposition(n: number, budget: number, level: number) {
  let zombies = 0;
  if (n >= 2 && level >= 2) zombies = Math.min(2, Math.floor(Math.max(0, budget - 3) / 2));
  const skeletons = budget - zombies * 2;
  return { skeletons, zombies };
}

export function evilSystem(sim: Sim, dt: number) {
  const w = sim.world;
  const ev = w.evil;
  const E = content.balance.evil;
  const t = w.time;
  if (ev.destroyed) {
    for (const u of sim.units) if (u.owner === EVIL && u.dissolveAt != null && t >= u.dissolveAt) dissolve(sim, u);
    return;
  }
  const core = sim.get(ev.coreId);
  const yard = sim.get(ev.graveyardId);

  // base level grows with active time (cosmetic + garrison cap + allowed wave content)
  const lvl = evilLevelAt(t);
  if (lvl !== ev.level) {
    ev.level = lvl;
    if (core) { core.level = lvl; sim.events.emit('upgraded', { id: core.id, def: core.def, level: lvl }); }
    sim.events.emit('evilLevel', { level: lvl });
    sim.notice('all', `Темне осердя посилюється: рівень ${lvl}`, 'warn');
  }

  // graveyard production
  if (yard) {
    ev.points = Math.min(E.maxPoints, ev.points + dt / E.pointSeconds);
  } else if (core && ev.graveyardRestoreAt > 0 && t >= ev.graveyardRestoreAt) {
    const g = sim.spawnBuilding('graveyard', EVIL, Math.round(ev.graveyardPos.x - 2), Math.round(ev.graveyardPos.y - 1.5), true);
    ev.graveyardId = g.id;
    ev.graveyardRestoreAt = 0;
    sim.notice('all', 'Осердя відродило кладовище', 'warn');
  }

  // garrison upkeep: refill from points only, up to the level cap
  const cap = E.garrisonCap[lvl - 1];
  const garrisonPts = garrisonPoints(sim);
  if (yard && t >= ev.nextSpawnAt && garrisonPts < cap) {
    const wantZombie = lvl >= 2 && cap - garrisonPts >= 2 && ev.points >= 2 && sim.rng.chance(0.35);
    const def = wantZombie ? 'zombie' : 'skeleton';
    const cost = content.units[def].points ?? 1;
    if (ev.points >= cost) {
      ev.points -= cost;
      spawnUndead(sim, def, { garrison: true });
      ev.nextSpawnAt = t + 3;
    }
  }

  manageWaves(sim);
}

function garrisonPoints(sim: Sim) {
  let n = 0;
  for (const u of sim.units) if (u.owner === EVIL && u.garrison) n += sim.uDef(u).points ?? 1;
  return n;
}

function spawnUndead(sim: Sim, def: string, extra: Partial<Entity>) {
  const g = sim.world.evil.graveyardPos;
  // only on free cells next to the graveyard
  const p = sim.nav.nearestWalkable(g.x + sim.rng.range(-2.5, 2.5), g.y + 2 + sim.rng.range(0, 1.5), 6) ?? [g.x, g.y + 3];
  return sim.spawnUnit(def, EVIL, p[0], p[1], extra);
}

function eligible(sim: Sim, f: Faction, ignoreTimers = false) {
  const E = content.balance.evil;
  const t = sim.time;
  if (!sim.townhall(f.id, false)) return false; // no settlement to attack
  if (t < f.protectedUntil) return false;
  if (sim.world.evil.waves.some((w) => w.faction === f.id)) return false; // max one attack per faction
  if (ignoreTimers) return true;
  if (t - f.lastWaveSentAt < E.sameFactionGap) return false;
  if (t - f.lastWaveEndedAt < E.afterWaveGap) return false;
  return true;
}

function manageWaves(sim: Sim) {
  const w = sim.world;
  const ev = w.evil;
  const E = content.balance.evil;
  const t = w.time;

  // ---- update active waves
  for (const wave of [...ev.waves]) {
    wave.units = wave.units.filter((id) => sim.get(id));
    if (wave.units.length === 0) { endWave(sim, wave); continue; }
    const th = sim.townhall(wave.faction, false);
    if (wave.state === 'march') {
      // progress tracking (stuck detection)
      if (th) {
        let best = 1e9;
        for (const id of wave.units) { const u = sim.get(id)!; best = Math.min(best, Math.hypot(u.x - th.x, u.y - th.y)); }
        if (best < wave.bestDist - 1) { wave.bestDist = best; wave.lastProgressAt = t; }
      }
      if (t - wave.sentAt >= E.marchTime) {
        if (t - wave.lastProgressAt > 60) {
          // stuck without progress: dissolve, points are lost
          for (const id of wave.units) dissolve(sim, sim.get(id)!);
          endWave(sim, wave);
        } else wave.state = 'retreat';
      }
    } else {
      // returning units take free garrison slots, the rest dissipate without refund
      const g = ev.graveyardPos;
      for (const id of [...wave.units]) {
        const u = sim.get(id)!;
        if (Math.hypot(u.x - g.x, u.y - (g.y + 2.5)) < 3.5 || t - wave.sentAt > E.marchTime * 2) {
          const pts = sim.uDef(u).points ?? 1;
          if (garrisonPoints(sim) + pts <= E.garrisonCap[ev.level - 1]) { u.garrison = true; u.waveId = undefined; }
          else dissolve(sim, u);
          wave.units = wave.units.filter((x) => x !== id);
        }
      }
      if (wave.units.length === 0) endWave(sim, wave);
    }
  }

  // ---- grace period: no waves in the first minutes
  if (t < E.graceMinutes * 60 - E.warningSeconds) return;

  // ---- pending (warned) wave: dispatch when allowed
  if (ev.pending) {
    const p = ev.pending;
    const f = sim.faction(p.faction);
    if (!f || !eligible(sim, f, true)) { ev.pending = null; return; }
    if (t < p.at) return;
    if (ev.waves.length >= E.maxActive || t - ev.lastDispatchAt < E.globalGap) return;
    const comp = waveComposition(f.waveCount, p.budget, ev.level);
    const cost = comp.skeletons + comp.zombies * 2;
    if (ev.points < cost || !sim.get(ev.graveyardId)) return; // wait for points; missed waves don't accumulate
    const th = sim.townhall(f.id, false)!;
    const g = ev.graveyardPos;
    const probe = sim.nav.findPath(g.x, g.y + 3, th.x, th.y + th.h! / 2 + 1);
    if (!probe.length) return; // no route: wait
    ev.points -= cost;
    const wave: Wave = { id: ++ev.waveSeq, faction: f.id, units: [], sentAt: t, state: 'march', bestDist: 1e9, lastProgressAt: t };
    for (let i = 0; i < comp.skeletons; i++) wave.units.push(spawnUndead(sim, 'skeleton', { waveId: wave.id }).id);
    for (let i = 0; i < comp.zombies; i++) wave.units.push(spawnUndead(sim, 'zombie', { waveId: wave.id }).id);
    ev.waves.push(wave);
    ev.lastDispatchAt = t;
    ev.pending = null;
    f.waveCount++;
    f.lastWaveSentAt = t;
    sim.events.emit('waveSent', { faction: f.id, wave: wave.id, size: wave.units.length });
    for (const o of w.factions) if (sim.isAlly(o.id, f.id)) sim.notice(o.id, o.id === f.id ? 'Нежить вирушила на ваше поселення!' : `Нежить атакує союзника: ${f.name}`, 'warn');
    return;
  }

  // ---- choose the next target round-robin; ineligible factions are skipped without debt
  if (ev.waves.length >= E.maxActive) return;
  const n = w.factions.length;
  for (let k = 0; k < n; k++) {
    const idx = (ev.queuePos + k) % n;
    const f = w.factions[idx];
    // schedule so that the dispatch time itself respects all gaps
    const readyAt = Math.max(f.lastWaveSentAt + E.sameFactionGap, f.lastWaveEndedAt + E.afterWaveGap, ev.lastDispatchAt + E.globalGap);
    if (!eligible(sim, f, true) || readyAt > t + E.warningSeconds) continue;
    const at = Math.max(t + E.warningSeconds, readyAt, E.graceMinutes * 60);
    ev.pending = { faction: f.id, at, budget: f.waveCount === 0 ? Math.min(3, waveBudget(0, w.settings.calm)) : waveBudget(f.waveCount, w.settings.calm), warnedAt: t };
    ev.queuePos = (idx + 1) % n;
    const g = ev.graveyardPos;
    for (const o of w.factions) if (sim.isAlly(o.id, f.id)) sim.events.emit('waveWarning', { faction: f.id, at, fromX: g.x, fromY: g.y });
    sim.notice(f.id, `Нежить готує напад! Через ${Math.round(at - t)} с`, 'warn');
    return;
  }
}

function endWave(sim: Sim, wave: Wave) {
  const ev = sim.world.evil;
  ev.waves = ev.waves.filter((w) => w !== wave);
  const f = sim.faction(wave.faction);
  if (f) f.lastWaveEndedAt = sim.time;
  sim.events.emit('waveEnded', { faction: wave.faction, wave: wave.id });
}

function dissolve(sim: Sim, u: Entity) {
  sim.remove(u);
  sim.events.emit('death', { id: u.id, def: u.def, x: u.x, y: u.y, owner: u.owner, kind: 'unit', killer: -2 });
}

export function registerEvilHooks(sim: Sim) {
  sim.deathHooks.evil = (e) => {
    const ev = sim.world.evil;
    if (e.id === ev.graveyardId) {
      ev.graveyardId = -1;
      ev.points = 0; // reserve is lost with the graveyard
      if (sim.get(ev.coreId)) ev.graveyardRestoreAt = sim.time + content.balance.evil.graveyardRestore;
      sim.notice('all', 'Кладовище зруйновано! Осердя відновить його через 5 хвилин.', 'good');
    }
    if (e.id === ev.coreId) {
      ev.destroyed = true;
      ev.destroyedAt = sim.time;
      ev.pending = null;
      ev.points = 0;
      sim.world.result = { type: 'evilDestroyed', at: sim.time };
      const yard = sim.get(ev.graveyardId);
      if (yard) sim.kill(yard);
      for (const u of sim.units) if (u.owner === EVIL) u.dissolveAt = sim.time + sim.rng.range(0.5, content.balance.evil.dissolveSeconds);
      ev.waves = [];
      sim.events.emit('evilDestroyed', {});
      sim.notice('all', 'Світове зло знищено!', 'good');
    }
    if (e.owner === EVIL && e.kind === 'unit' && e.waveId != null) {
      const wave = ev.waves.find((w) => w.id === e.waveId);
      if (wave) wave.units = wave.units.filter((id) => id !== e.id);
    }
  };
}
