/**
 * Navigation grid. Path search runs in the AssemblyScript WASM module (wasm/nav.ts) when available,
 * with a functionally identical TypeScript fallback (used in tests or if WASM fails to load).
 */

interface NavWasm {
  memory: WebAssembly.Memory;
  gridPtr(): number;
  pathPtr(): number;
  setSize(w: number, h: number): void;
  findPath(sx: number, sy: number, tx: number, ty: number, maxIter: number): number;
  nearestWalkable(x: number, y: number, r: number): number;
  lineOfSight(x0: number, y0: number, x1: number, y1: number): number;
}

export class Nav {
  readonly grid: Uint8Array;
  private blockers: Uint8Array;
  private base: Uint8Array;
  private wasm: NavWasm | null;
  stats = { searches: 0, ms: 0 };

  constructor(readonly W: number, readonly H: number, wasm: NavWasm | null) {
    this.wasm = wasm;
    if (wasm) {
      wasm.setSize(W, H);
      this.grid = new Uint8Array(wasm.memory.buffer, wasm.gridPtr(), W * H);
    } else this.grid = new Uint8Array(W * H);
    this.grid.fill(0);
    this.blockers = new Uint8Array(W * H);
    this.base = new Uint8Array(W * H);
  }

  get backend() {
    return this.wasm ? 'wasm' : 'ts';
  }

  static async loadWasm(source: ArrayBuffer | Uint8Array | string): Promise<NavWasm | null> {
    try {
      const bytes = typeof source === 'string' ? await (await fetch(source)).arrayBuffer() : source;
      const { instance } = await WebAssembly.instantiate(bytes as BufferSource, { env: { abort: () => { throw new Error('nav abort'); } } });
      return instance.exports as unknown as NavWasm;
    } catch (e) {
      console.warn('[nav] WASM unavailable, using TS fallback', e);
      return null;
    }
  }

  /** Static terrain cost: 255 = impassable, else extra cost. */
  setBase(i: number, v: number) {
    this.base[i] = v;
    this.refresh(i);
  }

  private refresh(i: number) {
    this.grid[i] = this.blockers[i] > 0 ? 255 : this.base[i];
  }

  block(x: number, y: number, w: number, h: number, on: boolean) {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) {
        if (xx < 0 || yy < 0 || xx >= this.W || yy >= this.H) continue;
        const i = yy * this.W + xx;
        this.blockers[i] = Math.max(0, this.blockers[i] + (on ? 1 : -1));
        this.refresh(i);
      }
  }

  walkable(x: number, y: number) {
    x |= 0; y |= 0;
    return x >= 0 && y >= 0 && x < this.W && y < this.H && this.grid[y * this.W + x] !== 255;
  }

  areaFree(x: number, y: number, w: number, h: number) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (!this.walkable(xx, yy)) return false;
    return true;
  }

  nearestWalkable(x: number, y: number, r = 8): [number, number] | null {
    const xi = Math.floor(x), yi = Math.floor(y);
    let idx: number;
    if (this.wasm) idx = this.wasm.nearestWalkable(xi, yi, r);
    else idx = nearestTS(this, xi, yi, r);
    if (idx < 0) return null;
    return [(idx % this.W) + 0.5, Math.floor(idx / this.W) + 0.5];
  }

  lineOfSight(x0: number, y0: number, x1: number, y1: number): boolean {
    if (this.wasm) return !!this.wasm.lineOfSight(x0 | 0, y0 | 0, x1 | 0, y1 | 0);
    return losTS(this, x0 | 0, y0 | 0, x1 | 0, y1 | 0);
  }

  /** Returns flat [x0,y0,x1,y1,...] waypoints at cell centers (start excluded). Empty if no movement possible. */
  findPath(sx: number, sy: number, tx: number, ty: number, maxIter = 12000): number[] {
    const t0 = performance.now();
    const out: number[] = [];
    if (this.wasm) {
      const n = this.wasm.findPath(sx | 0, sy | 0, tx | 0, ty | 0, maxIter);
      const p = new Int32Array(this.wasm.memory.buffer, this.wasm.pathPtr(), n);
      for (let i = 0; i < n; i++) out.push((p[i] % this.W) + 0.5, Math.floor(p[i] / this.W) + 0.5);
    } else {
      for (const c of findPathTS(this, sx | 0, sy | 0, tx | 0, ty | 0, maxIter)) out.push((c % this.W) + 0.5, Math.floor(c / this.W) + 0.5);
    }
    this.stats.searches++;
    this.stats.ms += performance.now() - t0;
    return out;
  }
}

