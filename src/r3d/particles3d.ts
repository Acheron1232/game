/**
 * GPU-instanced particles: additive billboards (fire, sparks, magic), alpha billboards (smoke,
 * dust, mist) and lit debris cubes (wood chips, stone, bones). One draw call per pool.
 */
import * as THREE from 'three/webgpu';
import { attribute, texture, uv, vec4 } from 'three/tsl';
import { dotTexture, smokeTexture } from './textures';

interface P {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  g: number; drag: number;
  life: number; max: number;
  s0: number; s1: number;
  a0: number;
  r: number; g2: number; b: number;
  rot: number; vr: number;
  fadeIn: number;
  stretch: boolean;
}

export interface Emit {
  n?: number;
  color?: number | number[];
  speed?: [number, number];
  up?: [number, number];
  gravity?: number;
  life?: [number, number];
  size?: [number, number];
  end?: number;
  alpha?: number;
  spread?: number;
  angle?: number;
  drag?: number;
  spin?: number;
  radius?: number;
  fadeIn?: number;
  stretch?: boolean;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

class Pool {
  readonly mesh: THREE.InstancedMesh;
  private parts: P[] = [];
  private alpha: THREE.InstancedBufferAttribute;
  constructor(readonly cap: number, tex: THREE.Texture | null, additive: boolean, lit = false) {
    const geo = lit ? new THREE.BoxGeometry(1, 1, 1) : new THREE.PlaneGeometry(1, 1);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    geo.setAttribute('pAlpha', this.alpha);
    let mat: THREE.Material;
    if (lit) {
      mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.8 });
    } else {
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
      const t = texture(tex!, uv()) as any;
      const a = attribute('pAlpha', 'float') as any;
      m.colorNode = vec4(t.rgb, t.a.mul(a));
      m.opacityNode = t.a.mul(a);
      m.fog = true;
      mat = m;
    }
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 5 : 4;
    if (lit) this.mesh.castShadow = false;
  }
  get count() {
    return this.parts.length;
  }
  emit(x: number, y: number, z: number, o: Emit, quality: number) {
    const n = Math.max(1, Math.round((o.n ?? 6) * quality));
    const cols = Array.isArray(o.color) ? o.color : [o.color ?? 0xffffff];
    for (let i = 0; i < n && this.parts.length < this.cap; i++) {
      const ang = (o.angle ?? 0) + (Math.random() - 0.5) * (o.spread ?? Math.PI * 2);
      const sp = rnd(...(o.speed ?? [0.5, 1.5]));
      const life = rnd(...(o.life ?? [0.4, 0.9]));
      const size = rnd(...(o.size ?? [0.1, 0.2]));
      _c.setHex(cols[(Math.random() * cols.length) | 0]);
      const r = o.radius ?? 0;
      this.parts.push({
        x: x + (Math.random() - 0.5) * r * 2, y, z: z + (Math.random() - 0.5) * r * 2,
        vx: Math.cos(ang) * sp, vz: Math.sin(ang) * sp, vy: rnd(...(o.up ?? [0, 0])),
        g: o.gravity ?? 0, drag: o.drag ?? 1.5, life, max: life, s0: size, s1: o.end ?? size * 0.3, a0: o.alpha ?? 1,
        r: _c.r, g2: _c.g, b: _c.b, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * (o.spin ?? 0), fadeIn: o.fadeIn ?? 0, stretch: !!o.stretch,
      });
    }
  }
  update(dt: number, cam: THREE.Camera, lit: boolean) {
    const ps = this.parts;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) { ps[i] = ps[ps.length - 1]; ps.pop(); continue; }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vz *= k;
      p.vy -= p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (lit && p.y < 0.03 && p.vy < 0) { p.y = 0.03; p.vy *= -0.3; p.vx *= 0.5; p.vz *= 0.5; p.vr *= 0.5; }
      p.rot += p.vr * dt;
    }
    const n = ps.length;
    this.mesh.count = n;
    const col = this.mesh.instanceColor!.array as Float32Array;
    const al = this.alpha.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const p = ps[i];
      const t = 1 - p.life / p.max;
      const s = p.s0 + (p.s1 - p.s0) * t;
      _p.set(p.x, p.y, p.z);
      if (lit) {
        _q.setFromEuler(_e.set(p.rot, p.rot * 0.7, p.rot * 0.3));
        _s.set(s, s, s);
      } else {
        _q.copy(cam.quaternion);
        if (p.stretch) {
          const v = Math.hypot(p.vx, p.vy, p.vz);
          _q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.atan2(p.vy, Math.hypot(p.vx, p.vz) * Math.sign(p.vx || 1))));
          _s.set(s * Math.min(4, 1 + v * 0.25), s * 0.5, 1);
        } else {
          _q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), p.rot));
          _s.set(s, s, 1);
        }
      }
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
      const fi = p.fadeIn > 0 ? Math.min(1, t / p.fadeIn) : 1;
      al[i] = p.a0 * (1 - t * t) * fi;
      col[i * 3] = p.r; col[i * 3 + 1] = p.g2; col[i * 3 + 2] = p.b;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
    this.alpha.needsUpdate = true;
  }
}

export class Particles {
  readonly group = new THREE.Group();
  private add = new Pool(3000, dotTexture(), true);
  private alpha = new Pool(1500, smokeTexture(), false);
  private debris = new Pool(800, null, false, true);
  quality = 1;

