// Asset pipeline: art/raw/*.png  ->  public/assets/*.png + public/assets/manifest.json
//  - chroma-key / alpha cleanup
//  - unit idle + animation strips -> one aligned atlas per unit (frames anchored at the feet)
//  - magenta team-color areas -> separate grayscale "team" layer (tinted at runtime)
//  - sprite sheets of props -> separate sprites via connected components
//  - building/prop light anchors (fire, toxic glow, runes) detected automatically
//  - ground textures -> seamless tiles
import sharp from 'sharp';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = resolve(root, 'art/raw');
const OUT = resolve(root, 'public/assets');
mkdirSync(OUT, { recursive: true });
const has = (n) => existsSync(resolve(RAW, n + '.png'));

// ---------- image helpers ----------
async function load(name) {
  const { data, info } = await sharp(resolve(RAW, name + '.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const img = { w: info.width, h: info.height, d: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
  cleanAlpha(img);
  return img;
}
const blank = (w, h) => ({ w, h, d: new Uint8ClampedArray(w * h * 4) });

function rgb2hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx / 255];
}

/** Removes chroma-green backgrounds (for RGB sources), kills near-invisible noise, de-spills green fringes. */
function cleanAlpha(img) {
  const { d } = img;
  let opaqueCorners = 0;
  for (const [x, y] of [[0, 0], [img.w - 1, 0], [0, img.h - 1], [img.w - 1, img.h - 1]]) if (d[(y * img.w + x) * 4 + 3] > 200) opaqueCorners++;
  const keyGreen = opaqueCorners >= 3;
  for (let i = 0; i < d.length; i += 4) {
    let [r, g, b, a] = [d[i], d[i + 1], d[i + 2], d[i + 3]];
    if (keyGreen) {
      const greenness = g - Math.max(r, b);
      if (greenness > 90) a = 0; else if (greenness > 40) { a = Math.round(a * (1 - (greenness - 40) / 50)); }
      if (greenness > 0 && a > 0) g = Math.max(r, b) + Math.min(greenness, 10);
    }
    if (a < 24) a = 0;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
  }
}

function bbox(img, thr = 24) {
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (img.d[(y * img.w + x) * 4 + 3] > thr) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
function crop(img, r) {
  const o = blank(r.w, r.h);
  for (let y = 0; y < r.h; y++) {
    const sy = r.y + y; if (sy < 0 || sy >= img.h) continue;
    for (let x = 0; x < r.w; x++) {
      const sx = r.x + x; if (sx < 0 || sx >= img.w) continue;
      const si = (sy * img.w + sx) * 4, di = (y * r.w + x) * 4;
      o.d[di] = img.d[si]; o.d[di + 1] = img.d[si + 1]; o.d[di + 2] = img.d[si + 2]; o.d[di + 3] = img.d[si + 3];
    }
  }
  return o;
}
async function resize(img, w, h) {
  // premultiplied resize to avoid dark fringes
  const buf = await sharp(Buffer.from(img.d.buffer, img.d.byteOffset, img.d.length), { raw: { width: img.w, height: img.h, channels: 4 } })
    .resize(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)), { kernel: 'lanczos3', fit: 'fill' })
    .raw().toBuffer({ resolveWithObject: true });
  return { w: buf.info.width, h: buf.info.height, d: new Uint8ClampedArray(buf.data.buffer, buf.data.byteOffset, buf.data.length) };
}
function blit(dst, src, dx, dy) {
  for (let y = 0; y < src.h; y++) {
    const ty = dy + y; if (ty < 0 || ty >= dst.h) continue;
    for (let x = 0; x < src.w; x++) {
      const tx = dx + x; if (tx < 0 || tx >= dst.w) continue;
      const si = (y * src.w + x) * 4, di = (ty * dst.w + tx) * 4;
      const a = src.d[si + 3]; if (!a) continue;
      dst.d[di] = src.d[si]; dst.d[di + 1] = src.d[si + 1]; dst.d[di + 2] = src.d[si + 2]; dst.d[di + 3] = a;
    }
  }
}
async function save(img, file) {
  await sharp(Buffer.from(img.d.buffer, img.d.byteOffset, img.d.length), { raw: { width: img.w, height: img.h, channels: 4 } })
    .png({ compressionLevel: 9, palette: false }).toFile(resolve(OUT, file));
}

