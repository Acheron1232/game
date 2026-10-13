/**
 * Procedural buildings. Origin = footprint center on the ground; +Z faces the front (towards the
 * camera). Returns a merged static geometry + anchors for lights, smoke, flags and animated parts.
 */
import * as THREE from 'three/webgpu';
import { G, GeoBuilder, M, lumpy } from './geo';

export interface BuildingModel {
  geo: THREE.BufferGeometry;
  lights: { x: number; y: number; z: number; kind: 'fire' | 'toxic' | 'arcane' | 'window' }[];
  smoke: { x: number; y: number; z: number }[];
  flags: { x: number; y: number; z: number; w: number; h: number; ry: number }[];
  parts: { geo: THREE.BufferGeometry; x: number; y: number; z: number; anim: 'saw' | 'float' | 'spin' | 'mill' }[];
  height: number;
}

const P = {
  stone: 0x9e988c, stoneDark: 0x726c62, stoneLight: 0xbab4a6, timber: 0x6a4424, timberDark: 0x4a2c16, plank: 0x9a6a3a,
  plaster: 0xeadfc4, thatch: 0xd8b050, thatchDark: 0xb08a32, slate: 0x4c5a76, slateDark: 0x3a465e, door: 0x4a2c16,
  window: 0x2a2018, glass: 0xffd27a, gold: 0xf0c040, iron: 0x3a3632, wheat: 0xe8c450, red: 0x9a3a2a,
  obsidian: 0x1c1626, toxic: 0x7dff6a, bone: 0xe8e0c8, dirt: 0x3a3028,
};

type B = GeoBuilder;
const box = (b: B, w: number, h: number, d: number, x: number, y: number, z: number, color: number, o: any = {}) => b.add(G.box(w, h, d), M(x, y + h / 2, z, o.rx ?? 0, o.ry ?? 0, o.rz ?? 0), { color, ...o });

function timberWall(b: B, w: number, h: number, d: number, y0: number) {
  box(b, w, h, d, 0, y0, 0, P.plaster, { shade: 0.2 });
  // frame: corner posts, mid posts, beams
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(b, 0.12, h + 0.02, 0.12, (sx * w) / 2, y0, (sz * d) / 2, P.timber);
  for (let i = 1; i < Math.round(w / 0.8); i++) {
    const x = -w / 2 + (w * i) / Math.round(w / 0.8);
    box(b, 0.08, h, 0.04, x, y0, d / 2 + 0.01, P.timber);
    box(b, 0.08, h, 0.04, x, y0, -d / 2 - 0.01, P.timber);
  }
  for (const yy of [y0 + h * 0.5, y0 + h - 0.06]) {
    box(b, w + 0.04, 0.08, 0.05, 0, yy, d / 2 + 0.015, P.timber);
    box(b, w + 0.04, 0.08, 0.05, 0, yy, -d / 2 - 0.015, P.timber);
    box(b, 0.05, 0.08, d + 0.04, w / 2 + 0.015, yy, 0, P.timber);
    box(b, 0.05, 0.08, d + 0.04, -w / 2 - 0.015, yy, 0, P.timber);
  }
  // diagonal braces on the front
  for (const sx of [-1, 1]) b.add(G.box(0.06, h * 0.55, 0.04), M((sx * w) / 3.2, y0 + h * 0.25, d / 2 + 0.02, 0, 0, sx * 0.6), { color: P.timber });
}

