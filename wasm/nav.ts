// AssemblyScript navigation core (compiled to WASM).
// Grid A* (8-directional, no corner cutting) + line-of-sight path smoothing + nearest-walkable search.
// All buffers are static memory regions so the module needs no GC/runtime and no JS glue.

const MAXW: i32 = 256;
const MAXN: i32 = MAXW * MAXW;

const GRID: usize = memory.data(MAXN); // u8 per cell: 0 free, 1..254 extra cost, 255 blocked
const GSCORE: usize = memory.data(MAXN * 4); // f32
const PARENT: usize = memory.data(MAXN * 4); // i32
const OPENED: usize = memory.data(MAXN * 4); // i32 stamp: node touched in this search
const CLOSED: usize = memory.data(MAXN * 4); // i32 stamp: node expanded in this search
const HEAPN: usize = memory.data(MAXN * 4); // i32 heap of node indices
const HEAPF: usize = memory.data(MAXN * 4); // f32 heap priorities
const RAW: usize = memory.data(MAXN * 4); // i32 raw path (target -> start)
const PATH: usize = memory.data(MAXN * 4); // i32 smoothed path output (start -> target), cell indices

let W: i32 = 0;
let H: i32 = 0;
let stamp: i32 = 0;
let heapSize: i32 = 0;

const SQRT2: f32 = 1.41421356;

export function gridPtr(): usize { return GRID; }
export function pathPtr(): usize { return PATH; }
export function maxCells(): i32 { return MAXN; }

export function setSize(w: i32, h: i32): void {
  W = w; H = h;
  stamp = 0;
  memory.fill(OPENED, 0, <usize>MAXN * 4);
  memory.fill(CLOSED, 0, <usize>MAXN * 4);
}

@inline function cell(i: i32): u8 { return load<u8>(GRID + <usize>i); }
@inline function walkable(x: i32, y: i32): bool {
  return x >= 0 && y >= 0 && x < W && y < H && cell(y * W + x) != 255;
}

@inline function heapSwap(a: i32, b: i32): void {
  const na = load<i32>(HEAPN + (<usize>a << 2)); const fa = load<f32>(HEAPF + (<usize>a << 2));
  store<i32>(HEAPN + (<usize>a << 2), load<i32>(HEAPN + (<usize>b << 2)));
  store<f32>(HEAPF + (<usize>a << 2), load<f32>(HEAPF + (<usize>b << 2)));
  store<i32>(HEAPN + (<usize>b << 2), na); store<f32>(HEAPF + (<usize>b << 2), fa);
}
@inline function hf(i: i32): f32 { return load<f32>(HEAPF + (<usize>i << 2)); }

function heapPush(n: i32, f: f32): void {
  let i = heapSize++;
  store<i32>(HEAPN + (<usize>i << 2), n); store<f32>(HEAPF + (<usize>i << 2), f);
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (hf(p) <= hf(i)) break;
    heapSwap(p, i); i = p;
  }
}
function heapPop(): i32 {
  const top = load<i32>(HEAPN);
  heapSize--;
  if (heapSize > 0) {
    store<i32>(HEAPN, load<i32>(HEAPN + (<usize>heapSize << 2)));
    store<f32>(HEAPF, load<f32>(HEAPF + (<usize>heapSize << 2)));
    let i = 0;
    while (true) {
      const l = i * 2 + 1; const r = l + 1; let m = i;
      if (l < heapSize && hf(l) < hf(m)) m = l;
      if (r < heapSize && hf(r) < hf(m)) m = r;
      if (m == i) break;
      heapSwap(i, m); i = m;
    }
  }
  return top;
}

@inline function octile(ax: i32, ay: i32, bx: i32, by: i32): f32 {
  const dx = <f32>abs(ax - bx); const dy = <f32>abs(ay - by);
  return dx > dy ? dx + (SQRT2 - 1) * dy : dy + (SQRT2 - 1) * dx;
}

