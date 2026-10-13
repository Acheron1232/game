/**
 * Authoritative simulation. Runs at a fixed tick rate, owns the World (plain data) and executes
 * an ordered, hot-swappable pipeline of systems. Clients (players, bots, network peers) only send
 * Commands; the simulation validates and applies them.
 */
import { EventBus } from '../engine/events';
import { content } from '../engine/registry';
import { Rng } from '../engine/rng';
import type { BuildingDef, Cost, HeroDef, ResKey, UnitDef } from '../content/types';
import { Nav } from './nav';
import { SpatialHash } from './spatial';
import { EVIL, NEUTRAL, type Command, type Entity, type Faction, type SimEvents, type World } from './types';

export type SystemFn = (sim: Sim, dt: number) => void;
export interface SystemEntry {
  name: string;
  fn: SystemFn;
  enabled: boolean;
  /** accumulated ms spent, for the profiler overlay */
  ms: number;
}

export class Sim {
  readonly events = new EventBus<SimEvents>();
  readonly spatial: SpatialHash;
  readonly rng: Rng;
  systems: SystemEntry[] = [];
  private queue: { cmd: Command; ext: boolean }[] = [];
  /** network: guests route player commands to the host instead of the local queue */
  sendHook: ((cmd: Command) => void) | null = null;
  /** network: host broadcasts the external commands applied in each tick */
  onStep: ((tick: number, cmds: Command[]) => void) | null = null;
  /** network guest: the simulation is advanced by the host's tick stream, not by wall time */
  remote = false;
  remoteAlpha = 1;
  /** commands executed this tick (for replays / network relay) */
  readonly log: { tick: number; cmd: Command }[] = [];
  paused = false;
  speed = 1;
  private acc = 0;
  readonly dt: number;
  /** live entity arrays rebuilt each tick */
  units: Entity[] = [];
  buildings: Entity[] = [];
  private pathBudget = 0;

  constructor(readonly world: World, readonly nav: Nav) {
    this.spatial = new SpatialHash(world.W, world.H, 4);
    this.rng = new Rng(world.rng);
    this.dt = 1 / content.balance.tickRate;
    this.rebuildIndex();
  }

  get defs() {
    return content;
  }
  get time() {
    return this.world.time;
  }

  // ------------------------------------------------------------------ pipeline
  addSystem(name: string, fn: SystemFn, opts: { before?: string; after?: string } = {}) {
    this.removeSystem(name);
    const entry: SystemEntry = { name, fn, enabled: true, ms: 0 };
    const idx = opts.before ? this.systems.findIndex((s) => s.name === opts.before) : opts.after ? this.systems.findIndex((s) => s.name === opts.after) + 1 : -1;
    if (idx >= 0) this.systems.splice(idx, 0, entry);
    else this.systems.push(entry);
  }
  /** Swap the implementation of a running system (used by HMR and mods). State is untouched. */
  replaceSystem(name: string, fn: SystemFn) {
    const s = this.systems.find((x) => x.name === name);
    if (s) s.fn = fn;
    else this.addSystem(name, fn);
  }
  removeSystem(name: string) {
    this.systems = this.systems.filter((s) => s.name !== name);
  }
  setSystemEnabled(name: string, on: boolean) {
    const s = this.systems.find((x) => x.name === name);
    if (s) s.enabled = on;
  }

  // ------------------------------------------------------------------ loop
  /** Advance by real elapsed seconds; returns interpolation alpha for rendering. */
  advance(realDt: number): number {
    if (this.remote) return this.remoteAlpha;
    if (this.paused || !this.world.started) return 1;
    this.acc += Math.min(realDt, 0.25) * this.speed;
    let steps = 0;
    while (this.acc >= this.dt && steps < 40) {
      this.step();
      this.acc -= this.dt;
      steps++;
    }
    if (steps >= 40) this.acc = 0;
    return this.acc / this.dt;
  }