/** Layered roof: overlapping strips on both slopes + gable ends + ridge. */
function stripRoof(b: B, w: number, d: number, h: number, y: number, cols: number[], gable: number, alongX = true, cx = 0, cz = 0, over = 0.22) {
  const run = d / 2 + over;
  const a = Math.atan2(h, run);
  const L = Math.hypot(run, h);
  const N = Math.max(4, Math.round(L / 0.16));
  const len = w + over * 2;
  for (const s of [-1, 1]) {
    for (let i = 0; i < N; i++) {
      const t = (i + 0.5) / N;
      const off = s * run * (1 - t), yy = y + h * t + 0.04;
      const m = alongX ? M(cx, yy, cz + off, s * a, 0, 0) : M(cx + off, yy, cz, 0, 0, -s * a);
      const geo = alongX ? G.box(len - (i % 2) * 0.04, 0.09, (L / N) * 1.35) : G.box((L / N) * 1.35, 0.09, len - (i % 2) * 0.04);
      b.add(geo, m, { color: cols[(i + (s > 0 ? 0 : 1)) % cols.length], shade: 0.15, jitter: 0.07 });
    }
  }
  // ridge cap
  b.add(alongX ? G.box(len + 0.05, 0.12, 0.2) : G.box(0.2, 0.12, len + 0.05), M(cx, y + h + 0.06, cz), { color: cols[cols.length - 1], shade: 0.1 });
  // gable triangles
  for (const s of [-1, 1]) {
    const tri = G.shape([[-d / 2, 0], [d / 2, 0], [0, h]], 0.08);
    const m = alongX ? M(cx + s * (w / 2 - 0.02), y, cz, 0, Math.PI / 2, 0) : M(cx, y, cz + s * (w / 2 - 0.02));
    b.add(tri, m, { color: gable, shade: 0.3 });
  }
}

function thatchRoof(b: B, w: number, d: number, h: number, y: number) {
  stripRoof(b, w, d, h, y, [0xd8b050, 0xc4a040, 0xe2c062, 0xa8822e], P.plaster);
}

function slateRoof(b: B, w: number, d: number, h: number, y: number) {
  stripRoof(b, w, d, h, y, [0x4c5a76, 0x5a6884, 0x46526c, 0x343e54], P.stone, true, 0, 0, 0.16);
}

function door(b: B, x: number, z: number, w = 0.45, h = 0.7) {
  box(b, w + 0.12, h + 0.08, 0.06, x, 0.15, z, P.timberDark);
  box(b, w, h, 0.06, x, 0.15, z + 0.02, P.door, { shade: 0.1 });
  b.add(G.cyl(w / 2, w / 2, 0.06, 10, ), M(x, 0.15 + h, z + 0.02, Math.PI / 2, 0, 0, 1, 1, 1), { color: P.door });
  box(b, 0.04, 0.04, 0.04, x + w * 0.3, 0.15 + h * 0.5, z + 0.07, P.gold, { metal: 1 });
}

function windowLit(b: B, x: number, y: number, z: number, ry = 0) {
  b.add(G.box(0.3, 0.3, 0.05), M(x, y, z, 0, ry, 0), { color: P.timberDark });
  b.add(G.box(0.22, 0.22, 0.06), M(x, y, z, 0, ry, 0), { color: P.glass, night: 1, shade: 0 });
  b.add(G.box(0.03, 0.24, 0.07), M(x, y, z, 0, ry, 0), { color: P.timberDark });
}

function banner(b: B, x: number, y: number, z: number, w = 0.3, h = 0.7) {
  box(b, w + 0.08, 0.05, 0.05, x, y, z, P.timberDark);
  b.add(G.shape([[-w / 2, 0], [w / 2, 0], [w / 2, -h], [0, -h - 0.12], [-w / 2, -h]], 0.02), M(x, y, z + 0.02), { color: 0xd0d0d0, team: 1, shade: 0.3 });
  b.add(G.octa(0.06), M(x, y - h * 0.45, z + 0.04, 0, 0, 0, 1, 1.3, 0.3), { color: P.gold, metal: 1 });
}

function torchOn(b: B, m: BuildingModel, x: number, y: number, z: number) {
  b.add(G.cyl(0.03, 0.04, 0.35, 5), M(x, y, z, 0.3, 0, 0), { color: P.timberDark });
  b.add(G.cyl(0.06, 0.04, 0.1, 6), M(x, y + 0.18, z + 0.05), { color: P.iron, metal: 1 });
  b.add(G.ico(0.05, 0), M(x, y + 0.25, z + 0.05), { color: 0xffb040, glow: 1, shade: 0 });
  m.lights.push({ x, y: y + 0.35, z: z + 0.1, kind: 'fire' });
}

