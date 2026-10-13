/** In-game developer console (JS REPL over the game API) and a live definition inspector. */
import { Pane } from 'tweakpane';
import { content } from '../engine/registry';
import type { GameApi } from '../mods/api';

export class DevConsole {
  el = document.createElement('div');
  private log = document.createElement('div');
  private input = document.createElement('input');
  private history: string[] = JSON.parse(localStorage.getItem('lk:hist') ?? '[]');
  private hi = -1;

  constructor(private api: GameApi) {
    this.el.className = 'console panel';
    this.log.className = 'log';
    this.input.placeholder = 'JS: game.help()  ·  Enter — виконати  ·  ↑↓ — історія  ·  ` — закрити';
    this.el.append(this.log, this.input);
    document.body.appendChild(this.el);
    this.print('Консоль «Живих королівств». Змінюйте гру прямо під час сесії. Введіть game.help()', 'info');
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.run(this.input.value);
      else if (e.key === 'ArrowUp') { this.hi = Math.min(this.history.length - 1, this.hi + 1); this.input.value = this.history[this.history.length - 1 - this.hi] ?? ''; e.preventDefault(); }
      else if (e.key === 'ArrowDown') { this.hi = Math.max(-1, this.hi - 1); this.input.value = this.hi < 0 ? '' : this.history[this.history.length - 1 - this.hi]; e.preventDefault(); }
      else if (e.key === '`' || e.key === 'Escape') { this.toggle(false); e.preventDefault(); }
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Backquote' && !(e.target as HTMLElement)?.closest?.('input, textarea')) { this.toggle(); e.preventDefault(); }
    });
    // mirror runtime errors into the console
    const orig = console.error.bind(console);
    console.error = (...a: unknown[]) => { orig(...a); this.print(a.map(fmt).join(' '), 'err'); };
    window.addEventListener('error', (e) => this.print(String(e.message), 'err'));
  }

  toggle(on = !this.el.classList.contains('open')) {
    this.el.classList.toggle('open', on);
    if (on) setTimeout(() => this.input.focus(), 0);
    else this.input.blur();
  }

  print(text: string, cls = '') {
    const d = document.createElement('div');
    if (cls) d.className = cls;
    d.textContent = text;
    this.log.appendChild(d);
    while (this.log.children.length > 400) this.log.firstChild!.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }

  async run(code: string) {
    if (!code.trim()) return;
    this.history.push(code);
    this.history = this.history.slice(-100);
    localStorage.setItem('lk:hist', JSON.stringify(this.history));
    this.hi = -1;
    this.input.value = '';
    this.print('› ' + code, 'in');
    try {
      let fn: Function;
      try { fn = new Function('game', 'content', `return (async () => (${code}))()`); }
      catch { fn = new Function('game', 'content', `return (async () => { ${code} })()`); }
      const r = await fn(this.api, content);
      if (r !== undefined) this.print(fmt(r), 'res');
    } catch (e) {
      this.print(String((e as Error)?.stack ?? e), 'err');
    }
  }
}

function fmt(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    const seen = new WeakSet();
    return JSON.stringify(v, (_k, x) => {
      if (typeof x === 'function') return `ƒ ${x.name || ''}()`;
      if (x && typeof x === 'object') { if (seen.has(x)) return '[circular]'; seen.add(x); }
      if (x instanceof Map) return Object.fromEntries([...x].slice(0, 30));
      return x;
    }, 2)?.slice(0, 4000) ?? String(v);
  } catch {
    return String(v);
  }
}

/** Tweakpane panel generated from the content registry: every number is editable live. */
export class Inspector {
  el = document.createElement('div');
  private pane: any = null;
  constructor(private api: GameApi) {
    this.el.className = 'inspector';
    document.body.appendChild(this.el);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F2') { this.toggle(); e.preventDefault(); }
    });
  }

  toggle(on = !this.el.classList.contains('open')) {
    this.el.classList.toggle('open', on);
    if (on) this.build();
  }

  build() {
    this.pane?.dispose();
    const pane: any = new Pane({ container: this.el, title: 'Живий редактор (F2)' });
    this.pane = pane;
    const api = this.api;
    const g = pane.addFolder({ title: 'Гра', expanded: true });
    const state = { speed: api.sim.speed, lighting: api.view.showLighting, fx: api.view.fx.quality, day: 0.4, post: true };
    g.addBinding(state, 'speed', { min: 0.25, max: 8, step: 0.25, label: 'швидкість' }).on('change', (e: any) => (api.sim.speed = e.value));
    g.addBinding(state, 'lighting', { label: 'освітлення' }).on('change', (e: any) => (api.view.showLighting = e.value));
    g.addBinding(state, 'fx', { min: 0, max: 2, step: 0.1, label: 'частинки' }).on('change', (e: any) => (api.view.fx.quality = e.value));
    g.addBinding(state, 'day', { min: 0, max: 1, step: 0.01, label: 'час доби' }).on('change', (e: any) => api.time.setDay(e.value));
    g.addBinding(state, 'post', { label: 'bloom/пост' }).on('change', (e: any) => ((window as any).engine.usePost = e.value));
    g.addButton({ title: 'Хвиля нежиті зараз' }).on('click', () => api.evil.forceWave());
    g.addButton({ title: '+500 усіх ресурсів' }).on('click', () => api.give('all', 500));
    g.addButton({ title: 'Перезавантажити ассети' }).on('click', () => api.assets.reload());
    const bind = (folder: any, obj: any, path: string, depth = 0) => {
      for (const [k, v] of Object.entries(obj)) {
        const p = `${path}.${k}`;
        if (typeof v === 'number') {
          const opts: any = { label: k };
          if (Math.abs(v) < 5 && !Number.isInteger(v)) opts.step = 0.05;
          folder.addBinding(obj, k, opts).on('change', (e: any) => content.patch(p, e.value));
        } else if (typeof v === 'boolean') folder.addBinding(obj, k, { label: k }).on('change', (e: any) => content.patch(p, e.value));
        else if (v && typeof v === 'object' && !Array.isArray(v) && depth < 2) bind(folder.addFolder({ title: k, expanded: false }), v, p, depth + 1);
      }
    };
    for (const [section, title] of [['heroes', 'Герої'], ['units', 'Юніти'], ['buildings', 'Будівлі'], ['abilities', 'Здібності']] as const) {
      const f = pane.addFolder({ title, expanded: false });
      for (const [id, def] of Object.entries(content.data[section])) bind(f.addFolder({ title: (def as any).name ?? id, expanded: false }), def, `${section}.${id}`);
    }
    bind(pane.addFolder({ title: 'Баланс', expanded: false }), content.data.balance, 'balance');
  }
}
