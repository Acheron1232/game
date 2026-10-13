/**
 * Renderer + frame loop facade (WebGPU with automatic WebGL2 fallback), post-processing (bloom,
 * grading, vignette), sun/sky/fog with a day-night cycle and a pooled set of dynamic point lights.
 */
import * as THREE from 'three/webgpu';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { float, mix, pass, screenUV, smoothstep, uniform, vec3, vec4 } from 'three/tsl';
import { globals } from './mats';

export type TickFn = (t: { deltaMS: number }) => void;

export class Engine {
  readonly renderer: THREE.WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.5, 400);
  readonly canvas: HTMLCanvasElement;
  readonly screen = { width: 1, height: 1 };
  private fns: TickFn[] = [];
  readonly ticker = { add: (f: TickFn) => this.fns.push(f), remove: (f: TickFn) => (this.fns = this.fns.filter((x) => x !== f)), lastTime: 0, update: (t: number) => this.frame(t) };
  private last = 0;
  private pipeline: THREE.RenderPipeline | null = null;
  readonly sun = new THREE.DirectionalLight(0xfff1d8, 2.6);
  readonly hemi = new THREE.HemisphereLight(0xbfd8ff, 0x5a4a30, 1.1);
  readonly ambient = new THREE.AmbientLight(0xffffff, 0.25);
  private pointLights: THREE.PointLight[] = [];
  /** world-space light sources; the nearest ones get real point lights */
  readonly lightSources = new Set<LightSource>();
  readonly bloomStrength = uniform(0.55);
  readonly vignette = uniform(0.35);
  night = 0;
  dayTime = 0.4;
  quality: 'high' | 'low' = 'high';
  usePost = true;

  constructor(readonly backend: 'webgpu' | 'webgl') {
    this.renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: backend === 'webgl', powerPreference: 'high-performance' });
    this.canvas = this.renderer.domElement;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.background = new THREE.Color(0x8fb8e0);
    this.scene.fog = new THREE.Fog(0x9ec4e8, 40, 110);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    const sc = this.sun.shadow.camera;
    sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 120;
    this.scene.add(this.sun, this.sun.target, this.hemi, this.ambient);
    for (let i = 0; i < 12; i++) {
      const p = new THREE.PointLight(0xffaa55, 0, 9, 1.6);
      p.castShadow = false;
      this.pointLights.push(p);
      this.scene.add(p);
    }
  }

  async init(container: HTMLElement) {
    await this.renderer.init();
    container.appendChild(this.canvas);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.setupPost();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  get name() {
    return (this.renderer.backend as any).isWebGPUBackend ? 'webgpu' : 'webgl2';
  }

  private setupPost() {
    try {
      const pipe = new THREE.RenderPipeline(this.renderer);
      const scenePass = pass(this.scene, this.camera);
      const color = scenePass.getTextureNode('output') as any;
      const glow = bloom(color, 0.55, 0.45, 0.82) as any;
      glow.strength = this.bloomStrength;
      let out = color.add(glow) as any;
      // vignette + slight warm grade
      const d = screenUV.sub(0.5).length() as any;
      const v = float(1).sub(smoothstep(float(0.35), float(0.85), d).mul(this.vignette)) as any;
      out = vec4(mix(out.rgb, out.rgb.mul(vec3(1.04, 1.0, 0.94)), float(0.6)).mul(v), 1);
      pipe.outputNode = out;
      this.pipeline = pipe;
    } catch (e) {
      console.warn('[engine] post-processing unavailable', e);
      this.pipeline = null;
    }
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.screen.width = w;
    this.screen.height = h;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame(t: number) {
    const dt = this.last ? Math.min(100, t - this.last) : 16;
    this.last = t;
    this.ticker.lastTime = t;
    for (const f of this.fns) {
      try { f({ deltaMS: dt }); } catch (e) { console.error('[frame]', e); }
    }
    this.assignLights();
    if (this.pipeline && this.usePost) this.pipeline.render();
    else this.renderer.render(this.scene, this.camera);
  }

  // ---------------------------------------------------------------- day / night
  setDay(t01: number, focus: THREE.Vector3) {
    this.dayTime = t01;
    // sun path: rises at 0.25, sets at 0.75
    const ang = (t01 - 0.25) * Math.PI * 2;
    const elev = Math.sin(ang);
    const dayK = THREE.MathUtils.smoothstep(elev, -0.15, 0.25);
    this.night = 1 - dayK;
    const dusk = Math.max(0, 1 - Math.abs(elev) / 0.35) * (elev > -0.2 ? 1 : 0);
    const sunDir = new THREE.Vector3(Math.cos(ang) * 0.8, Math.max(0.25, elev), 0.45).normalize();
    if (elev < 0) sunDir.set(-0.4, 0.8, 0.5).normalize(); // moonlight
    this.sun.position.copy(focus).addScaledVector(sunDir, 60);
    this.sun.target.position.copy(focus);
    const sunCol = new THREE.Color(0xfff1d8).lerp(new THREE.Color(0xff9a50), dusk * 0.8);
    const moonCol = new THREE.Color(0x8aa0ff);
    this.sun.color.copy(sunCol.lerp(moonCol, this.night));
    this.sun.intensity = THREE.MathUtils.lerp(2.7, 0.55, this.night) * (1 - dusk * 0.3);
    this.hemi.intensity = THREE.MathUtils.lerp(1.15, 0.45, this.night);
    this.hemi.color.set(0xbfd8ff).lerp(new THREE.Color(0x3a4a8a), this.night);
    this.hemi.groundColor.set(0x5a4a30).lerp(new THREE.Color(0x1a1a2a), this.night);
    this.ambient.intensity = THREE.MathUtils.lerp(0.25, 0.18, this.night);
    const sky = new THREE.Color(0x8fb8e0).lerp(new THREE.Color(0xf0a070), dusk * 0.55).lerp(new THREE.Color(0x0e1630), this.night);
    (this.scene.background as THREE.Color).copy(sky);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(sky).lerp(new THREE.Color(0x6a7a90), 0.25);
    globals.night.value = this.night;
    this.bloomStrength.value = 0.45 + this.night * 0.55;
  }

  // ---------------------------------------------------------------- light pool
  private lightT = 0;
  focus = new THREE.Vector3();
  private assignLights() {
    const t = performance.now() / 1000;
    if (t - this.lightT > 0.2) {
      this.lightT = t;
      const arr = [...this.lightSources].filter((l) => l.on);
      arr.sort((a, b) => a.pos.distanceToSquared(this.focus) - b.pos.distanceToSquared(this.focus));
      for (let i = 0; i < this.pointLights.length; i++) (this.pointLights[i] as any).src = arr[i] ?? null;
    }
    for (const p of this.pointLights) {
      const s: LightSource | null = (p as any).src;
      if (!s || !s.on) { p.intensity = 0; continue; }
      p.position.copy(s.pos);
      p.color.setHex(s.color);
      p.distance = s.radius;
      const fl = s.flicker ? 1 + (Math.sin(t * 11 + s.phase) * 0.6 + Math.sin(t * 27 + s.phase * 3) * 0.4) * s.flicker : 1;
      p.intensity = s.intensity * fl * (0.35 + this.night * 1.2);
    }
  }
}

export interface LightSource {
  pos: THREE.Vector3;
  color: number;
  radius: number;
  intensity: number;
  flicker: number;
  phase: number;
  on: boolean;
}

export function lightSource(p: Partial<LightSource> & { pos: THREE.Vector3 }): LightSource {
  return { color: 0xffa050, radius: 8, intensity: 6, flicker: 0, phase: Math.random() * 100, on: true, ...p };
}
