/** Asset manifest (generated art), ground images with procedural fallbacks, FX canvas textures. */
import * as THREE from 'three/webgpu';
import { EventBus } from '../engine/events';
import { fbm, hash2 } from '../engine/rng';

const BASE = import.meta.env.BASE_URL + 'assets/';

interface Manifest {
  version: number;
  props: Record<string, { file: string }>;
  textures: Record<string, { file: string }>;
  units: Record<string, unknown>;
  buildings: Record<string, unknown>;
}

class Store {
  manifest: Manifest = { version: 0, props: {}, textures: {}, units: {}, buildings: {} };
  readonly events = new EventBus<{ reload: {} }>();
  private ground = new Map<string, CanvasImageSource>();

  async load() {
    try {
      const r = await fetch(BASE + 'manifest.json?ts=' + Date.now());
      if (r.ok) this.manifest = await r.json();
    } catch {}
    this.ground.clear();
    await Promise.all(
      Object.entries(this.manifest.textures ?? {}).map(async ([k, t]) => {
        try {
          const img = new Image();
          img.src = BASE + t.file + '?v=' + this.manifest.version;
          await img.decode();
          this.ground.set(k, img);
        } catch {}
      }),
    );
  }
  async reload() {
    await this.load();
    this.events.emit('reload', {});
  }
  icon(key: string): string | null {
    return this.manifest.props?.[key] ? BASE + this.manifest.props[key].file + '?v=' + this.manifest.version : null;
  }
  groundImage(key: string): CanvasImageSource {
    let g = this.ground.get(key);
    if (!g) {
      g = fallbackGround(key);
      this.ground.set(key, g);
    }
    return g;
  }
}

export const assets = new Store();
export const groundImage = (k: string) => assets.groundImage(k);

/** Painterly procedural ground textures (used until generated textures exist). */
export function fallbackGround(kind: string): HTMLCanvasElement {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  const pal: Record<string, [number, number, number][]> = {
    tex_grass: [[70, 118, 40], [86, 138, 46], [104, 154, 54], [78, 126, 42], [120, 160, 60]],
    tex_dirt: [[118, 88, 56], [136, 104, 66], [100, 76, 50], [150, 118, 78], [126, 96, 60]],
    tex_forest: [[46, 74, 32], [58, 88, 36], [72, 78, 40], [40, 62, 28], [88, 84, 46]],
    tex_water: [[40, 92, 140], [46, 104, 156], [56, 120, 170], [36, 84, 128], [60, 130, 176]],
    tex_sand: [[200, 178, 128], [212, 192, 142], [186, 166, 118], [220, 200, 152], [196, 172, 124]],
    tex_cursed: [[44, 36, 46], [56, 46, 54], [36, 30, 40], [68, 56, 60], [50, 40, 52]],
  };
  const p = pal[kind] ?? pal.tex_grass;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const a = (x / S) * Math.PI * 2, b = (y / S) * Math.PI * 2;
      const n = fbm(Math.cos(a) * 3 + 10, Math.sin(a) * 3 + Math.cos(b) * 3 + 10, 5, 4) * 0.55 + fbm(Math.sin(b) * 9 + 3, Math.cos(a) * 9 + Math.sin(b) * 2 + 7, 9, 3) * 0.45;
      const px = hash2(x >> 1, y >> 1, 3);
      const col = p[Math.min(4, Math.floor(n * 4.2 + px * 0.9))];
      const i = (y * S + x) * 4;
      const v = 0.88 + px * 0.24;
      img.data[i] = col[0] * v; img.data[i + 1] = col[1] * v; img.data[i + 2] = col[2] * v; img.data[i + 3] = 255;
      if (kind === 'tex_cursed') {
        const crack = Math.abs(fbm(Math.cos(a) * 3 + 1, Math.sin(b) * 3 + Math.sin(a) * 2, 21, 4) - 0.5);
        const zone = fbm(Math.sin(a) * 2 + 5, Math.cos(b) * 2 + 3, 44, 2);
        if (crack < 0.007 && zone > 0.55) { const k = 1 - crack / 0.007; img.data[i] = 40 + 20 * k; img.data[i + 1] = 90 + 90 * k; img.data[i + 2] = 50 + 30 * k; }
      }
      if (kind === 'tex_grass' && px > 0.93) { img.data[i] *= 1.25; img.data[i + 1] *= 1.25; }
      if (kind === 'tex_dirt' && px > 0.95) { img.data[i] = img.data[i + 1] = img.data[i + 2] = 150 + px * 40; }
    }
  g.putImageData(img, 0, 0);
  return c;
}

const texCache = new Map<string, THREE.Texture>();
function canvasTex(key: string, size: number, draw: (g: CanvasRenderingContext2D, s: number) => void) {
  let t = texCache.get(key);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d')!, size);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    texCache.set(key, t);
  }
  return t;
}

export const dotTexture = () => canvasTex('dot', 64, (g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, s, s);
});

export const smokeTexture = () => canvasTex('smoke', 64, (g, s) => {
  for (let i = 0; i < 7; i++) {
    const x = s / 2 + Math.cos(i * 2.3) * 9, y = s / 2 + Math.sin(i * 1.7) * 9, r = 16 + (i % 3) * 4;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.5)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  }
});

export const ringTexture = () => canvasTex('ring', 128, (g, s) => {
  g.translate(s / 2, s / 2);
  for (let i = 0; i < 3; i++) {
    g.beginPath();
    g.arc(0, 0, s * 0.4 - i * 2, 0, Math.PI * 2);
    g.strokeStyle = `rgba(255,255,255,${0.3 + i * 0.25})`;
    g.lineWidth = 9 - i * 3;
    g.shadowColor = 'white';
    g.shadowBlur = 10;
    g.stroke();
  }
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, s * 0.42);
  gr.addColorStop(0, 'rgba(255,255,255,0.18)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, s * 0.42, 0, Math.PI * 2);
  g.fill();
});

export const blobShadowTexture = () => canvasTex('blob', 64, (g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(0,0,0,0.5)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, s, s);
});

export const gridTexture = () => canvasTex('grid', 64, (g, s) => {
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.fillRect(0, 0, s, s);
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineWidth = 4;
  g.strokeRect(2, 2, s - 4, s - 4);
});