/** Splits magenta team areas into a separate grayscale layer. Returns {base, team, teamPixels}. */
function splitTeam(img) {
  const base = { w: img.w, h: img.h, d: new Uint8ClampedArray(img.d) };
  const team = blank(img.w, img.h);
  let n = 0;
  for (let i = 0; i < img.d.length; i += 4) {
    const a = img.d[i + 3]; if (!a) continue;
    const r = img.d[i], g = img.d[i + 1], b = img.d[i + 2];
    const [h, s, v] = rgb2hsv(r, g, b);
    const magenta = h >= 280 && h <= 335 && s > 0.38 && v > 0.12 && g < Math.min(r, b) * 0.75;
    if (!magenta) continue;
    n++;
    // value channel drives the shade; keep a little contrast boost so the tint reads well
    const shade = Math.min(255, Math.round(Math.pow(v, 0.85) * 255 * 1.05));
    team.d[i] = team.d[i + 1] = team.d[i + 2] = shade; team.d[i + 3] = a;
    base.d[i] = base.d[i + 1] = base.d[i + 2] = Math.round(shade * 0.35); // dark underlay for anti-aliased edges
  }
  return { base, team, teamPixels: n };
}

/** Finds clusters of emissive pixels (fire, toxic green, arcane blue). Coordinates are in image pixels. */
function findLights(img) {
  const kinds = {
    fire: (r, g, b) => r > 215 && g > 95 && g < 225 && b < 120 && r - b > 120,
    toxic: (r, g, b) => g > 170 && g - r > 55 && g - b > 40,
    arcane: (r, g, b) => b > 200 && g > 110 && r < 140 && b - r > 90,
  };
  const out = [];
  const cs = 6; // cluster grid
  for (const [kind, test] of Object.entries(kinds)) {
    const gw = Math.ceil(img.w / cs), gh = Math.ceil(img.h / cs);
    const grid = new Uint16Array(gw * gh);
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
      const i = (y * img.w + x) * 4;
      if (img.d[i + 3] > 128 && test(img.d[i], img.d[i + 1], img.d[i + 2])) grid[((y / cs) | 0) * gw + ((x / cs) | 0)]++;
    }
    // flood-fill cells with enough hits
    const seen = new Uint8Array(gw * gh);
    for (let c = 0; c < grid.length; c++) {
      if (seen[c] || grid[c] < 3) continue;
      const stack = [c]; seen[c] = 1; let sx = 0, sy = 0, sw = 0, cnt = 0;
      while (stack.length) {
        const k = stack.pop(); const kx = k % gw, ky = (k / gw) | 0;
        sx += kx * grid[k]; sy += ky * grid[k]; sw += grid[k]; cnt++;
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const nx = kx + ox, ny = ky + oy; if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const nk = ny * gw + nx; if (seen[nk] || grid[nk] < 2) continue; seen[nk] = 1; stack.push(nk);
        }
      }
      if (sw < 18) continue;
      out.push({ kind, x: (sx / sw + 0.5) * cs, y: (sy / sw + 0.5) * cs, size: Math.sqrt(cnt) * cs });
    }
  }
  // keep the strongest few per kind
  return out.sort((a, b) => b.size - a.size).slice(0, 8);
}

/** Feet anchor of a sprite frame: bottom row and mean x of the lowest opaque band. */
function feet(img) {
  const bb = bbox(img, 60); if (!bb) return { x: img.w / 2, y: img.h };
  const band = Math.max(4, Math.round(bb.h * 0.1));
  let sx = 0, n = 0;
  for (let y = bb.y + bb.h - band; y < bb.y + bb.h; y++) for (let x = bb.x; x < bb.x + bb.w; x++) if (img.d[(y * img.w + x) * 4 + 3] > 60) { sx += x; n++; }
  return { x: n ? sx / n : bb.x + bb.w / 2, y: bb.y + bb.h };
}

