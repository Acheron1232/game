/**
 * 3D world view: syncs simulation entities to animated models, handles event-driven effects,
 * atmosphere, day/night and the HTML overlay. Exposes the same surface the input/HUD layers use.
 */
import * as THREE from 'three/webgpu';
import { cos, positionLocal, sin, time, uniform, vec3 } from 'three/tsl';
import { sfx } from '../audio/sfx';
import { content } from '../engine/registry';
import type { Sim } from '../sim/sim';
import { swingDuration } from '../sim/systems/combat';
import { EVIL, NEUTRAL, Terrain, type Entity } from '../sim/types';
import { Animator } from './anim';
import { buildingModel, scaffold, type BuildingModel } from './buildings3d';
import { Camera3D, TS } from './camera3d';
import { characterModel, type CharacterModel } from './characters';
import { lightSource, type Engine, type LightSource } from './engine';
import { G, GeoBuilder, M } from './geo';
import { teamMaterial } from './mats';
import { PropLayer, hashf } from './nature3d';
import { Overlay } from './overlay';
import { Particles } from './particles3d';
import { buildTerrain, buildWater, Heightmap } from './terrain3d';
import { ringTexture, gridTexture, assets } from './textures';

const LIGHT = { fire: { color: 0xffa04a, radius: 7, intensity: 9, flicker: 0.18 }, toxic: { color: 0x6aff7a, radius: 9, intensity: 10, flicker: 0.05 }, arcane: { color: 0x6ac8ff, radius: 7, intensity: 8, flicker: 0.04 }, window: { color: 0xffc070, radius: 4, intensity: 3, flicker: 0.02 } };

const ACTION_OF: Record<string, string> = { slash: 'slash', thrust: 'thrust', bow: 'bow', cast: 'cast', chop: 'chop', claw: 'claw', none: 'chop' };

function hexCss(c: number) {
  return '#' + c.toString(16).padStart(6, '0');
}

const flagMats = new Map<number, THREE.MeshStandardNodeMaterial>();
function flagMaterial(color: number) {
  let m = flagMats.get(color);
  if (!m) {
    m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, color });
    const x = positionLocal.x as any;
    const wave = (sin(time.mul(5).sub(x.mul(9))) as any).mul(0.06).add((sin(time.mul(3.1).sub(x.mul(5))) as any).mul(0.03)).mul(x.mul(1.6));
    m.positionNode = (positionLocal as any).add(vec3(0, (cos(time.mul(4).sub(x.mul(7))) as any).mul(0.015).mul(x), wave));
    m.roughness = 0.9;
    flagMats.set(color, m);
  }
  return m;
}

// =================================================================== unit view
class UnitV {
  mesh!: THREE.SkinnedMesh;
  anim!: Animator;
  model!: CharacterModel;
  defKey = '';
  px = 0; py = 0; cx = 0; cy = 0;
  heading = 0;
  speed = 0;
  hitT = 9;
  deadT = -1;
  spawnT = -1;
  dissolve = false;
  light: LightSource | null = null;
  pos = new THREE.Vector3();
  removeAt = 0;

  constructor(public e: Entity, private v: View3D, spawn: boolean) {
    this.px = this.cx = e.x;
    this.py = this.cy = e.y;
    this.heading = hashf(e.id) * Math.PI * 2;
    this.build();
    if (spawn) this.spawnT = 0;
  }

  build() {
    if (this.mesh) { this.v.scene.remove(this.mesh); this.mesh.skeleton.dispose(); }
    if (this.light) { this.v.engine.lightSources.delete(this.light); this.light = null; }
    this.defKey = this.e.def;
    this.model = characterModel(this.e.def);
    const { mesh, bones } = this.model.rig.instantiate(teamMaterial(this.v.colorOf(this.e.owner)));
    mesh.scale.setScalar(this.model.scale);
    this.mesh = mesh;
    this.anim = new Animator(bones, this.model.style, this.model.mounted, this.e.def === 'zombie' ? 1 : 0);
    this.v.scene.add(mesh);
    const d = content.unit(this.e.def);
    if (this.e.def === 'hero_mage') this.light = lightSource({ pos: new THREE.Vector3(), color: 0x7ad0ff, radius: 6, intensity: 5, flicker: 0.05 });
    else if (d?.light) this.light = lightSource({ pos: new THREE.Vector3(), color: d.light.color, radius: 3, intensity: 2.5 });
    if (this.light) this.v.engine.lightSources.add(this.light);
  }

  tick() {
    this.px = this.cx; this.py = this.cy;
    this.cx = this.e.x; this.cy = this.e.y;
  }