function stoneBase(b: B, w: number, d: number, h = 0.18) {
  box(b, w, h, d, 0, 0, 0, P.stoneDark, { jitter: 0.1 });
  for (let i = 0; i < Math.round((w + d) * 3); i++) {
    const a = (i * 2.399) % (Math.PI * 2);
    const onX = i % 2 === 0;
    const x = onX ? (((i * 0.37) % 1) - 0.5) * w : (i % 4 === 1 ? 1 : -1) * w / 2;
    const z = onX ? (i % 4 === 0 ? 1 : -1) * d / 2 : (((i * 0.53) % 1) - 0.5) * d;
    b.add(G.box(0.22, 0.12, 0.08), M(x, h * 0.5, z, 0, onX ? 0 : Math.PI / 2, a * 0.02), { color: i % 3 ? P.stone : P.stoneLight });
  }
}

function newModel(): BuildingModel {
  return { geo: null as any, lights: [], smoke: [], flags: [], parts: [], height: 2 };
}

// ------------------------------------------------------------------ human buildings
export function townhall1(): BuildingModel {
  const b = new GeoBuilder(), m = newModel();
  stoneBase(b, 3.7, 2.7);
  timberWall(b, 3.3, 1.15, 2.2, 0.18);
  thatchRoof(b, 3.4, 2.3, 1.35, 1.32);
  // front cross-gable porch
  b.add(G.box(1.3, 1.0, 0.7), M(0, 0.68, 1.3), { color: P.plaster });
  for (const sx of [-1, 1]) box(b, 0.14, 1.05, 0.14, sx * 0.62, 0.18, 1.62, P.timber);
  stripRoof(b, 1.0, 1.5, 0.85, 1.18, [0xd8b050, 0xc4a040, 0xe2c062, 0xa8822e], P.plaster, false, 0, 1.35, 0.12);
  door(b, 0, 1.66, 0.5, 0.72);
  // carved ridge heads
  for (const sx of [-1, 1]) b.add(G.cone(0.08, 0.45, 5), M(sx * 1.85, 2.7, 0, 0, 0, -sx * 0.9), { color: P.timberDark });
  b.add(G.cone(0.07, 0.35, 5), M(0, 2.05, 1.85, 0.9, 0, 0), { color: P.timberDark });
  for (const x of [-1.15, -0.65, 0.65, 1.15]) windowLit(b, x, 0.85, 1.12);
  for (const x of [-0.9, 0.9]) windowLit(b, x, 0.85, -1.12);
  // chimney
  box(b, 0.32, 1.1, 0.32, -1.0, 1.6, -0.45, P.stone, { jitter: 0.12 });
  m.smoke.push({ x: -1.0, y: 2.8, z: -0.45 });
  banner(b, -0.95, 1.18, 1.14);
  banner(b, 0.95, 1.18, 1.14);
  torchOn(b, m, -0.85, 0.55, 1.68);
  torchOn(b, m, 0.85, 0.55, 1.68);
  // barrels + crates
  b.add(G.cyl(0.16, 0.15, 0.4, 8), M(1.55, 0.2, 1.05), { color: 0x7a4a26 });
  box(b, 0.35, 0.35, 0.35, -1.55, 0.0, 1.05, P.plank, { ry: 0.3 });
  m.flags.push({ x: 0, y: 2.65, z: 0, w: 0.5, h: 0.3, ry: 0 });
  m.geo = b.build();
  m.height = 2.8;
  return m;
}

