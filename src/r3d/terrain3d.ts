/**
 * 3D terrain: heightfield mesh (gentle meadows, forest hills, lake basin), baked splat color map
 * with a close-up detail texture, animated water surface.
 */
import * as THREE from 'three/webgpu';
import { float, mix, positionWorld, sin, texture, time, uv, vec2, vec3, mx_noise_float } from 'three/tsl';
import { fbm, hash2 } from '../engine/rng';
import { Terrain, type World } from '../sim/types';
import { groundImage } from './textures';

const smooth = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

function blurField(world: World, pred: (t: number) => boolean, r: number): Float32Array {
  const { W, H, terrain } = world;
  const ind = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) ind[i] = pred(terrain[i]) ? 1 : 0;
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let o = -r; o <= r; o++) { const xx = Math.min(W - 1, Math.max(0, x + o)); s += ind[y * W + xx]; n++; }
    tmp[y * W + x] = s / n;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let o = -r; o <= r; o++) { const yy = Math.min(H - 1, Math.max(0, y + o)); s += tmp[yy * W + x]; n++; }
    out[y * W + x] = s / n;
  }
  return out;
}

function sample(f: Float32Array, W: number, H: number, x: number, y: number) {
  x -= 0.5; y -= 0.5;
  const x0 = Math.max(0, Math.min(W - 1, Math.floor(x))), y0 = Math.max(0, Math.min(H - 1, Math.floor(y)));
  const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0)), fy = Math.max(0, Math.min(1, y - y0));
  const a = f[y0 * W + x0], b = f[y0 * W + x1], c = f[y1 * W + x0], d = f[y1 * W + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

export class Heightmap {
  readonly h: Float32Array;
  readonly res = 2; // samples per tile
  readonly sw: number;
  readonly sh: number;
  constructor(readonly world: World, flatSpots: { x: number; y: number; r: number }[]) {
    const { W, H } = world;
    this.sw = W * this.res + 1;
    this.sh = H * this.res + 1;
    this.h = new Float32Array(this.sw * this.sh);
    const water = blurField(world, (t) => t === Terrain.Water, 2);
    const forest = blurField(world, (t) => t === Terrain.Forest, 3);
    const road = blurField(world, (t) => t === Terrain.Dirt, 1);
    const cursed = blurField(world, (t) => t === Terrain.Cursed, 3);
    for (let j = 0; j < this.sh; j++)
      for (let i = 0; i < this.sw; i++) {
        const x = i / this.res, y = j / this.res;
        const edge = Math.min(x, y, W - x, H - y);
        let h = (fbm(x * 0.05, y * 0.05, 3, 4) - 0.5) * 0.9;
        h += sample(forest, W, H, x, y) * (fbm(x * 0.09, y * 0.09, 8, 3) * 2.2);
        h += Math.max(0, 6 - edge) * 0.35;
        h -= sample(road, W, H, x, y) * 0.08;
        const cu = sample(cursed, W, H, x, y);
        h += cu * (0.15 + (fbm(x * 0.3, y * 0.3, 12, 2) - 0.5) * 0.4);
        const wv = sample(water, W, H, x, y);
        h = h * (1 - smooth(0.05, 0.6, wv)) - smooth(0.25, 0.9, wv) * 1.1;
        for (const f of flatSpots) {
          const d = Math.hypot(x - f.x, y - f.y);
          const k = 1 - smooth(f.r * 0.6, f.r, d);
          h = h * (1 - k) + 0.0 * k;
        }
        this.h[j * this.sw + i] = h;
      }
  }
  /** Height at tile coordinates (bilinear). */
  at(x: number, y: number) {
    const fx = Math.max(0, Math.min(this.sw - 1.001, x * this.res)), fy = Math.max(0, Math.min(this.sh - 1.001, y * this.res));
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const a = this.h[j * this.sw + i], b = this.h[j * this.sw + i + 1], c = this.h[(j + 1) * this.sw + i], d = this.h[(j + 1) * this.sw + i + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
}

const LAYERS: { t: Terrain; tex: string; lo: number; hi: number; noise: number }[] = [
  { t: Terrain.Forest, tex: 'tex_forest', lo: 0.3, hi: 0.62, noise: 0.55 },
  { t: Terrain.Dirt, tex: 'tex_dirt', lo: 0.38, hi: 0.6, noise: 0.45 },
  { t: Terrain.Sand, tex: 'tex_sand', lo: 0.3, hi: 0.55, noise: 0.35 },
  { t: Terrain.Water, tex: 'tex_sand', lo: 0.45, hi: 0.7, noise: 0.25 },
  { t: Terrain.Cursed, tex: 'tex_cursed', lo: 0.3, hi: 0.6, noise: 0.6 },
];

/** Bakes the whole map color into one canvas (PX px per tile). */
function bakeColor(world: World, PX: number): HTMLCanvasElement {
  const { W, H } = world;
  const c = document.createElement('canvas');
  c.width = W * PX; c.height = H * PX;
  const g = c.getContext('2d')!;
  const pat = (key: string, scale: number) => {
    const img = groundImage(key) as CanvasImageSource & { width: number };
    const p = g.createPattern(img, 'repeat')!;
    p.setTransform(new DOMMatrix().scale(scale));
    return p;
  };
  const texScale = (PX * 6) / 512; // one texture tile = 6 world tiles
  g.fillStyle = pat('tex_grass', texScale);
  g.fillRect(0, 0, c.width, c.height);
  const MS = 4;
  const mw = Math.ceil(c.width / MS), mh = Math.ceil(c.height / MS);
  const mask = document.createElement('canvas');
  mask.width = mw; mask.height = mh;
  const mg = mask.getContext('2d')!;
  const mimg = mg.createImageData(mw, mh);
  const tmp = document.createElement('canvas');
  tmp.width = c.width; tmp.height = c.height;
  const tg = tmp.getContext('2d')!;
  for (const L of LAYERS) {
    const f = blurField(world, (t) => t === L.t || (L.t === Terrain.Sand && t === Terrain.Water), 1);
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
      const wx = ((x + 0.5) * MS) / PX, wy = ((y + 0.5) * MS) / PX;
      let v = sample(f, W, H, wx, wy);
      if (v > 0.001 && v < 0.999) v += (fbm(wx * 0.45, wy * 0.45, 31 + L.t, 3) - 0.5) * L.noise;
      const i = (y * mw + x) * 4;
      mimg.data[i] = mimg.data[i + 1] = mimg.data[i + 2] = 255;
      mimg.data[i + 3] = smooth(L.lo, L.hi, v) * 255;
    }
    mg.putImageData(mimg, 0, 0);
    tg.globalCompositeOperation = 'source-over';
    tg.clearRect(0, 0, tmp.width, tmp.height);
    tg.fillStyle = pat(L.tex, texScale);
    tg.fillRect(0, 0, tmp.width, tmp.height);
    if (L.t === Terrain.Water) { tg.fillStyle = 'rgba(40,60,50,0.55)'; tg.fillRect(0, 0, tmp.width, tmp.height); }
    tg.globalCompositeOperation = 'destination-in';
    tg.drawImage(mask, 0, 0, tmp.width, tmp.height);
    g.drawImage(tmp, 0, 0);
  }
  // tonal variation + subtle grass speckles
  const tone = mg.createImageData(mw, mh);
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    const n = fbm((x * MS) / PX * 0.08, (y * MS) / PX * 0.08, 77, 3);
    const i = (y * mw + x) * 4;
    const v = n > 0.5 ? 255 : 0;
    tone.data[i] = v; tone.data[i + 1] = v * 0.95; tone.data[i + 2] = v * 0.75; tone.data[i + 3] = Math.abs(n - 0.5) * 2 * 70;
  }
  mg.putImageData(tone, 0, 0);
  g.globalCompositeOperation = 'soft-light';
  g.drawImage(mask, 0, 0, c.width, c.height);
  g.globalCompositeOperation = 'source-over';
  // flower speckles on meadows
  for (let k = 0; k < W * H * 0.6; k++) {
    const x = hash2(k, 1, 9) * W, y = hash2(k, 2, 9) * H;
    if (world.terrain[(y | 0) * W + (x | 0)] !== Terrain.Grass) continue;
    g.fillStyle = ['#f4e070', '#ffffff', '#d080e0', '#f09050'][k % 4];
    g.globalAlpha = 0.7;
    g.fillRect(x * PX, y * PX, 2, 2);
  }
  g.globalAlpha = 1;
  return c;
}

function detailTexture(): THREE.Texture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const a = (x / S) * Math.PI * 2, b = (y / S) * Math.PI * 2;
    const n = fbm(Math.cos(a) * 4 + 9, Math.sin(a) * 4 + Math.cos(b) * 4 + 9, 4, 4) * 0.7 + hash2(x, y, 3) * 0.3;
    const v = 140 + n * 115;
    const i = (y * S + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export function buildTerrain(world: World, hm: Heightmap) {
  const { W, H } = world;
  const geo = new THREE.PlaneGeometry(W, H, hm.sw - 1, hm.sh - 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(W / 2, 0, H / 2);
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setY(i, hm.at(p.getX(i), p.getZ(i)));
  geo.computeVertexNormals();
  const colorMap = new THREE.CanvasTexture(bakeColor(world, 16));
  colorMap.colorSpace = THREE.SRGBColorSpace;
  colorMap.anisotropy = 8;
  colorMap.generateMipmaps = true;
  const detail = detailTexture();
  const mat = new THREE.MeshStandardNodeMaterial();
  const d = texture(detail, uv().mul(vec2(W / 3, H / 3))).r as any;
  const d2 = texture(detail, uv().mul(vec2(W * 0.7, H * 0.7))).r as any;
  mat.colorNode = texture(colorMap, uv()).rgb.mul(d.mul(0.55).add(0.55)).mul(d2.mul(0.3).add(0.82));
  mat.roughnessNode = float(0.95);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

export function buildWater(world: World) {
  const { W, H } = world;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (world.terrain[y * W + x] === Terrain.Water) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  if (x1 < 0) return null;
  x0 -= 3; y0 -= 3; x1 += 4; y1 += 4;
  const geo = new THREE.PlaneGeometry(x1 - x0, y1 - y0, 1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate((x0 + x1) / 2, -0.35, (y0 + y1) / 2);
  const mat = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false });
  const p = positionWorld.xz as any;
  const n1 = mx_noise_float(vec3(p.mul(0.7).add(vec2(time.mul(0.25), time.mul(0.12))), time.mul(0.2))) as any;
  const n2 = mx_noise_float(vec3(p.mul(2.2).sub(vec2(time.mul(0.4), 0)), time.mul(0.5))) as any;
  const waves = n1.mul(0.5).add(n2.mul(0.5));
  const deep = vec3(0.06, 0.2, 0.34), shallow = vec3(0.16, 0.42, 0.55);
  mat.colorNode = mix(deep, shallow, waves.mul(0.5).add(0.5));
  mat.emissiveNode = vec3(0.6, 0.8, 1.0).mul(waves.sub(0.55).max(0).mul(0.9));
  mat.roughnessNode = float(0.12).add(waves.abs().mul(0.15));
  mat.metalnessNode = float(0.1);
  mat.opacityNode = float(0.86).add(sin(time).mul(0.0));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  return mesh;
}
