/**
 * Content registry: every gameplay number and definition lives here as plain data.
 * Systems read definitions live each tick, so patching a def at runtime (console, inspector,
 * mods, Vite HMR) changes the running game immediately without restarting the session.
 */
import { EventBus } from './events';
import type { BalanceDef, BuildingDef, HeroDef, PropDef, UnitDef, AbilityDef } from '../content/types';

export interface ContentSections {
  units: Record<string, UnitDef>;
  heroes: Record<string, HeroDef>;
  buildings: Record<string, BuildingDef>;
  props: Record<string, PropDef>;
  abilities: Record<string, AbilityDef>;
  balance: BalanceDef;
}

export type ContentEvents = {
  change: { path: string; value: unknown };
  register: { section: keyof ContentSections; id: string };
};

class ContentRegistry {
  readonly data: ContentSections = { units: {}, heroes: {}, buildings: {}, props: {}, abilities: {}, balance: {} as BalanceDef };
  readonly events = new EventBus<ContentEvents>();
  /** Patches applied at runtime (console/inspector/mods). Saved with the game so tweaks survive reloads. */
  readonly overrides: Record<string, unknown> = {};

  /** Register or hot-update a definition. Existing objects are merged in place to keep references valid. */
  register<S extends Exclude<keyof ContentSections, 'balance'>>(section: S, id: string, def: ContentSections[S][string]) {
    const table = this.data[section] as Record<string, any>;
    if (table[id]) deepAssign(table[id], def);
    else table[id] = def;
    this.events.emit('register', { section, id });
  }

  setBalance(b: BalanceDef) {
    deepAssign(this.data.balance, b);
    this.events.emit('register', { section: 'balance', id: '*' });
  }

  get units() { return this.data.units; }
  get heroes() { return this.data.heroes; }
  get buildings() { return this.data.buildings; }
  get props() { return this.data.props; }
  get abilities() { return this.data.abilities; }
  get balance() { return this.data.balance; }

  unit(id: string): UnitDef {
    return this.data.units[id] ?? this.data.heroes[id];
  }

  /** Set a value by dotted path, e.g. patch('units.soldier.damage', 9). */
  patch(path: string, value: unknown, record = true) {
    const parts = path.split('.');
    let o: any = this.data;
    for (let i = 0; i < parts.length - 1; i++) {
      if (o[parts[i]] == null) o[parts[i]] = {};
      o = o[parts[i]];
    }
    o[parts[parts.length - 1]] = value;
    if (record) this.overrides[path] = value;
    this.events.emit('change', { path, value });
  }

  get(path: string): unknown {
    return path.split('.').reduce<any>((o, k) => (o == null ? o : o[k]), this.data);
  }

  applyOverrides(over: Record<string, unknown>) {
    for (const [p, v] of Object.entries(over)) this.patch(p, v);
  }

  /** Re-apply runtime overrides after content modules are hot-reloaded. */
  reapplyOverrides() {
    for (const [p, v] of Object.entries(this.overrides)) this.patch(p, v, false);
  }
}

export function deepAssign(target: any, src: any) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) deepAssign(target[k], v);
    else target[k] = v;
  }
  return target;
}

export const content = new ContentRegistry();