  update(dt: number, alpha: number) {
    const e = this.e, v = this.v, sim = v.sim;
    if (this.defKey !== e.def) { this.build(); v.fx.magic(e.x, v.h(e.x, e.y) + 0.6, e.y, [0xffe080, 0xffffff], 24, 2); }
    const heroDown = e.respawnAt != null;
    if (heroDown && this.deadT < 0) this.deadT = 0;
    if (!heroDown && this.deadT >= 0 && !e.dead) { this.deadT = -1; this.spawnT = 0; this.px = this.cx = e.x; this.py = this.cy = e.y; }
    const hidden = e.inside != null || (heroDown && this.deadT > 4);
    this.mesh.visible = !hidden;
    if (this.light) this.light.on = !hidden;
    if (hidden) return;
    const x = this.px + (this.cx - this.px) * alpha, z = this.py + (this.cy - this.py) * alpha;
    const dx = this.cx - this.px, dz = this.cy - this.py;
    const sp = Math.hypot(dx, dz) * content.balance.tickRate;
    this.speed += (sp - this.speed) * Math.min(1, dt * 10);
    // heading: movement, else target
    let want: number | null = null;
    if (sp > 0.2) want = Math.atan2(dx, dz);
    else {
      const t = sim.get(e.targetId) ?? sim.get(e.workId) ?? sim.get((e.order as any)?.target) ?? (e.role && e.role !== 'free' ? sim.get(e.jobId) : undefined);
      if (t && (e.state === 'attack' || e.state === 'work' || e.hitAt != null)) want = Math.atan2(t.x - e.x, t.y - e.y);
    }
    if (want != null && this.deadT < 0) {
      let d = want - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * Math.min(1, dt * 10);
    }
    let y = v.h(x, z);
    // swing
    const isWork = e.state === 'work';
    const dur = isWork ? 0.62 : swingDuration(sim, e);
    const since = e.swingAt != null ? sim.time - e.swingAt : 99;
    const swinging = since >= 0 && since < dur;
    const action = isWork ? (this.model.style === 'cast' ? 'cast' : this.model.style === 'bow' ? 'chop' : 'chop') : ACTION_OF[this.model.style];
    this.hitT += dt;
    let dead = false;
    if (this.deadT >= 0) {
      this.deadT += dt;
      dead = true;
      if (this.deadT > 2.4) y -= (this.deadT - 2.4) * (this.dissolve ? 2 : 0.5);
    }
    if (this.spawnT >= 0) {
      this.spawnT += dt;
      const p = Math.min(1, this.spawnT / 0.8);
      if (e.owner === EVIL) y -= (1 - p) * 1.3;
      else this.mesh.scale.setScalar(this.model.scale * (0.6 + 0.4 * p + Math.sin(p * Math.PI) * 0.12));
      if (p >= 1) { this.spawnT = -1; this.mesh.scale.setScalar(this.model.scale); }
    }
    this.mesh.position.set(x, y, z);
    this.mesh.rotation.y = this.heading;
    this.anim.update(dt, { speed: dead ? 0 : this.speed, swing: swinging && !dead ? since / dur : -1, action, dead, deadT: Math.max(0, this.deadT), hitT: this.hitT });
    this.pos.set(x, y, z);
    if (this.light) this.light.pos.set(x, y + (e.def === 'hero_mage' ? 2.0 : 1.0), z);
    // ring + bar
    const hero = !!content.heroes[e.def];
    const sel = v.selected.has(e.id) || v.hovered === e.id;
    if (!dead && e.owner !== NEUTRAL) v.ring(x, y, z, (this.model.mounted ? 0.95 : 0.55) * (hero ? 1.25 : 1), e.owner === EVIL ? 0x4aff6a : v.colorOf(e.owner), (hero ? 0.6 : 0.32) + (sel ? 0.55 : 0));
    if (!dead && (sel || hero || e.hp < e.maxHp - 0.5)) {
      v.overlay.bar(new THREE.Vector3(x, y + this.model.height * this.model.scale + 0.25, z), v.engine.camera, v.vw, v.vh, e.hp / e.maxHp, hero ? 46 : 30, e.owner === NEUTRAL ? null : hexCss(e.owner === EVIL ? 0x4aff6a : v.colorOf(e.owner)), hero ? e.level ?? 1 : 0);
    }
    // ambient bits
    if (e.def === 'hero_mage' && !dead && Math.random() < dt * 8) {
      const hb = this.mesh.skeleton.bones.find((b) => b.name === 'handR');
      if (hb) { const p = new THREE.Vector3(0, 1.0, 0.01).applyMatrix4(hb.matrixWorld); v.fx.glow(p.x, p.y, p.z, { n: 1, color: [0x8fd0ff, 0xd0f0ff], speed: [0.05, 0.2], up: [0.1, 0.4], life: [0.4, 0.8], size: [0.06, 0.12], end: 0.01 }); }
    }
    if (sp > 1 && Math.random() < dt * 4) v.fx.dust(x, y + 0.05, z, 1, 0xb8a882);
  }

  hit() {
    this.hitT = 0;
  }

  dispose() {
    this.v.scene.remove(this.mesh);
    this.mesh.skeleton.dispose();
    if (this.light) this.v.engine.lightSources.delete(this.light);
  }
}

// =================================================================== building view
class BuildingV {
  group = new THREE.Group();
  mesh!: THREE.Mesh;
  scaffoldMesh: THREE.Mesh;
  model!: BuildingModel;
  level = -1;
  lights: { src: LightSource; kind: string; local: THREE.Vector3 }[] = [];
  flags: THREE.Mesh[] = [];
  parts: { mesh: THREE.Mesh; anim: string; base: THREE.Vector3 }[] = [];
  shake = 0;
  fxT = 0;
  pop = 0;
  cx: number; cz: number;
  s: number;

  constructor(public e: Entity, private v: View3D) {
    this.cx = e.tx! + e.w! / 2;
    this.cz = e.ty! + e.h! / 2;
    this.s = ({ dark_core: 1.2, graveyard: 1.05, tower: 1.2 } as Record<string, number>)[e.def] ?? 1.18;
    this.group.scale.setScalar(this.s);
    this.group.position.set(this.cx, v.h(this.cx, this.cz) - 0.02, this.cz);
    v.scene.add(this.group);
    this.scaffoldMesh = new THREE.Mesh(scaffold(e.w! - 0.3, e.h! - 0.3, 1.8), teamMaterial(0xffffff));
    this.scaffoldMesh.castShadow = true;
    this.group.add(this.scaffoldMesh);
    this.apply();
  }

  levelKey() {
    return this.e.def === 'dark_core' ? this.v.sim.world.evil.level : this.e.level ?? 1;
  }

  apply() {
    for (const c of [...this.group.children]) if (c !== this.scaffoldMesh) this.group.remove(c);
    for (const l of this.lights) this.v.engine.lightSources.delete(l.src);
    this.lights = []; this.flags = []; this.parts = [];
    this.level = this.levelKey();
    this.model = buildingModel(this.e.def, this.level);
    const color = this.v.colorOf(this.e.owner);
    this.mesh = new THREE.Mesh(this.model.geo, teamMaterial(color));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
    for (const l of this.model.lights) {
      const cfg = (LIGHT as any)[l.kind];
      const local = new THREE.Vector3(l.x, l.y, l.z);
      const src = lightSource({ pos: local.clone().multiplyScalar(this.s).add(this.group.position), ...cfg });
      this.v.engine.lightSources.add(src);
      this.lights.push({ src, kind: l.kind, local });
    }
    for (const f of this.model.flags) {
      const g = new THREE.PlaneGeometry(f.w, f.h, 10, 2);
      g.translate(f.w / 2, -f.h / 2, 0);
      const fm = new THREE.Mesh(g, flagMaterial(this.e.owner === EVIL ? 0x2a2a2a : color));
      fm.position.set(f.x, f.y, f.z);
      fm.castShadow = true;
      this.mesh.add(fm);
      this.flags.push(fm);
    }
    for (const p of this.model.parts) {
      const pm = new THREE.Mesh(p.geo, teamMaterial(color));
      pm.position.set(p.x, p.y, p.z);
      pm.castShadow = true;
      this.mesh.add(pm);
      this.parts.push({ mesh: pm, anim: p.anim, base: pm.position.clone() });
    }
  }