// ---------------- TypeScript fallback (mirrors wasm/nav.ts) ----------------

function nearestTS(nav: Nav, x: number, y: number, r: number): number {
  if (nav.walkable(x, y)) return y * nav.W + x;
  for (let d = 1; d <= r; d++) {
    let best = -1, bd = 1e9;
    for (let oy = -d; oy <= d; oy++)
      for (let ox = -d; ox <= d; ox++) {
        if (Math.abs(ox) !== d && Math.abs(oy) !== d) continue;
        if (!nav.walkable(x + ox, y + oy)) continue;
        const dd = ox * ox + oy * oy;
        if (dd < bd) { bd = dd; best = (y + oy) * nav.W + x + ox; }
      }
    if (best >= 0) return best;
  }
  return -1;
}

function losTS(nav: Nav, x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x1 > x0 ? 1 : -1, sy = y1 > y0 ? 1 : -1;
  let x = x0, y = y0, err = dx - dy, n = dx + dy;
  while (n-- > 0) {
    const e2 = err * 2;
    if (e2 > -dy && e2 < dx) {
      if (!nav.walkable(x + sx, y) || !nav.walkable(x, y + sy)) return false;
      err -= dy; err += dx; x += sx; y += sy; n--;
    } else if (e2 > -dy) { err -= dy; x += sx; } else { err += dx; y += sy; }
    if (!nav.walkable(x, y)) return false;
  }
  return true;
}

function findPathTS(nav: Nav, sx: number, sy: number, tx: number, ty: number, maxIter: number): number[] {
  const W = nav.W;
  if (!nav.walkable(sx, sy)) { const s = nearestTS(nav, sx, sy, 6); if (s < 0) return []; sx = s % W; sy = (s / W) | 0; }
  if (!nav.walkable(tx, ty)) { const t = nearestTS(nav, tx, ty, 12); if (t < 0) return []; tx = t % W; ty = (t / W) | 0; }
  const N = W * nav.H;
  const g = new Float32Array(N).fill(Infinity), parent = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const oct = (ax: number, ay: number) => { const dx = Math.abs(ax - tx), dy = Math.abs(ay - ty); return dx > dy ? dx + 0.4142 * dy : dy + 0.4142 * dx; };
  const heap: [number, number][] = [];
  const push = (n: number, f: number) => { heap.push([f, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0]; const last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top[1]; };
  const start = sy * W + sx, goal = ty * W + tx;
  g[start] = 0; push(start, oct(sx, sy));
  let best = start, bestH = oct(sx, sy), it = 0, found = false;
  while (heap.length && it++ < maxIter) {
    const cur = pop();
    if (closed[cur]) continue; closed[cur] = 1;
    if (cur === goal) { found = true; best = cur; break; }
    const cx = cur % W, cy = (cur / W) | 0;
    for (let k = 0; k < 8; k++) {
      const ox = [1, -1, 0, 0, 1, 1, -1, -1][k], oy = [0, 0, 1, -1, 1, -1, 1, -1][k];
      const nx = cx + ox, ny = cy + oy;
      if (!nav.walkable(nx, ny)) continue;
      if (ox && oy && (!nav.walkable(cx + ox, cy) || !nav.walkable(cx, cy + oy))) continue;
      const ni = ny * W + nx; if (closed[ni]) continue;
      const ng = g[cur] + (ox && oy ? 1.41421356 : 1) * (1 + nav.grid[ni] / 32);
      if (ng >= g[ni]) continue;
      g[ni] = ng; parent[ni] = cur;
      const h = oct(nx, ny); if (h < bestH) { bestH = h; best = ni; }
      push(ni, ng + h * 1.001);
    }
  }
  if (!found && best === start) return [];
  const raw: number[] = []; for (let c = best; c !== -1; c = parent[c]) raw.push(c);
  const out: number[] = []; let anchor = raw.length - 1;
  while (anchor > 0) {
    const ax = raw[anchor] % W, ay = (raw[anchor] / W) | 0; let next = anchor - 1;
    for (let j = Math.max(0, anchor - 48); j < anchor - 1; j++) if (losTS(nav, ax, ay, raw[j] % W, (raw[j] / W) | 0)) { next = j; break; }
    out.push(raw[next]); anchor = next;
  }
  return out;
}