export function townhall2(): BuildingModel {
  const b = new GeoBuilder(), m = newModel();
  stoneBase(b, 3.9, 2.9, 0.25);
  box(b, 3.4, 1.5, 2.3, 0, 0.25, 0, P.stone, { jitter: 0.12, shade: 0.3 });
  // stone courses
  for (let r = 0; r < 4; r++) for (let i = 0; i < 9; i++) b.add(G.box(0.36, 0.06, 0.02), M(-1.6 + i * 0.4 + (r % 2) * 0.2, 0.45 + r * 0.35, 1.16), { color: P.stoneLight, jitter: 0.1 });
  // crenellations
  for (let i = 0; i < 9; i++) for (const z of [-1.15, 1.15]) box(b, 0.22, 0.22, 0.22, -1.6 + i * 0.4, 1.75, z, P.stoneLight);
  slateRoof(b, 3.0, 1.9, 1.0, 1.75);
  // keep tower front-left
  b.add(G.cyl(0.55, 0.62, 2.7, 10), M(-1.45, 1.35, 0.8), { color: P.stone, jitter: 0.12, shade: 0.35 });
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; box(b, 0.18, 0.2, 0.18, -1.45 + Math.cos(a) * 0.55, 2.7, 0.8 + Math.sin(a) * 0.55, P.stoneLight); }
  b.add(G.cone(0.72, 1.1, 10), M(-1.45, 3.4, 0.8), { color: P.slate, shade: 0.35 });
  m.flags.push({ x: -1.45, y: 4.2, z: 0.8, w: 0.7, h: 0.4, ry: 0 });
  b.add(G.cyl(0.02, 0.02, 0.9, 4), M(-1.45, 4.25, 0.8), { color: P.iron });
  windowLit(b, -1.45, 1.9, 1.38);
  windowLit(b, -1.45, 1.2, 1.4);
  // gate
  box(b, 0.95, 1.1, 0.2, 0.3, 0.25, 1.2, P.stoneDark);
  door(b, 0.3, 1.28, 0.7, 0.85);
  for (const x of [1.0, 1.5]) windowLit(b, x, 1.15, 1.17);
  banner(b, -0.45, 1.6, 1.2, 0.36, 0.9);
  banner(b, 1.05, 1.6, 1.2, 0.36, 0.9);
  // braziers
  for (const x of [-0.45, 1.05]) {
    b.add(G.cyl(0.18, 0.1, 0.2, 8), M(x, 0.6, 1.62), { color: P.iron, metal: 1 });
    b.add(G.cyl(0.04, 0.05, 0.45, 5), M(x, 0.3, 1.62), { color: P.iron });
    b.add(G.ico(0.1, 0), M(x, 0.75, 1.62), { color: 0xffb040, glow: 1, shade: 0 });
    m.lights.push({ x, y: 0.95, z: 1.65, kind: 'fire' });
  }
  box(b, 0.3, 0.9, 0.3, 1.3, 1.75, -0.5, P.stone);
  m.smoke.push({ x: 1.3, y: 2.75, z: -0.5 });
  m.geo = b.build();
  m.height = 4.2;
  return m;
}

export function house(): BuildingModel {
  const b = new GeoBuilder(), m = newModel();
  stoneBase(b, 1.8, 1.7, 0.14);
  timberWall(b, 1.45, 0.85, 1.25, 0.14);
  thatchRoof(b, 1.55, 1.35, 0.95, 0.98);
  door(b, 0.25, 0.64, 0.36, 0.55);
  windowLit(b, -0.35, 0.62, 0.64);
  windowLit(b, 0.0, 0.62, -0.64);
  box(b, 0.24, 0.8, 0.24, 0.5, 1.1, -0.25, P.stone, { jitter: 0.12 });
  m.smoke.push({ x: 0.5, y: 2.0, z: -0.25 });
  b.add(G.cyl(0.13, 0.12, 0.32, 8), M(-0.7, 0.16, 0.75), { color: 0x7a4a26 });
  m.flags.push({ x: -0.6, y: 1.95, z: 0, w: 0.35, h: 0.2, ry: 0 });
  b.add(G.cyl(0.015, 0.015, 0.5, 4), M(-0.6, 1.8, 0), { color: P.iron });
  m.geo = b.build();
  m.height = 2.0;
  return m;
}