  step() {
    const w = this.world;
    w.tick++;
    w.time += this.dt;
    this.pathBudget = 40;
    this.rebuildIndex();
    // internal (AI) commands first, then player commands — identical order on every peer
    const q = this.queue;
    this.queue = [];
    const ordered = [...q.filter((x) => !x.ext), ...q.filter((x) => x.ext)];
    for (const { cmd: c } of ordered) {
      this.log.push({ tick: w.tick, cmd: c });
      try {
        this.execute(c);
      } catch (e) {
        console.error('[cmd]', c, e);
      }
    }
    if (this.onStep) this.onStep(w.tick, q.filter((x) => x.ext).map((x) => x.cmd));
    if (this.log.length > 5000) this.log.splice(0, this.log.length - 5000);
    for (const s of this.systems) {
      if (!s.enabled) continue;
      const t0 = performance.now();
      try {
        s.fn(this, this.dt);
      } catch (e) {
        console.error(`[system ${s.name}]`, e);
      }
      s.ms = s.ms * 0.95 + (performance.now() - t0) * 0.05;
    }
    this.cleanup();
  }

  /** Player command (external: replicated over the network). */
  send(cmd: Command) {
    if (this.sendHook) return this.sendHook(cmd);
    this.queue.push({ cmd, ext: true });
  }
  /** Internal command issued by simulation code (bots) — runs identically on every peer. */
  enqueue(cmd: Command) {
    this.queue.push({ cmd, ext: false });
  }
  /** Network: apply a player command received from the host. */
  applyRemote(cmd: Command) {
    this.queue.push({ cmd, ext: true });
  }

  /** Cheap state checksum for desync detection. */
  checksum(): number {
    let h = this.world.tick | 0;
    for (const e of this.world.entities.values()) {
      if (e.dead || e.kind === 'prop') continue;
      h = (Math.imul(h, 31) + ((e.x * 64) | 0) + ((e.y * 64) | 0) * 7 + (e.hp | 0) * 13 + e.id) | 0;
    }
    for (const f of this.world.factions) h = (Math.imul(h, 17) + ((f.res.wood + f.res.stone * 3 + f.res.food * 7) | 0)) | 0;
    return h;
  }

  private rebuildIndex() {
    this.spatial.clear();
    this.units.length = 0;
    this.buildings.length = 0;
    for (const e of this.world.entities.values()) {
      if (e.dead) continue;
      if (e.kind === 'unit') {
        if (e.inside != null || e.respawnAt != null) continue;
        this.units.push(e);
        this.spatial.insert(e);
      } else if (e.kind === 'building') {
        this.buildings.push(e);
        this.spatial.insert(e);
      }
    }
  }

  private cleanup() {
    for (const [id, e] of this.world.entities) if (e.dead) this.world.entities.delete(id);
  }

  // ------------------------------------------------------------------ accessors
  get(id: number | undefined | null): Entity | undefined {
    if (id == null) return undefined;
    const e = this.world.entities.get(id);
    return e && !e.dead ? e : undefined;
  }
  faction(id: number): Faction | undefined {
    return this.world.factions.find((f) => f.id === id);
  }
  uDef(e: Entity): UnitDef {
    return content.unit(e.def);
  }
  bDef(e: Entity): BuildingDef {
    return content.buildings[e.def];
  }
  isHero(e: Entity) {
    return !!content.heroes[e.def];
  }
  hasTag(e: Entity, tag: string) {
    return e.kind === 'unit' && !!this.uDef(e)?.tags.includes(tag);
  }

  isEnemy(a: { owner: number }, b: { owner: number }): boolean {
    if (a.owner === b.owner || a.owner === NEUTRAL || b.owner === NEUTRAL) return false;
    if (a.owner === EVIL || b.owner === EVIL) return true;
    const fa = this.faction(a.owner), fb = this.faction(b.owner);
    return !!fa && !!fb && fa.team !== fb.team;
  }
  isAlly(a: number, b: number) {
    const fa = this.faction(a), fb = this.faction(b);
    return !!fa && !!fb && fa.team === fb.team;
  }

  // ------------------------------------------------------------------ stats (live from defs)
  maxHpOf(e: Entity): number {
    if (e.kind === 'building') {
      if (e.def === 'dark_core') return content.balance.evil.coreHp;
      if (e.def === 'graveyard') return content.balance.evil.graveyardHp;
      const d = this.bDef(e);
      return Math.round(d.hp * (e.def === 'townhall' && (e.level ?? 1) >= 2 ? 1.5 : 1));
    }
    const d = this.uDef(e);
    if (!d) return e.maxHp;
    let hp = d.hp;
    if (this.isHero(e)) hp += ((e.level ?? 1) - 1) * (d as HeroDef).levelHp;
    if (e.def === 'soldier' && this.faction(e.owner)?.militia) hp += content.balance.militia.hp;
    return hp;
  }
  damageOf(e: Entity): number {
    if (e.kind === 'building') return this.bDef(e).attack?.damage ?? 0;
    const d = this.uDef(e);
    let dmg = d.damage;
    if (this.isHero(e)) dmg += ((e.level ?? 1) - 1) * (d as HeroDef).levelDamage;
    if (e.def === 'soldier' && this.faction(e.owner)?.militia) dmg += content.balance.militia.damage;
    return dmg;
  }
  cooldownOf(e: Entity): number {
    const base = e.kind === 'building' ? this.bDef(e).attack?.cooldown ?? 1 : this.uDef(e).attackCooldown;
    const f = this.faction(e.owner);
    return f?.hungry && e.def === 'soldier' ? base / (1 - content.balance.hungerPenalty) : base;
  }
  workRate(f: Faction): number {
    return f.hungry ? 1 - content.balance.hungerPenalty : 1;
  }