/** Splits a horizontal strip into N frames using empty columns, falling back to equal cells. */
function splitStrip(img, n) {
  const col = new Uint32Array(img.w);
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (img.d[(y * img.w + x) * 4 + 3] > 40) col[x]++;
  // candidate gaps: runs of (nearly) empty columns
  const runs = []; let s = -1;
  for (let x = 0; x <= img.w; x++) {
    const empty = x < img.w && col[x] <= 1;
    if (empty && s < 0) s = x; if (!empty && s >= 0) { runs.push([s, x]); s = -1; }
  }
  const inner = runs.filter(([a, b]) => a > 0 && b < img.w).sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]));
  let cuts = [];
  if (inner.length >= n - 1) {
    // choose gaps closest to ideal cut positions
    for (let k = 1; k < n; k++) {
      const ideal = (img.w * k) / n;
      let best = null, bd = Infinity;
      for (const r of inner) { const c = (r[0] + r[1]) / 2; const dd = Math.abs(c - ideal); if (dd < bd && dd < img.w / n / 2) { bd = dd; best = c; } }
      cuts.push(best ?? ideal);
    }
  } else cuts = Array.from({ length: n - 1 }, (_, k) => (img.w * (k + 1)) / n);
  const xs = [0, ...cuts.map(Math.round), img.w];
  const frames = [];
  for (let k = 0; k < n; k++) {
    const f = crop(img, { x: xs[k], y: 0, w: xs[k + 1] - xs[k], h: img.h });
    // drop stray specks from neighbours: keep only the largest component's bbox region
    const bb = bbox(f, 40); frames.push(bb ? crop(f, bb) : f);
  }
  return frames;
}

// ---------- units ----------
const UNITS = {
  hero_warrior: { height: 120, anims: { walk: 'hero_warrior_walk', attack: 'hero_warrior_attack' } },
  hero_archer: { height: 120, anims: { walk: 'hero_archer_walk', attack: 'hero_archer_attack' } },
  hero_mage: { height: 150, anims: { walk: 'hero_mage_walk', attack: 'hero_mage_attack' } },
  villager: { height: 96, anims: { walk: 'villager_walk', work: 'villager_work' } },
  soldier: { height: 104, anims: { walk: 'soldier_walk', attack: 'soldier_attack' } },
  traveler: { height: 96, anims: { walk: 'traveler_walk' } },
  skeleton: { height: 100, anims: { walk: 'skeleton_walk', attack: 'skeleton_attack' } },
  zombie: { height: 104, anims: { walk: 'zombie_walk', attack: 'zombie_attack' } },
};

async function processUnit(name, cfg, manifest) {
  if (!has(name)) return;
  const src = await load(name);
  const bb = bbox(src); const base = crop(src, bb);
  const scale = cfg.height / base.h;
  const anims = { idle: [{ img: base, scale }] };
  for (const [anim, file] of Object.entries(cfg.anims)) {
    if (!has(file)) continue;
    const strip = await load(file);
    const frames = splitStrip(strip, 4);
    // normalise strip scale against the idle pose using the smallest frame height (closest to a neutral pose)
    const ref = anim === 'walk' ? frames.map((f) => f.h).sort((a, b) => a - b)[1] : Math.min(...frames.map((f) => f.h));
    const s = cfg.height / ref * (anim === 'walk' ? 1 : 0.97);
    anims[anim] = frames.map((img) => ({ img, scale: Math.min(s, scale * 3) }));
  }
  // resize all frames, find feet anchors, compute uniform cell
  const out = {};
  let left = 0, right = 0, up = 0, down = 4;
  for (const [anim, frames] of Object.entries(anims)) {
    out[anim] = [];
    for (const f of frames) {
      const img = await resize(f.img, f.img.w * f.scale, f.img.h * f.scale);
      const ft = feet(img);
      left = Math.max(left, ft.x); right = Math.max(right, img.w - ft.x); up = Math.max(up, ft.y);
      out[anim].push({ img, ft });
    }
  }
  const cw = Math.ceil(left + right) + 4, ch = Math.ceil(up + down) + 2;
  const ax = Math.ceil(left) + 2, ay = Math.ceil(up) + 2;
  const order = Object.keys(out);
  const cols = Math.max(...order.map((a) => out[a].length));
  const atlas = blank(cw * cols, ch * order.length);
  const frames = {};
  order.forEach((anim, row) => {
    frames[anim] = out[anim].map((f, i) => {
      blit(atlas, f.img, i * cw + Math.round(ax - f.ft.x), row * ch + Math.round(ay - f.ft.y));
      return { x: i * cw, y: row * ch, w: cw, h: ch };
    });
  });
  const { base: b, team, teamPixels } = splitTeam(atlas);
  await save(b, `${name}.png`);
  if (teamPixels > 50) await save(team, `${name}_team.png`);
  manifest.units[name] = { file: `${name}.png`, team: teamPixels > 50 ? `${name}_team.png` : null, anchor: { x: ax, y: ay }, frames, height: cfg.height };
  console.log('unit', name, Object.keys(frames).map((k) => `${k}:${frames[k].length}`).join(' '), `cell ${cw}x${ch}`);
}

