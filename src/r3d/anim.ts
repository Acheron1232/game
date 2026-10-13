/**
 * Procedural skeletal animation. Base layer (idle / walk / run / mounted) + action layer
 * (attack variants per weapon style, work, cast, hit reaction) + full-body death, all crossfaded.
 * Clips are code, so mods can register new ones at runtime.
 */
import type * as THREE from 'three/webgpu';
import type { WeaponStyle } from './characters';

type Rot = [number, number, number];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PoseSpec = Record<string, any>;

const TAU = Math.PI * 2;
const ease = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/** Keyframed clip sampled with smoothstep between keys. */
function keys(frames: [number, PoseSpec][]) {
  return (t: number, out: PoseSpec) => {
    let i = 0;
    while (i < frames.length - 2 && t > frames[i + 1][0]) i++;
    const [t0, a] = frames[i], [t1, b] = frames[i + 1];
    const k = ease(clamp01((t - t0) / Math.max(1e-6, t1 - t0)));
    const names = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const n of names) {
      if (n === '_hy' || n === '_hz') { (out as any)[n] = ((a as any)[n] ?? 0) + (((b as any)[n] ?? 0) - ((a as any)[n] ?? 0)) * k; continue; }
      const ra = (a[n] ?? [0, 0, 0]) as Rot, rb = (b[n] ?? [0, 0, 0]) as Rot;
      out[n] = [ra[0] + (rb[0] - ra[0]) * k, ra[1] + (rb[1] - ra[1]) * k, ra[2] + (rb[2] - ra[2]) * k];
    }
  };
}

// ------------------------------------------------------------------ base layer
/** Weapon-holding stance offsets added to idle/walk. */
const STANCE: Record<WeaponStyle, PoseSpec> = {
  slash: { armR: [-0.25, 0, -0.12], foreR: [-0.9, 0, 0], handR: [0.2, 0, 0], armL: [-0.55, 0, 0.12], foreL: [-1.25, 1.15, 0] },
  thrust: { armR: [-0.1, 0, -0.18], foreR: [-1.45, 0, 0], handR: [0.1, 0, 0], armL: [-0.5, 0, 0.12], foreL: [-1.2, 1.1, 0] },
  bow: { armL: [-0.45, 0, 0.1], foreL: [-0.5, 0, 0], armR: [0.1, 0, -0.1], foreR: [-0.3, 0, 0] },
  cast: { armR: [-0.25, 0, -0.2], foreR: [-0.55, 0, 0], armL: [-0.2, 0, 0.15], foreL: [-0.6, 0, 0] },
  chop: { armR: [-0.15, 0, -0.1], foreR: [-0.7, 0, 0], armL: [0.05, 0, 0.1], foreL: [-0.3, 0, 0] },
  claw: { armR: [-0.9, 0, -0.15], foreR: [-0.5, 0, 0], armL: [-0.9, 0, 0.15], foreL: [-0.5, 0, 0], chest: [0.35, 0, 0], head: [-0.3, 0, 0] },
  none: { armR: [-0.2, 0, -0.1], foreR: [-0.4, 0, 0], armL: [0.05, 0, 0.1], foreL: [-0.2, 0, 0] },
};

function idle(t: number, out: PoseSpec, style: WeaponStyle, phase: number) {
  const b = Math.sin(t * 2.2 + phase);
  Object.assign(out, structuredClone(STANCE[style]));
  out.chest = add(out.chest, [b * 0.025, Math.sin(t * 0.7 + phase) * 0.05, 0]);
  out.head = add(out.head, [-b * 0.02, Math.sin(t * 0.45 + phase * 2) * 0.25, 0]);
  out.armL = add(out.armL, [b * 0.03, 0, 0]);
  out.armR = add(out.armR, [-b * 0.03, 0, 0]);
  out.thighL = [0.05, 0, 0.04]; out.thighR = [-0.08, 0, -0.04];
  out.shinL = [0.1, 0, 0]; out.shinR = [0.12, 0, 0];
  out.footL = [-0.12, 0, 0]; out.footR = [-0.04, 0, 0];
  out.cape = [0.12 + b * 0.02, 0, 0];
  out._hy = -0.01 + b * 0.004;
}

