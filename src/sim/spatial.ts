import type { Entity } from './types';

/** Uniform-grid spatial hash, rebuilt every tick for units/buildings. */
export class SpatialHash {
  private cells: Entity[][];
  private cw: number;
  private ch: number;

  constructor(readonly W: number, readonly H: number, readonly size = 4) {
    this.cw = Math.ceil(W / size);
    this.ch = Math.ceil(H / size);
    this.cells = Array.from({ length: this.cw * this.ch }, () => []);
  }

  clear() {
    for (const c of this.cells) c.length = 0;
  }

  insert(e: Entity) {
    const cx = Math.min(this.cw - 1, Math.max(0, (e.x / this.size) | 0));
    const cy = Math.min(this.ch - 1, Math.max(0, (e.y / this.size) | 0));
    this.cells[cy * this.cw + cx].push(e);
  }

  /** Calls fn for entities whose position is within r of (x,y) (plus building half-size slack). */
  query(x: number, y: number, r: number, fn: (e: Entity, d2: number) => void, slack = 3) {
    const rr = r + slack;
    const x0 = Math.max(0, ((x - rr) / this.size) | 0), x1 = Math.min(this.cw - 1, ((x + rr) / this.size) | 0);
    const y0 = Math.max(0, ((y - rr) / this.size) | 0), y1 = Math.min(this.ch - 1, ((y + rr) / this.size) | 0);
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        const cell = this.cells[cy * this.cw + cx];
        for (let i = 0; i < cell.length; i++) {
          const e = cell[i];
          const dx = e.x - x, dy = e.y - y;
          fn(e, dx * dx + dy * dy);
        }
      }
  }
}
