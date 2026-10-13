// Batch-generates all art via tools/gen.sh (Codex image generator). Skips assets that already exist.
// Usage: node tools/gen-assets.mjs [--only name1,name2] [--concurrency 6] [--force]
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHASE1 as ALL1, PHASE2, TEAM } from './assets.mjs';
// 3D build: only ground textures and UI icons are needed (characters/buildings are procedural)
const PHASE1 = Object.fromEntries(Object.entries(ALL1).filter(([k]) => k.startsWith('tex_') || k === 'sheet_icons'));

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const raw = resolve(root, 'art/raw');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const only = opt('--only', '')?.split(',').filter(Boolean);
const force = argv.includes('--force');
const conc = +opt('--concurrency', 6);

function gen(name, a) {
  const out = resolve(raw, name + '.png');
  const prompt = a.prompt.replace('%TEAM%', a.noteam ? 'Do not use magenta, pink or purple anywhere.' : TEAM);
  const ref = a.ref ? resolve(raw, a.ref + '.png') : '';
  return new Promise((res) => {
    const t0 = Date.now();
    const p = spawn(resolve(root, 'tools/gen.sh'), [out, prompt, ref], { stdio: ['ignore', 'pipe', 'inherit'] });
    let s = ''; p.stdout.on('data', (d) => (s += d));
    p.on('close', () => { console.log(`[${((Date.now() - t0) / 1000) | 0}s] ${s.trim()}`); res(existsSync(out)); });
  });
}

async function runPhase(entries) {
  const todo = entries.filter(([n, a]) => (only?.length ? only.includes(n) : !a.skip) && (force || !existsSync(resolve(raw, n + '.png'))));
  console.log('generating', todo.map((t) => t[0]).join(', ') || '(nothing)');
  let i = 0;
  const worker = async () => { while (i < todo.length) { const [n, a] = todo[i++]; let ok = await gen(n, a); if (!ok) ok = await gen(n, a); } };
  await Promise.all(Array.from({ length: conc }, worker));
}

await runPhase(Object.entries(PHASE1));
if (argv.includes('--legacy-2d')) await runPhase(Object.entries(PHASE2));
console.log('DONE');