  update(dt: number) {
    const e = this.e, v = this.v, t = v.time;
    if (this.levelKey() !== this.level) {
      this.apply();
      v.fx.debrisBurst(this.cx, this.group.position.y, this.cz, e.w!);
      v.fx.magic(this.cx, this.group.position.y + 1.5, this.cz, e.owner === EVIL ? [0x6aff7a, 0xb0ffb0] : [0xffe080, 0xffffff], 50, 4);
      this.pop = 1;
    }
    const p = e.built ? 1 : Math.max(0, e.progress ?? 0);
    this.scaffoldMesh.visible = !e.built;
    this.shake = Math.max(0, this.shake - dt * 4);
    this.pop = Math.max(0, this.pop - dt * 2.5);
    const sx = this.shake > 0 ? Math.sin(t * 55) * this.shake * 0.06 : 0;
    this.mesh.position.set(sx, -(1 - p) * this.model.height * 0.92, 0);
    const k = 1 + Math.sin(this.pop * Math.PI) * 0.06;
    this.mesh.scale.set(2 - k, k, 2 - k);
    // animated parts
    for (const part of this.parts) {
      if (part.anim === 'saw') {
        const working = v.sim.units.some((u) => u.role === 'lumber' && u.jobId === e.id && u.state === 'work');
        part.mesh.rotation.x += dt * (working ? 18 : 2);
      } else if (part.anim === 'float') {
        const ph = part.base.x * 3 + part.base.z;
        part.mesh.position.set(part.base.x * (1 + Math.sin(t * 0.7 + ph) * 0.08), part.base.y + Math.sin(t * 1.3 + ph) * 0.2, part.base.z * (1 + Math.cos(t * 0.6 + ph) * 0.08));
        part.mesh.rotation.y += dt * 0.8;
      }
    }
    for (const l of this.lights) {
      l.src.on = !!e.built;
      l.src.pos.copy(l.local).multiplyScalar(this.s).add(this.group.position);
      if (l.kind === 'toxic') l.src.intensity = 10 + Math.sin(t * 2 + l.src.phase) * 4;
    }
    // particles
    if (!v.near(this.cx, this.cz, 30)) return;
    this.fxT -= dt;
    const gy = this.group.position.y;
    for (const l of this.lights) if (e.built && l.kind === 'fire') v.fx.fire(l.src.pos.x, l.src.pos.y - 0.12, l.src.pos.z, 0.8);
    if (this.fxT <= 0) {
      this.fxT = 0.15;
      for (const l of this.lights) if (e.built && l.kind === 'fire' && Math.random() < 0.4) v.fx.embers(l.src.pos.x, l.src.pos.y, l.src.pos.z);
      if (e.built) for (const s of this.model.smoke) if (Math.random() < 0.35) v.fx.smoke(this.cx + s.x * this.s, gy + s.y * this.s, this.cz + s.z * this.s, 1, 0x8a8a8a, 0.35, 0.22);
      if (e.def === 'dark_core') {
        v.fx.glow(this.cx, gy + 0.3, this.cz, { n: 2, color: [0x6aff7a, 0xa0ffb0, 0x2a8a3a], speed: [0.2, 0.8], up: [0.6, 1.8], life: [1.5, 3], size: [0.06, 0.14], end: 0.02, radius: 1.5 });
      }
      if (e.def === 'graveyard') v.fx.soft(this.cx, gy + 0.2, this.cz, { n: 1, color: 0x7aff8a, speed: [0.05, 0.2], up: [0.02, 0.1], life: [3, 5], size: [0.8, 1.2], end: 2, alpha: 0.12, radius: 1.6, fadeIn: 0.3 });
      if (!e.built && (e as any).status === 'Будується') {
        v.fx.dust(this.cx + (Math.random() - 0.5) * e.w!, gy + 0.1, this.cz + (Math.random() - 0.5) * e.h!, 2);
        if (Math.random() < 0.5) v.fx.sparks(this.cx + (Math.random() - 0.5) * e.w! * 0.6, gy + Math.random() * 1.2, this.cz + e.h! * 0.45, [0xffe0a0], 3);
      }
      if (e.built && e.hp < e.maxHp * 0.5 && e.owner !== EVIL) {
        const fx = this.cx + (Math.random() - 0.5) * e.w! * 0.7, fz = this.cz + (Math.random() - 0.5) * e.h! * 0.7, fy = gy + this.model.height * this.s * (0.3 + Math.random() * 0.4);
        v.fx.smoke(fx, fy, fz, 1, 0x333333, 0.55, 0.35);
        if (e.hp < e.maxHp * 0.3) for (let i = 0; i < 3; i++) v.fx.fire(fx, fy, fz, 1.4);
      }
    }
    // ring + bar
    const sel = v.selected.has(e.id) || v.hovered === e.id;
    if (sel) v.ring(this.cx, gy + 0.05, this.cz, Math.max(e.w!, e.h!) * 0.75, e.owner === EVIL ? 0x4aff6a : v.colorOf(e.owner), 0.9);
    if (sel || !e.built || e.hp < e.maxHp - 1 || e.upgrading || e.training || e.researching) {
      let sub: { ratio: number; color: string } | undefined;
      if (!e.built) sub = { ratio: e.progress ?? 0, color: '#e8c050' };
      else if (e.upgrading) sub = { ratio: e.level2Progress ?? 0, color: '#8ac0ff' };
      else if (e.training) sub = { ratio: (v.sim.time - e.training.startedAt) / (e.training.doneAt - e.training.startedAt), color: '#ffa040' };
      else if (e.researching) sub = { ratio: 1 - (e.researching.doneAt - v.sim.time) / 30, color: '#c080ff' };
      v.overlay.bar(new THREE.Vector3(this.cx, gy + this.model.height * this.s * p + 0.4, this.cz), v.engine.camera, v.vw, v.vh, e.hp / e.maxHp, 64, e.owner === NEUTRAL ? null : hexCss(e.owner === EVIL ? 0x4aff6a : v.colorOf(e.owner)), 0, sub);
    }
  }

  dispose() {
    for (const l of this.lights) this.v.engine.lightSources.delete(l.src);
    this.v.scene.remove(this.group);
  }
}