export function farm(): BuildingModel {
  const b = new GeoBuilder(), m = newModel();
  // barn at the back-left
  box(b, 1.25, 0.95, 1.0, -0.75, 0, -0.85, 0x8a3a26, { shade: 0.3 });
  for (let i = 0; i < 6; i++) box(b, 0.03, 0.95, 0.02, -1.3 + i * 0.22, 0, -0.34, 0x6a2a1a);
  stripRoof(b, 1.25, 1.0, 0.7, 0.95, [0xb8902e, 0xa47c28, 0xc49a3a, 0x8a6a22], 0x8a3a26, true, -0.75, -0.85, 0.12);
  box(b, 0.45, 0.6, 0.04, -0.75, 0, -0.33, P.timberDark);
  b.add(G.box(0.5, 0.04, 0.05), M(-0.75, 0.3, -0.3, 0, 0, 0.85), { color: P.plank });
  b.add(G.box(0.5, 0.04, 0.05), M(-0.75, 0.3, -0.3, 0, 0, -0.85), { color: P.plank });
  // field: soil rows with wheat
  box(b, 2.7, 0.06, 1.55, 0.1, 0, 0.62, 0x6a4a2a);
  for (let r = 0; r < 5; r++) for (let i = 0; i < 12; i++) {
    const x = -1.1 + i * 0.21, z = 0.05 + r * 0.3;
    b.add(G.cone(0.05, 0.38 + ((i * 7 + r * 3) % 5) * 0.03, 4), M(x, 0.24, z, 0, i, ((i + r) % 3 - 1) * 0.1), { color: P.wheat, shade: 0.5, jitter: 0.08 });
  }
  // fence
  for (let i = 0; i <= 10; i++) {
    const x = -1.35 + i * 0.29;
    box(b, 0.05, 0.35, 0.05, x, 0, 1.45, P.timber);
  }
  box(b, 3.0, 0.04, 0.03, 0.1, 0.22, 1.45, P.plank);
  box(b, 0.03, 0.04, 1.6, 1.42, 0.22, 0.6, P.plank);
  // scarecrow
  box(b, 0.05, 0.9, 0.05, 0.85, 0, 0.55, P.timber);
  box(b, 0.5, 0.05, 0.05, 0.85, 0.65, 0.55, P.timber);
  b.add(G.sphere(0.1, 8, 6), M(0.85, 0.95, 0.55), { color: P.wheat });
  b.add(G.cone(0.14, 0.15, 6), M(0.85, 1.07, 0.55), { color: 0x6a4428 });
  b.add(G.box(0.22, 0.3, 0.12), M(0.85, 0.68, 0.55), { color: 0xd0d0d0, team: 1 });
  m.flags.push({ x: -0.3, y: 1.9, z: -0.85, w: 0.4, h: 0.22, ry: 0 });
  b.add(G.cyl(0.015, 0.015, 0.6, 4), M(-0.3, 1.75, -0.85), { color: P.iron });
  m.geo = b.build();
  m.height = 1.9;
  return m;
}

export function sawmill(): BuildingModel {
  const b = new GeoBuilder(), m = newModel();
  box(b, 2.7, 0.1, 1.7, 0, 0, 0, P.plank, { jitter: 0.1 });
  for (const x of [-1.2, 0, 1.2]) for (const z of [-0.7, 0.7]) box(b, 0.12, 1.3, 0.12, x, 0.1, z, P.timber);
  b.add(G.box(2.9, 0.08, 1.9), M(0, 1.5, -0.05, 0.22, 0, 0), { color: P.plank, shade: 0.3, jitter: 0.08 });
  for (let i = 0; i < 7; i++) box(b, 2.9, 0.03, 0.06, 0, 1.4 + (i * 0.04), -0.8 + i * 0.27, P.timberDark, { rx: 0.22 });
  // saw table
  box(b, 1.1, 0.5, 0.45, 0.1, 0.1, 0.0, P.timberDark);
  box(b, 1.2, 0.08, 0.5, 0.1, 0.6, 0.0, P.plank);
  m.parts.push({ geo: new GeoBuilder().add(G.cyl(0.32, 0.32, 0.02, 16), M(0, 0, 0, 0, 0, Math.PI / 2), { color: 0xd0d4dc, metal: 1 }).add(G.cyl(0.06, 0.06, 0.05, 8), M(0, 0, 0, 0, 0, Math.PI / 2), { color: P.iron }).build(), x: 0.1, y: 0.82, z: 0, anim: 'saw' });
  // log pile
  for (let r = 0; r < 3; r++) for (let i = 0; i < 4 - r; i++) b.add(G.cyl(0.13, 0.13, 1.1, 8), M(-1.0 + i * 0.27 + r * 0.13, 0.2 + r * 0.23, 0.95, 0, 0, Math.PI / 2), { color: r % 2 ? 0x7a5030 : 0x8a5a34 });
  // plank stacks
  for (let i = 0; i < 6; i++) box(b, 0.9, 0.05, 0.3, 1.0, 0.1 + i * 0.055, 0.9, i % 2 ? 0xc49a5a : 0xb48a4a);
  box(b, 0.05, 1.5, 0.05, 1.35, 0.1, -0.85, P.timber);
  banner(b, 1.35, 1.5, -0.8, 0.28, 0.6);
  m.flags.push({ x: 1.35, y: 1.95, z: -0.85, w: 0.4, h: 0.22, ry: 0 });
  m.geo = b.build();
  m.height = 1.9;
  return m;
}