function walk(t: number, out: PoseSpec, style: WeaponStyle, run: number, heavy: number) {
  const p = t * TAU;
  const s = Math.sin(p), c = Math.cos(p);
  const amp = 0.55 + run * 0.35;
  Object.assign(out, structuredClone(STANCE[style]));
  out.thighL = [-s * amp, 0, 0.02];
  out.thighR = [s * amp, 0, -0.02];
  out.shinL = [Math.max(0, -c) * (0.9 + run * 0.6) + 0.1, 0, 0];
  out.shinR = [Math.max(0, c) * (0.9 + run * 0.6) + 0.1, 0, 0];
  out.footL = [s * 0.25, 0, 0];
  out.footR = [-s * 0.25, 0, 0];
  const armAmp = style === 'claw' ? 0.15 : 0.45 + run * 0.4;
  out.armL = add(out.armL, [s * armAmp * (style === 'slash' || style === 'thrust' ? 0.3 : 1), 0, 0]);
  out.armR = add(out.armR, [-s * armAmp * (style === 'chop' || style === 'none' || style === 'bow' ? 1 : 0.35), 0, 0]);
  out.spine = [run * 0.12 + heavy * 0.25, s * 0.12, 0];
  out.chest = add(out.chest, [run * 0.08, s * 0.08, 0]);
  out.head = add(out.head, [-run * 0.12, -s * 0.08, 0]);
  out.cape = [0.35 + run * 0.6 + Math.abs(c) * 0.1, 0, s * 0.05];
  out.hips = [0, -s * 0.1, c * 0.04 * (1 + heavy * 2)];
  out._hy = -Math.abs(c) * (0.025 + run * 0.02) + 0.01;
}

/** Seated rider pose on a horse. */
function riderBase(t: number, out: PoseSpec, moving: boolean) {
  Object.assign(out, structuredClone(STANCE.cast));
  out.thighL = [-1.35, 0, 0.45]; out.thighR = [-1.35, 0, -0.45];
  out.shinL = [1.25, 0, 0]; out.shinR = [1.25, 0, 0];
  out.footL = [0.2, 0, 0]; out.footR = [0.2, 0, 0];
  const b = moving ? Math.sin(t * TAU * 2) : Math.sin(t * 2);
  out.spine = [moving ? 0.1 : 0.02, 0, 0];
  out.chest = [b * (moving ? 0.05 : 0.015), 0, 0];
  out.cape = [moving ? 0.6 : 0.15, 0, 0];
  out.head = [0, Math.sin(t * 0.5) * 0.15, 0];
}

function horse(t: number, out: PoseSpec, moving: boolean, speed: number) {
  if (moving) {
    // trot: diagonal pairs move together
    const p = t * TAU;
    const a = Math.sin(p), bb = Math.sin(p + Math.PI);
    const amp = 0.45 + speed * 0.1;
    out.legFL = [-a * amp, 0, 0]; out.kneeFL = [Math.max(0, Math.cos(p)) * 0.9, 0, 0];
    out.legBR = [-a * amp, 0, 0]; out.kneeBR = [-Math.max(0, Math.cos(p)) * 0.5, 0, 0];
    out.legFR = [-bb * amp, 0, 0]; out.kneeFR = [Math.max(0, -Math.cos(p)) * 0.9, 0, 0];
    out.legBL = [-bb * amp, 0, 0]; out.kneeBL = [-Math.max(0, -Math.cos(p)) * 0.5, 0, 0];
    out.hbody = [Math.sin(p * 2) * 0.03, 0, 0];
    out.hneck = [Math.sin(p * 2) * 0.08 - 0.05, 0, 0];
    out.hhead = [Math.sin(p * 2 + 1) * 0.06, 0, 0];
    out.htail = [0.4 + Math.sin(p * 2) * 0.15, Math.sin(p) * 0.2, 0];
    out._hy = -Math.abs(Math.cos(p)) * 0.045;
  } else {
    const graze = Math.max(0, Math.sin(t * 0.25) - 0.7) * 3.3;
    out.hneck = [graze * 0.9 + Math.sin(t * 1.5) * 0.02, 0, 0];
    out.hhead = [graze * 0.5, Math.sin(t * 0.8) * 0.1, 0];
    out.htail = [0.15, Math.sin(t * 2.4) * 0.35, 0];
    out.legFL = [0, 0, 0]; out.legBR = [0.05, 0, 0]; out.legFR = [-0.05, 0, 0]; out.kneeBL = [-0.15, 0, 0];
    out.hbody = [Math.sin(t * 1.8) * 0.01, 0, 0];
    out._hy = Math.sin(t * 1.8) * 0.004;
  }
}

