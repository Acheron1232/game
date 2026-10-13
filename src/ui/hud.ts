/** HTML HUD over the canvas. Updated at ~8 Hz; static structure built once. */
import { sfx } from '../audio/sfx';
import { content } from '../engine/registry';
import type { Game } from '../game';
import { assets } from '../r3d/textures';
import { TS } from '../r3d/camera3d';
import { thumbnail, thumbState } from '../r3d/thumbs3d';
import { resName } from '../sim/commands';
import { EVIL, NEUTRAL, Terrain, type Entity } from '../sim/types';
import { evilLevelAt } from '../sim/systems/evil';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const ICON_FALLBACK: Record<string, string> = { ic_wood: '🪵', ic_stone: '🪨', ic_food: '🍖', ic_house: '🏠', ic_swords: '⚔️', ic_skull: '💀', ic_wheat: '🌾', ic_axe: '🪓', ic_pick: '⛏️', ic_hammer: '🔨', ic_shield: '🛡️', ic_crown: '👑', ic_heart: '❤️', ic_star: '⭐', ic_horn: '📯', ic_banner: '🚩' };
export function icon(key: string, size = 22) {
  const url = assets.icon(key);
  return url ? `<img src="${url}" style="width:${size}px;height:${size}px" alt="">` : `<span class="ico" style="font-size:${size * 0.75}px">${ICON_FALLBACK[key] ?? '•'}</span>`;
}
const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const costHtml = (c: Record<string, number | undefined>) =>
  Object.entries(c).filter(([, v]) => v).map(([k, v]) => `${icon(k === 'wood' ? 'ic_wood' : k === 'stone' ? 'ic_stone' : 'ic_food', 13)}${v}`).join(' ');

export class Hud {
  root = h('div', 'hud');
  private els: Record<string, HTMLElement> = {};
  private tab = 'build';
  private acc = 0;
  private noticeUnsub: (() => void)[] = [];
  private minimapBase: HTMLCanvasElement | null = null;
  private tooltip = h('div', 'tooltip panel');
  private lastSel: number | null = -1;
  private selKey = '';
  private victoryShown = false;
  private perfOn = false;
  private thumbV = -1;

  constructor(readonly game: Game) {
    const ui = game.uiRoot;
    ui.appendChild(this.root);
    ui.appendChild(this.tooltip);
    this.build();
    const sim = game.sim;
    this.noticeUnsub.push(
      sim.events.on('notice', (n) => { if (n.f === 'all' || n.f === game.localFaction) this.notice(n.text, n.kind); if (n.kind === 'error') sfx.play('error', 0, 0, true); }),
      sim.events.on('waveWarning', (w) => {
        if (!sim.isAlly(w.faction, game.localFaction)) return;
        const own = w.faction === game.localFaction;
        this.notice(own ? 'Нежить готує напад на ваше поселення!' : `Нежить готує напад на ${sim.faction(w.faction)?.name}`, 'warn');
      }),
    );
    window.addEventListener('keydown', this.onKey);
  }