  // ------------------------------------------------------------------ geometry
  /** Edge-to-edge distance (buildings use their footprint rectangle). */
  dist(a: Entity, b: Entity): number {
    if (b.kind === 'building' && b.tx != null) {
      const dx = Math.max(b.tx - a.x, 0, a.x - (b.tx + b.w!));
      const dy = Math.max(b.ty! - a.y, 0, a.y - (b.ty! + b.h!));
      return Math.hypot(dx, dy) - (a.kind === 'unit' ? this.uDef(a)?.radius ?? 0.3 : 0);
    }
    const ra = a.kind === 'unit' ? this.uDef(a)?.radius ?? 0.3 : 0;
    const rb = b.kind === 'unit' ? this.uDef(b)?.radius ?? 0.3 : b.kind === 'resource' ? 0.5 : 0;
    return Math.hypot(a.x - b.x, a.y - b.y) - ra - rb;
  }

  /** A walkable point adjacent to the target from which `e` can interact. */
  approachPoint(e: Entity, t: Entity): [number, number] {
    if (t.kind === 'building' && t.tx != null) {
      const cx = Math.max(t.tx - 0.5, Math.min(e.x, t.tx + t.w! + 0.5));
      const cy = Math.max(t.ty! - 0.5, Math.min(e.y, t.ty! + t.h! + 0.5));
      return this.nav.nearestWalkable(cx, cy, 6) ?? [t.x, t.y];
    }
    return [t.x, t.y];
  }

  // ------------------------------------------------------------------ movement intents
  moveTo(e: Entity, x: number, y: number) {
    if (e.goalX != null && Math.abs(e.goalX - x) < 0.6 && Math.abs(e.goalY! - y) < 0.6 && e.path) return;
    e.goalX = x;
    e.goalY = y;
    e.path = undefined;
    e.state = 'move';
  }
  stop(e: Entity) {
    e.goalX = e.goalY = undefined;
    e.path = undefined;
    if (e.state === 'move') e.state = 'idle';
  }
  /** Path requests are budgeted per tick to keep frame times flat. */
  requestPath(e: Entity): boolean {
    if (this.pathBudget <= 0) return false;
    this.pathBudget--;
    e.path = this.nav.findPath(e.x, e.y, e.goalX!, e.goalY!);
    e.pathI = 0;
    e.repathAt = this.time + 2.5 + this.rng.next();
    return true;
  }

  // ------------------------------------------------------------------ factions
  townhall(f: number, builtOnly = true): Entity | undefined {
    let best: Entity | undefined;
    for (const b of this.buildings) if (b.owner === f && b.def === 'townhall' && (!builtOnly || b.built)) if (!best || (b.built && !best.built)) best = b;
    return best;
  }
  countBuildings(f: number, def: string, builtOnly = true) {
    let n = 0;
    for (const b of this.buildings) if (b.owner === f && b.def === def && (!builtOnly || b.built)) n++;
    return n;
  }
  population(f: number) {
    let n = 0;
    for (const e of this.world.entities.values()) if (!e.dead && e.kind === 'unit' && e.owner === f && (e.def === 'villager' || e.def === 'soldier')) n++;
    return n;
  }
  housing(f: number) {
    let cap = 0, thCap = 0;
    for (const b of this.buildings) {
      if (b.owner !== f || !b.built) continue;
      const d = this.bDef(b);
      cap += d.housing;
      if (d.popCap) thCap = Math.max(thCap, d.popCap[Math.min(d.popCap.length - 1, (b.level ?? 1) - 1)]);
    }
    return Math.min(cap, thCap, content.balance.maxPopulation);
  }
  canAfford(f: Faction, cost: Cost) {
    return (Object.keys(cost) as ResKey[]).every((k) => f.res[k] >= (cost[k] ?? 0));
  }
  pay(f: Faction, cost: Cost) {
    for (const k of Object.keys(cost) as ResKey[]) f.res[k] -= cost[k] ?? 0;
  }
  gain(f: Faction, res: ResKey, amount: number) {
    f.res[res] += amount;
    if (res === 'wood') f.stats.woodIn += amount;
    if (res === 'stone') f.stats.stoneIn += amount;
    if (res === 'food') f.stats.foodIn += amount;
  }
  /** Fractional production (per-minute rates) accumulates and releases whole units. */
  produce(f: Faction, res: ResKey, amount: number) {
    f.acc[res] += amount;
    if (f.acc[res] >= 1) {
      const whole = Math.floor(f.acc[res]);
      f.acc[res] -= whole;
      this.gain(f, res, whole);
    }
  }
  notice(f: number | 'all', text: string, kind: 'info' | 'warn' | 'error' | 'good' = 'info') {
    this.events.emit('notice', { f, text, kind });
  }