// ------------------------------------------------------------------ action layer (normalized time 0..1)
export const ACTIONS: Record<string, (t: number, out: PoseSpec) => void> = {
  slash: keys([
    [0, { armR: [-0.25, 0, -0.12], foreR: [-0.9, 0, 0], chest: [0, 0, 0], spine: [0, 0, 0], armL: [-0.55, 0, 0.12], foreL: [-1.25, 1.15, 0] }],
    [0.38, { armR: [-2.7, 0.3, -0.5], foreR: [-1.4, 0, 0], handR: [0.4, 0, 0], chest: [-0.15, 0.55, 0], spine: [-0.05, 0.2, 0], armL: [-0.7, 0, 0.3], foreL: [-1.3, 1.15, 0], head: [0.1, -0.3, 0] }],
    [0.58, { armR: [-0.6, -0.3, -0.15], foreR: [-0.15, 0, 0], handR: [-0.2, 0, 0], chest: [0.25, -0.55, 0], spine: [0.15, -0.2, 0], armL: [-0.3, 0, 0.2], foreL: [-1.1, 1.15, 0], head: [-0.1, 0.25, 0], _hz: 0.06 }],
    [1, { armR: [-0.25, 0, -0.12], foreR: [-0.9, 0, 0], chest: [0, 0, 0], spine: [0, 0, 0], armL: [-0.55, 0, 0.12], foreL: [-1.25, 1.15, 0] }],
  ]),
  thrust: keys([
    [0, { armR: [-0.1, 0, -0.18], foreR: [-1.45, 0, 0], armL: [-0.5, 0, 0.12], foreL: [-1.2, 1.1, 0] }],
    [0.4, { armR: [0.45, 0, -0.25], foreR: [-1.6, 0, 0], chest: [-0.1, 0.45, 0], spine: [-0.05, 0.15, 0], armL: [-0.7, 0, 0.2], foreL: [-1.3, 1.1, 0] }],
    [0.6, { armR: [-1.35, 0, -0.05], foreR: [-0.15, 0, 0], handR: [-0.1, 0, 0], chest: [0.25, -0.35, 0], spine: [0.15, -0.1, 0], armL: [-0.3, 0, 0.2], foreL: [-1.1, 1.1, 0], _hz: 0.1 }],
    [1, { armR: [-0.1, 0, -0.18], foreR: [-1.45, 0, 0], armL: [-0.5, 0, 0.12], foreL: [-1.2, 1.1, 0] }],
  ]),
  bow: keys([
    [0, { armL: [-0.45, 0, 0.1], foreL: [-0.5, 0, 0], armR: [0.1, 0, -0.1], foreR: [-0.3, 0, 0] }],
    [0.3, { armL: [-1.5, 0.3, 0.05], foreL: [-0.05, 0, 0], armR: [-1.4, -0.2, -0.1], foreR: [-1.2, 0, 0], chest: [0, -0.7, 0], spine: [0, -0.3, 0], head: [0, 0.75, 0] }],
    [0.72, { armL: [-1.55, 0.3, 0.05], foreL: [0, 0, 0], armR: [-1.45, 0.4, -0.3], foreR: [-2.3, 0, 0], chest: [-0.05, -0.75, 0], spine: [0, -0.3, 0], head: [0, 0.8, 0] }],
    [0.78, { armL: [-1.5, 0.3, 0.05], foreL: [0, 0, 0], armR: [-1.0, 0.6, -0.6], foreR: [-0.5, 0, 0], chest: [0, -0.7, 0], spine: [0, -0.3, 0], head: [0, 0.75, 0] }],
    [1, { armL: [-0.45, 0, 0.1], foreL: [-0.5, 0, 0], armR: [0.1, 0, -0.1], foreR: [-0.3, 0, 0] }],
  ]),
  cast: keys([
    [0, { armR: [-0.25, 0, -0.2], foreR: [-0.55, 0, 0], armL: [-0.2, 0, 0.15], foreL: [-0.6, 0, 0] }],
    [0.4, { armR: [-2.9, 0, -0.25], foreR: [-0.2, 0, 0], armL: [-1.2, 0, 0.5], foreL: [-0.6, 0, 0], chest: [-0.2, 0.15, 0], head: [-0.25, 0, 0] }],
    [0.6, { armR: [-1.5, 0, -0.05], foreR: [0, 0, 0], armL: [-1.4, 0, 0.3], foreL: [-0.2, 0, 0], chest: [0.25, -0.1, 0], head: [0.1, 0, 0] }],
    [1, { armR: [-0.25, 0, -0.2], foreR: [-0.55, 0, 0], armL: [-0.2, 0, 0.15], foreL: [-0.6, 0, 0] }],
  ]),
  chop: keys([
    [0, { armR: [-0.15, 0, -0.1], foreR: [-0.7, 0, 0], armL: [0.05, 0, 0.1], foreL: [-0.3, 0, 0] }],
    [0.42, { armR: [-2.8, 0, -0.1], foreR: [-1.1, 0, 0], armL: [-2.6, 0, 0.25], foreL: [-1.1, 0, 0], chest: [-0.25, 0.1, 0], spine: [-0.1, 0, 0], head: [-0.15, 0, 0] }],
    [0.58, { armR: [-0.9, 0, -0.05], foreR: [-0.2, 0, 0], armL: [-0.9, 0, 0.3], foreL: [-0.3, 0, 0], chest: [0.4, 0, 0], spine: [0.25, 0, 0], head: [0.2, 0, 0], _hy: -0.03 }],
    [1, { armR: [-0.15, 0, -0.1], foreR: [-0.7, 0, 0], armL: [0.05, 0, 0.1], foreL: [-0.3, 0, 0] }],
  ]),
  claw: keys([
    [0, { armR: [-0.9, 0, -0.15], foreR: [-0.5, 0, 0], armL: [-0.9, 0, 0.15], foreL: [-0.5, 0, 0], chest: [0.35, 0, 0] }],
    [0.45, { armR: [-2.6, 0, -0.5], foreR: [-0.8, 0, 0], armL: [-2.4, 0, 0.5], foreL: [-0.8, 0, 0], chest: [-0.15, 0, 0], head: [-0.4, 0, 0] }],
    [0.65, { armR: [-0.5, 0, 0.1], foreR: [-0.2, 0, 0], armL: [-0.6, 0, -0.1], foreL: [-0.2, 0, 0], chest: [0.6, 0, 0], spine: [0.2, 0, 0], head: [0.1, 0, 0], _hz: 0.08 }],
    [1, { armR: [-0.9, 0, -0.15], foreR: [-0.5, 0, 0], armL: [-0.9, 0, 0.15], foreL: [-0.5, 0, 0], chest: [0.35, 0, 0] }],
  ]),
  /** casting while mounted: same as cast but legs stay seated (the mask excludes legs) */
  hit: keys([
    [0, {}],
    [0.3, { chest: [-0.35, 0.15, 0], head: [-0.3, 0, 0], spine: [-0.1, 0, 0], _hz: -0.05 }],
    [1, {}],
  ]),
};

