/**
 * Low-poly model construction kit. Parts are primitive geometries with per-vertex color plus
 * extra attributes: `team` (tinted by faction color), `glow` (always emissive), `night`
 * (emissive at night — windows), `metal` (shinier). Parts can be bound to skeleton bones.
 */
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface PartOpts {
  color: number;
  team?: number;
  glow?: number;
  night?: number;
  metal?: number;
  bone?: number;
  /** darken towards the bottom of the part (cheap painterly AO) */
  shade?: number;
  /** random per-face color jitter */
  jitter?: number;
}

const _c = new THREE.Color();

export function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  return m;
}

// primitive shortcuts (low poly, stylized)
export const G = {
  box: (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d),
  cyl: (rt: number, rb: number, h: number, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg),
  cone: (r: number, h: number, seg = 8) => new THREE.ConeGeometry(r, h, seg),
  sphere: (r: number, ws = 10, hs = 8) => new THREE.SphereGeometry(r, ws, hs),
  ico: (r: number, d = 0) => new THREE.IcosahedronGeometry(r, d),
  octa: (r: number) => new THREE.OctahedronGeometry(r, 0),
  dodeca: (r: number) => new THREE.DodecahedronGeometry(r, 0),
  capsule: (r: number, len: number, cap = 4, rad = 8) => new THREE.CapsuleGeometry(r, len, cap, rad),
  torus: (r: number, t: number, rs = 6, ts = 12, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, rs, ts, arc),
  /** box tapered to the top: w0 bottom width, w1 top width */
  taper: (w0: number, w1: number, h: number, d0: number, d1 = d0) => {
    const g = new THREE.BoxGeometry(1, h, 1);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const top = p.getY(i) > 0;
      p.setX(i, p.getX(i) * (top ? w1 : w0));
      p.setZ(i, p.getZ(i) * (top ? d1 : d0));
    }
    g.computeVertexNormals();
    return g;
  },
  /** triangular prism roof: width (x), height (y), depth (z) */
  roof: (w: number, h: number, d: number, overhang = 0) => {
    const s = new THREE.Shape();
    s.moveTo(-w / 2 - overhang, 0);
    s.lineTo(0, h);
    s.lineTo(w / 2 + overhang, 0);
    s.lineTo(-w / 2 - overhang, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
    g.translate(0, 0, -d / 2);
    return g;
  },
  /** flat shape extruded (for shields, blades) */
  shape: (pts: [number, number][], depth: number) => {
    const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
    g.translate(0, 0, -depth / 2);
    return g;
  },
  /** lathe for vases, hats, robes */
  lathe: (pts: [number, number][], seg = 10) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg),
};

/** Deform vertices with noise (rocks, foliage) */
export function lumpy(g: THREE.BufferGeometry, amount: number, seed = 1) {
  const p = g.attributes.position as THREE.BufferAttribute;
  const key = (x: number, y: number, z: number) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
  const off = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const k = key(p.getX(i), p.getY(i), p.getZ(i));
    let o = off.get(k);
    if (o == null) {
      const s = Math.sin(p.getX(i) * 12.9898 * seed + p.getY(i) * 78.233 + p.getZ(i) * 37.719) * 43758.5453;
      o = (s - Math.floor(s) - 0.5) * 2 * amount;
      off.set(k, o);
    }
    const len = Math.hypot(p.getX(i), p.getY(i), p.getZ(i)) || 1;
    p.setXYZ(i, p.getX(i) * (1 + o / len), p.getY(i) * (1 + o / len), p.getZ(i) * (1 + o / len));
  }
  g.computeVertexNormals();
  return g;
}

export class GeoBuilder {
  private parts: THREE.BufferGeometry[] = [];
  private seed = 1;

  add(geo: THREE.BufferGeometry, m: THREE.Matrix4, o: PartOpts) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    geo.dispose();
    g.deleteAttribute('uv');
    if (g.attributes.uv1) g.deleteAttribute('uv1');
    g.applyMatrix4(m);
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const team = new Float32Array(n), glow = new Float32Array(n), night = new Float32Array(n), metal = new Float32Array(n);
    const skinI = new Uint16Array(n * 4), skinW = new Float32Array(n * 4);
    const pos = g.attributes.position as THREE.BufferAttribute;
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) { const y = pos.getY(i); if (y < minY) minY = y; if (y > maxY) maxY = y; }
    const shade = o.shade ?? 0.25, jitter = o.jitter ?? 0.04;
    _c.setHex(o.color);
    for (let i = 0; i < n; i += 3) {
      const j = 1 + (rand(this.seed++) - 0.5) * 2 * jitter;
      for (let k = 0; k < 3 && i + k < n; k++) {
        const v = i + k;
        const h = maxY > minY ? (pos.getY(v) - minY) / (maxY - minY) : 1;
        const s = (1 - shade + shade * h) * j;
        col[v * 3] = _c.r * s; col[v * 3 + 1] = _c.g * s; col[v * 3 + 2] = _c.b * s;
        team[v] = o.team ?? 0; glow[v] = o.glow ?? 0; night[v] = o.night ?? 0; metal[v] = o.metal ?? 0;
        skinI[v * 4] = o.bone ?? 0; skinW[v * 4] = 1;
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('team', new THREE.BufferAttribute(team, 1));
    g.setAttribute('glow', new THREE.BufferAttribute(glow, 1));
    g.setAttribute('night', new THREE.BufferAttribute(night, 1));
    g.setAttribute('metal', new THREE.BufferAttribute(metal, 1));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinI, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(skinW, 4));
    this.parts.push(g);
    return this;
  }

  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts, false)!;
    for (const p of this.parts) p.dispose();
    this.parts = [];
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  get empty() {
    return this.parts.length === 0;
  }
}

function rand(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