// ---------- buildings & single sprites ----------
const BUILDINGS = {
  townhall_1: 230, townhall_2: 250, house: 130, farm: 200, sawmill: 190, barracks: 200, tower: 120,
  construction: 150, dark_core_1: 200, dark_core_2: 230, dark_core_3: 270, graveyard: 230,
};
async function processSingle(name, width, manifest, section = 'buildings') {
  if (!has(name)) return;
  const src = await load(name);
  const bb = bbox(src); const img0 = crop(src, bb);
  const img = await resize(img0, width, (img0.h * width) / img0.w);
  const lights = findLights(img).map((l) => ({ ...l, x: +(l.x - img.w / 2).toFixed(1), y: +(l.y - img.h).toFixed(1) }));
  const { base, team, teamPixels } = splitTeam(img);
  await save(base, `${name}.png`);
  if (teamPixels > 50) await save(team, `${name}_team.png`);
  manifest[section][name] = { file: `${name}.png`, team: teamPixels > 50 ? `${name}_team.png` : null, w: img.w, h: img.h, lights };
  console.log(section, name, `${img.w}x${img.h}`, lights.length ? `lights:${lights.map((l) => l.kind).join(',')}` : '');
}

// ---------- prop sheets ----------
function components(img, minArea) {
  // downsampled occupancy grid with dilation so leafy sprites stay in one piece
  const cs = 4, gw = Math.ceil(img.w / cs), gh = Math.ceil(img.h / cs);
  const occ = new Uint8Array(gw * gh);
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (img.d[(y * img.w + x) * 4 + 3] > 40) occ[((y / cs) | 0) * gw + ((x / cs) | 0)] = 1;
  const dil = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (occ[y * gw + x])
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) { const nx = x + ox, ny = y + oy; if (nx >= 0 && ny >= 0 && nx < gw && ny < gh) dil[ny * gw + nx] = 1; }
  const lab = new Int32Array(gw * gh).fill(-1); const comps = [];
  for (let c = 0; c < dil.length; c++) {
    if (!dil[c] || lab[c] >= 0) continue;
    const id = comps.length; const st = [c]; lab[c] = id; let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, area = 0;
    while (st.length) {
      const k = st.pop(); const kx = k % gw, ky = (k / gw) | 0;
      if (occ[k]) area++;
      x0 = Math.min(x0, kx); y0 = Math.min(y0, ky); x1 = Math.max(x1, kx); y1 = Math.max(y1, ky);
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = kx + ox, ny = ky + oy; if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const nk = ny * gw + nx; if (dil[nk] && lab[nk] < 0) { lab[nk] = id; st.push(nk); }
      }
    }
    comps.push({ x: x0 * cs, y: y0 * cs, w: (x1 - x0 + 1) * cs, h: (y1 - y0 + 1) * cs, area: area * cs * cs });
  }
  const big = comps.filter((c) => c.area >= minArea);
  // reading order: rows then columns
  big.sort((a, b) => (Math.abs(a.y - b.y) < Math.min(a.h, b.h) * 0.5 ? a.x - b.x : a.y - b.y));
  return big;
}
const SHEETS = {
  sheet_trees: { names: ['tree_oak1', 'tree_oak2', 'tree_pine1', 'tree_pine2', 'tree_birch', 'tree_autumn'], width: 150 },
  sheet_cursed: { names: ['dead_tree1', 'dead_tree2', 'dead_tree3', 'bone_pile', 'tomb1', 'tomb2'], width: 110 },
  sheet_rocks: { names: ['rock1', 'rock2', 'rock3', 'rock4', 'rock5', 'rock6'], width: 84 },
  sheet_bushes: { names: ['berry1', 'berry2', 'berry3', 'bush_empty', 'grass1', 'grass2'], width: 64 },
  sheet_ruins: { names: ['ruin_column', 'ruin_arch', 'ruin_runestone', 'ruin_statue', 'ruin_wall', 'ruin_shrine'], width: 110 },
  sheet_props: { names: ['torch', 'brazier', 'campfire', 'tent', 'signpost', 'crates', 'barrels', 'haystack'], width: 70 },
  sheet_fx: { names: ['fx_arrow', 'fx_orb', 'fx_slash', 'fx_smoke', 'fx_sparkle', 'fx_skullflame'], width: 64 },
  sheet_icons: { names: ['ic_wood', 'ic_stone', 'ic_food', 'ic_house', 'ic_swords', 'ic_shield', 'ic_hammer', 'ic_skull', 'ic_wheat', 'ic_axe', 'ic_pick', 'ic_crown', 'ic_heart', 'ic_star', 'ic_horn', 'ic_banner'], width: 64, square: true },
  portraits: { names: ['portrait_warrior', 'portrait_archer', 'portrait_mage'], width: 160, square: true },
};
const SPECIAL_WIDTH = { tree_pine1: 120, tree_pine2: 120, tree_birch: 120, tent: 120, ruin_arch: 150, ruin_wall: 140, bone_pile: 70, tomb1: 56, tomb2: 56, torch: 34, brazier: 48, campfire: 64, signpost: 44, fx_arrow: 40, grass1: 48, grass2: 48, crates: 60, barrels: 52, haystack: 70 };