export function barracks(): BuildingModel {
  const b = new GeoBuilder(), m = newModel();
  stoneBase(b, 2.8, 2.5, 0.25);
  box(b, 2.5, 0.9, 1.9, 0, 0.25, 0, P.stone, { jitter: 0.12 });
  timberWall(b, 2.5, 0.6, 1.9, 1.15);
  slateRoof(b, 2.7, 2.1, 1.0, 1.72);
  door(b, 0, 0.97, 0.6, 0.75);
  banner(b, -0.75, 1.55, 0.98, 0.36, 0.95);
  banner(b, 0.75, 1.55, 0.98, 0.36, 0.95);
  torchOn(b, m, -0.45, 0.65, 1.0);
  torchOn(b, m, 0.45, 0.65, 1.0);
  // weapon rack with spears + shields
  box(b, 0.9, 0.06, 0.1, -0.85, 0.6, 1.05, P.timber);
  for (let i = 0; i < 4; i++) { b.add(G.cyl(0.015, 0.015, 1.1, 4), M(-1.2 + i * 0.22, 0.55, 1.05, 0.1, 0, 0), { color: P.timber }); b.add(G.cone(0.03, 0.12, 4), M(-1.2 + i * 0.22, 1.15, 1.1), { color: 0xd0d4dc, metal: 1 }); }
  for (let i = 0; i < 2; i++) b.add(G.cyl(0.18, 0.18, 0.04, 10), M(-1.05 + i * 0.4, 0.35, 1.12, Math.PI / 2, 0, 0), { color: 0xd0d0d0, team: 1 });
  // training dummy
  box(b, 0.05, 0.95, 0.05, 1.0, 0, 1.05, P.timber);
  box(b, 0.55, 0.05, 0.05, 1.0, 0.7, 1.05, P.timber);
  b.add(G.capsule(0.13, 0.25, 3, 8), M(1.0, 0.65, 1.05), { color: P.wheat });
  b.add(G.sphere(0.11, 8, 6), M(1.0, 1.02, 1.05), { color: P.wheat });
  m.flags.push({ x: 0, y: 2.85, z: 0, w: 0.55, h: 0.3, ry: 0 });
  b.add(G.cyl(0.02, 0.02, 0.7, 4), M(0, 2.7, 0), { color: P.iron });
  m.geo = b.build();
  m.height = 2.9;
  return m;
}

export function tower(): BuildingModel {
  const b = new GeoBuilder(), m = newModel();
  stoneBase(b, 1.7, 1.7, 0.2);
  b.add(G.cyl(0.55, 0.7, 2.4, 10), M(0, 1.4, 0), { color: P.stone, jitter: 0.12, shade: 0.4 });
  for (let r = 0; r < 5; r++) b.add(G.torus(0.62 - r * 0.025, 0.02, 3, 12), M(0, 0.5 + r * 0.45, 0, Math.PI / 2, 0, 0), { color: P.stoneDark });
  windowLit(b, 0, 1.4, 0.62);
  door(b, 0, 0.66, 0.36, 0.55);
  // wooden platform + railing + roof
  b.add(G.cyl(0.85, 0.75, 0.15, 10), M(0, 2.65, 0), { color: P.plank });
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; box(b, 0.05, 0.4, 0.05, Math.cos(a) * 0.8, 2.72, Math.sin(a) * 0.8, P.timber); }
  b.add(G.torus(0.8, 0.025, 3, 16), M(0, 3.1, 0, Math.PI / 2, 0, 0), { color: P.timber });
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.4; box(b, 0.07, 0.8, 0.07, Math.cos(a) * 0.65, 2.72, Math.sin(a) * 0.65, P.timberDark); }
  b.add(G.cone(1.05, 0.9, 10), M(0, 3.95, 0), { color: P.thatchDark, shade: 0.4 });
  torchOn(b, m, 0.5, 2.85, 0.55);
  m.flags.push({ x: 0, y: 4.75, z: 0, w: 0.5, h: 0.28, ry: 0 });
  b.add(G.cyl(0.02, 0.02, 0.6, 4), M(0, 4.6, 0), { color: P.iron });
  m.geo = b.build();
  m.height = 4.8;
  return m;
}

