import '@fontsource/cinzel/400.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/alegreya-sans/400.css';
import '@fontsource/alegreya-sans/700.css';
import './ui/styles.css';
import './content/index';
import './sim/commands';
import { sfx } from './audio/sfx';
import { Game } from './game';
import { createApi } from './mods/api';
import { assets } from './r3d/textures';
import { Engine } from './r3d/engine';
import { generateThumbnails } from './r3d/thumbs3d';
import { Nav } from './sim/nav';
import { DevConsole, Inspector } from './ui/devtools';
import { showLobby } from './ui/lobby';
import { factionColors } from './sim/map';

const HOT_KEY = 'lk:hot';

async function boot() {
  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.innerHTML = `<div>Живі королівства</div><div class="bar"><i style="width:10%"></i></div><div style="font-size:14px;color:#c8b898" data-s>Підготовка світу…</div>`;
  document.body.appendChild(loading);
  const step = (p: number, s: string) => { (loading.querySelector('i') as HTMLElement).style.width = p + '%'; loading.querySelector('[data-s]')!.textContent = s; };

  const params = new URLSearchParams(location.search);
  const backend = params.get('renderer') === 'webgl' ? 'webgl' : 'webgpu';
  step(20, 'Запуск 3D-рендера…');
  const app = new Engine(backend);
  await app.init(document.getElementById('game')!);
  (window as any).engine = app;
  step(45, 'Завантаження ассетів…');
  await assets.load();
  step(75, 'Компіляція навігації (WASM)…');
  const wasm = await Nav.loadWasm(import.meta.env.BASE_URL + 'wasm/nav.wasm');
  await document.fonts.ready;
  void generateThumbnails(app, factionColors[+(localStorage.getItem('lk:color') ?? 0)] ?? 0x3d7bff);
  step(100, 'Готово');
  loading.style.opacity = '0';
  setTimeout(() => loading.remove(), 500);

  const ui = document.getElementById('ui')!;
  const game = new Game(app, wasm, ui);
  const toLobby = async () => {
    game.dispose();
    const r = await showLobby(document.body, app);
    if (r.loadSlot) {
      const raw = localStorage.getItem('lk:save:' + r.loadSlot);
      if (raw) { const s = JSON.parse(raw); game.load(s, s.localFaction ?? 0); return; }
    }
    if (r.guest) {
      game.load(r.guest.save, r.guest.faction);
      r.guest.session.attach(game);
      game.sim.notice(game.localFaction, 'Ви приєдналися до кооперативної гри', 'good');
      (window as any).net = r.guest.session;
      void generateThumbnails(app, game.faction.color);
      return;
    }
    if (r.setup) game.start(r.setup, r.local ?? 0);
    if (game.sim) void generateThumbnails(app, game.faction.color);
    if (r.host) {
      const h = r.host;
      h.start(game);
      game.onAttach = () => { h.hook(game); h.resyncAll(); };
      (window as any).net = h;
      if (h.guests.size) game.sim.notice('all', `Кооператив: ${[...h.guests.values()].map((g) => g.name).join(', ')}`, 'good');
    }
  };
  const api = createApi(game, { toLobby });
  (window as any).game = api;
  api.console = new DevConsole(api);
  api.inspector = new Inspector(api);
  console.info(`%cЖиві королівства — renderer: ${app.name}, nav: ${wasm ? 'wasm' : 'ts'}`, 'color:#e8c46a');

  // restore a session that was running before a code reload
  const hot = sessionStorage.getItem(HOT_KEY);
  sessionStorage.removeItem(HOT_KEY);
  if (hot) {
    try {
      const s = JSON.parse(hot);
      game.load(s, s.localFaction ?? 0);
      game.sim.notice(game.localFaction, 'Код оновлено — сесію відновлено', 'good');
    } catch (e) {
      console.error('hot restore failed', e);
      await toLobby();
    }
  } else if (params.has('quick')) {
    game.start({ mapId: 'ash_valley', calm: false, players: [
      { name: 'Гравець', color: 0x3d7bff, team: 0, kind: 'human', difficulty: 'normal', heroClass: params.get('hero') ?? 'hero_warrior', start: 0 },
      { name: 'Союзник 1', color: 0xe8423f, team: 0, kind: 'bot', difficulty: 'normal', heroClass: 'hero_archer', start: 1 },
    ] });
  } else await toLobby();

  const persist = () => { if (game.sim?.world.started && !(window as any).net) sessionStorage.setItem(HOT_KEY, JSON.stringify(game.snapshot())); };
  if (import.meta.hot) import.meta.hot.on('vite:beforeFullReload', persist);

  // drag & drop a .js mod or a .json save onto the window
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (!file) return;
    const text = await file.text();
    if (file.name.endsWith('.json')) { const s = JSON.parse(text); game.load(s, s.localFaction ?? 0); }
    else await api.mods.load(text, file.name).catch((err) => api.notice('Помилка мода: ' + err.message, 'error'));
  });
  window.addEventListener('pointerdown', () => sfx.unlock(), { once: true });

  // pick up newly generated art while the game runs
  let version = assets.manifest.version;
  setInterval(async () => {
    try {
      const m = await (await fetch(import.meta.env.BASE_URL + 'assets/manifest.json?ts=' + Date.now())).json();
      if (m.version !== version) {
        version = m.version;
        await assets.reload();
        game.sim?.notice(game.localFaction, 'Нова графіка підвантажена', 'good');
      }
    } catch {}
  }, 8000);
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88;padding:20px;position:fixed;inset:0;z-index:999;background:#000">${String(e?.stack ?? e)}</pre>`);
});
