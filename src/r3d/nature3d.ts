/**
 * Instanced environment: trees (wind sway), rocks, berry bushes, grass, ruins, rune stones,
 * graves, camp props. Each prop entity maps to one instance; removal hides the instance.
 */
import * as THREE from 'three/webgpu';
import { content } from '../engine/registry';
import type { Entity } from '../sim/types';
import { G, GeoBuilder, M, lumpy } from './geo';
import { teamMaterial } from './mats';

export interface PropModel {
  geo: THREE.BufferGeometry;
  wind: boolean;
  shadow: boolean;
  lights: { x: number; y: number; z: number; kind: 'fire' | 'arcane' | 'toxic' }[];
}

const GREENS = [[0x3f7a2a, 0x4f8f34, 0x63a23e], [0x2f6a30, 0x3e7d38, 0x4f9244], [0x5a8a2a, 0x6e9e30, 0x86b03a]];

function oak(variant: number, autumn = false): PropModel {
  const b = new GeoBuilder();
  b.add(G.cyl(0.11, 0.17, 1.1, 7), M(0, 0.55, 0), { color: 0x6a4428, shade: 0.4 });
  for (let i = 0; i < 3; i++) b.add(G.cyl(0.04, 0.08, 0.5, 5), M(Math.cos(i * 2.1) * 0.15, 0.05, Math.sin(i * 2.1) * 0.15, Math.sin(i * 2.1) * 0.9, 0, -Math.cos(i * 2.1) * 0.9), { color: 0x5a3a20 });
  const cols = autumn ? [0xb8541e, 0xd47a2a, 0xe8a03a] : GREENS[variant % GREENS.length];
  const blobs: [number, number, number, number][] = [[0, 1.55, 0, 0.62], [0.38, 1.3, 0.1, 0.45], [-0.36, 1.35, -0.12, 0.46], [0.05, 1.3, 0.38, 0.42], [-0.1, 1.95, -0.05, 0.42], [0.1, 1.2, -0.38, 0.4]];
  blobs.forEach(([x, y, z, r], i) => b.add(lumpy(G.ico(r, 1), r * 0.18, i + 1 + variant * 7), M(x, y, z), { color: cols[i % 3], shade: 0.55, jitter: 0.1 }));
  return { geo: b.build(), wind: true, shadow: true, lights: [] };
}
function pine(variant: number): PropModel {
  const b = new GeoBuilder();
  b.add(G.cyl(0.08, 0.13, 0.7, 6), M(0, 0.35, 0), { color: 0x5a3a22 });
  const cols = variant ? [0x1f4f2c, 0x2a6038, 0x357044] : [0x264a26, 0x2f5e30, 0x3b6e3a];
  for (let i = 0; i < 4; i++) b.add(lumpy(G.cone(0.75 - i * 0.15, 0.85, 8), 0.06, i + 3), M(0, 0.7 + i * 0.5, 0), { color: cols[i % 3], shade: 0.5, jitter: 0.08 });
  return { geo: b.build(), wind: true, shadow: true, lights: [] };
}
function birch(): PropModel {
  const b = new GeoBuilder();
  b.add(G.cyl(0.07, 0.1, 1.5, 6), M(0, 0.75, 0), { color: 0xe8e4d8, jitter: 0.2 });
  for (let i = 0; i < 4; i++) b.add(G.box(0.08, 0.03, 0.02), M(0, 0.3 + i * 0.3, 0.085), { color: 0x2a2a2a });
  [[0, 1.75, 0, 0.45], [0.25, 1.45, 0.1, 0.35], [-0.25, 1.5, -0.1, 0.36], [0, 2.1, 0, 0.3]].forEach(([x, y, z, r], i) => b.add(lumpy(G.ico(r, 1), r * 0.15, i + 11), M(x, y, z), { color: [0x7aa63a, 0x8ab842, 0x9ac84a][i % 3], shade: 0.5 }));
  return { geo: b.build(), wind: true, shadow: true, lights: [] };
}
function deadTree(v: number): PropModel {
  const b = new GeoBuilder();
  b.add(G.cyl(0.08, 0.16, 1.4, 6), M(0, 0.7, 0, 0.05 * v, 0, -0.08), { color: 0x2a221e, jitter: 0.1 });
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7 + v;
    b.add(G.cyl(0.025, 0.05, 0.7, 5), M(Math.cos(a) * 0.22, 1.05 + i * 0.15, Math.sin(a) * 0.22, Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9), { color: 0x2e2622 });
  }
  return { geo: b.build(), wind: true, shadow: true, lights: [] };
}
function rock(v: number): PropModel {
  const b = new GeoBuilder();
  b.add(lumpy(G.dodeca(0.55), 0.12, v + 1).toNonIndexed(), M(0, 0.25, 0, 0, v, 0, 1.1, 0.75, 1), { color: 0x8a8680, shade: 0.45, jitter: 0.12 });
  b.add(lumpy(G.dodeca(0.32), 0.08, v + 4), M(0.42, 0.12, 0.2, 0, v * 2, 0, 1, 0.8, 1), { color: 0x7a7670, shade: 0.4, jitter: 0.12 });
  b.add(G.box(0.4, 0.06, 0.3), M(0, 0.62, 0, 0.1, v, 0.05), { color: 0x5a7a3a, shade: 0.2 });
  for (let i = 0; i < 3; i++) b.add(G.octa(0.08), M(-0.2 + i * 0.18, 0.45, 0.35, 0.3, i, 0.4), { color: 0xd8e8ff, glow: 0.25, metal: 1 });
  return { geo: b.build(), wind: false, shadow: true, lights: [] };
}
function bush(berries: boolean, v: number): PropModel {
  const b = new GeoBuilder();
  for (let i = 0; i < 5; i++) b.add(lumpy(G.ico(0.32, 1), 0.05, i + v), M(Math.cos(i * 1.3) * 0.25, 0.3 + (i % 2) * 0.1, Math.sin(i * 1.3) * 0.22), { color: [0x2f6a2a, 0x3d8a34, 0x4a9a3a][i % 3], shade: 0.5 });
  return { geo: b.build(), wind: true, shadow: true, lights: [] };
}
function berries(): PropModel {
  const b = new GeoBuilder();
  for (let i = 0; i < 16; i++) {
    const a = i * 2.4, r = 0.3 + (i % 3) * 0.06;
    b.add(G.sphere(0.05, 6, 4), M(Math.cos(a) * r, 0.25 + (i % 4) * 0.1, Math.sin(a) * r), { color: 0xd42030, shade: 0, glow: 0.05 });
  }
  return { geo: b.build(), wind: true, shadow: false, lights: [] };
}
function grass(v: number): PropModel {
  const b = new GeoBuilder();
  for (let i = 0; i < 9; i++) {
    const a = i * 0.7 + v, r = 0.05 + (i % 3) * 0.06;
    b.add(G.cone(0.03, 0.35 + (i % 4) * 0.08, 3), M(Math.cos(a) * r, 0.18, Math.sin(a) * r, Math.sin(a) * 0.25, 0, Math.cos(a) * 0.25), { color: [0x5a9a34, 0x6aaa3a, 0x7aba44][i % 3], shade: 0.6 });
  }
  if (v === 1) for (let i = 0; i < 3; i++) b.add(G.sphere(0.04, 5, 4), M(Math.cos(i * 2) * 0.12, 0.38, Math.sin(i * 2) * 0.12), { color: [0xf4e070, 0xffffff, 0xd080e0][i], shade: 0 });
  return { geo: b.build(), wind: true, shadow: false, lights: [] };
}
function column(): PropModel {
  const b = new GeoBuilder();
  b.add(G.box(0.6, 0.15, 0.6), M(0, 0.07, 0), { color: 0xb8b2a6 });
  b.add(G.cyl(0.2, 0.22, 1.5, 10), M(0, 0.85, 0, 0.05, 0, 0.04), { color: 0xcfc8ba, jitter: 0.08 });
  b.add(G.box(0.5, 0.15, 0.5), M(0.02, 1.65, 0, 0.05, 0.3, 0.06), { color: 0xc0b8aa });
  b.add(G.box(0.3, 0.2, 0.25), M(0.5, 0.1, 0.3, 0.3, 0.6, 0.2), { color: 0xb0a898 });
  return { geo: b.build(), wind: false, shadow: true, lights: [] };
}
function arch(): PropModel {
  const b = new GeoBuilder();
  for (const x of [-0.6, 0.6]) b.add(G.box(0.35, 1.6, 0.4), M(x, 0.8, 0), { color: 0xc4bcae, jitter: 0.1 });
  b.add(G.box(1.6, 0.3, 0.45), M(0, 1.72, 0, 0, 0, 0.08), { color: 0xb8b0a0 });
  b.add(G.box(0.25, 0.4, 0.3), M(0.9, 0.12, 0.3, 0.4, 0, 0.5), { color: 0xa8a090 });
  return { geo: b.build(), wind: false, shadow: true, lights: [] };
}
function statue(): PropModel {
  const b = new GeoBuilder();
  b.add(G.box(0.7, 0.3, 0.7), M(0, 0.15, 0), { color: 0x9a948a });
  b.add(G.taper(0.35, 0.45, 0.6, 0.25), M(0, 0.6, 0), { color: 0xb8b2a6 });
  b.add(G.sphere(0.16, 8, 6), M(0, 1.05, 0), { color: 0xb8b2a6 });
  b.add(G.box(0.06, 1.0, 0.06), M(0.3, 0.8, 0.1, 0.1, 0, 0), { color: 0xa8a296 });
  b.add(G.box(0.2, 0.25, 0.04), M(-0.28, 0.65, 0.12), { color: 0xa8a296 });
  return { geo: b.build(), wind: false, shadow: true, lights: [] };
}
function wall(): PropModel {
  const b = new GeoBuilder();
  for (let i = 0; i < 5; i++) b.add(G.box(0.38, 0.3 + (i % 3) * 0.3, 0.35), M(-0.8 + i * 0.4, 0.15 + (i % 3) * 0.15, 0, 0, 0, (i - 2) * 0.03), { color: [0xb0a898, 0xa09888, 0xc0b8a8][i % 3], jitter: 0.1 });
  b.add(G.box(1.0, 0.08, 0.38), M(-0.4, 0.64, 0), { color: 0x5a7a3a });
  return { geo: b.build(), wind: false, shadow: true, lights: [] };
}
function runestone(shrine: boolean): PropModel {
  const b = new GeoBuilder();
  if (shrine) {
    b.add(G.cyl(0.6, 0.7, 0.2, 8), M(0, 0.1, 0), { color: 0x9a948a });
    for (let i = 0; i < 4; i++) b.add(G.box(0.12, 0.9, 0.12), M(Math.cos(i * 1.57 + 0.78) * 0.45, 0.6, Math.sin(i * 1.57 + 0.78) * 0.45), { color: 0xb8b2a6 });
    b.add(G.cone(0.7, 0.4, 4), M(0, 1.25, 0, 0, 0.78, 0), { color: 0x6a7a90 });
    b.add(G.octa(0.16), M(0, 0.55, 0), { color: 0x6ad0ff, glow: 1, shade: 0 });
    return { geo: b.build(), wind: false, shadow: true, lights: [{ x: 0, y: 0.6, z: 0, kind: 'arcane' }] };
  }
  b.add(G.taper(0.55, 0.38, 1.6, 0.3, 0.22), M(0, 0.8, 0, 0.04, 0, 0.05), { color: 0x7a7a80, jitter: 0.1 });
  for (let i = 0; i < 4; i++) b.add(G.box(0.18, 0.05, 0.02), M(0, 0.4 + i * 0.28, 0.16 - i * 0.01, 0, 0, (i % 2 ? 0.5 : -0.5)), { color: 0x6ad0ff, glow: 1, shade: 0 });
  b.add(G.box(0.05, 0.9, 0.02), M(0, 0.85, 0.155), { color: 0x6ad0ff, glow: 0.8, shade: 0 });
  return { geo: b.build(), wind: false, shadow: true, lights: [{ x: 0, y: 0.9, z: 0.25, kind: 'arcane' }] };
}
function tomb(v: number): PropModel {
  const b = new GeoBuilder();
  if (v === 2) {
    for (let i = 0; i < 7; i++) b.add(G.cyl(0.03, 0.03, 0.35, 5), M(Math.cos(i) * 0.2, 0.05, Math.sin(i * 1.3) * 0.2, Math.PI / 2, i, 0), { color: 0xe8e0c8 });
    b.add(G.sphere(0.1, 8, 6), M(0, 0.12, 0), { color: 0xe8e0c8 });
    return { geo: b.build(), wind: false, shadow: true, lights: [] };
  }
  b.add(G.box(0.4, 0.6, 0.12), M(0, 0.3, 0, 0, 0, v ? 0.15 : -0.1), { color: 0x8a8680, jitter: 0.1 });
  b.add(G.cyl(0.2, 0.2, 0.12, 8, ), M(0, 0.6, 0, Math.PI / 2, 0, v ? 0.15 : -0.1), { color: 0x8a8680 });
  b.add(G.box(0.5, 0.06, 0.9), M(0, 0.02, 0.4), { color: 0x3a3028 });
  return { geo: b.build(), wind: false, shadow: true, lights: [] };
}
function tent(): PropModel {
  const b = new GeoBuilder();
  for (const s of [-1, 1]) for (let i = 0; i < 5; i++) b.add(G.box(0.04, 0.32, 1.8), M(s * (0.72 - i * 0.15), 0.14 + i * 0.24, 0, 0, 0, s * 0.6), { color: i % 2 ? 0xcfb88a : 0xbfa87a, shade: 0.2 });
  b.add(G.box(0.5, 0.8, 0.02), M(0, 0.4, 0.91), { color: 0x4a3a28 });
  b.add(G.cyl(0.03, 0.03, 1.4, 5), M(0, 0.7, 0.92), { color: 0x6a4428 });
  return { geo: b.build(), wind: false, shadow: true, lights: [] };
}
function campfire(): PropModel {
  const b = new GeoBuilder();
  for (let i = 0; i < 8; i++) b.add(G.dodeca(0.1), M(Math.cos(i * 0.785) * 0.35, 0.05, Math.sin(i * 0.785) * 0.35), { color: 0x6a6660 });
  for (let i = 0; i < 4; i++) b.add(G.cyl(0.05, 0.05, 0.6, 5), M(0, 0.12, 0, Math.PI / 2 - 0.4, i * 0.8, 0), { color: 0x5a3a20 });
  b.add(G.ico(0.15, 0), M(0, 0.15, 0), { color: 0xffa040, glow: 1, shade: 0 });
  return { geo: b.build(), wind: false, shadow: false, lights: [{ x: 0, y: 0.35, z: 0, kind: 'fire' }] };
}
function torch(): PropModel {
  const b = new GeoBuilder();
  b.add(G.cyl(0.04, 0.05, 1.6, 6), M(0, 0.8, 0), { color: 0x5a3a20 });
  b.add(G.cyl(0.09, 0.06, 0.16, 6), M(0, 1.62, 0), { color: 0x3a3430, metal: 1 });
  b.add(G.ico(0.07, 0), M(0, 1.72, 0), { color: 0xffb040, glow: 1, shade: 0 });
  return { geo: b.build(), wind: false, shadow: true, lights: [{ x: 0, y: 1.85, z: 0, kind: 'fire' }] };
}
function brazier(): PropModel {
  const b = new GeoBuilder();
  for (let i = 0; i < 3; i++) b.add(G.cyl(0.03, 0.03, 0.8, 5), M(Math.cos(i * 2.1) * 0.15, 0.4, Math.sin(i * 2.1) * 0.15, Math.sin(i * 2.1) * 0.2, 0, -Math.cos(i * 2.1) * 0.2), { color: 0x2a2624, metal: 1 });
  b.add(G.cyl(0.3, 0.18, 0.2, 8), M(0, 0.85, 0), { color: 0x3a3430, metal: 1 });
  b.add(G.ico(0.18, 0), M(0, 0.98, 0), { color: 0x7dff6a, glow: 1, shade: 0 });
  return { geo: b.build(), wind: false, shadow: true, lights: [{ x: 0, y: 1.2, z: 0, kind: 'toxic' }] };
}
function deco(v: number): PropModel {
  const b = new GeoBuilder();
  if (v === 0) { b.add(G.box(0.5, 0.5, 0.5), M(0, 0.25, 0, 0, 0.3, 0), { color: 0x9a6a3a }); b.add(G.box(0.4, 0.4, 0.4), M(0.45, 0.2, 0.2, 0, -0.2, 0), { color: 0x8a5a30 }); b.add(G.box(0.35, 0.35, 0.35), M(0.15, 0.68, 0.05, 0, 0.6, 0), { color: 0xa47442 }); }
  else if (v === 1) { for (let i = 0; i < 2; i++) { b.add(G.cyl(0.22, 0.2, 0.55, 10), M(i * 0.45, 0.27, 0), { color: 0x7a4a26 }); b.add(G.torus(0.21, 0.02, 4, 12), M(i * 0.45, 0.4, 0, Math.PI / 2, 0, 0), { color: 0x3a3430, metal: 1 }); } }
  else if (v === 2) b.add(lumpy(G.sphere(0.55, 10, 8), 0.05, 3), M(0, 0.3, 0, 0, 0, 0, 1, 0.65, 1), { color: 0xd8b850, jitter: 0.1 });
  else { b.add(G.cyl(0.04, 0.05, 1.3, 5), M(0, 0.65, 0), { color: 0x6a4428 }); b.add(G.box(0.6, 0.18, 0.04), M(0.2, 1.1, 0, 0, 0, 0.08), { color: 0x9a6a3a }); }
  return { geo: b.build(), wind: false, shadow: true, lights: [] };
}