  private onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest?.('input, textarea')) return;
    if (e.code === 'F3') { this.perfOn = !this.perfOn; this.els.perf.style.display = this.perfOn ? 'block' : 'none'; e.preventDefault(); }
    if (e.code === 'F10' || (e.code === 'Escape' && this.game.input.mode.kind === 'normal' && this.game.input.selected == null)) this.toggleMenu();
    if (e.code === 'Tab') { e.preventDefault(); const tabs = ['build', 'jobs', 'army', 'allies']; this.setTab(tabs[(tabs.indexOf(this.tab) + 1) % tabs.length]); }
  };

  // ------------------------------------------------------------------ structure
  private build() {
    const R = this.root;
    // top bar
    const top = h('div', 'topbar panel interactive');
    top.innerHTML = `
      <div class="res" data-tip="Дерево: будівлі, солдати, ремонт">${icon('ic_wood')}<b data-k="wood">0</b></div>
      <div class="res" data-tip="Камінь: ратуша 2 рівня, вежа">${icon('ic_stone')}<b data-k="stone">0</b></div>
      <div class="res" data-k="foodbox" data-tip="Їжа: найм людей і утримання (1 за хвилину на жителя)">${icon('ic_food')}<b data-k="food">0</b><small data-k="foodrate"></small></div>
      <div class="res" data-tip="Населення / доступне житло">${icon('ic_house')}<b data-k="pop">0</b></div>
      <div class="sep"></div>
      <div class="clock" data-k="clock">0:00</div>
      <div class="sep"></div>
      <div class="evilbox" data-tip="Світове зло: рівень бази та найближчий можливий напад">${icon('ic_skull', 20)}<span data-k="evil"></span></div>
      <div class="sep"></div>
      <div class="speedbox"><button class="btn small" data-act="pause">⏸</button><button class="btn small" data-act="slower">−</button><b data-k="speed" style="min-width:30px;text-align:center;font-size:13px">1×</b><button class="btn small" data-act="faster">+</button></div>`;
    R.appendChild(top);
    const tr = h('div', 'topright interactive');
    tr.innerHTML = `<button class="btn small" data-act="console" title="Консоль розробника (\`)">⌨</button><button class="btn small" data-act="inspector" title="Живий редактор (F2)">⚙</button><button class="btn small" data-act="mute" title="Звук">🔊</button><button class="btn small" data-act="menu" title="Меню (F10)">☰</button>`;
    R.appendChild(tr);
    const keyed = (cls: string, k: string) => { const e = h('div', cls); e.dataset.k = k; return e; };
    R.appendChild(keyed('perf', 'perf'));
    R.appendChild(keyed('notices', 'notices'));
    R.appendChild(keyed('wave-banner', 'wave'));
    const vic = h('div', 'victory panel interactive', `<h1>Світове зло знищено!</h1><p style="font-size:18px">Темне осердя впало. Нежить розсіюється.</p><button class="btn primary" data-act="continue">Продовжити будівництво</button>`);
    vic.dataset.k = 'victory';
    R.appendChild(vic);

    const bottom = h('div', 'bottom');
    // hero panel
    const hero = h('div', 'heropanel panel interactive');
    hero.innerHTML = `
      <div class="portrait" data-k="portrait" data-act="centerHero" data-tip="Центрувати на герої (Space)"><div class="dead" data-k="dead"></div><div class="lvl" data-k="lvl">1</div></div>
      <div class="herodata">
        <div class="heroname" data-k="heroname"></div>
        <div class="bar hp"><i data-k="hpbar"></i><span data-k="hptext"></span></div>
        <div class="bar xp"><i data-k="xpbar"></i><span data-k="xptext"></span></div>
        <div class="ability"><button class="btn small" data-act="ability" data-k="abbtn"><span data-k="abname"></span><div class="cd" data-k="abcd"></div></button><span>Q</span></div>
      </div>`;
    bottom.appendChild(hero);
    // command card
    const cmd = h('div', 'command panel interactive');
    cmd.innerHTML = `<div class="tabs">
        <div class="tab" data-tab="build">Будівництво</div><div class="tab" data-tab="jobs">Роботи</div><div class="tab" data-tab="army">Армія</div><div class="tab" data-tab="allies">Союзники</div>
      </div><div data-k="tabbody"></div>`;
    bottom.appendChild(cmd);
    const sel = h('div', 'selection panel interactive');
    sel.dataset.k = 'selection';
    bottom.appendChild(sel);
    const mm = h('div', 'minimap-wrap panel interactive');
    const mc = h('canvas', 'minimap') as HTMLCanvasElement;
    mc.width = 448; mc.height = 336;
    mc.dataset.k = 'minimap';
    mm.appendChild(mc);
    bottom.appendChild(mm);
    R.appendChild(bottom);

    R.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => (this.els[e.dataset.k!] = e));
    this.els.minimap = mc;
    R.addEventListener('click', (e) => this.onClick(e));
    R.addEventListener('mouseover', (e) => this.onHover(e));
    R.addEventListener('mouseout', () => (this.tooltip.style.display = 'none'));
    this.bindMinimap(mc);
    this.setTab('build');
  }

  setTab(t: string) {
    this.tab = t;
    this.root.querySelectorAll<HTMLElement>('.tab').forEach((e) => e.classList.toggle('active', e.dataset.tab === t));
    const body = this.els.tabbody;
    const g = this.game, f = g.faction;
    if (t === 'build') {
      const defs = Object.values(content.buildings).filter((b) => b.buildable).sort((a, b) => a.order - b.order);
      body.innerHTML = `<div class="grid">${defs.map((d, i) => `<div class="card" data-act="build" data-def="${d.id}" data-tip="${esc(`<b>${d.name}</b><br>${d.description}<br>Вартість: ${costHtml(d.cost as any)}`)}">
        <span class="key">${i + 1}</span><div class="thumb"><img src="${thumbnail('b:' + d.id)}" alt=""></div><div class="name">${d.name}</div><div class="cost">${costHtml(d.cost as any)}</div></div>`).join('')}
        <div class="card" data-act="markmode" data-tip="<b>Позначити камінь</b><br>Клацніть по каменю, щоб призначити видобуток (M)"><span class="key">M</span><div class="thumb">${icon('ic_pick', 40)}</div><div class="name">Видобуток</div><div class="cost">позначити поклад</div></div></div>`;
    } else if (t === 'jobs') {
      const roles: [string, string, string, string][] = [['farmer', 'Фермери', 'ic_wheat', 'Працюють на фермах (1 на ферму)'], ['lumber', 'Лісоруби', 'ic_axe', 'Працюють від лісопильні (1 на лісопильню)'], ['miner', 'Каменярі', 'ic_pick', 'Видобувають позначені поклади (2 на поклад)'], ['builder', 'Будівельники', 'ic_hammer', 'Будують і ремонтують']];
      body.innerHTML = `<div class="jobs">${roles.map(([r, n, ic, tip]) => `<div class="job" data-tip="${tip}"><div class="jname">${icon(ic, 18)}${n}</div><div class="count" data-k="job_${r}">0</div>
        <div class="row"><button class="btn small" data-act="job" data-role="${r}" data-d="-1">−</button><button class="btn small" data-act="job" data-role="${r}" data-d="1">+</button></div><div class="hint" data-k="jobhint_${r}"></div></div>`).join('')}</div>
        <div class="line" data-k="jobline"></div>`;
    } else if (t === 'army') {
      body.innerHTML = `<div class="line" style="margin-top:0;font-size:15px">${icon('ic_swords', 22)}<b data-k="armycount" style="color:var(--ink)">0</b> солдатів · Наказ: <b data-k="armyorder" style="color:var(--gold)"></b></div>
        <div class="row2"><button class="btn" data-act="army" data-o="defend" data-tip="Солдати захищають поселення, не переслідують ворога далеко (Z)">🛡 Захищати</button>
        <button class="btn" data-act="armyTarget" data-tip="Клацніть ціль або точку на карті (X)">⚔ Атакувати ціль</button>
        <button class="btn" data-act="army" data-o="return" data-tip="Перериває атаку й повертає військо (R)">↩ Повернутися</button>
        <button class="btn" data-act="pingmode" data-tip="Позначити точку для союзників (G). Союзні боти прийдуть на допомогу.">📍 Пінг</button></div>
        <div class="line" data-k="armyline"></div>`;
    } else {
      const allies = g.sim.world.factions.filter((o) => o.id !== f.id && g.sim.isAlly(o.id, f.id));
      body.innerHTML = allies.length
        ? allies.map((a) => `<div class="slot"><span class="dot" style="background:#${a.color.toString(16).padStart(6, '0')}"></span><span class="grow">${a.name} ${a.kind === 'bot' ? '(бот)' : ''}</span>
          ${(['wood', 'stone', 'food'] as const).map((r) => `<button class="btn small" data-act="give" data-to="${a.id}" data-res="${r}" data-tip="${esc('Передати 10 ' + resName(r))}">+10 ${icon(r === 'wood' ? 'ic_wood' : r === 'stone' ? 'ic_stone' : 'ic_food', 14)}</button>`).join('')}</div>`).join('') + `<div class="line">Союзники не шкодять одне одному. Пінг (G) кличе союзних ботів на допомогу.</div>`
        : `<div class="line">Союзників немає. Додайте союзного бота в лобі.</div>`;
    }
    body.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => (this.els[e.dataset.k!] = e));
  }

  // ------------------------------------------------------------------ interactions
  private onClick(ev: MouseEvent) {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-act],[data-tab]');
    if (!el) return;
    sfx.unlock();
    sfx.play('click', 0, 0, true);
    const g = this.game, sim = g.sim, f = g.localFaction, input = g.input;
    if (el.dataset.tab) return this.setTab(el.dataset.tab);
    const act = el.dataset.act;
    switch (act) {
      case 'build': input.setMode({ kind: 'place', def: el.dataset.def! }); break;
      case 'markmode': input.setMode({ kind: 'mark' }); break;
      case 'job': sim.send({ t: 'jobs', f, role: el.dataset.role as any, count: g.faction.jobs[el.dataset.role as 'farmer'] + +el.dataset.d! }); break;
      case 'army': sim.send({ t: 'army', f, order: el.dataset.o as any }); break;
      case 'armyTarget': input.setMode({ kind: 'army' }); break;
      case 'pingmode': input.setMode({ kind: 'ping' }); break;
      case 'give': sim.send({ t: 'transfer', f, to: +el.dataset.to!, res: el.dataset.res as any, amount: 10 }); break;
      case 'pause': sim.paused = !sim.paused; break;
      case 'slower': sim.speed = Math.max(0.25, sim.speed / 2); break;
      case 'faster': sim.speed = Math.min(8, sim.speed * 2); break;
      case 'ability': {
        const hero = g.hero;
        const ab = hero && content.abilities[content.heroes[hero.def]?.ability];
        if (ab?.effect === 'aoe_target') input.setMode({ kind: 'ability' });
        else sim.send({ t: 'heroAbility', f, x: 0, y: 0 });
        break;
      }
      case 'centerHero': { const hh = g.hero; if (hh && hh.respawnAt == null) { g.view.camera.tx = hh.x * TS; g.view.camera.ty = hh.y * TS; } break; }
      case 'continue': this.els.victory.style.display = 'none'; break;
      case 'menu': this.toggleMenu(); break;
      case 'mute': sfx.toggleMute(); el.textContent = sfx.muted ? '🔇' : '🔊'; break;
      case 'console': (window as any).game?.console?.toggle(); break;
      case 'inspector': (window as any).game?.inspector?.toggle(); break;
      case 'sel': this.selectionAction(el.dataset.a!); break;
    }
  }

  private selectionAction(a: string) {
    const g = this.game, sim = g.sim, f = g.localFaction;
    const id = g.input.selected;
    if (id == null) return;
    const e = sim.get(id);
    if (!e) return;
    if (a === 'train') sim.send({ t: 'train', f, id });
    if (a === 'research') sim.send({ t: 'research', f, id, tech: 'militia' });
    if (a === 'upgrade') sim.send({ t: 'upgrade', f, id });
    if (a === 'cancel') sim.send({ t: 'cancel', f, id });
    if (a === 'demolish') { if (confirm('Знести споруду? Ресурси не повертаються.')) sim.send({ t: 'demolish', f, id }); }
    if (a === 'help') sim.send({ t: 'heroBuild', f, target: id });
    if (a === 'mark') sim.send({ t: 'mark', f, id, on: !e.marked?.includes(f) });
    if (a === 'attack') sim.send({ t: 'army', f, order: 'attack', target: id });
    if (a === 'heroAttack') sim.send({ t: 'heroAttack', f, target: id });
    if (a === 'recruit') sim.send({ t: 'heroInteract', f, target: id });
    if (a === 'gather') sim.send({ t: 'heroGather', f, target: id });
    this.selKey = '';
  }

  private onHover(ev: MouseEvent) {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-tip]');
    if (!el) { this.tooltip.style.display = 'none'; return; }
    this.tooltip.innerHTML = el.dataset.tip!;
    this.tooltip.style.display = 'block';
    const r = el.getBoundingClientRect();
    const tw = this.tooltip.offsetWidth, th = this.tooltip.offsetHeight;
    this.tooltip.style.left = Math.max(6, Math.min(innerWidth - tw - 6, r.left + r.width / 2 - tw / 2)) + 'px';
    this.tooltip.style.top = (r.top > th + 14 ? r.top - th - 8 : r.bottom + 8) + 'px';
  }

  notice(text: string, kind: string = 'info') {
    const box = this.els.notices;
    const n = h('div', 'notice ' + kind, text);
    box.appendChild(n);
    while (box.children.length > 5) box.firstChild!.remove();
    setTimeout(() => (n.style.opacity = '0'), 4200);
    setTimeout(() => n.remove(), 4900);
  }

  private menuEl: HTMLElement | null = null;
  toggleMenu() {
    if (this.menuEl) { this.menuEl.remove(); this.menuEl = null; this.game.sim.paused = false; return; }
    const g = this.game;
    g.sim.paused = true;
    const o = h('div', 'overlay');
    o.innerHTML = `<div class="menu panel"><h2>Пауза</h2>
      <button class="btn" data-m="resume">Продовжити</button>
      <button class="btn" data-m="save">Зберегти (F5)</button>
      <button class="btn" data-m="load">Завантажити (F9)</button>
      <button class="btn" data-m="export">Експорт збереження у файл</button>
      <button class="btn" data-m="lights">Освітлення: ${g.view.showLighting ? 'увімк.' : 'вимк.'}</button>
      <button class="btn" data-m="quit">Вийти в лобі</button>
      <div class="hint-keys" style="margin-top:8px">
        <div><b>ПКМ</b> — наказ герою</div><div><b>WASD</b> — рух героя</div><div><b>Стрілки/край</b> — камера</div><div><b>Колесо</b> — зум</div>
        <div><b>1–6</b> — будівлі</div><div><b>Q</b> — здібність</div><div><b>Space</b> — до героя</div><div><b>F</b> — стежити</div>
        <div><b>Z/X/R</b> — армія</div><div><b>G</b> — пінг</div><div><b>M</b> — позначити камінь</div><div><b>P</b> — пауза, <b>+/−</b> швидкість</div>
        <div><b>\`</b> — консоль</div><div><b>F2</b> — живий редактор</div><div><b>F3</b> — продуктивність</div><div><b>Tab</b> — вкладки</div>
      </div></div>`;
    o.addEventListener('click', (e) => {
      const m = (e.target as HTMLElement).closest<HTMLElement>('[data-m]')?.dataset.m;
      if (!m && e.target === o) return this.toggleMenu();
      if (m === 'resume') this.toggleMenu();
      if (m === 'save') { g.save(); this.toggleMenu(); }
      if (m === 'load') { this.toggleMenu(); g.loadSlot(); }
      if (m === 'export') {
        const blob = new Blob([JSON.stringify(g.snapshot())], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `living-kingdoms-${Date.now()}.json`;
        a.click();
      }
      if (m === 'lights') { g.view.showLighting = !g.view.showLighting; this.toggleMenu(); }
      if (m === 'quit') { this.toggleMenu(); (window as any).game?.toLobby?.(); }
    });
    this.game.uiRoot.appendChild(o);
    this.menuEl = o;
  }

  // ------------------------------------------------------------------ minimap
  private bindMinimap(c: HTMLCanvasElement) {
    const go = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      const w = this.game.sim.world;
      const x = ((e.clientX - r.left) / r.width) * w.W, y = ((e.clientY - r.top) / r.height) * w.H;
      if (e.button === 2) { this.game.sim.send({ t: 'heroMove', f: this.game.localFaction, x, y }); return; }
      const cam = this.game.view.camera;
      cam.follow = null;
      cam.tx = x * TS; cam.ty = y * TS;
    };
    let down = false;
    c.addEventListener('pointerdown', (e) => { down = e.button === 0; go(e); });
    c.addEventListener('pointermove', (e) => { if (down) go(e); });
    window.addEventListener('pointerup', () => (down = false));
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private drawMinimap() {
    const c = this.els.minimap as HTMLCanvasElement;
    const g = c.getContext('2d')!;
    const sim = this.game.sim, w = sim.world;
    const sx = c.width / w.W, sy = c.height / w.H;
    if (!this.minimapBase) {
      const b = document.createElement('canvas');
      b.width = c.width; b.height = c.height;
      const bg = b.getContext('2d')!;
      const cols: Record<number, string> = { [Terrain.Grass]: '#4f7f36', [Terrain.Dirt]: '#8a6c48', [Terrain.Forest]: '#2f5226', [Terrain.Water]: '#2c5f8e', [Terrain.Sand]: '#c2ad7c', [Terrain.Cursed]: '#3a3036' };
      for (let y = 0; y < w.H; y++) for (let x = 0; x < w.W; x++) { bg.fillStyle = cols[w.terrain[y * w.W + x]]; bg.fillRect(x * sx, y * sy, sx + 0.5, sy + 0.5); }
      this.minimapBase = b;
    }
    g.drawImage(this.minimapBase, 0, 0);
    for (const e of w.entities.values()) {
      if (e.dead) continue;
      if (e.kind === 'resource') {
        if (e.res === 'wood') { g.fillStyle = '#1e3a18'; g.fillRect(e.x * sx - 1, e.y * sy - 1, 2.5, 2.5); }
        else if (e.res === 'stone') { g.fillStyle = '#b8b8b8'; g.fillRect(e.x * sx - 2, e.y * sy - 2, 4, 4); }
        else { g.fillStyle = '#d04040'; g.fillRect(e.x * sx - 1.5, e.y * sy - 1.5, 3, 3); }
      }
    }
    const col = (o: number) => (o === EVIL ? '#5aff6a' : o === NEUTRAL ? '#e8e0c0' : '#' + (sim.faction(o)?.color ?? 0xffffff).toString(16).padStart(6, '0'));
    for (const b of sim.buildings) {
      g.fillStyle = col(b.owner);
      g.fillRect(b.tx! * sx, b.ty! * sy, b.w! * sx, b.h! * sy);
      g.strokeStyle = 'rgba(0,0,0,.7)';
      g.strokeRect(b.tx! * sx, b.ty! * sy, b.w! * sx, b.h! * sy);
    }
    for (const u of sim.units) {
      g.fillStyle = col(u.owner);
      const hero = sim.isHero(u);
      const r = hero ? 4 : 2.2;
      g.beginPath(); g.arc(u.x * sx, u.y * sy, r, 0, Math.PI * 2); g.fill();
      if (hero) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke(); }
    }
    for (const c2 of w.camps) { g.strokeStyle = '#e8e0c0'; g.lineWidth = 1; g.strokeRect(c2.x * sx - 3, c2.y * sy - 3, 6, 6); }
    // camera rect
    const cam = this.game.view.camera, app = this.game.app;
    const r = cam.viewRect(app.screen.width, app.screen.height, 0);
    g.strokeStyle = 'rgba(255,240,200,.9)';
    g.lineWidth = 2;
    g.strokeRect((r.x0 / TS) * sx, (r.y0 / TS) * sy, ((r.x1 - r.x0) / TS) * sx, ((r.y1 - r.y0) / TS) * sy);
    // active ping / wave direction
    const ev = w.evil;
    if (ev.pending && sim.isAlly(ev.pending.faction, this.game.localFaction)) {
      const p = 0.5 + Math.sin(performance.now() / 150) * 0.5;
      g.strokeStyle = `rgba(255,80,60,${p})`;
      g.lineWidth = 3;
      g.beginPath(); g.arc(ev.graveyardPos.x * sx, ev.graveyardPos.y * sy, 10, 0, Math.PI * 2); g.stroke();
    }
  }

  // ------------------------------------------------------------------ per-frame update
  update(dt: number) {
    this.acc += dt;
    if (this.acc < 0.12) return;
    this.acc = 0;
    if (this.thumbV !== thumbState.version) { this.thumbV = thumbState.version; if (this.tab === 'build') this.setTab('build'); }
    const g = this.game, sim = g.sim, f = g.faction, E = this.els, w = sim.world;
    const set = (k: string, v: string) => { const el = E[k]; if (el && el.innerHTML !== v) el.innerHTML = v; };
    set('wood', String(Math.floor(f.res.wood)));
    set('stone', String(Math.floor(f.res.stone)));
    set('food', String(Math.floor(f.res.food)));
    const net = f.stats.foodIn - f.stats.foodOut;
    set('foodrate', `<span class="${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : ''}${net.toFixed(0)}/хв</span> <span style="opacity:.7">(+${f.stats.foodIn.toFixed(0)} −${f.stats.foodOut.toFixed(0)})</span>`);
    E.foodbox.classList.toggle('hungry', f.hungry);
    const pop = sim.population(f.id), cap = sim.housing(f.id);
    set('pop', `${pop}/${cap}`);
    const day = ((w.time / content.balance.dayLength + g.view.dayOffset) % 1 + 1) % 1;
    set('clock', `${fmt(w.time)} · ${day > 0.25 && day < 0.75 ? '☀ День' : '☾ Ніч'}`);
    set('speed', sim.paused ? '⏸' : `${sim.speed}×`);
    // evil status
    const ev = w.evil;
    let evil = '';
    if (ev.destroyed) evil = '<b>Знищено</b>';
    else {
      evil = `Рівень <b>${ev.level}</b> · `;
      const grace = content.balance.evil.graceMinutes * 60;
      if (ev.pending && sim.isAlly(ev.pending.faction, f.id)) evil += `<span style="color:#ff8a6a">Напад на ${ev.pending.faction === f.id ? 'вас' : sim.faction(ev.pending.faction)?.name} через ${fmt(Math.max(0, ev.pending.at - w.time))}</span>`;
      else if (ev.waves.some((x) => x.faction === f.id)) evil += `<span style="color:#ff6a50">Хвиля атакує!</span>`;
      else if (w.time < grace) evil += `Захист: не раніше ніж через ${fmt(grace - w.time)}`;
      else if (f.protectedUntil > w.time) evil += `Захист ще ${fmt(f.protectedUntil - w.time)}`;
      else {
        const next = Math.max(f.lastWaveSentAt + content.balance.evil.sameFactionGap, f.lastWaveEndedAt + content.balance.evil.afterWaveGap, grace) - w.time;
        evil += next > 0 ? `Напад не раніше ніж через ${fmt(next)}` : 'Напад можливий';
      }
      const nextLvl = ev.level < 3 ? content.balance.evil.levelMinutes[ev.level - 1] * 60 - w.time : 0;
      if (nextLvl > 0) evil += ` · рів.${ev.level + 1} через ${fmt(nextLvl)}`;
    }
    set('evil', evil);
    // wave banner
    const wb = E.wave;
    if (ev.pending && sim.isAlly(ev.pending.faction, f.id)) {
      wb.style.display = 'block';
      set('wave', `☠ Хвиля нежиті на ${ev.pending.faction === f.id ? 'ваше поселення' : sim.faction(ev.pending.faction)?.name} через ${Math.ceil(Math.max(0, ev.pending.at - w.time))} с`);
    } else wb.style.display = 'none';
    if (w.result && !this.victoryShown) { this.victoryShown = true; E.victory.style.display = 'block'; }

    // hero panel
    const hero = g.hero;
    if (hero) {
      const hd = content.heroes[hero.def];
      E.portrait.style.backgroundImage = `url(${assets.icon(hd.portrait) ?? thumbnail('p:' + hero.def, g.faction.color)})`;
      set('heroname', `${hd.name}<small>${hd.title}</small>`);
      set('lvl', String(hero.level ?? 1));
      const dead = hero.respawnAt != null;
      E.dead.style.display = dead ? 'flex' : 'none';
      if (dead) set('dead', String(Math.ceil(hero.respawnAt! - w.time)));
      (E.hpbar as HTMLElement).style.width = `${(dead ? 0 : hero.hp / hero.maxHp) * 100}%`;
      set('hptext', dead ? `Відродження через ${Math.ceil(hero.respawnAt! - w.time)} с` : `${Math.ceil(hero.hp)} / ${hero.maxHp}`);
      const lv = hero.level ?? 1, xs = hd.xpLevels;
      const prev = lv > 1 ? xs[lv - 2] : 0, next = xs[lv - 1];
      (E.xpbar as HTMLElement).style.width = next ? `${(((hero.xp ?? 0) - prev) / (next - prev)) * 100}%` : '100%';
      set('xptext', next ? `Досвід ${hero.xp ?? 0} / ${next}` : 'Максимальний рівень');
      const ab = content.abilities[hd.ability];
      set('abname', ab?.name ?? '');
      E.abbtn.dataset.tip = ab ? `<b>${ab.name}</b> (Q)<br>${ab.description}<br>Перезарядка ${ab.cooldown} с` : '';
      const cd = Math.max(0, (hero.abilityReadyAt ?? 0) - w.time);
      (E.abcd as HTMLElement).style.width = ab ? `${(cd / ab.cooldown) * 100}%` : '0';
    }

    // tabs
    if (this.tab === 'build') {
      this.root.querySelectorAll<HTMLElement>('.card[data-def]').forEach((c) => {
        const d = content.buildings[c.dataset.def!];
        const ok = sim.canAfford(f, d.cost) && (d.id !== 'townhall' || !sim.townhall(f.id, false)) && (d.id === 'townhall' || !!sim.townhall(f.id, false));
        c.classList.toggle('disabled', !ok);
      });
    } else if (this.tab === 'jobs') {
      const vill = sim.units.filter((u) => u.owner === f.id && u.def === 'villager');
      const slots: Record<string, number> = { farmer: sim.countBuildings(f.id, 'farm'), lumber: sim.countBuildings(f.id, 'sawmill'), miner: [...w.entities.values()].filter((r) => r.kind === 'resource' && !r.dead && r.marked?.includes(f.id)).length * 2, builder: 99 };
      for (const r of ['farmer', 'lumber', 'miner', 'builder'] as const) {
        const cur = vill.filter((v) => v.role === r).length;
        set('job_' + r, `${cur}<small> / ${f.jobs[r]}</small>`);
        const hint = r !== 'builder' && f.jobs[r] > slots[r] ? (r === 'miner' ? 'Позначте поклади (M)' : `Місць: ${slots[r]} — збудуйте ще`) : cur < f.jobs[r] ? 'Немає вільних людей' : '';
        set('jobhint_' + r, hint);
      }
      const free = vill.filter((v) => !v.role || v.role === 'free');
      const reasons = new Map<string, number>();
      for (const v of vill) if (v.status && v.status !== 'trainee' && v.status !== 'no-path') reasons.set(v.status, (reasons.get(v.status) ?? 0) + 1);
      const sites = sim.buildings.filter((b) => b.owner === f.id && !b.built);
      set('jobline', `Жителів: <b>${vill.length}</b> · вільних: <b>${free.length}</b> (збирають ягоди / допомагають)` + [...reasons].map(([k, n]) => ` · ${k}: ${n}`).join('') + (sites.length ? ` · Будови: ${sites.map((s) => `${sim.bDef(s).name} — ${(s as any).status ?? ''}`).join(', ')}` : ''));
    } else if (this.tab === 'army') {
      const sol = sim.units.filter((u) => u.owner === f.id && u.def === 'soldier');
      set('armycount', String(sol.length));
      set('armyorder', { defend: 'Захищати поселення', attack: 'Атакувати', return: 'Повернутися' }[f.army.order]);
      const b = sim.buildings.find((x) => x.owner === f.id && x.def === 'barracks' && x.built);
      set('armyline', `${f.militia ? '✔ Навчене ополчення (+10 HP, +1 шкоди)' : 'Поліпшення «Навчене ополчення» — у казармі (потрібна ратуша 2 рівня)'}${b ? ` · Черга: ${b.trainQueue ?? 0}` : ' · Збудуйте казарму'}`);
      this.root.querySelectorAll<HTMLElement>('[data-act="army"]').forEach((x) => x.classList.toggle('active', x.dataset.o === f.army.order));
    }

    this.updateSelection();
    this.drawMinimap();
    if (this.perfOn) {
      const s = sim.systems.map((x) => `${x.name.padEnd(10)} ${x.ms.toFixed(2)}ms`).join('\n');
      const net = (window as any).net;
      const ns = net?.stats ? `\nnet buffer ${net.stats.buffer}  jitter ${net.stats.jitter.toFixed(0)}ms  desync ${net.stats.desyncs}  resync ${net.stats.resyncs}  starved ${net.stats.late}` : net ? `\nnet host · guests ${net.guests.size}` : '';
      set('perf', `FPS ${g.fps.toFixed(0)}  frame ${g.frameMs.toFixed(2)}ms\nrenderer ${g.app.name}  nav ${sim.nav.backend} (${sim.nav.stats.searches} paths)\nentities ${w.entities.size}  views ${g.view.stats.views} (${g.view.stats.visible} visible)\nparticles ${g.view.fx.count}${ns}\n${s}`);
    }
  }

  private updateSelection() {
    const g = this.game, sim = g.sim, f = g.localFaction;
    const id = g.input.selected;
    const box = this.els.selection;
    const e = id != null ? sim.get(id) : undefined;
    if (!e) {
      if (this.lastSel !== null) {
        this.lastSel = null;
        box.innerHTML = `<div class="sname">Нічого не вибрано</div><div class="sdesc">Лівий клік — вибрати. Правий клік — наказ герою: рух, атака, збір, будівництво, найм мандрівника.</div>`;
      }
      return;
    }
    const own = e.owner === f;
    let name = '', desc = '', stats = '', actions = '';
    const hp = `${icon('ic_heart', 14)} ${Math.ceil(e.hp)} / ${e.maxHp}`;
    if (e.kind === 'building') {
      const d = sim.bDef(e);
      name = d.name + (e.def === 'townhall' ? ` (рівень ${e.level ?? 1})` : e.def === 'dark_core' ? ` (рівень ${sim.world.evil.level})` : '');
      desc = d.description;
      stats = `<div class="sstat">${hp}</div>`;
      if (!e.built) stats += `<div class="sstat">Будівництво ${Math.floor((e.progress ?? 0) * 100)}% · ${(e as any).status ?? ''}</div>`;
      if (e.def === 'dark_core') stats += `<div class="sstat">Очки сили: ${sim.world.evil.points.toFixed(1)} / ${content.balance.evil.maxPoints}</div>`;
      if (own) {
        if (!e.built) actions += `<button class="btn small" data-act="sel" data-a="help">Герой допомагає</button><button class="btn small" data-act="sel" data-a="cancel">Скасувати (80%)</button>`;
        if (e.built && e.def === 'townhall' && (e.level ?? 1) < 2 && !e.upgrading) actions += `<button class="btn small" data-act="sel" data-a="upgrade" data-tip="60 дерева, 30 каменю, 60 с роботи. Кам’яна ратуша: до 20 населення">⬆ Покращити ${costHtml(d.upgrade!.cost as any)}</button>`;
        if (e.upgrading) { stats += `<div class="sstat">Покращення ${Math.floor((e.level2Progress ?? 0) * 100)}%</div>`; actions += `<button class="btn small" data-act="sel" data-a="cancel">Скасувати покращення</button>`; }
        if (e.built && e.def === 'barracks') {
          actions += `<button class="btn small" data-act="sel" data-a="train" data-tip="Перетворює вільного жителя на солдата">⚔ Солдат ${costHtml(content.balance.soldier.cost as any)}</button>`;
          if (!sim.faction(f)!.militia && !e.researching) actions += `<button class="btn small" data-act="sel" data-a="research" data-tip="+10 здоров’я, +1 шкоди всім солдатам. Потрібна ратуша 2 рівня">Навчене ополчення ${costHtml(content.balance.militia.cost as any)}</button>`;
          stats += `<div class="sstat">Черга: ${e.trainQueue ?? 0}${(e as any).status ? ' · ' + (e as any).status : ''}</div>`;
        }
        if (e.built && e.hp < e.maxHp) actions += `<button class="btn small" data-act="sel" data-a="help">Ремонт героєм</button>`;
        if (e.built) actions += `<button class="btn small" data-act="sel" data-a="demolish">Знести</button>`;
      } else if (sim.isEnemy({ owner: f }, e)) actions += `<button class="btn small" data-act="sel" data-a="attack">Армія: атакувати</button><button class="btn small" data-act="sel" data-a="heroAttack">Герой: атакувати</button>`;
    } else if (e.kind === 'unit') {
      const d = sim.uDef(e);
      const hd = content.heroes[e.def];
      name = hd ? `${hd.name} — ${hd.title}` : d.name;
      const fac = sim.faction(e.owner);
      desc = e.owner === EVIL ? 'Нежить' : e.owner === NEUTRAL ? 'Нейтральний. Найміть героєм за 5 їжі (ПКМ).' : fac?.name ?? '';
      stats = `<div class="sstat">${hp}</div><div class="sstat">${icon('ic_swords', 14)} ${sim.damageOf(e)} шкоди · ${d.attackCooldown}с</div>`;
      if (e.def === 'villager') stats += `<div class="sstat">Робота: ${{ farmer: 'фермер', lumber: 'лісоруб', miner: 'каменяр', builder: 'будівельник', free: 'вільний' }[e.role ?? 'free']}${e.status && e.status !== 'no-path' ? ' · ' + e.status : ''}</div>`;
      if (hd) stats += `<div class="sstat">${icon('ic_star', 14)} Рівень ${e.level} · досвід ${e.xp}</div>`;
      if (e.def === 'traveler') actions += `<button class="btn small" data-act="sel" data-a="recruit">Найняти (5 їжі)</button>`;
      if (sim.isEnemy({ owner: f }, e)) actions += `<button class="btn small" data-act="sel" data-a="heroAttack">Герой: атакувати</button>`;
    } else if (e.kind === 'resource') {
      name = { wood: 'Дерево', stone: 'Кам’яний поклад', food: 'Ягідний кущ' }[e.res!]!;
      desc = e.res === 'stone' ? 'Позначте для каменярів або збирайте героєм.' : e.res === 'food' ? 'Ягоди повільно відновлюються.' : 'Лісоруби рубають дерева біля лісопильні.';
      stats = `<div class="sstat">Запас: ${Math.floor(e.amount ?? 0)}</div>`;
      actions += `<button class="btn small" data-act="sel" data-a="gather">Герой: збирати</button>`;
      if (e.res === 'stone') actions += `<button class="btn small" data-act="sel" data-a="mark">${e.marked?.includes(f) ? 'Зняти позначку' : '⛏ Позначити для видобутку'}</button>`;
    }
    const key = `${e.id}|${name}|${desc}|${stats}|${actions}`;
    if (key === this.selKey) return;
    this.selKey = key;
    this.lastSel = e.id;
    box.innerHTML = `<div class="sname">${name}</div><div class="sdesc">${desc}</div>${stats}<div class="actions">${actions}</div>`;
  }

  destroy() {
    for (const u of this.noticeUnsub) u();
    window.removeEventListener('keydown', this.onKey);
    this.menuEl?.remove();
    this.root.remove();
    this.tooltip.remove();
  }
}

export type { Entity };
