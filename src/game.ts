/**
 * Client game session: owns the Simulation, the WorldView, input and HUD, and runs the frame loop.
 * The session survives code edits: on a full reload (dev), the world is snapshotted to sessionStorage
 * and restored on boot, while content/system edits are hot-swapped without any reload at all.
 */
import { sfx } from './audio/sfx';
import { content } from './engine/registry';
import { createGame, type GameSetup } from './sim/map';
import { Nav } from './sim/nav';
import { deserialize, serialize, type SaveFile } from './sim/save';
import type { Sim } from './sim/sim';
import { installSystems } from './sim/systems';
import { Input } from './input/input';
import { Hud } from './ui/hud';
import type { Engine } from './r3d/engine';
import { TS } from './r3d/camera3d';
import { View3D } from './r3d/view3d';

export type NavWasm = ConstructorParameters<typeof Nav>[2];

export class Game {
  sim!: Sim;
  view!: View3D;
  input!: Input;
  hud!: Hud;
  localFaction = 0;
  private tickerFn: ((t: { deltaMS: number }) => void) | null = null;
  fps = 60;
  frameMs = 0;
  /** network hooks */
  beforeFrame: ((dt: number) => void) | null = null;
  onAttach: (() => void) | null = null;

  constructor(readonly app: Engine, readonly wasm: NavWasm, readonly uiRoot: HTMLElement) {}

  start(setup: GameSetup, localFaction = 0) {
    const sim = createGame(setup, this.wasm);
    this.attach(sim, localFaction);
    sim.world.started = true;
    const h = sim.get(sim.faction(localFaction)!.heroId);
    if (h) this.view.camera.jump(h.x * TS, h.y * TS);
    sim.notice(localFaction, 'Знайдіть місце для ратуші (клавіша 1) та залучіть мандрівників.', 'info');
  }

  load(save: SaveFile, localFaction = 0) {
    const sim = deserialize(save, this.wasm);
    this.attach(sim, localFaction);
    const cam = (save as any).camera;
    if (cam) { this.view.camera.jump(cam.x, cam.y); this.view.camera.zoom = this.view.camera.targetZoom = cam.zoom; }
    else {
      const h = sim.get(sim.faction(localFaction)!.heroId);
      if (h) this.view.camera.jump(h.x * TS, h.y * TS);
    }
  }

  private attach(sim: Sim, localFaction: number) {
    this.dispose();
    this.sim = sim;
    this.localFaction = localFaction;
    installSystems(sim);
    this.view = new View3D(this.app, sim);
    this.view.localFaction = localFaction;
    this.input = new Input(this);
    this.hud = new Hud(this);
    let acc = 0, frames = 0;
    this.tickerFn = (t) => {
      const dt = Math.min(0.1, t.deltaMS / 1000);
      const t0 = performance.now();
      this.beforeFrame?.(dt);
      const alpha = sim.advance(dt);
      this.input.update(dt);
      this.view.update(dt, alpha);
      this.view.renderLights();
      sfx.listener.x = this.view.camera.x;
      sfx.listener.y = this.view.camera.y;
      sfx.listener.zoom = this.view.camera.zoom;
      this.hud.update(dt);
      this.frameMs = this.frameMs * 0.9 + (performance.now() - t0) * 0.1;
      acc += dt; frames++;
      if (acc >= 0.5) { this.fps = frames / acc; acc = 0; frames = 0; }
    };
    this.app.ticker.add(this.tickerFn as any);
    this.onAttach?.();
  }

  snapshot(): SaveFile {
    const s = serialize(this.sim);
    (s as any).camera = { x: this.view.camera.x, y: this.view.camera.y, zoom: this.view.camera.zoom };
    (s as any).localFaction = this.localFaction;
    return s;
  }

  save(slot = 'quick') {
    try {
      localStorage.setItem('lk:save:' + slot, JSON.stringify(this.snapshot()));
      this.sim.notice(this.localFaction, 'Гру збережено', 'good');
    } catch (e) {
      this.sim.notice(this.localFaction, 'Не вдалося зберегти: ' + (e as Error).message, 'error');
    }
  }

  loadSlot(slot = 'quick') {
    if (this.sim.remote) return this.sim.notice(this.localFaction, 'У мережевій грі стан задає хост', 'error');
    const raw = localStorage.getItem('lk:save:' + slot);
    if (!raw) return this.sim.notice(this.localFaction, 'Збереження не знайдено', 'error');
    const s = JSON.parse(raw);
    this.load(s, s.localFaction ?? 0);
    this.sim.notice(this.localFaction, 'Гру завантажено', 'good');
  }

  dispose() {
    this.beforeFrame = null;
    if (this.tickerFn) this.app.ticker.remove(this.tickerFn as any);
    this.tickerFn = null;
    this.input?.destroy();
    this.hud?.destroy();
    this.view?.destroy();
  }

  get faction() {
    return this.sim.faction(this.localFaction)!;
  }
  get hero() {
    return this.sim.world.entities.get(this.faction.heroId);
  }
  get defs() {
    return content;
  }
}