const BUILDERS: Record<string, () => PropModel> = {
  tree_oak1: () => oak(0), tree_oak2: () => oak(1), tree_autumn: () => oak(2, true), tree_birch: birch,
  tree_pine1: () => pine(0), tree_pine2: () => pine(1),
  dead_tree1: () => deadTree(0), dead_tree2: () => deadTree(1), dead_tree3: () => deadTree(2),
  rock1: () => rock(0), rock2: () => rock(1), rock3: () => rock(2), rock4: () => rock(3), rock5: () => rock(4), rock6: () => rock(5),
  berry1: () => bush(true, 0), berry2: () => bush(true, 1), berry3: () => bush(true, 2), berries,
  grass1: () => grass(0), grass2: () => grass(1),
  ruin_column: column, ruin_arch: arch, ruin_statue: statue, ruin_wall: wall, ruin_runestone: () => runestone(false), ruin_shrine: () => runestone(true),
  tomb1: () => tomb(0), tomb2: () => tomb(1), bone_pile: () => tomb(2), tent, campfire, torch, brazier,
  crates: () => deco(0), barrels: () => deco(1), haystack: () => deco(2), signpost: () => deco(3),
};

export function propModel(key: string): PropModel {
  return (BUILDERS[key] ?? (() => rock(0)))();
}