  // ------------------------------------------------------------------ spawning
  nextId() {
    return this.world.nextId++;
  }
  spawnUnit(def: string, owner: number, x: number, y: number, extra: Partial<Entity> = {}): Entity {
    const d = content.unit(def);
    const p = this.nav.walkable(x, y) ? [x, y] : this.nav.nearestWalkable(x, y, 8) ?? [x, y];
    const e: Entity = {
      id: this.nextId(), kind: 'unit', def, owner, x: p[0], y: p[1], hp: d.hp, maxHp: d.hp,
      state: 'idle', facing: this.rng.chance(0.5) ? 1 : -1, attackCd: 0, order: { type: 'idle' }, level: content.heroes[def] ? 1 : undefined, xp: content.heroes[def] ? 0 : undefined, ...extra,
    };
    e.maxHp = this.maxHpOf(e);
    e.hp = Math.min(e.hp, e.maxHp);
    if (extra.hp == null) e.hp = e.maxHp;
    this.world.entities.set(e.id, e);
    this.events.emit('spawn', { id: e.id, def, x: e.x, y: e.y, owner });
    return e;
  }
  spawnBuilding(def: string, owner: number, tx: number, ty: number, built: boolean, extra: Partial<Entity> = {}): Entity {
    const d = content.buildings[def];
    const [w, h] = d.size;
    const e: Entity = {
      id: this.nextId(), kind: 'building', def, owner, x: tx + w / 2, y: ty + h / 2, tx, ty, w, h, hp: 1, maxHp: d.hp,
      built, progress: built ? 1 : 0, level: 1, training: null, trainQueue: 0, attackCd: 0, ...extra,
    };
    e.maxHp = this.maxHpOf(e);
    e.hp = built ? e.maxHp : Math.max(1, Math.round(e.maxHp * 0.1));
    this.nav.block(tx, ty, w, h, true);
    this.world.entities.set(e.id, e);
    // push out units standing on the new footprint
    for (const u of this.world.entities.values()) {
      if (u.kind !== 'unit' || u.dead || u.inside != null) continue;
      if (u.x > tx - 0.3 && u.x < tx + w + 0.3 && u.y > ty - 0.3 && u.y < ty + h + 0.3) {
        const p = this.nav.nearestWalkable(u.x, u.y < ty + h / 2 ? ty - 1 : ty + h, 6);
        if (p) { u.x = p[0]; u.y = p[1]; u.path = undefined; }
      }
    }
    this.events.emit(built ? 'built' : 'placed', { id: e.id, def, owner });
    return e;
  }
  spawnResource(def: string, x: number, y: number, variant?: number): Entity {
    const d = content.props[def];
    const e: Entity = {
      id: this.nextId(), kind: d.res ? 'resource' : 'prop', def, owner: NEUTRAL, x, y, hp: 1, maxHp: 1,
      variant: variant ?? Math.floor(this.rng.next() * d.sprites.length), res: d.res, amount: d.amount, maxAmount: d.amount,
    };
    if (d.blocks) this.nav.block(Math.floor(x), Math.floor(y), 1, 1, true);
    this.world.entities.set(e.id, e);
    return e;
  }