/** Spiral search for the closest walkable cell to (x,y) within radius r. Returns cell index or -1. */
export function nearestWalkable(x: i32, y: i32, r: i32): i32 {
  if (walkable(x, y)) return y * W + x;
  let best: i32 = -1; let bestD: i32 = 0x7fffffff;
  for (let d = 1; d <= r; d++) {
    for (let oy = -d; oy <= d; oy++) {
      for (let ox = -d; ox <= d; ox++) {
        if (abs(ox) != d && abs(oy) != d) continue;
        const cx = x + ox; const cy = y + oy;
        if (!walkable(cx, cy)) continue;
        const dd = ox * ox + oy * oy;
        if (dd < bestD) { bestD = dd; best = cy * W + cx; }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/** Grid line-of-sight through walkable cells (supercover DDA, conservative at corners). */
export function lineOfSight(x0: i32, y0: i32, x1: i32, y1: i32): bool {
  let dx = abs(x1 - x0); let dy = abs(y1 - y0);
  const sx = x1 > x0 ? 1 : -1; const sy = y1 > y0 ? 1 : -1;
  let x = x0; let y = y0;
  let err = dx - dy;
  let n = dx + dy;
  while (n-- > 0) {
    const e2 = err * 2;
    if (e2 > -dy && e2 < dx) {
      // diagonal step: require both orthogonal neighbours to be free (no corner cutting)
      if (!walkable(x + sx, y) || !walkable(x, y + sy)) return false;
      err -= dy; err += dx; x += sx; y += sy; n--;
    } else if (e2 > -dy) { err -= dy; x += sx; }
    else { err += dx; y += sy; }
    if (!walkable(x, y)) return false;
  }
  return true;
}

/**
 * A* from (sx,sy) to (tx,ty). If the target is unreachable the path leads to the closest explored cell.
 * Writes smoothed waypoints (cell indices, start excluded) to PATH and returns their count (0 = no movement possible).
 */
export function findPath(sx: i32, sy: i32, tx: i32, ty: i32, maxIter: i32): i32 {
  if (W == 0) return 0;
  if (!walkable(sx, sy)) {
    const s = nearestWalkable(sx, sy, 6); if (s < 0) return 0;
    sx = s % W; sy = s / W;
  }
  if (!walkable(tx, ty)) {
    const t = nearestWalkable(tx, ty, 12); if (t < 0) return 0;
    tx = t % W; ty = t / W;
  }
  stamp++;
  if (stamp == 0x7fffffff) { setSize(W, H); stamp = 1; }
  heapSize = 0;
  const start = sy * W + sx; const goal = ty * W + tx;
  store<f32>(GSCORE + (<usize>start << 2), 0);
  store<i32>(PARENT + (<usize>start << 2), -1);
  store<i32>(OPENED + (<usize>start << 2), stamp);
  heapPush(start, octile(sx, sy, tx, ty));
  let bestNode = start; let bestH: f32 = octile(sx, sy, tx, ty);
  let iter = 0;
  let found = false;
  while (heapSize > 0 && iter < maxIter) {
    iter++;
    const cur = heapPop();
    if (load<i32>(CLOSED + (<usize>cur << 2)) == stamp) continue;
    store<i32>(CLOSED + (<usize>cur << 2), stamp);
    if (cur == goal) { found = true; bestNode = cur; break; }
    const cx = cur % W; const cy = cur / W;
    const g = load<f32>(GSCORE + (<usize>cur << 2));
    for (let k = 0; k < 8; k++) {
      let ox = 0; let oy = 0;
      if (k == 0) { ox = 1; } else if (k == 1) { ox = -1; } else if (k == 2) { oy = 1; } else if (k == 3) { oy = -1; }
      else if (k == 4) { ox = 1; oy = 1; } else if (k == 5) { ox = 1; oy = -1; } else if (k == 6) { ox = -1; oy = 1; } else { ox = -1; oy = -1; }
      const nx = cx + ox; const ny = cy + oy;
      if (!walkable(nx, ny)) continue;
      if (ox != 0 && oy != 0 && (!walkable(cx + ox, cy) || !walkable(cx, cy + oy))) continue;
      const ni = ny * W + nx;
      if (load<i32>(CLOSED + (<usize>ni << 2)) == stamp) continue;
      const extra = <f32>cell(ni) / 32.0;
      const step: f32 = (ox != 0 && oy != 0 ? SQRT2 : 1.0) * (1.0 + extra);
      const ng = g + step;
      if (load<i32>(OPENED + (<usize>ni << 2)) == stamp && ng >= load<f32>(GSCORE + (<usize>ni << 2))) continue;
      store<i32>(OPENED + (<usize>ni << 2), stamp);
      store<f32>(GSCORE + (<usize>ni << 2), ng);
      store<i32>(PARENT + (<usize>ni << 2), cur);
      const h = octile(nx, ny, tx, ty);
      if (h < bestH) { bestH = h; bestNode = ni; }
      heapPush(ni, ng + h * 1.001);
    }
  }
  if (!found && bestNode == start) return 0;
  // reconstruct raw path target -> start
  let n = 0; let c = bestNode;
  while (c != -1 && n < MAXN) { store<i32>(RAW + (<usize>n << 2), c); n++; c = load<i32>(PARENT + (<usize>c << 2)); }
  // smooth: greedy furthest-visible waypoint, iterating from start (RAW[n-1]) toward target (RAW[0])
  let out = 0; let anchor = n - 1;
  while (anchor > 0) {
    const ax = load<i32>(RAW + (<usize>anchor << 2)) % W; const ay = load<i32>(RAW + (<usize>anchor << 2)) / W;
    let next = anchor - 1;
    // scan toward target for the furthest node still visible from the anchor
    for (let j = max<i32>(0, anchor - 48); j < anchor - 1; j++) {
      const cj = load<i32>(RAW + (<usize>j << 2));
      if (lineOfSight(ax, ay, cj % W, cj / W)) { next = j; break; }
    }
    store<i32>(PATH + (<usize>out << 2), load<i32>(RAW + (<usize>next << 2)));
    out++; anchor = next;
  }
  return out;
}
