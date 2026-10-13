/**
 * Public runtime API (window.game). Used by the dev console, the live inspector and mods.
 * A mod is an ES module exporting `default (api) => void` (or `register(api)`); it can patch content,
 * add/replace simulation systems, register commands, abilities, sounds and listen to events —
 * all while a session is running.
 */
import { sfx } from '../audio/sfx';
import { content } from '../engine/registry';
import type { Game } from '../game';
import { assets } from '../r3d/textures';
import { TS } from '../r3d/camera3d';
import { registerCharacter } from '../r3d/characters';
import { abilityEffects } from '../sim/commands';
import { maps } from '../sim/map';
import { commandHandlers, type SystemFn } from '../sim/sim';
import { EVIL, NEUTRAL, type SimEvents } from '../sim/types';

export interface ModInfo {
  name: string;
  source: string;
  at: number;
  dispose?: () => void;
}

export function createApi(game: Game, hooks: { toLobby(): void }) {
  const loaded: ModInfo[] = [];
  const api = {
    get sim() { return game.sim; },
    get world() { return game.sim.world; },
    get view() { return game.view; },
    get input() { return game.input; },
    get hud() { return game.hud; },
    get me() { return game.faction; },
    get hero() { return game.hero; },
    content,
    defs: content.data,
    maps,
    assets,
    registerCharacter,
    sfx,
    EVIL, NEUTRAL, TS,
    /** set any definition value live: patch('units.skeleton.damage', 8) */
    patch: (path: string, value: unknown) => content.patch(path, value),
    get: (path: string) => content.get(path),
    spawn(def: string, x?: number, y?: number, owner?: number) {
      const h = game.hero;
      const px = x ?? (game.input.world.x / TS), py = y ?? (game.input.world.y / TS);
      if (content.buildings[def]) return game.sim.spawnBuilding(def, owner ?? game.localFaction, Math.round(px), Math.round(py), true);
      if (content.props[def]) return game.sim.spawnResource(def, px, py);
      return game.sim.spawnUnit(def, owner ?? (def === 'skeleton' || def === 'zombie' ? EVIL : game.localFaction), px ?? h?.x, py ?? h?.y);
    },
    give(res: 'wood' | 'stone' | 'food' | 'all', n = 100, f = game.localFaction) {
      const fac = game.sim.faction(f)!;
      for (const r of res === 'all' ? (['wood', 'stone', 'food'] as const) : [res]) fac.res[r] += n;
      return fac.res;
    },
    kill(id: number) { const e = game.sim.get(id); if (e) game.sim.kill(e); },
    selected() { return game.sim.get(game.input.selected); },
    time: {
      speed(n: number) { game.sim.speed = n; },
      pause(on = !game.sim.paused) { game.sim.paused = on; },
      /** fast-forward the simulation by N seconds */
      skip(seconds: number) { const n = Math.round(seconds / game.sim.dt); for (let i = 0; i < n; i++) game.sim.step(); },
      setDay(t01: number) { game.view.dayOffset = t01 - (game.sim.world.time / content.balance.dayLength) % 1; },
    },
    evil: {
      get state() { return game.sim.world.evil; },
      points(n: number) { game.sim.world.evil.points = n; },
      /** schedule a wave against a faction right now (testing) */
      forceWave(f = game.localFaction) {
        const ev = game.sim.world.evil;
        ev.pending = { faction: f, at: game.sim.time + 5, budget: Math.max(3, content.balance.evil.budgets[Math.min(4, game.sim.faction(f)!.waveCount)]), warnedAt: game.sim.time };
        ev.points = Math.max(ev.points, 10);
        game.sim.faction(f)!.lastWaveSentAt = -1e9;
        game.sim.faction(f)!.lastWaveEndedAt = -1e9;
        ev.lastDispatchAt = -1e9;
        game.sim.world.time = Math.max(game.sim.world.time, content.balance.evil.graceMinutes * 60);
      },
    },
    systems: {
      list: () => game.sim.systems.map((s) => ({ name: s.name, enabled: s.enabled, ms: +s.ms.toFixed(3) })),
      add: (name: string, fn: SystemFn, opts?: { before?: string; after?: string }) => game.sim.addSystem(name, fn, opts),
      replace: (name: string, fn: SystemFn) => game.sim.replaceSystem(name, fn),
      remove: (name: string) => game.sim.removeSystem(name),
      enable: (name: string, on = true) => game.sim.setSystemEnabled(name, on),
    },
    commands: commandHandlers,
    abilities: abilityEffects,
    send: (cmd: any) => game.sim.send({ f: game.localFaction, ...cmd }),
    on<K extends keyof SimEvents>(type: K, fn: (p: SimEvents[K]) => void) { return game.sim.events.on(type, fn); },
    notice: (text: string, kind: 'info' | 'warn' | 'error' | 'good' = 'info') => game.sim.notice(game.localFaction, text, kind),
    save: (slot?: string) => game.save(slot),
    load: (slot?: string) => game.loadSlot(slot),
    toLobby: () => hooks.toLobby(),
    mods: {
      loaded,
      /** load a mod from a URL or from source code */
      async load(src: string, name?: string) {
        let url = src;
        const isCode = /[\n;(]/.test(src) && !/^(https?:|\/|\.)/.test(src);
        if (isCode) url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        const mod = await import(/* @vite-ignore */ url + (isCode ? '' : (url.includes('?') ? '&' : '?') + 't=' + Date.now()));
        const fn = mod.default ?? mod.register;
        if (typeof fn !== 'function') throw new Error('Mod must export default function(api) or register(api)');
        const dispose = await fn(api);
        const info: ModInfo = { name: name ?? mod.name ?? src.slice(0, 40), source: isCode ? '(inline)' : src, at: Date.now(), dispose: typeof dispose === 'function' ? dispose : undefined };
        loaded.push(info);
        game.sim.notice(game.localFaction, `Мод завантажено: ${info.name}`, 'good');
        return info;
      },
      unload(name: string) {
        const i = loaded.findIndex((m) => m.name === name);
        if (i >= 0) { loaded[i].dispose?.(); loaded.splice(i, 1); }
      },
    },
    console: null as any,
    inspector: null as any,
    help() {
      return `game.patch('units.soldier.damage', 9)   — змінити будь-яке значення
game.give('all', 500)                    — ресурси
game.spawn('skeleton')                   — створити під курсором (юніт/будівлю/проп)
game.time.speed(4) / game.time.skip(600) — швидкість / перемотка
game.evil.forceWave()                    — хвиля зараз
game.systems.list() / add / replace      — системи симуляції
game.on('death', e => ...)               — події
game.mods.load('/mods/example-mod.js')   — мод (або перетягніть .js у вікно)
game.defs                                — всі визначення (дані)`;
    },
  };
  return api;
}

export type GameApi = ReturnType<typeof createApi>;