// =================================================================== projectile view
class ProjV {
  mesh: THREE.Mesh;
  light: LightSource | null = null;
  constructor(public e: Entity, private v: View3D) {
    if (e.ptype === 'arrow') {
      this.mesh = new THREE.Mesh(v.arrowGeo, teamMaterial(0xffffff));
    } else {
      this.mesh = new THREE.Mesh(v.orbGeo, teamMaterial(0xffffff));
      this.light = lightSource({ pos: new THREE.Vector3(), color: 0x6ac8ff, radius: 6, intensity: 12 });
      v.engine.lightSources.add(this.light);
    }
    v.scene.add(this.mesh);
  }
  update(_dt: number, alpha: number) {
    const e = this.e, v = this.v;
    const total = Math.hypot(e.toX! - e.fromX!, e.toY! - e.fromY!) || 1;
    const done = Math.hypot(e.x - e.fromX!, e.y - e.fromY!);
    const p = Math.min(1, done / total);
    const startH = e.variant === 1 ? 3.0 : e.ptype === 'arrow' ? 1.0 : 1.6;
    const lift = e.ptype === 'arrow' ? Math.sin(p * Math.PI) * Math.min(2.2, total * 0.18) : Math.sin(p * Math.PI) * 0.5;
    const baseY = THREE.MathUtils.lerp(v.h(e.fromX!, e.fromY!) + startH, v.h(e.x, e.y) + 0.7, p);
    const x = e.x, z = e.y;
    this.mesh.position.set(x, baseY + lift, z);
    const vy = Math.cos(p * Math.PI) * (e.ptype === 'arrow' ? 0.8 : 0.2);
    this.mesh.lookAt(x + (e.vx ?? 0), baseY + lift + vy, z + (e.vy ?? 0));
    if (this.light) this.light.pos.copy(this.mesh.position);
    if (e.ptype === 'orb') {
      this.mesh.rotation.z += 0.3;
      v.fx.glow(x, baseY + lift, z, { n: 2, color: [0x8fd0ff, 0xd0f0ff, 0x4a90ff], speed: [0.05, 0.3], life: [0.2, 0.45], size: [0.12, 0.22], end: 0.01 });
    }
  }
  dispose() {
    this.v.scene.remove(this.mesh);
    if (this.light) this.v.engine.lightSources.delete(this.light);
  }
}

// =================================================================== the view
export class View3D {
  readonly scene: THREE.Scene;
  readonly camera: Camera3D;
  readonly fx = new Particles();
  readonly overlay = new Overlay();
  readonly hm: Heightmap;
  readonly props: PropLayer;
  selected = new Set<number>();
  hovered: number | null = null;
  localFaction = 0;
  dayOffset = 0.3;
  showLighting = true;
  time = 0;
  stats = { views: 0, visible: 0 };
  vw = 1; vh = 1;
  private units = new Map<number, UnitV>();
  private buildings = new Map<number, BuildingV>();
  private projs = new Map<number, ProjV>();
  private dying: UnitV[] = [];
  private falling: { mesh: THREE.Mesh; t: number; dir: number; axis: THREE.Vector3 }[] = [];
  private lastTick = -1;
  private unsub: (() => void)[] = [];
  private root = new THREE.Group();
  private rings: THREE.InstancedMesh;
  private ringN = 0;
  private propLights = new Map<string, LightSource>();
  private ghost: THREE.Group | null = null;
  private ghostKey = '';
  private cursor: THREE.Mesh;
  private markers: { mesh: THREE.Mesh; t: number }[] = [];
  readonly arrowGeo: THREE.BufferGeometry;
  readonly orbGeo: THREE.BufferGeometry;
  private ambientT = 0;
  private propState = new Map<number, number>();
  private terrainMesh!: THREE.Mesh;

