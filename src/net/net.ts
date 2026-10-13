/**
 * Co-op networking (deterministic lockstep through a WebSocket relay).
 * The host's simulation is authoritative: every tick it broadcasts the player commands it applied.
 * Guests run the identical simulation driven by that stream; their own commands go to the host,
 * which validates them. Periodic checksums trigger a full resync on any divergence.
 */
import { content } from '../engine/registry';
import type { Game } from '../game';
import type { SaveFile } from '../sim/save';
import type { Command } from '../sim/types';

export function relayUrl() {
  const p = new URLSearchParams(location.search).get('relay');
  if (p) return p;
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/net';
}

type Handler = (m: any) => void;

export class NetLink {
  private handlers = new Map<string, Set<Handler>>();
  private constructor(private ws: WebSocket) {
    ws.onmessage = (ev) => {
      let m: any;
      try { m = JSON.parse(ev.data); } catch { return; }
      for (const h of this.handlers.get(m.type) ?? []) h(m);
      for (const h of this.handlers.get('*') ?? []) h(m);
    };
    ws.onclose = () => { for (const h of this.handlers.get('close') ?? []) h({}); };
  }
  static connect(url = relayUrl()): Promise<NetLink> {
    return new Promise((res, rej) => {
      const ws = new WebSocket(url);
      ws.onopen = () => res(new NetLink(ws));
      ws.onerror = () => rej(new Error('Не вдалося підключитися до ' + url));
    });
  }
  on(type: string, fn: Handler) {
    let s = this.handlers.get(type);
    if (!s) this.handlers.set(type, (s = new Set()));
    s.add(fn);
    return () => s!.delete(fn);
  }
  send(m: unknown) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }
  close() {
    this.ws.close();
  }
}

export interface GuestInfo {
  id: number;
  name: string;
  heroClass: string;
  color: number;
  faction?: number;
}

// =================================================================== host
export class HostSession {
  readonly guests = new Map<number, GuestInfo>();
  onChange: (() => void) | null = null;
  private game: Game | null = null;
  private unsub: (() => void)[] = [];

  constructor(readonly link: NetLink, readonly room: string) {
    link.on('joined', (m) => { this.guests.set(m.id, { id: m.id, name: m.name, heroClass: 'hero_warrior', color: 0x34c06b }); this.onChange?.(); });
    link.on('left', (m) => {
      const g = this.guests.get(m.id);
      this.guests.delete(m.id);
      if (g && this.game) this.game.sim.notice('all', `${g.name} від'єднався`, 'warn');
      this.onChange?.();
    });
    link.on('from', (m) => this.fromGuest(m.id, m.data));
  }

  static async create(room: string) {
    const link = await NetLink.connect();
    return new Promise<HostSession>((res, rej) => {
      link.on('hosted', () => res(new HostSession(link, room)));
      link.on('error', (m) => rej(new Error(m.error)));
      link.send({ type: 'host', room });
    });
  }

  private fromGuest(id: number, data: any) {
    const g = this.guests.get(id);
    if (!g || !data) return;
    if (data.t === 'hello') {
      g.name = String(data.name ?? g.name).slice(0, 18);
      g.heroClass = content.heroes[data.heroClass] ? data.heroClass : 'hero_warrior';
      g.color = typeof data.color === 'number' ? data.color : g.color;
      this.onChange?.();
    } else if (data.t === 'cmd' && this.game && g.faction != null) {
      const cmd = data.cmd as Command;
      if (!cmd || typeof cmd !== 'object' || (cmd as any).f !== g.faction) return; // a guest may only command its own faction
      this.game.sim.send(cmd);
    } else if (data.t === 'resync' && this.game && g.faction != null) {
      this.link.send({ type: 'to', id, data: { t: 'start', save: this.game.snapshot(), faction: g.faction } });
    }
  }