const NEUTRAL_COLOR = 0xffffff;

interface Slot { mesh: THREE.InstancedMesh; index: number; base: THREE.Matrix4; key: string }

/** One InstancedMesh per prop model key. */
export class PropLayer {
  readonly group = new THREE.Group();
  private meshes = new Map<string, THREE.InstancedMesh>();
  private counts = new Map<string, number>();
  private free = new Map<string, number[]>();
  private slots = new Map<number, Slot>();
  private berrySlots = new Map<number, Slot>();
  private shakes = new Map<number, number>();
  readonly lights: { id: number; pos: THREE.Vector3; kind: 'fire' | 'arcane' | 'toxic' }[] = [];
  private models = new Map<string, PropModel>();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(entities: Entity[], private height: (x: number, y: number) => number) {
    const need = new Map<string, number>();
    for (const e of entities) {
      const k = this.keyOf(e);
      need.set(k, (need.get(k) ?? 0) + 1);
      if (e.res === 'food') need.set('berries', (need.get('berries') ?? 0) + 1);
    }
    for (const [k, n] of need) this.ensure(k, n + 16);
    for (const e of entities) this.add(e);
  }

  keyOf(e: Entity) {
    const d = content.props[e.def];
    return d ? d.sprites[(e.variant ?? 0) % d.sprites.length] : e.def;
  }