/** Scaffolding drawn around buildings under construction. */
export function scaffold(w: number, d: number, h: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  box(b, w + 0.1, 0.12, d + 0.1, 0, 0, 0, P.stoneDark, { jitter: 0.12 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(b, 0.07, h, 0.07, (sx * w) / 2, 0, (sz * d) / 2, P.plank);
  for (let y = 0.5; y < h; y += 0.6) {
    box(b, w, 0.05, 0.06, 0, y, d / 2, P.plank);
    box(b, w, 0.05, 0.06, 0, y, -d / 2, P.plank);
    box(b, 0.06, 0.05, d, w / 2, y, 0, P.plank);
    box(b, 0.06, 0.05, d, -w / 2, y, 0, P.plank);
  }
  for (let i = 0; i < 4; i++) box(b, 0.6, 0.06, 0.12, w / 2 + 0.3, 0.06 * i, d / 3, i % 2 ? 0xb48a4a : 0xc49a5a);
  b.add(G.dodeca(0.2), M(-w / 2 - 0.25, 0.15, d / 3), { color: P.stone });
  return b.build();
}

// ------------------------------------------------------------------ evil structures
export function darkCore(level: number): BuildingModel {
  const b = new GeoBuilder(), m = newModel();
  const s = 0.9 + level * 0.18;
  b.add(G.cyl(2.0, 2.3, 0.12, 14), M(0, 0, 0), { color: 0x2a2028, jitter: 0.15 });
  b.add(lumpy(G.octa(0.9 * s), 0.08, 3), M(0, 1.6 * s, 0, 0, 0.3, 0, 0.75, 2.1, 0.75), { color: P.obsidian, metal: 1, shade: 0.2 });
  for (let i = 0; i < 5 + level * 2; i++) {
    const a = (i / (5 + level * 2)) * Math.PI * 2;
    const r = 0.75 + (i % 2) * 0.3;
    b.add(lumpy(G.octa(0.35 * s), 0.05, i), M(Math.cos(a) * r, 0.45 * s, Math.sin(a) * r, Math.cos(a) * 0.5, a, Math.sin(a) * 0.5, 0.55, 1.7, 0.55), { color: P.obsidian, metal: 1, shade: 0.25 });
  }
  // glowing veins
  for (let i = 0; i < 6; i++) b.add(G.box(0.05, 1.6 * s, 0.05), M(Math.cos(i) * 0.25, 1.5 * s, Math.sin(i) * 0.25, Math.sin(i) * 0.12, 0, Math.cos(i) * 0.12), { color: P.toxic, glow: 1, shade: 0 });
  // bone spikes ring + skulls
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.add(G.cone(0.08, 0.6 + (i % 3) * 0.2, 5), M(Math.cos(a) * 1.75, 0.3, Math.sin(a) * 1.75, Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3), { color: P.bone });
    if (i % 3 === 0) b.add(G.sphere(0.12, 8, 6), M(Math.cos(a) * 1.5, 0.15, Math.sin(a) * 1.5), { color: P.bone });
  }
  m.lights.push({ x: 0, y: 2.2 * s, z: 0, kind: 'toxic' });
  for (let i = 0; i < 2 + level * 2; i++) {
    m.parts.push({ geo: new GeoBuilder().add(lumpy(G.octa(0.22), 0.04, i + 9), M(0, 0, 0, 0, 0, 0, 0.6, 1.5, 0.6), { color: P.obsidian, metal: 1 }).add(G.box(0.03, 0.4, 0.03), M(0, 0, 0.08), { color: P.toxic, glow: 1, shade: 0 }).build(), x: Math.cos(i * 1.4) * 1.3, y: 2.4 * s + (i % 3) * 0.3, z: Math.sin(i * 1.4) * 1.3, anim: 'float' });
  }
  m.geo = b.build();
  m.height = 3.6 * s;
  return m;
}

export function graveyard(): BuildingModel {
  const b = new GeoBuilder(), m = newModel();
  b.add(G.cyl(2.1, 2.2, 0.08, 14), M(0, 0, 0, 0, 0, 0, 1, 1, 0.75), { color: 0x2e2622, jitter: 0.15 });
  for (let i = 0; i < 9; i++) {
    const x = -1.4 + (i % 5) * 0.7 + (i > 4 ? 0.35 : 0), z = -0.7 + Math.floor(i / 5) * 0.9;
    if (i % 3 === 0) {
      b.add(G.box(0.08, 0.6, 0.08), M(x, 0.3, z, 0, 0, (i % 2 ? 0.2 : -0.15)), { color: 0x8a8680 });
      b.add(G.box(0.35, 0.08, 0.08), M(x, 0.45, z, 0, 0, (i % 2 ? 0.2 : -0.15)), { color: 0x8a8680 });
    } else {
      b.add(G.box(0.32, 0.45, 0.1), M(x, 0.22, z, 0.1, (i - 4) * 0.1, (i % 2 ? 0.15 : -0.12)), { color: 0x8a8680, jitter: 0.1 });
      b.add(G.cyl(0.16, 0.16, 0.1, 8), M(x, 0.45, z, Math.PI / 2 + 0.1, 0, (i % 2 ? 0.15 : -0.12)), { color: 0x8a8680 });
    }
    b.add(G.box(0.35, 0.05, 0.6), M(x, 0.03, z + 0.4), { color: P.dirt });
  }
  // open grave + fence
  box(b, 0.5, 0.05, 0.9, 1.3, 0, 0.55, 0x0a0806);
  for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; if (i === 3 || i === 4) continue; box(b, 0.03, 0.55, 0.03, Math.cos(a) * 2.0, 0, Math.sin(a) * 1.5, P.iron, { metal: 1 }); b.add(G.cone(0.03, 0.08, 4), M(Math.cos(a) * 2.0, 0.6, Math.sin(a) * 1.5), { color: P.iron }); }
  // dead tree
  b.add(G.cyl(0.07, 0.12, 1.4, 6), M(-1.6, 0.7, -0.9, 0.1, 0, 0.15), { color: 0x2a221e });
  for (let i = 0; i < 3; i++) b.add(G.cyl(0.02, 0.04, 0.6, 4), M(-1.6 + Math.cos(i * 2) * 0.2, 1.2 + i * 0.1, -0.9 + Math.sin(i * 2) * 0.2, Math.sin(i * 2) * 0.9, 0, -Math.cos(i * 2) * 0.9), { color: 0x2a221e });
  // green candles
  for (const [x, z] of [[-0.5, 0.2], [0.6, -0.4], [0.2, 0.9]]) {
    b.add(G.cyl(0.03, 0.03, 0.15, 5), M(x, 0.08, z), { color: 0xe8e0c8 });
    b.add(G.ico(0.035, 0), M(x, 0.2, z), { color: P.toxic, glow: 1, shade: 0 });
  }
  m.lights.push({ x: 0, y: 0.6, z: 0.2, kind: 'toxic' });
  m.geo = b.build();
  m.height = 1.5;
  return m;
}

const cache = new Map<string, BuildingModel>();
export function buildingModel(def: string, level = 1): BuildingModel {
  const key = def + ':' + level;
  let m = cache.get(key);
  if (m) return m;
  switch (def) {
    case 'townhall': m = level >= 2 ? townhall2() : townhall1(); break;
    case 'house': m = house(); break;
    case 'farm': m = farm(); break;
    case 'sawmill': m = sawmill(); break;
    case 'barracks': m = barracks(); break;
    case 'tower': m = tower(); break;
    case 'dark_core': m = darkCore(level); break;
    case 'graveyard': m = graveyard(); break;
    default: m = house();
  }
  cache.set(key, m);
  return m;
}