/** Full-body death clip. */
function death(t: number, out: PoseSpec, mounted: boolean) {
  const k = ease(clamp01(t / 0.7));
  if (mounted) {
    out.legFL = [-0.6 * k, 0, 0]; out.legFR = [-0.5 * k, 0, 0];
    out.kneeFL = [1.6 * k, 0, 0]; out.kneeFR = [1.4 * k, 0, 0];
    out.legBL = [0.6 * k, 0, 0]; out.legBR = [0.5 * k, 0, 0];
    out.kneeBL = [-1.2 * k, 0, 0]; out.kneeBR = [-1.2 * k, 0, 0];
    out.hbody = [0, 0, 0.35 * k];
    out.hneck = [0.6 * k, 0, 0];
    out._hy = -0.38 * k;
    out.chest = [-0.6 * k, 0, 0.3 * k];
    out.head = [-0.5 * k, 0, 0];
    return;
  }
  out.thighL = [-0.6 * k, 0, 0.1]; out.thighR = [-0.3 * k, 0, -0.1];
  out.shinL = [0.9 * k, 0, 0]; out.shinR = [0.6 * k, 0, 0];
  out.armL = [-1.2 * k, 0, 0.6 * k]; out.armR = [-1.4 * k, 0, -0.5 * k];
  out.foreL = [-0.3 * k, 0, 0]; out.foreR = [-0.3 * k, 0, 0];
  out.chest = [-0.2 * k, 0, 0]; out.head = [-0.4 * k, 0.3 * k, 0];
  out.root = [-Math.PI / 2 * ease(clamp01((t - 0.15) / 0.55)), 0, 0];
  out._hy = 0.08 * k;
}

function add(a: Rot | undefined, b: Rot): Rot {
  return a ? [a[0] + b[0], a[1] + b[1], a[2] + b[2]] : b;
}