  /** Called after the host game has been created; sends each guest its faction and the initial state. */
  start(game: Game) {
    this.game = game;
    for (const u of this.unsub) u();
    this.unsub = [];
    this.hook(game);
    const save = game.snapshot();
    for (const g of this.guests.values()) if (g.faction != null) this.link.send({ type: 'to', id: g.id, data: { t: 'start', save, faction: g.faction } });
    this.unsub.push(content.events.on('change', (c) => this.link.send({ type: 'broadcast', data: { t: 'patch', path: c.path, value: c.value } })));
  }

  /** Re-hook after the host reloads its game (save/load). */
  hook(game: Game) {
    this.game = game;
    game.sim.onStep = (tick, cmds) => {
      const msg: any = { t: 'tick', tick, cmds };
      if (tick % 40 === 0) msg.sum = game.sim.checksum();
      this.link.send({ type: 'broadcast', data: msg });
    };
  }

  /** Host loaded a different state: push it to every guest. */
  resyncAll() {
    if (!this.game) return;
    const save = this.game.snapshot();
    for (const g of this.guests.values()) if (g.faction != null) this.link.send({ type: 'to', id: g.id, data: { t: 'start', save, faction: g.faction } });
  }

  close() {
    for (const u of this.unsub) u();
    this.link.close();
  }
}

// =================================================================== guest
export class GuestSession {
  private pending: any[] = [];
  private game: Game | null = null;
  private lastTickAt = 0;
  private resyncing = false;
  onStart: ((save: SaveFile, faction: number) => void) | null = null;
  faction = 0;

  constructor(readonly link: NetLink, readonly room: string) {
    link.on('data', (m) => this.onData(m.data));
    link.on('host-left', () => this.game?.sim.notice('all', 'Хост завершив сесію', 'error'));
  }

  static async join(room: string, name: string) {
    const link = await NetLink.connect();
    return new Promise<GuestSession>((res, rej) => {
      link.on('joined-room', () => res(new GuestSession(link, room)));
      link.on('error', (m) => rej(new Error(m.error)));
      link.send({ type: 'join', room, name });
    });
  }

  hello(name: string, heroClass: string, color: number) {
    this.link.send({ type: 'to-host', data: { t: 'hello', name, heroClass, color } });
  }

  private onData(d: any) {
    if (!d) return;
    if (d.t === 'start') {
      this.pending = [];
      this.resyncing = false;
      this.faction = d.faction;
      if (this.game) {
        this.game.load(d.save, d.faction);
        this.attach(this.game);
      } else this.onStart?.(d.save, d.faction);
    } else if (d.t === 'tick') this.pending.push(d);
    else if (d.t === 'patch') content.patch(d.path, d.value);
  }

  /** Puts the local game into remote-driven mode. */
  attach(game: Game) {
    this.game = game;
    const sim = game.sim;
    sim.remote = true;
    sim.sendHook = (cmd) => this.link.send({ type: 'to-host', data: { t: 'cmd', cmd } });
    game.beforeFrame = () => this.pump();
  }

  private pump() {
    const game = this.game!;
    const sim = game.sim;
    let n = 0;
    while (this.pending.length && n < 60) {
      const m = this.pending[0];
      if (m.tick <= sim.world.tick) { this.pending.shift(); continue; }
      if (m.tick !== sim.world.tick + 1) { this.requestResync(); this.pending.shift(); continue; }
      this.pending.shift();
      for (const c of m.cmds) sim.applyRemote(c);
      sim.step();
      n++;
      this.lastTickAt = performance.now();
      if (m.sum != null && m.sum !== sim.checksum()) {
        console.warn('[net] desync at tick', m.tick);
        this.requestResync();
        break;
      }
    }
    sim.remoteAlpha = Math.min(1, (performance.now() - this.lastTickAt) / (1000 / content.balance.tickRate));
  }

  private requestResync() {
    if (this.resyncing) return;
    this.resyncing = true;
    this.link.send({ type: 'to-host', data: { t: 'resync' } });
  }

  close() {
    this.link.close();
  }
}

export function randomRoom() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}