  remove(e: Entity) {
    if (e.dead) return;
    e.dead = true;
    if (e.kind === 'building' && e.tx != null) this.nav.block(e.tx, e.ty!, e.w!, e.h!, false);
    if ((e.kind === 'resource' || e.kind === 'prop') && content.props[e.def]?.blocks) this.nav.block(Math.floor(e.x), Math.floor(e.y), 1, 1, false);
  }

  // ------------------------------------------------------------------ damage
  damage(t: Entity, amount: number, src?: number) {
    if (t.dead || t.respawnAt != null || amount <= 0) return;
    if (this.world.result && t.owner === EVIL && t.kind === 'building') return;
    t.hp -= amount;
    t.lastHurtAt = this.time;
    this.events.emit('hit', { id: t.id, src: src ?? -1, dmg: amount, x: t.x, y: t.y });
    // retaliation memory for AI
    if (src != null && t.kind === 'unit' && t.targetId == null) {
      const s = this.get(src);
      if (s && this.isEnemy(t, s)) t.targetId = s.id;
    }
    if (t.hp <= 0) this.kill(t, src);
  }

  kill(t: Entity, src?: number) {
    if (t.dead) return;
    t.hp = 0;
    // heroes don't die permanently: they wait for respawn
    if (this.isHero(t)) {
      t.respawnAt = this.time + content.balance.heroRespawn;
      t.state = 'dead';
      t.order = { type: 'idle' };
      this.stop(t);
      t.targetId = undefined;
      this.events.emit('death', { id: t.id, def: t.def, x: t.x, y: t.y, owner: t.owner, kind: t.kind, killer: src });
      this.events.emit('heroDied', { id: t.id, owner: t.owner, respawnAt: t.respawnAt });
      return;
    }
    this.remove(t);
    this.events.emit('death', { id: t.id, def: t.def, x: t.x, y: t.y, owner: t.owner, kind: t.kind, killer: src });
    // experience: heroes of the killing side near the victim
    const xp = t.kind === 'unit' ? this.uDef(t)?.xp ?? 0 : t.kind === 'building' ? 30 : 0;
    if (xp > 0) {
      for (const f of this.world.factions) {
        const h = this.get(f.heroId);
        if (!h || h.respawnAt != null || !this.isEnemy(h, t)) continue;
        if (Math.hypot(h.x - t.x, h.y - t.y) <= 10 || src === h.id) this.addXp(h, xp);
      }
    }
    for (const fn of Object.values(this.deathHooks)) fn(t, src);
  }

  /** Systems register reactions to deaths here (evil waves, town hall loss, ...). */
  deathHooks: Record<string, (e: Entity, src?: number) => void> = {};

  addXp(h: Entity, amount: number) {
    const d = content.heroes[h.def];
    if (!d) return;
    h.xp = (h.xp ?? 0) + amount;
    while ((h.level ?? 1) <= d.xpLevels.length && h.xp >= d.xpLevels[(h.level ?? 1) - 1]) {
      h.level = (h.level ?? 1) + 1;
      const old = h.maxHp;
      h.maxHp = this.maxHpOf(h);
      h.hp += h.maxHp - old;
      this.events.emit('levelUp', { id: h.id, level: h.level, owner: h.owner });
      this.notice(h.owner, `Герой досяг рівня ${h.level}!`, 'good');
    }
  }

  // ------------------------------------------------------------------ commands
  private execute(c: Command) {
    const handler = commandHandlers[c.t];
    if (handler) handler(this, c as any);
  }
}

/** Command handlers are a registry too, so mods can add new commands. */
export const commandHandlers: Record<string, (sim: Sim, c: any) => void> = {};

export function newFaction(partial: Partial<Faction> & { id: number; name: string; color: number; team: number }): Faction {
  const s = content.balance.start;
  return {
    kind: 'human', difficulty: 'normal', heroClass: 'hero_warrior', heroId: -1,
    res: { wood: s.wood, stone: s.stone, food: s.food }, acc: { wood: 0, stone: 0, food: 0 },
    start: { x: 0, y: 0 }, jobs: { farmer: 0, lumber: 0, miner: 0, builder: 1 }, army: { order: 'defend' },
    militia: false, firstBuilt: {}, waveCount: 0, lastWaveSentAt: -1e9, lastWaveEndedAt: -1e9, protectedUntil: 0,
    hadTownhall: false, firstRecruitDone: false, hungry: false, stats: { foodIn: 0, foodOut: 0, woodIn: 0, stoneIn: 0 },
    ...partial,
  };
}