  constructor(readonly engine: Engine, readonly sim: Sim) {
    const w = sim.world;
    this.scene = engine.scene;
    const flat: { x: number; y: number; r: number }[] = [];
    for (const f of w.factions) flat.push({ x: f.start.x, y: f.start.y - 2, r: 9 });
    for (const c of w.camps) flat.push({ x: c.x, y: c.y, r: 4 });
    for (const b of sim.buildings) flat.push({ x: b.x, y: b.y, r: Math.max(b.w!, b.h!) * 0.9 + 1 });
    this.hm = new Heightmap(w, flat);
    this.camera = new Camera3D(engine.camera, w.W * TS, w.H * TS, (x, y) => this.h(x, y));
    this.terrainMesh = buildTerrain(w, this.hm);
    this.root.add(this.terrainMesh);
    // newly generated ground textures are baked in without restarting the session
    this.unsub.push(assets.events.on('reload', () => {
      const t = buildTerrain(w, this.hm);
      this.root.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
      this.terrainMesh = t;
      this.root.add(t);
    }));
    const water = buildWater(w);
    if (water) this.root.add(water);
    this.props = new PropLayer([...w.entities.values()].filter((e) => !e.dead && (e.kind === 'resource' || e.kind === 'prop')), (x, y) => this.h(x, y));
    this.root.add(this.props.group);
    this.root.add(this.fx.group);
    const ringMat = new THREE.MeshBasicNodeMaterial({ map: ringTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const rg = new THREE.PlaneGeometry(1, 1);
    rg.rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(rg, ringMat, 800);
    this.rings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(800 * 3), 3);
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 3;
    this.root.add(this.rings);
    this.cursor = new THREE.Mesh(rg, new THREE.MeshBasicNodeMaterial({ map: ringTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffd060 }));
    this.cursor.visible = false;
    this.root.add(this.cursor);
    this.scene.add(this.root);
    this.arrowGeo = new GeoBuilder().add(G.cyl(0.015, 0.015, 0.7, 4), M(0, 0, 0, Math.PI / 2, 0, 0), { color: 0x8a6438 }).add(G.cone(0.04, 0.12, 4), M(0, 0, 0.38, Math.PI / 2, 0, 0), { color: 0xd0d0d0, metal: 1 }).add(G.box(0.06, 0.005, 0.12), M(0, 0, -0.32), { color: 0xffffff }).build();
    this.orbGeo = new GeoBuilder().add(G.ico(0.16, 1), M(), { color: 0x8fd8ff, glow: 1.2, shade: 0 }).add(G.ico(0.24, 0), M(), { color: 0x4a90ff, glow: 0.6, shade: 0 }).build();
    this.bindEvents();
    void this.warmup();
  }

  /** Compile every model/material combination up front so units never pop in. */
  private async warmup() {
    const g = new THREE.Group();
    const colors = new Set<number>([...this.sim.world.factions.map((f) => f.color), this.colorOf(EVIL), this.colorOf(NEUTRAL)]);
    const skeletons: THREE.Skeleton[] = [];
    for (const c of colors) {
      for (const id of [...Object.keys(content.units), ...Object.keys(content.heroes)]) {
        const { mesh } = characterModel(id).rig.instantiate(teamMaterial(c));
        skeletons.push(mesh.skeleton);
        g.add(mesh);
      }
      for (const id of Object.keys(content.buildings)) g.add(new THREE.Mesh(buildingModel(id, 1).geo, teamMaterial(c)));
      g.add(new THREE.Mesh(buildingModel('townhall', 2).geo, teamMaterial(c)));
    }
    try {
      await this.engine.renderer.compileAsync(g, this.engine.camera, this.scene);
    } catch (e) {
      console.warn('[warmup]', e);
    }
    for (const s of skeletons) s.dispose();
  }

  h(x: number, y: number) {
    return this.hm.at(x, y);
  }
  colorOf(o: number) {
    return o === EVIL ? 0x2a2630 : o === NEUTRAL ? 0x8a7a5a : this.sim.faction(o)?.color ?? 0xffffff;
  }
  near(x: number, z: number, r: number) {
    const cx = this.camera.x / TS, cz = this.camera.y / TS;
    return Math.abs(x - cx) < r && Math.abs(z - cz) < r * 0.8;
  }

  ring(x: number, y: number, z: number, r: number, color: number, a: number) {
    if (this.ringN >= 800) return;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y + 0.04, z), new THREE.Quaternion(), new THREE.Vector3(r * 2, 1, r * 2));
    this.rings.setMatrixAt(this.ringN, m);
    const c = new THREE.Color(color).multiplyScalar(a);
    this.rings.setColorAt(this.ringN, c);
    this.ringN++;
  }

  // ---------------------------------------------------------------- input helpers
  setGhost(def: string | null, tx = 0, ty = 0, ok = true) {
    if (!def) { if (this.ghost) this.ghost.visible = false; return; }
    const d = content.buildings[def];
    const key = def + ok;
    if (this.ghostKey !== key) {
      if (this.ghost) this.root.remove(this.ghost);
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicNodeMaterial({ color: ok ? 0x80ff90 : 0xff6050, transparent: true, opacity: 0.45, depthWrite: false });
      g.add(new THREE.Mesh(buildingModel(def, 1).geo, mat));
      const grid = gridTexture();
      const gm = new THREE.MeshBasicNodeMaterial({ map: grid, color: ok ? 0x60ff70 : 0xff4030, transparent: true, depthWrite: false, opacity: 0.8 });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(d.size[0], d.size[1]), gm);
      plane.rotation.x = -Math.PI / 2;
      plane.position.y = 0.06;
      grid.wrapS = grid.wrapT = THREE.RepeatWrapping;
      (gm.map as THREE.Texture).repeat.set(d.size[0], d.size[1]);
      g.add(plane);
      if (def === 'tower') {
        const r = new THREE.Mesh(new THREE.RingGeometry(d.attack!.range - 0.05, d.attack!.range, 48), new THREE.MeshBasicNodeMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));
        r.rotation.x = -Math.PI / 2;
        r.position.y = 0.08;
        g.add(r);
      }
      this.ghost = g;
      this.ghostKey = key;
      this.root.add(g);
    }
    const cx = tx + d.size[0] / 2, cz = ty + d.size[1] / 2;
    this.ghost!.visible = true;
    this.ghost!.position.set(cx, this.h(cx, cz), cz);
  }

  setCursor(x: number | null, y = 0, r = 1) {
    this.cursor.visible = x != null;
    if (x == null) return;
    this.cursor.position.set(x, this.h(x, y) + 0.08, y);
    this.cursor.scale.set(r * 2.2, 1, r * 2.2);
  }

  flashMarker(x: number, y: number, color: number) {
    const m = new THREE.Mesh(this.cursor.geometry, new THREE.MeshBasicNodeMaterial({ map: ringTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color }));
    m.position.set(x, this.h(x, y) + 0.06, y);
    this.root.add(m);
    this.markers.push({ mesh: m, t: 0 });
    this.fx.glow(x, this.h(x, y) + 0.1, y, { n: 6, color, speed: [0.5, 1.2], life: [0.2, 0.4], size: [0.08, 0.14], end: 0.01 });
  }

  // ---------------------------------------------------------------- events
  private bindEvents() {
    const ev = this.sim.events;
    const near = (x: number, y: number) => this.near(x, y, 28);
    const P = (x: number, y: number, up = 0.8) => new THREE.Vector3(x, this.h(x, y) + up, y);
    this.unsub.push(
      ev.on('hit', (h) => {
        const u = this.units.get(h.id);
        u?.hit();
        const b = this.buildings.get(h.id);
        if (b) b.shake = Math.min(1, b.shake + 0.5);
        if (!near(h.x, h.y)) return;
        const t = this.sim.get(h.id);
        const y = this.h(h.x, h.y) + (t?.kind === 'building' ? 1 : 0.7);
        if (t?.kind === 'building') this.fx.chips(h.x, y, h.y, [0x8a7a68, 0x6a4a28], 5);
        else if (t?.owner === EVIL) this.fx.chips(h.x, y, h.y, [0xe8e0c8, 0xb8ab8a], 4);
        else this.fx.blood(h.x, y, h.y);
        this.fx.sparks(h.x, y, h.y, [0xfff0c0, 0xffc060], 5);
        const big = h.dmg >= 15;
        this.overlay.text(P(h.x, h.y, 1.6), String(Math.round(h.dmg)), t?.owner === this.localFaction ? '#ff7060' : big ? '#ffd040' : '#fff4e0', big ? 19 : 15);
        if (t && this.sim.isHero(t) && t.owner === this.localFaction) this.camera.shake(3);
        sfx.play(t?.kind === 'building' ? 'thud' : t?.owner === EVIL ? 'bone' : 'hit', h.x * TS, h.y * TS);
      }),
      ev.on('swing', (s) => {
        const e = this.sim.get(s.id);
        if (!e || !near(e.x, e.y)) return;
        if (!content.unit(e.def)?.projectile) sfx.play(e.owner === EVIL ? 'swingUndead' : 'swing', e.x * TS, e.y * TS);
      }),
      ev.on('shoot', (s) => {
        const e = this.sim.get(s.id);
        if (!e || !near(e.x, e.y)) return;
        sfx.play(s.ptype === 'orb' ? 'magic' : 'bow', e.x * TS, e.y * TS);
        if (s.ptype === 'orb') this.fx.magic(e.x, this.h(e.x, e.y) + 1.8, e.y, undefined, 16, 1.5);
      }),
      ev.on('impact', (i) => {
        const y = i.y;
        if (!near(i.x, y)) return;
        const gy = this.h(i.x, y);
        if (i.ptype === 'orb') {
          this.fx.magic(i.x, gy + 0.6, y, undefined, 30, 3.5);
          this.fx.ring(i.x, gy + 0.2, y, 0x8fd0ff, i.splash || 1);
          const l = lightSource({ pos: new THREE.Vector3(i.x, gy + 1, y), color: 0x6ac8ff, radius: 9, intensity: 30 });
          this.engine.lightSources.add(l);
          setTimeout(() => this.engine.lightSources.delete(l), 180);
          sfx.play('boom', i.x * TS, y * TS);
        } else this.fx.chips(i.x, gy + 0.6, y, 0x8a6438, 2);
      }),
      ev.on('ability', (a) => {
        const gy = this.h(a.x, a.y);
        this.camera.shake(6);
        if (a.ability === 'whirlwind') {
          this.fx.ring(a.x, gy + 0.6, a.y, 0xfff0c0, a.radius);
          this.fx.sparks(a.x, gy + 0.8, a.y, [0xffffff, 0xffe080], 30);
          sfx.play('whirl', a.x * TS, a.y * TS);
        } else if (a.ability === 'volley') {
          for (let i = 0; i < 30; i++) setTimeout(() => {
            const px = a.x + (Math.random() - 0.5) * a.radius * 1.8, pz = a.y + (Math.random() - 0.5) * a.radius * 1.8;
            this.fx.glow(px, this.h(px, pz) + 6, pz, { n: 1, color: 0xfff0c0, speed: [0, 0.01], up: [-18, -16], life: [0.34, 0.36], size: [0.12, 0.12], stretch: true });
            setTimeout(() => { this.fx.chips(px, this.h(px, pz) + 0.2, pz, 0x8a6438, 2); this.fx.dust(px, this.h(px, pz) + 0.1, pz, 2); }, 330);
          }, i * 22);
          sfx.play('volley', a.x * TS, a.y * TS);
        } else {
          this.fx.ring(a.x, gy + 0.5, a.y, 0x8fd0ff, a.radius);
          this.fx.magic(a.x, gy + 1, a.y, undefined, 70, a.radius * 3);
          const l = lightSource({ pos: new THREE.Vector3(a.x, gy + 1.5, a.y), color: 0x6ac8ff, radius: a.radius * 4, intensity: 60 });
          this.engine.lightSources.add(l);
          setTimeout(() => this.engine.lightSources.delete(l), 350);
          sfx.play('nova', a.x * TS, a.y * TS);
        }
      }),
      ev.on('death', (d) => {
        const gy = this.h(d.x, d.y);
        if (d.kind === 'unit') {
          const u = this.units.get(d.id);
          if (u && !content.heroes[d.def]) {
            this.units.delete(d.id);
            u.deadT = 0;
            u.dissolve = d.killer === -2 || d.owner === EVIL;
            this.dying.push(u);
          }
          if (d.owner === EVIL) { this.fx.bones(d.x, gy + 0.6, d.y); sfx.play('bone', d.x * TS, d.y * TS); }
          else if (content.heroes[d.def]) { this.fx.magic(d.x, gy + 1, d.y, [0xffe080, 0xffffff], 50, 2.5); sfx.play('heroDeath', d.x * TS, d.y * TS); }
          else this.fx.blood(d.x, gy + 0.5, d.y, 0x8a1a1a, 10);
          if (d.killer === -2) this.fx.soft(d.x, gy + 0.5, d.y, { n: 8, color: 0x4aff6a, speed: [0.1, 0.5], up: [0.4, 1], life: [0.8, 1.4], size: [0.3, 0.5], end: 1.2, alpha: 0.4 });
        } else if (d.kind === 'building') {
          const b = this.buildings.get(d.id);
          const w = this.sim.world.entities.get(d.id)?.w ?? 3;
          this.fx.debrisBurst(d.x, gy, d.y, w);
          if (near(d.x, d.y)) this.camera.shake(8);
          sfx.play('collapse', d.x * TS, d.y * TS);
          if (b) { b.dispose(); this.buildings.delete(d.id); }
        }
      }),
      ev.on('depleted', (d) => this.removeProp(d.id, true)),
      ev.on('gathered', (g) => {
        if (!near(g.x, g.y)) return;
        const r = [...this.sim.world.entities.values()].find((e) => (e.kind === 'resource') && Math.abs(e.x - g.x) < 0.01 && Math.abs(e.y - g.y) < 0.01);
        if (r) this.props.shake(r.id);
        const gy = this.h(g.x, g.y);
        if (g.res === 'wood') { this.fx.chips(g.x, gy + 0.6, g.y, 0xb0864a, 3); if (Math.random() < 0.5) this.fx.leaves(g.x, gy + 1.8, g.y, 3); sfx.play('chop', g.x * TS, g.y * TS); }
        else if (g.res === 'stone') { this.fx.chips(g.x, gy + 0.5, g.y, 0x9a9690, 4); this.fx.sparks(g.x, gy + 0.5, g.y, [0xffffff], 3); sfx.play('pick', g.x * TS, g.y * TS); }
        else { this.fx.chips(g.x, gy + 0.4, g.y, 0xd42030, 3); sfx.play('pluck', g.x * TS, g.y * TS); }
        if (g.owner === this.localFaction) this.overlay.text(P(g.x, g.y, 1.8), `+${g.amount}`, g.res === 'wood' ? '#e0b070' : g.res === 'stone' ? '#d0d0d8' : '#ff9070', 13);
      }),
      ev.on('built', (b) => {
        const v = this.buildings.get(b.id);
        if (v) { v.pop = 1; this.fx.dust(v.cx, v.group.position.y + 0.1, v.cz, 16); this.fx.magic(v.cx, v.group.position.y + 1.5, v.cz, [0xffe080, 0xffffff], 30, 3); }
        if (b.owner === this.localFaction) sfx.play('built', 0, 0, true);
      }),
      ev.on('placed', (b) => { if (b.owner === this.localFaction) sfx.play('place', 0, 0, true); }),
      ev.on('levelUp', (l) => {
        const e = this.sim.get(l.id);
        if (!e) return;
        const gy = this.h(e.x, e.y);
        this.fx.magic(e.x, gy + 1, e.y, [0xffe080, 0xfff4c0, 0xffffff], 60, 3);
        this.fx.ring(e.x, gy + 0.3, e.y, 0xffd040, 1.4);
        for (let i = 0; i < 20; i++) this.fx.glow(e.x, gy + i * 0.15, e.y, { n: 1, color: 0xffe080, speed: [0.3, 0.6], up: [1, 2], life: [0.8, 1.2], size: [0.12, 0.2], end: 0.02 });
        this.overlay.text(P(e.x, e.y, 2.4), `Рівень ${l.level}!`, '#ffd040', 22);
        sfx.play('levelUp', 0, 0, true);
      }),
      ev.on('recruited', (r) => { const e = this.sim.get(r.id); if (e) this.overlay.text(P(e.x, e.y, 1.8), '+1', '#9aff8a', 18); sfx.play('recruit', 0, 0, true); }),
      ev.on('trained', (r) => { const e = this.sim.get(r.id); if (e) { this.fx.sparks(e.x, this.h(e.x, e.y) + 0.7, e.y, [0xffffff, 0xffe080], 14); this.fx.dust(e.x, this.h(e.x, e.y), e.y, 8); } }),
      ev.on('waveSent', () => sfx.play('horn', 0, 0, true)),
      ev.on('waveWarning', (w) => { if (this.sim.isAlly(w.faction, this.localFaction)) sfx.play('warning', 0, 0, true); }),
      ev.on('evilDestroyed', () => { this.camera.shake(14); sfx.play('victory', 0, 0, true); }),
      ev.on('ping', (p) => this.ping(p.x, p.y, this.colorOf(p.f))),
      ev.on('spawn', (s) => {
        if (s.owner === EVIL && near(s.x, s.y)) { const gy = this.h(s.x, s.y); this.fx.dust(s.x, gy, s.y, 8, 0x5a5048); this.fx.glow(s.x, gy + 0.2, s.y, { n: 10, color: 0x6aff7a, speed: [0.2, 0.8], up: [0.6, 1.6], life: [0.6, 1.1], size: [0.08, 0.14], end: 0.01 }); }
      }),
    );
  }

  ping(x: number, y: number, color: number) {
    for (let i = 0; i < 3; i++) setTimeout(() => this.fx.ring(x, this.h(x, y) + 0.2, y, color, 1.2), i * 300);
    for (let i = 0; i < 25; i++) this.fx.glow(x, this.h(x, y) + i * 0.2, y, { n: 1, color, speed: [0, 0.1], up: [0.5, 1], life: [1.5, 2.5], size: [0.15, 0.25], end: 0.05 });
    sfx.play('ping', 0, 0, true);
  }

  private removeProp(id: number, depleted: boolean) {
    const slot = this.props.slot(id);
    if (slot && depleted && slot.key.startsWith('tree')) {
      // falling tree animation using a temporary mesh
      const mesh = new THREE.Mesh(this.props.geometry(slot.key), teamMaterial(0xffffff));
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(slot.base);
      mesh.castShadow = true;
      this.root.add(mesh);
      const dir = Math.random() < 0.5 ? -1 : 1;
      this.falling.push({ mesh, t: 0, dir, axis: new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize() });
      sfx.play('treeFall', 0, 0, false);
    } else if (slot && depleted) {
      const p = new THREE.Vector3().setFromMatrixPosition(slot.base);
      this.fx.dust(p.x, p.y + 0.2, p.z, 10, 0x9a9690);
    }
    this.props.remove(id);
    const l = this.propLights.get(String(id));
    if (l) { this.engine.lightSources.delete(l); this.propLights.delete(String(id)); }
  }

  // ---------------------------------------------------------------- frame
  update(dt: number, alpha: number) {
    const sim = this.sim, w = sim.world;
    this.time += dt;
    this.vw = this.engine.screen.width;
    this.vh = this.engine.screen.height;
    this.camera.update(dt, this.vw, this.vh);
    const focus = new THREE.Vector3(this.camera.x / TS, 0, this.camera.y / TS);
    this.engine.focus.copy(focus);
    const d = this.camera.dist;
    const fog = this.scene.fog as THREE.Fog;
    fog.near = d * 1.6;
    fog.far = d * 4.5;
    const day = ((w.time / content.balance.dayLength + this.dayOffset) % 1 + 1) % 1;
    this.engine.setDay(day, focus);
    this.engine.renderer.shadowMap.enabled = this.showLighting;
    const ticked = w.tick !== this.lastTick;
    if (ticked) this.lastTick = w.tick;
    this.overlay.begin();
    this.ringN = 0;
    let visible = 0;
    const seen = new Set<number>();
    for (const e of w.entities.values()) {
      if (e.dead) continue;
      if (e.kind === 'unit') {
        let u = this.units.get(e.id);
        if (!u) { u = new UnitV(e, this, this.lastTick > 5); this.units.set(e.id, u); }
        if (ticked) u.tick();
        seen.add(e.id);
        u.e = e;
        const inView = this.near(e.x, e.y, 34);
        u.mesh.visible = inView;
        if (inView) { u.update(dt, alpha); visible++; }
      } else if (e.kind === 'building') {
        let b = this.buildings.get(e.id);
        if (!b) { b = new BuildingV(e, this); this.buildings.set(e.id, b); }
        seen.add(e.id);
        b.update(dt);
      } else if (e.kind === 'projectile') {
        let p = this.projs.get(e.id);
        if (!p) { p = new ProjV(e, this); this.projs.set(e.id, p); }
        seen.add(e.id);
        p.update(dt, alpha);
      } else if (e.kind === 'resource' && (w.tick % 10 === 0)) {
        // berries + stone scale
        if (e.res === 'food') {
          const has = (e.amount ?? 0) >= 1 ? 1 : 0;
          if (this.propState.get(e.id) !== has) { this.propState.set(e.id, has); this.props.setBerries(e.id, !!has); }
        } else if (e.res === 'stone' && e.maxAmount) {
          const k = Math.round((0.6 + 0.4 * Math.max(0, (e.amount ?? 0) / e.maxAmount)) * 20) / 20;
          if (this.propState.get(e.id) !== k) { this.propState.set(e.id, k); this.props.setScale(e.id, k); }
          if (e.marked?.length && this.near(e.x, e.y, 30)) this.fx.glow(e.x, this.h(e.x, e.y) + 1.2 + Math.sin(this.time * 3) * 0.1, e.y, { n: 1, color: 0xffd060, speed: [0, 0.01], life: [0.5, 0.5], size: [0.25, 0.25], end: 0.2 });
        }
      }
    }
    for (const [id, u] of this.units) if (!seen.has(id)) { u.dispose(); this.units.delete(id); }
    for (const [id, b] of this.buildings) if (!seen.has(id)) { b.dispose(); this.buildings.delete(id); }
    for (const [id, p] of this.projs) if (!seen.has(id)) { p.dispose(); this.projs.delete(id); }
    // removed props without depletion events (e.g. world edits)
    if (w.tick % 30 === 0) for (const [id] of (this.props as any).slots as Map<number, unknown>) { const e = w.entities.get(id); if (!e || e.dead) this.removeProp(id, false); }
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const u = this.dying[i];
      u.update(dt, 1);
      if (u.deadT > (u.dissolve ? 3 : 5)) { u.dispose(); this.dying.splice(i, 1); }
    }
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.t += dt;
      const p = Math.min(1, f.t / 0.9);
      const rot = new THREE.Matrix4().makeRotationAxis(f.axis, (Math.PI / 2) * p * p * 0.95);
      const base = new THREE.Matrix4().copy((f.mesh as any).userData.base ?? ((f.mesh as any).userData.base = f.mesh.matrix.clone()));
      const pos = new THREE.Vector3().setFromMatrixPosition(base);
      f.mesh.matrix.copy(new THREE.Matrix4().makeTranslation(pos.x, pos.y - Math.max(0, f.t - 1.6) * 0.8, pos.z).multiply(rot).multiply(new THREE.Matrix4().makeTranslation(-pos.x, -pos.y, -pos.z)).multiply(base));
      if (p >= 1 && f.t - dt < 0.9) {
        const tip = pos.clone().add(new THREE.Vector3(f.axis.z, 0, -f.axis.x).multiplyScalar(-1.6));
        this.fx.leaves(tip.x, tip.y + 0.4, tip.z, 14);
        this.fx.dust(tip.x, tip.y, tip.z, 10);
        if (this.near(pos.x, pos.z, 20)) this.camera.shake(2);
      }
      if (f.t > 2.6) { this.root.remove(f.mesh); this.falling.splice(i, 1); }
    }
    // prop lights (torches, rune stones, campfires)
    for (const l of this.props.lights) {
      const key = l.id + ':' + l.pos.x.toFixed(2);
      let src = this.propLights.get(String(l.id));
      if (!src) { src = lightSource({ pos: l.pos.clone(), ...(LIGHT as any)[l.kind] }); this.engine.lightSources.add(src); this.propLights.set(String(l.id), src); }
      if (l.kind === 'fire' && this.near(l.pos.x, l.pos.z, 30)) this.fx.fire(l.pos.x, l.pos.y - 0.1, l.pos.z, 0.9);
      void key;
    }
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i];
      m.t += dt;
      const p = m.t / 0.6;
      m.mesh.scale.set(1.4 * (1 - p * 0.5), 1, 1.4 * (1 - p * 0.5));
      (m.mesh.material as THREE.MeshBasicNodeMaterial).opacity = 1 - p;
      if (p >= 1) { this.root.remove(m.mesh); this.markers.splice(i, 1); }
    }
    this.rings.count = this.ringN;
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
    this.props.update(dt, this.time);
    this.ambient(dt);
    this.fx.update(dt, this.engine.camera);
    this.overlay.updateTexts(dt, this.engine.camera, this.vw, this.vh);
    this.overlay.end();
    this.stats.views = this.units.size + this.buildings.size;
    this.stats.visible = visible;
  }

  renderLights() {}

  private ambient(dt: number) {
    this.ambientT -= dt;
    if (this.ambientT > 0) return;
    this.ambientT = 0.1;
    const w = this.sim.world;
    const cx = this.camera.x / TS, cz = this.camera.y / TS;
    const R = this.camera.dist * 0.9;
    for (let i = 0; i < 3; i++) {
      const x = cx + (Math.random() - 0.5) * R * 2, z = cz + (Math.random() - 0.5) * R * 1.4;
      if (x < 0 || z < 0 || x >= w.W || z >= w.H) continue;
      const t = w.terrain[(z | 0) * w.W + (x | 0)];
      const gy = this.h(x, z);
      if (t === Terrain.Cursed) {
        this.fx.soft(x, gy + 0.3, z, { n: 1, color: [0x3a5a3a, 0x4a3a4a], speed: [0.1, 0.3], life: [3, 5], size: [1.2, 2], end: 3, alpha: 0.22, fadeIn: 0.3, drag: 0.2 });
        if (Math.random() < 0.5) this.fx.glow(x, gy + 0.2, z, { n: 1, color: 0x7dff9a, speed: [0.05, 0.2], up: [0.2, 0.5], life: [2, 3.5], size: [0.05, 0.1], end: 0.01, fadeIn: 0.2 });
      } else if (t === Terrain.Forest || t === Terrain.Grass) {
        if (this.engine.night > 0.4 && Math.random() < 0.8) this.fx.glow(x, gy + 0.5 + Math.random(), z, { n: 1, color: [0xd8ff7a, 0xfff08a], speed: [0.1, 0.4], up: [0.05, 0.2], life: [2.5, 4.5], size: [0.06, 0.1], end: 0.04, fadeIn: 0.3, drag: 0.3 });
        else if (this.engine.night < 0.3 && t === Terrain.Forest && Math.random() < 0.25) this.fx.leaves(x, gy + 2.5, z, 1);
      } else if (t === Terrain.Water && Math.random() < 0.6) {
        this.fx.glow(x, -0.3, z, { n: 1, color: 0xffffff, speed: [0, 0.02], life: [0.5, 1], size: [0.06, 0.12], end: 0.01, alpha: 0.8, fadeIn: 0.4 });
      }
    }
  }

  destroy() {
    for (const u of this.unsub) u();
    for (const u of this.units.values()) u.dispose();
    for (const b of this.buildings.values()) b.dispose();
    for (const p of this.projs.values()) p.dispose();
    for (const u of this.dying) u.dispose();
    for (const l of this.propLights.values()) this.engine.lightSources.delete(l);
    this.engine.lightSources.clear();
    this.scene.remove(this.root);
    this.overlay.destroy();
  }
}

export const unusedUniform = uniform;