  constructor() {
    this.group.add(this.alpha.mesh, this.add.mesh, this.debris.mesh);
  }
  get count() {
    return this.add.count + this.alpha.count + this.debris.count;
  }
  glow(x: number, y: number, z: number, o: Emit) { this.add.emit(x, y, z, o, this.quality); }
  soft(x: number, y: number, z: number, o: Emit) { this.alpha.emit(x, y, z, o, this.quality); }
  chunk(x: number, y: number, z: number, o: Emit) { this.debris.emit(x, y, z, o, this.quality); }

  update(dt: number, cam: THREE.Camera) {
    this.add.update(dt, cam, false);
    this.alpha.update(dt, cam, false);
    this.debris.update(dt, cam, true);
  }

  // ---------------------------------------------------------------- presets (world units)
  fire(x: number, y: number, z: number, scale = 1) {
    this.glow(x, y, z, { n: 1, color: [0xffb040, 0xff7020, 0xffe080], speed: [0.02, 0.1], up: [0.6 * scale, 1.2 * scale], life: [0.35, 0.6], size: [0.18 * scale, 0.3 * scale], end: 0.04, radius: 0.04 * scale });
  }
  embers(x: number, y: number, z: number) {
    this.glow(x, y, z, { n: 1, color: [0xffc060, 0xff8030], speed: [0.1, 0.4], up: [0.8, 1.6], gravity: -0.3, life: [0.8, 1.6], size: [0.03, 0.06], end: 0.01, radius: 0.1 });
  }
  smoke(x: number, y: number, z: number, n = 1, color = 0x777777, alpha = 0.45, size = 0.35) {
    this.soft(x, y, z, { n, color, speed: [0.05, 0.2], up: [0.5, 0.9], life: [2.2, 3.6], size: [size, size * 1.4], end: size * 3.5, alpha, drag: 0.4, angle: 0, spread: 6.28, fadeIn: 0.12, spin: 0.6 });
  }
  dust(x: number, y: number, z: number, n = 6, color = 0xb8a882) {
    this.soft(x, y, z, { n, color, speed: [0.4, 1.4], up: [0.2, 0.7], life: [0.5, 1.1], size: [0.2, 0.35], end: 0.9, alpha: 0.5, drag: 2.5, spin: 1 });
  }
  sparks(x: number, y: number, z: number, color: number | number[] = [0xffe08a, 0xffb040], n = 8) {
    this.glow(x, y, z, { n, color, speed: [1.5, 4], up: [1, 3], gravity: 9, life: [0.25, 0.5], size: [0.06, 0.1], end: 0.02, stretch: true, drag: 1 });
  }
  magic(x: number, y: number, z: number, color: number | number[] = [0x8fd0ff, 0xc8eaff, 0x5aa8ff], n = 14, speed = 2.5) {
    this.glow(x, y, z, { n, color, speed: [speed * 0.3, speed], up: [-0.5, 1.5], life: [0.35, 0.8], size: [0.1, 0.22], end: 0.02, drag: 3 });
  }
  ring(x: number, y: number, z: number, color: number, radius: number) {
    const n = Math.round(radius * 18);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.glow(x + Math.cos(a) * 0.2, y, z + Math.sin(a) * 0.2, { n: 1, color, speed: [radius * 3, radius * 3.4], angle: a, spread: 0.05, life: [0.3, 0.4], size: [0.18, 0.25], end: 0.05, drag: 4 });
    }
  }
  chips(x: number, y: number, z: number, color: number | number[] = 0xb0864a, n = 5) {
    this.chunk(x, y, z, { n, color, speed: [0.8, 2.2], up: [1.5, 3], gravity: 10, life: [0.6, 1.1], size: [0.04, 0.08], end: 0.04, spin: 14, drag: 1 });
  }
  bones(x: number, y: number, z: number) {
    this.chunk(x, y, z, { n: 12, color: [0xe8e0c8, 0xd0c8b0, 0xa8a090], speed: [0.8, 2.5], up: [2, 4], gravity: 10, life: [1, 1.8], size: [0.05, 0.12], end: 0.05, spin: 12, drag: 1 });
    this.glow(x, y, z, { n: 10, color: [0x7dff6a, 0xb0ffb0], speed: [0.2, 1], up: [0.3, 1.2], life: [0.6, 1.2], size: [0.08, 0.16], end: 0.02 });
  }
  blood(x: number, y: number, z: number, color = 0x8a1a1a, n = 6) {
    this.chunk(x, y, z, { n, color, speed: [0.5, 1.6], up: [1, 2.5], gravity: 10, life: [0.4, 0.7], size: [0.03, 0.05], end: 0.03, drag: 1 });
  }
  debrisBurst(x: number, y: number, z: number, w: number) {
    this.chunk(x, y + 0.5, z, { n: 40, color: [0x8a6438, 0x6a4a28, 0x9e988c, 0x726c62, 0xd8b050], speed: [1, 4], up: [2, 6], gravity: 10, life: [1, 2], size: [0.08, 0.22], end: 0.1, spin: 10, drag: 0.6, radius: w * 0.4 });
    for (let i = 0; i < 8; i++) this.dust(x + (Math.random() - 0.5) * w, y + Math.random(), z + (Math.random() - 0.5) * w, 4, 0x8a8070);
  }
  leaves(x: number, y: number, z: number, n = 4, color: number[] = [0x5f9a3a, 0x7cb04a, 0x4a7a2a]) {
    this.chunk(x, y, z, { n, color, speed: [0.3, 1.2], up: [0, 0.8], gravity: 1.2, life: [1.5, 2.6], size: [0.05, 0.08], end: 0.05, spin: 6, drag: 2.5, radius: 0.5 });
  }
}