const UPPER = new Set(['spine', 'chest', 'neck', 'head', 'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR', 'cape']);

// ------------------------------------------------------------------ animator
export interface AnimInput {
  /** movement speed in tiles/s (0 = standing) */
  speed: number;
  /** normalized swing progress 0..1, or -1 when not swinging */
  swing: number;
  /** action clip for the swing */
  action: string;
  dead: boolean;
  deadT: number;
  hitT: number;
}

export class Animator {
  private names: string[];
  private bones: THREE.Bone[];
  private base: PoseSpec = {};
  private act: PoseSpec = {};
  private prev: Float32Array;
  private cur: Float32Array;
  private hy0: number;
  private walkT = Math.random();
  private time = Math.random() * 100;
  private actW = 0;
  private phase = Math.random() * 10;
  private hz = 0;

  constructor(bones: THREE.Bone[], private style: WeaponStyle, private mounted: boolean, private heavy = 0) {
    this.bones = bones;
    this.names = bones.map((b) => b.name);
    this.prev = new Float32Array(bones.length * 3);
    this.cur = new Float32Array(bones.length * 3);
    const hips = bones.find((b) => b.name === (mounted ? 'hbody' : 'hips'))!;
    this.hy0 = hips.position.y;
  }

  update(dt: number, inp: AnimInput) {
    this.time += dt;
    const moving = inp.speed > 0.05;
    // base layer
    const base: PoseSpec = (this.base = {});
    if (this.mounted) {
      this.walkT += dt * Math.max(0.9, inp.speed * 0.55);
      horse(moving ? this.walkT : this.time, base, moving, inp.speed);
      riderBase(moving ? this.walkT : this.time, base, moving);
    } else if (moving) {
      const run = Math.min(1, Math.max(0, (inp.speed - 2.2) / 1.2));
      this.walkT += dt * inp.speed * (0.62 - run * 0.1);
      walk(this.walkT, base, this.style, run, this.heavy);
    } else idle(this.time, base, this.style, this.phase);
    // action layer
    const act: PoseSpec = (this.act = {});
    let w = 0;
    if (inp.swing >= 0 && ACTIONS[inp.action]) {
      ACTIONS[inp.action](inp.swing, act);
      w = 1;
    }
    this.actW += (w - this.actW) * Math.min(1, dt * (w > this.actW ? 30 : 10));
    if (inp.hitT > 0 && inp.hitT < 0.3) ACTIONS.hit(inp.hitT / 0.3, act);
    // compose
    const out = this.cur;
    out.fill(0);
    let hy = (base._hy ?? 0), hz = 0;
    for (let i = 0; i < this.names.length; i++) {
      const n = this.names[i];
      const b = base[n] ?? [0, 0, 0];
      const a = act[n];
      let r: Rot = b as Rot;
      if (a && (UPPER.has(n) || !moving)) {
        const k = n === 'chest' || n === 'spine' || n === 'head' ? this.actW : this.actW;
        r = [b[0] + (a[0] - b[0]) * k, b[1] + (a[1] - b[1]) * k, b[2] + (a[2] - b[2]) * k];
      }
      out[i * 3] = r[0]; out[i * 3 + 1] = r[1]; out[i * 3 + 2] = r[2];
    }
    if (act._hy != null) hy += act._hy * this.actW;
    if (act._hz != null) hz += act._hz * this.actW;
    if (inp.dead) {
      const d: PoseSpec = {};
      death(inp.deadT, d, this.mounted);
      for (let i = 0; i < this.names.length; i++) {
        const r = d[this.names[i]];
        if (r) { out[i * 3] = r[0]; out[i * 3 + 1] = r[1]; out[i * 3 + 2] = r[2]; }
      }
      hy = d._hy ?? hy;
    }
    // smooth towards target pose (removes pops between states)
    const k = 1 - Math.exp(-dt * 22);
    for (let i = 0; i < out.length; i++) this.prev[i] += (out[i] - this.prev[i]) * k;
    this.hz += (hz - this.hz) * k;
    for (let i = 0; i < this.bones.length; i++) this.bones[i].rotation.set(this.prev[i * 3], this.prev[i * 3 + 1], this.prev[i * 3 + 2]);
    const hips = this.bones[this.names.indexOf(this.mounted ? 'hbody' : 'hips')];
    hips.position.y = this.hy0 + hy;
    hips.position.z = this.hz;
  }
}