  private model(k: string) {
    let m = this.models.get(k);
    if (!m) { m = propModel(k); this.models.set(k, m); }
    return m;
  }

  private ensure(k: string, cap: number) {
    if (this.meshes.has(k)) return this.meshes.get(k)!;
    const m = this.model(k);
    const mesh = new THREE.InstancedMesh(m.geo, teamMaterial(NEUTRAL_COLOR, { wind: m.wind }), cap);
    mesh.count = cap;
    for (let i = 0; i < cap; i++) mesh.setMatrixAt(i, this.zero);
    mesh.castShadow = m.shadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.meshes.set(k, mesh);
    this.counts.set(k, 0);
    this.free.set(k, []);
    this.group.add(mesh);
    return mesh;
  }

  private alloc(k: string): [THREE.InstancedMesh, number] | null {
    const mesh = this.ensure(k, 64);
    const f = this.free.get(k)!;
    if (f.length) return [mesh, f.pop()!];
    const n = this.counts.get(k)!;
    if (n >= mesh.count) return null;
    this.counts.set(k, n + 1);
    return [mesh, n];
  }

  add(e: Entity) {
    if (this.slots.has(e.id)) return;
    const k = this.keyOf(e);
    const a = this.alloc(k);
    if (!a) return;
    const [mesh, index] = a;
    const h = hashf(e.id);
    const s = (e.def === 'grass' ? 0.8 : 0.85) + h * 0.35;
    const x = e.x + (hashf(e.id * 3) - 0.5) * 0.3, z = e.y + (hashf(e.id * 5) - 0.5) * 0.3;
    const base = new THREE.Matrix4().compose(new THREE.Vector3(x, this.height(x, z) - 0.03, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, h * Math.PI * 2, 0)), new THREE.Vector3(s, s * (0.9 + hashf(e.id * 7) * 0.25), s));
    mesh.setMatrixAt(index, base);
    mesh.instanceMatrix.needsUpdate = true;
    this.slots.set(e.id, { mesh, index, base, key: k });
    if (e.res === 'food') {
      const b = this.alloc('berries');
      if (b) { b[0].setMatrixAt(b[1], base); b[0].instanceMatrix.needsUpdate = true; this.berrySlots.set(e.id, { mesh: b[0], index: b[1], base, key: 'berries' }); }
    }
    for (const l of this.model(k).lights) this.lights.push({ id: e.id, pos: new THREE.Vector3(l.x, l.y, l.z).applyMatrix4(base), kind: l.kind });
  }

  remove(id: number) {
    for (const map of [this.slots, this.berrySlots]) {
      const s = map.get(id);
      if (!s) continue;
      s.mesh.setMatrixAt(s.index, this.zero);
      s.mesh.instanceMatrix.needsUpdate = true;
      this.free.get(s.key)!.push(s.index);
      map.delete(id);
    }
    for (let i = this.lights.length - 1; i >= 0; i--) if (this.lights[i].id === id) this.lights.splice(i, 1);
  }

  baseMatrix(id: number) {
    return this.slots.get(id)?.base;
  }
  slot(id: number) {
    return this.slots.get(id);
  }

  shake(id: number) {
    this.shakes.set(id, 1);
  }

  setBerries(id: number, visible: boolean) {
    const s = this.berrySlots.get(id);
    if (!s) return;
    const want = visible ? s.base : this.zero;
    s.mesh.setMatrixAt(s.index, want);
    s.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Stone deposits shrink as they are mined. */
  setScale(id: number, k: number) {
    const s = this.slots.get(id);
    if (!s) return;
    const m = s.base.clone().multiply(new THREE.Matrix4().makeScale(k, k, k));
    s.mesh.setMatrixAt(s.index, m);
    s.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number, t: number) {
    for (const [id, v] of this.shakes) {
      const s = this.slots.get(id);
      const nv = v - dt * 2.5;
      if (!s || nv <= 0) { if (s) { s.mesh.setMatrixAt(s.index, s.base); s.mesh.instanceMatrix.needsUpdate = true; } this.shakes.delete(id); continue; }
      this.shakes.set(id, nv);
      const r = Math.sin(t * 40) * 0.06 * nv;
      const m = s.base.clone().multiply(new THREE.Matrix4().makeRotationZ(r));
      s.mesh.setMatrixAt(s.index, m);
      s.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Geometry of a model (used for falling-tree animations). */
  geometry(k: string) {
    return this.model(k).geo;
  }
}

export const hashf = (n: number) => {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