async function processSheet(name, cfg, manifest) {
  if (!has(name)) return;
  const src = await load(name);
  const comps = components(src, (src.w * src.h) / 600);
  const list = comps.slice(0, cfg.names.length);
  if (list.length < cfg.names.length) console.warn(`  ${name}: found ${comps.length} parts, expected ${cfg.names.length}`);
  for (let i = 0; i < list.length; i++) {
    const n = cfg.names[i]; const c = list[i];
    let img = crop(src, c); const bb = bbox(img); if (bb) img = crop(img, bb);
    const w = SPECIAL_WIDTH[n] ?? cfg.width;
    const scaled = await resize(img, w, cfg.square ? w : (img.h * w) / img.w);
    const lights = findLights(scaled).map((l) => ({ ...l, x: +(l.x - scaled.w / 2).toFixed(1), y: +(l.y - scaled.h).toFixed(1) }));
    const { base, team, teamPixels } = splitTeam(scaled);
    await save(base, `${n}.png`);
    if (teamPixels > 30) await save(team, `${n}_team.png`);
    manifest.props[n] = { file: `${n}.png`, team: teamPixels > 30 ? `${n}_team.png` : null, w: scaled.w, h: scaled.h, lights };
  }
  console.log('sheet', name, '->', list.length, 'sprites');
}

// ---------- ground textures ----------
async function processTexture(name, manifest) {
  if (!has(name)) return;
  const S = 512;
  const src = await sharp(resolve(RAW, name + '.png')).removeAlpha().resize(S, S, { fit: 'cover' }).raw().toBuffer();
  // make seamless: blend with a half-offset copy using a smooth mask that hides the original edges
  const out = Buffer.alloc(S * S * 3);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const ex = Math.min(x, S - 1 - x) / (S / 2), ey = Math.min(y, S - 1 - y) / (S / 2);
    const w = Math.min(1, Math.min(ex, ey) * 2.2); const wm = w * w * (3 - 2 * w);
    const ox = (x + S / 2) % S, oy = (y + S / 2) % S;
    for (let c = 0; c < 3; c++) out[(y * S + x) * 3 + c] = Math.round(src[(y * S + x) * 3 + c] * wm + src[(oy * S + ox) * 3 + c] * (1 - wm));
  }
  await sharp(out, { raw: { width: S, height: S, channels: 3 } }).png().toFile(resolve(OUT, `${name}.png`));
  manifest.textures[name] = { file: `${name}.png`, size: S };
  console.log('texture', name);
}

// ---------- run ----------
const manifest = { version: Date.now(), units: {}, buildings: {}, props: {}, textures: {} };
// the 3D renderer builds characters/buildings procedurally; only UI icons and ground textures are used
await processSheet('sheet_icons', SHEETS.sheet_icons, manifest);
for (const n of ['tex_grass', 'tex_dirt', 'tex_cursed', 'tex_water', 'tex_forest', 'tex_sand']) await processTexture(n, manifest);
writeFileSync(resolve(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log('manifest written:', Object.keys(manifest.units).length, 'units,', Object.keys(manifest.buildings).length, 'buildings,', Object.keys(manifest.props).length, 'props,', Object.keys(manifest.textures).length, 'textures');
