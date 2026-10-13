/**
 * Save format: the whole World as JSON (entities, factions, evil state incl. wave queue, active waves,
 * timers) plus runtime content overrides. Loading restores timers as-is, so protections are not reset
 * and overdue attacks are not all fired at once.
 */
import { content } from '../engine/registry';
import { Nav } from './nav';
import { Sim } from './sim';
import type { Entity, World } from './types';

export const SAVE_VERSION = 1;

export interface SaveFile {
  v: number;
  savedAt: number;
  world: Omit<World, 'entities' | 'terrain'> & { entities: Entity[]; terrain: string };
  overrides: Record<string, unknown>;
}

export function serialize(sim: Sim): SaveFile {
  const w = sim.world;
  const { entities, terrain, ...rest } = w;
  return {
    v: SAVE_VERSION,
    savedAt: Date.now(),
    world: structuredClone({ ...rest, entities: [...entities.values()].filter((e) => !e.dead), terrain: toB64(terrain) }),
    overrides: { ...content.overrides },
  };
}

export function deserialize(save: SaveFile, wasm: ConstructorParameters<typeof Nav>[2]): Sim {
  if (save.v !== SAVE_VERSION) throw new Error(`Unsupported save version ${save.v}`);
  content.applyOverrides(save.overrides ?? {});
  const { entities, terrain, ...rest } = structuredClone(save.world);
  const world: World = { ...rest, entities: new Map(entities.map((e) => [e.id, e])), terrain: fromB64(terrain) };
  const nav = new Nav(world.W, world.H, wasm);
  for (let i = 0; i < world.terrain.length; i++) nav.setBase(i, world.terrain[i] === 3 ? 255 : world.terrain[i] === 2 ? 6 : 0);
  for (const e of world.entities.values()) {
    if (e.kind === 'building' && e.tx != null) nav.block(e.tx, e.ty!, e.w!, e.h!, true);
    else if ((e.kind === 'resource' || e.kind === 'prop') && content.props[e.def]?.blocks) nav.block(Math.floor(e.x), Math.floor(e.y), 1, 1, true);
  }
  return new Sim(world, nav);
}

function toB64(a: Uint8Array) {
  let s = '';
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s);
}
function fromB64(s: string) {
  const b = atob(s);
  const a = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
  return a;
}
