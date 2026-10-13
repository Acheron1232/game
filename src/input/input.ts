/**
 * Input → Commands. Right click is a WC3-style smart command for the hero, WASD drives the hero
 * directly, arrows / edges / drag pan the camera, wheel zooms to the cursor.
 */
import { sfx } from '../audio/sfx';
import { content } from '../engine/registry';
import type { Game } from '../game';
import { TS } from '../r3d/camera3d';
import { placementError } from '../sim/commands';
import { EVIL, NEUTRAL, type Entity } from '../sim/types';

export type Mode =
  | { kind: 'normal' }
  | { kind: 'place'; def: string }
  | { kind: 'mark' }
  | { kind: 'army' }
  | { kind: 'ability' }
  | { kind: 'ping' };

export class Input {
  mode: Mode = { kind: 'normal' };
  mouse = { x: 0, y: 0, inside: false };
  world = { x: 0, y: 0 };
  keys = new Set<string>();
  private dragging: { x: number; y: number; moved: boolean; button: number } | null = null;
  private moveCmdAt = 0;
  private listeners: [EventTarget, string, any, any?][] = [];
  selected: number | null = null;
  /** consumers (HUD) may suppress world input while typing */
  captureKeys = false;

  constructor(readonly game: Game) {
    const canvas = game.app.canvas;
    const on = (t: EventTarget, ev: string, fn: any, opt?: any) => { t.addEventListener(ev, fn, opt); this.listeners.push([t, ev, fn, opt]); };
    on(canvas, 'contextmenu', (e: Event) => e.preventDefault());
    on(canvas, 'pointerdown', (e: PointerEvent) => this.down(e));
    on(window, 'pointerup', (e: PointerEvent) => this.up(e));
    on(window, 'pointermove', (e: PointerEvent) => this.moveEv(e));
    on(canvas, 'pointerenter', () => (this.mouse.inside = true));
    on(canvas, 'pointerleave', () => (this.mouse.inside = false));
    on(canvas, 'wheel', (e: WheelEvent) => { e.preventDefault(); this.game.view.camera.zoomAt(Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY, this.vw, this.vh); }, { passive: false });
    on(window, 'keydown', (e: KeyboardEvent) => this.keydown(e));
    on(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.code));
    on(window, 'blur', () => this.keys.clear());
  }

  get vw() { return this.game.app.screen.width; }
  get vh() { return this.game.app.screen.height; }
  get sim() { return this.game.sim; }
  get f() { return this.game.localFaction; }

  setMode(m: Mode) {
    this.mode = m;
    this.game.view.setGhost(null);
    this.game.view.setCursor(null);
    (this.game.app.canvas as HTMLCanvasElement).style.cursor = m.kind === 'normal' ? '' : 'crosshair';
  }

  // ---------------------------------------------------------------- picking
  pick(wx: number, wy: number): Entity | undefined {
    const tx = wx / TS, ty = wy / TS;
    let best: Entity | undefined, bd = Infinity;
    for (const u of this.sim.units) {
      const d = content.unit(u.def);
      const r = (d?.radius ?? 0.35) * 1.4 + 0.3;
      if (Math.abs(tx - u.x) < r && ty > u.y - r * 1.6 && ty < u.y + r) {
        const dd = Math.abs(tx - u.x) + Math.abs(ty - u.y) * 0.5;
        if (dd < bd) { bd = dd; best = u; }
      }
    }
    if (best) return best;
    for (const b of this.sim.buildings) {
      const up = b.def === 'dark_core' ? 2 : b.def === 'tower' ? 1.5 : 0.8;
      if (tx > b.tx! - 0.2 && tx < b.tx! + b.w! + 0.2 && ty > b.ty! - up && ty < b.ty! + b.h! + 0.2) return b;
    }
    for (const e of this.sim.world.entities.values()) {
      if (e.dead || e.kind !== 'resource') continue;
      const tall = e.res === 'wood' ? 1.4 : 0.7;
      if (Math.abs(tx - e.x) < 0.7 && ty < e.y + 0.6 && ty > e.y - tall) {
        const dd = Math.abs(tx - e.x) + Math.abs(ty - e.y);
        if (dd < bd) { bd = dd; best = e; }
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- pointer
  private moveEv(e: PointerEvent) {
    const r = (this.game.app.canvas as HTMLCanvasElement).getBoundingClientRect();
    this.mouse.x = e.clientX - r.left;
    this.mouse.y = e.clientY - r.top;
    if (this.dragging) {
      const dx = e.movementX, dy = e.movementY;
      if (Math.abs(this.mouse.x - this.dragging.x) + Math.abs(this.mouse.y - this.dragging.y) > 6) this.dragging.moved = true;
      if (this.dragging.moved) this.game.view.camera.pan(-dx, -dy);
    }
  }

  private down(e: PointerEvent) {
    sfx.unlock();
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.moveEv(e);
    if (e.button === 1 || (e.button === 0 && this.mode.kind === 'normal')) this.dragging = { x: this.mouse.x, y: this.mouse.y, moved: false, button: e.button };
    if (e.button === 2) this.rightClick(e.shiftKey);
  }

  private up(e: PointerEvent) {
    const d = this.dragging;
    this.dragging = null;
    if (e.button !== 0) return;
    if (d && d.moved) return;
    if (!this.mouse.inside && e.target !== this.game.app.canvas) return;
    this.leftClick(e.shiftKey);
  }

  private leftClick(shift: boolean) {
    const w = this.world, m = this.mode;
    const t = this.pick(w.x, w.y);
    switch (m.kind) {
      case 'place': {
        const [tx, ty] = this.footprint(m.def);
        const err = placementError(this.sim, this.f, m.def, tx, ty);
        if (err) { this.sim.notice(this.f, err, 'error'); sfx.play('error', 0, 0, true); return; }
        this.sim.send({ t: 'place', f: this.f, def: m.def, x: tx, y: ty });
        if (!shift) this.setMode({ kind: 'normal' });
        return;
      }
      case 'mark': {
        if (t?.kind === 'resource' && t.res === 'stone') {
          const on = !t.marked?.includes(this.f);
          this.sim.send({ t: 'mark', f: this.f, id: t.id, on });
          this.sim.notice(this.f, on ? 'Поклад позначено для видобутку' : 'Позначку знято', 'info');
          sfx.play('click', 0, 0, true);
        }
        if (!shift) this.setMode({ kind: 'normal' });
        return;
      }
      case 'army': {
        if (t && this.sim.isEnemy({ owner: this.f }, t)) this.sim.send({ t: 'army', f: this.f, order: 'attack', target: t.id });
        else this.sim.send({ t: 'army', f: this.f, order: 'attack', x: w.x / TS, y: w.y / TS });
        this.flashMarker(w.x, w.y, 0xff5040);
        sfx.play('horn', 0, 0, true);
        this.setMode({ kind: 'normal' });
        return;
      }
      case 'ability':
        this.sim.send({ t: 'heroAbility', f: this.f, x: w.x / TS, y: w.y / TS });
        this.setMode({ kind: 'normal' });
        return;
      case 'ping':
        this.sim.send({ t: 'ping', f: this.f, x: w.x / TS, y: w.y / TS });
        this.setMode({ kind: 'normal' });
        return;
    }
    this.select(t?.id ?? null);
  }

  select(id: number | null) {
    this.selected = id;
    this.game.view.selected.clear();
    if (id != null) this.game.view.selected.add(id);
    if (id != null) sfx.play('click', 0, 0, true);
  }

  private rightClick(shift: boolean) {
    if (this.mode.kind !== 'normal') { this.setMode({ kind: 'normal' }); return; }
    const w = this.world;
    const t = this.pick(w.x, w.y);
    const f = this.f;
    if (t && t.owner !== f && this.sim.isEnemy({ owner: f }, t)) {
      this.sim.send({ t: 'heroAttack', f, target: t.id });
      this.flashMarker(t.x * TS, t.y * TS, 0xff4030);
    } else if (t?.kind === 'resource') {
      this.sim.send({ t: 'heroGather', f, target: t.id });
      this.flashMarker(t.x * TS, t.y * TS, 0xffd050);
    } else if (t?.kind === 'building' && t.owner === f) {
      this.sim.send({ t: 'heroBuild', f, target: t.id });
      this.flashMarker(t.x * TS, t.y * TS, 0xffd050);
    } else if (t?.def === 'traveler') {
      this.sim.send({ t: 'heroInteract', f, target: t.id });
      this.flashMarker(t.x * TS, t.y * TS, 0x80ff80);
    } else {
      this.sim.send({ t: 'heroMove', f, x: w.x / TS, y: w.y / TS });
      this.flashMarker(w.x, w.y, 0x80ff80);
    }
    sfx.play('move', 0, 0, true);
  }

  private flashMarker(x: number, y: number, color: number) {
    this.game.view.flashMarker(x / TS, y / TS, color);
  }

  footprint(def: string): [number, number] {
    const [w, h] = content.buildings[def].size;
    return [Math.round(this.world.x / TS - w / 2), Math.round(this.world.y / TS - h / 2)];
  }

  // ---------------------------------------------------------------- keyboard
  private keydown(e: KeyboardEvent) {
    if (this.captureKeys || (e.target as HTMLElement)?.closest?.('input, textarea, .console')) return;
    this.keys.add(e.code);
    sfx.unlock();
    const g = this.game;
    const builds = Object.values(content.buildings).filter((b) => b.buildable).sort((a, b) => a.order - b.order);
    if (/^Digit[1-9]$/.test(e.code)) {
      const b = builds[+e.code.slice(5) - 1];
      if (b) this.setMode({ kind: 'place', def: b.id });
      return;
    }
    switch (e.code) {
      case 'Escape': this.setMode({ kind: 'normal' }); this.select(null); break;
      case 'Space': { const h = g.hero; if (h && h.respawnAt == null) g.view.camera.tx = h.x * TS, g.view.camera.ty = h.y * TS; e.preventDefault(); break; }
      case 'KeyF': { const cam = g.view.camera; cam.follow = cam.follow ? null : () => { const h = g.hero; return h && h.respawnAt == null ? { x: h.x * TS, y: h.y * TS } : null; }; g.sim.notice(g.localFaction, cam.follow ? 'Камера слідує за героєм' : 'Вільна камера', 'info'); break; }
      case 'KeyQ': {
        const h = g.hero;
        const ab = h && content.abilities[content.heroes[h.def]?.ability];
        if (ab?.effect === 'aoe_target') this.setMode({ kind: 'ability' });
        else this.sim.send({ t: 'heroAbility', f: this.f, x: 0, y: 0 });
        break;
      }
      case 'KeyG': this.setMode({ kind: 'ping' }); break;
      case 'KeyM': if (!e.ctrlKey) this.setMode({ kind: 'mark' }); break;
      case 'KeyR': this.sim.send({ t: 'army', f: this.f, order: 'return' }); break;
      case 'KeyX': this.setMode({ kind: 'army' }); break;
      case 'KeyZ': this.sim.send({ t: 'army', f: this.f, order: 'defend' }); break;
      case 'KeyH': this.sim.send({ t: 'heroStop', f: this.f }); break;
      case 'KeyP': case 'Pause': this.sim.paused = !this.sim.paused; break;
      case 'Equal': case 'NumpadAdd': this.sim.speed = Math.min(8, this.sim.speed * 2); break;
      case 'Minus': case 'NumpadSubtract': this.sim.speed = Math.max(0.25, this.sim.speed / 2); break;
      case 'F5': e.preventDefault(); g.save(); break;
      case 'F9': e.preventDefault(); g.loadSlot(); break;
      case 'KeyL': if (e.shiftKey) g.view.showLighting = !g.view.showLighting; break;
    }
  }

  // ---------------------------------------------------------------- per frame
  update(dt: number) {
    const g = this.game, cam = g.view.camera;
    this.world = cam.toWorld(this.mouse.x, this.mouse.y, this.vw, this.vh);
    // camera pan: arrows + screen edges
    let px = 0, py = 0;
    const sp = 900 * dt;
    if (this.keys.has('ArrowLeft')) px -= sp;
    if (this.keys.has('ArrowRight')) px += sp;
    if (this.keys.has('ArrowUp')) py -= sp;
    if (this.keys.has('ArrowDown')) py += sp;
    if (this.mouse.inside && document.hasFocus() && !this.dragging) {
      const m = 8;
      if (this.mouse.x < m) px -= sp; else if (this.mouse.x > this.vw - m) px += sp;
      if (this.mouse.y < m) py -= sp; else if (this.mouse.y > this.vh - m) py += sp;
    }
    if (px || py) cam.pan(px, py);
    // WASD: direct hero control
    let hx = 0, hy = 0;
    if (this.keys.has('KeyW')) hy -= 1;
    if (this.keys.has('KeyS')) hy += 1;
    if (this.keys.has('KeyA')) hx -= 1;
    if (this.keys.has('KeyD')) hx += 1;
    const h = g.hero;
    if ((hx || hy) && h && h.respawnAt == null && g.sim.time >= this.moveCmdAt) {
      this.moveCmdAt = g.sim.time + 0.12;
      const l = Math.hypot(hx, hy);
      g.sim.send({ t: 'heroMove', f: this.f, x: h.x + (hx / l) * 1.6, y: h.y + (hy / l) * 1.6 });
      if (!cam.follow) { cam.tx += (h.x * TS - cam.tx) * 0.05; cam.ty += (h.y * TS - cam.ty) * 0.05; }
    }
    // hover highlight
    const hov = this.mode.kind === 'place' ? undefined : this.pick(this.world.x, this.world.y);
    g.view.hovered = hov?.id ?? null;
    const canvas = g.app.canvas as HTMLCanvasElement;
    if (this.mode.kind === 'normal') canvas.style.cursor = hov ? (this.sim.isEnemy({ owner: this.f }, hov) ? 'crosshair' : 'pointer') : '';
    // placement ghost / ability cursor
    if (this.mode.kind === 'place') {
      const def = this.mode.def;
      const [tx, ty] = this.footprint(def);
      this.game.view.setGhost(def, tx, ty, !placementError(this.sim, this.f, def, tx, ty));
    } else if (this.mode.kind === 'ability') {
      const ab = h && content.abilities[content.heroes[h.def]?.ability];
      if (ab) this.game.view.setCursor(this.world.x / TS, this.world.y / TS, ab.radius);
    } else if (this.mode.kind === 'army' || this.mode.kind === 'ping') {
      this.game.view.setCursor(this.world.x / TS, this.world.y / TS, 0.8);
    }
    if (this.selected != null && !this.sim.get(this.selected)) this.select(null);
  }

  destroy() {
    for (const [t, ev, fn, opt] of this.listeners) t.removeEventListener(ev, fn, opt);
  }
}

export const isNeutral = (e: Entity) => e.owner === NEUTRAL;
export const isEvilEntity = (e: Entity) => e.owner === EVIL;
