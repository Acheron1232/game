/** Lobby: map + start zone selection, hero choice, color, bots (ally/enemy, easy/normal), calm mode. */
import { sfx } from '../audio/sfx';
import { content } from '../engine/registry';
import { factionColorNames, factionColors, maps, type GameSetup, type PlayerSetup } from '../sim/map';
import { Terrain } from '../sim/types';
import * as THREE from 'three/webgpu';
import type { Engine } from '../r3d/engine';
import { characterModel } from '../r3d/characters';
import { Animator } from '../r3d/anim';
import { teamMaterial } from '../r3d/mats';
import { ringTexture } from '../r3d/textures';
import { GuestSession, HostSession, randomRoom } from '../net/net';
import type { SaveFile } from '../sim/save';

export interface LobbyResult {
  setup?: GameSetup;
  local?: number;
  loadSlot?: string;
  host?: HostSession;
  guest?: { session: GuestSession; save: SaveFile; faction: number };
}

export function showLobby(root: HTMLElement, engine: Engine): Promise<LobbyResult> {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'lobby';
    const heroes = Object.values(content.heroes);
    let heroClass = localStorage.getItem('lk:hero') ?? heroes[0].id;
    let color = +(localStorage.getItem('lk:color') ?? 0);
    let name = localStorage.getItem('lk:name') ?? 'Гравець';
    let mapId = Object.keys(maps)[0];
    let calm = false;
    let myStart = 0;
    const bots: { team: 'ally' | 'enemy'; difficulty: 'easy' | 'normal'; heroClass: string; start: number }[] = [
      { team: 'ally', difficulty: 'normal', heroClass: 'hero_archer', start: 1 },
    ];
    const hasSave = !!localStorage.getItem('lk:save:quick');
    let host: HostSession | null = null;
    let guest: GuestSession | null = null;
    const guestStarts = new Map<number, number>();

    el.innerHTML = `<div class="bgart"></div><div class="inner">
      <header><h1>Живі королівства</h1><p>Знайдіть мандрівників, збудуйте поселення, переживіть хвилі нежиті й зруйнуйте Темне осердя.</p></header>
      <section class="panel heroes-panel"><h3>Оберіть героя</h3><div class="heroes" data-k="heroes"></div></section>
      <div class="cols">
        <section class="panel"><h3>Карта та стартова зона</h3>
          <div class="row2"><label>Карта</label><select data-k="map">${Object.values(maps).map((m) => `<option value="${m.id}">${m.name}</option>`).join('')}</select></div>
          <div class="mapwrap"><canvas data-k="mapc" width="512" height="384"></canvas></div>
          <div class="row2" style="font-size:13px;color:var(--ink-dim)" data-k="mapdesc"></div>
        </section>
        <section class="panel"><h3>Учасники</h3>
          <div class="row2"><label>Ім’я</label><input type="text" data-k="name" maxlength="18" value="${name}"></div>
          <div class="row2"><label>Колір</label><div class="colors" data-k="colors"></div></div>
          <div data-k="slots" style="margin-top:10px"></div>
          <div class="row2"><button class="btn small" data-a="addAlly">+ Союзний бот</button><button class="btn small" data-a="addEnemy">+ Ворожий бот</button></div>
          <div class="row2"><label><input type="checkbox" data-k="calm"> Режим «Спокійно» (хвилі ×0.75)</label></div>
          <div class="netbox">
            <h3 style="font-size:14px;margin:6px 0">Кооператив по мережі</h3>
            <div class="row2"><label>Кімната</label><input type="text" data-k="room" maxlength="8" style="width:90px;text-transform:uppercase" value="${randomRoom()}">
              <button class="btn small" data-a="host">Створити</button><button class="btn small" data-a="join">Приєднатися</button></div>
            <div class="row2" data-k="netstatus" style="font-size:13px;color:var(--ink-dim)">Друг відкриває цю ж адресу у своєму браузері, вводить код кімнати й тисне «Приєднатися».</div>
          </div>
          <div class="hint-keys" style="margin-top:10px">
            <div><b>ПКМ</b> — наказ герою</div><div><b>WASD</b> — рух героя</div><div><b>1–6</b> — будівлі</div><div><b>Q</b> — здібність</div>
            <div><b>Space</b> — до героя</div><div><b>Z/X/R</b> — армія</div><div><b>\`</b> — консоль</div><div><b>F2</b> — живий редактор</div>
          </div>
        </section>
      </div>
      <footer>${hasSave ? '<button class="btn" data-a="load">Продовжити збереження</button>' : ''}<button class="btn primary start" data-a="start">Почати гру</button></footer>
    </div>`;
    root.appendChild(el);
    const q = (k: string) => el.querySelector<HTMLElement>(`[data-k="${k}"]`)!;

    // hero cards with live 3D previews rendered behind the page
    const heroBox = q('heroes');
    const stage = new THREE.Group();
    engine.scene.add(stage);
    const actors: { key: string; host: HTMLElement; mesh: THREE.SkinnedMesh; anim: Animator; ring: THREE.Mesh; t: number }[] = [];
    for (const hd of heroes) {
      const card = document.createElement('div');
      card.className = 'herocard';
      card.dataset.hero = hd.id;
      card.innerHTML = `<div class="art"></div><h4>${hd.name}</h4><div class="sub">${hd.title}</div><div class="desc">${hd.description}</div>
        <div class="stats"><span>❤ ${hd.hp}</span><span>⚔ ${hd.damage}</span><span>${hd.projectile ? '🏹 ' + hd.range : '🗡 ближній'}</span><span>✦ ${content.abilities[hd.ability]?.name}</span></div>`;
      heroBox.appendChild(card);
      const model = characterModel(hd.id);
      const { mesh, bones } = model.rig.instantiate(teamMaterial(factionColors[color]));
      stage.add(mesh);
      const rg = new THREE.PlaneGeometry(1, 1);
      rg.rotateX(-Math.PI / 2);
      const ring = new THREE.Mesh(rg, new THREE.MeshBasicNodeMaterial({ map: ringTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: factionColors[color] }));
      stage.add(ring);
      actors.push({ key: hd.id, host: card.querySelector('.art')!, mesh, anim: new Animator(bones, model.style, model.mounted), ring, t: Math.random() * 3 });
    }
    const cam = engine.camera;
    const prevBg = (engine.scene.background as THREE.Color).clone();
    (engine.scene.background as THREE.Color).set(0x120c08);
    (engine.scene.fog as THREE.Fog).near = 200;
    (engine.scene.fog as THREE.Fog).far = 400;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const vw = engine.screen.width, vh = engine.screen.height;
      cam.position.set(0, 1.1, 9);
      cam.lookAt(0, 1.1, 0);
      cam.updateMatrixWorld();
      const halfH = 9 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)), halfW = halfH * cam.aspect;
      const ppu = vh / (2 * halfH);
      engine.sun.position.set(4, 8, 8);
      engine.sun.target.position.set(0, 0, 0);
      engine.focus.set(0, 0, 0);
      for (const a of actors) {
        const r = a.host.getBoundingClientRect();
        const visible = r.bottom > 0 && r.top < vh;
        a.mesh.visible = a.ring.visible = visible;
        const x = ((r.left + r.width / 2) / vw * 2 - 1) * halfW;
        const y = 1.1 + (1 - (r.bottom - 6) / vh * 2) * halfH;
        const model = characterModel(a.key);
        const s = Math.min(1.35, (r.height * 0.95) / ppu / model.height);
        a.mesh.position.set(x, y, 0);
        a.mesh.scale.setScalar(s);
        const sel = a.key === heroClass;
        a.t += dt;
        a.mesh.rotation.y = sel ? 0.35 + Math.sin(a.t * 0.4) * 0.3 : 0.45;
        const cyc = a.t % 4.2;
        const attacking = sel && cyc > 2.6 && cyc < 3.4;
        a.anim.update(dt, { speed: sel && cyc < 2.4 ? 2.2 : 0, swing: attacking ? (cyc - 2.6) / 0.8 : -1, action: ({ slash: 'slash', bow: 'bow', cast: 'cast' } as any)[model.style] ?? 'slash', dead: false, deadT: 0, hitT: 9 });
        a.ring.position.set(x, y + 0.02, 0);
        a.ring.scale.setScalar(sel ? 1.6 * s : 1.1 * s);
        (a.ring.material as any).color.setHex(factionColors[color]);
        (a.ring.material as any).opacity = sel ? 1 : 0.4;
        if ((a.mesh as any).userData.c !== color) { a.mesh.material = teamMaterial(factionColors[color]); (a.mesh as any).userData.c = color; }
      }
    };
    engine.ticker.add(tick as any);
    const disposeStage = () => {
      engine.ticker.remove(tick as any);
      engine.scene.remove(stage);
      for (const a of actors) a.mesh.skeleton.dispose();
      (engine.scene.background as THREE.Color).copy(prevBg);
    };
    const selHero = () => heroBox.querySelectorAll<HTMLElement>('.herocard').forEach((c) => c.classList.toggle('sel', c.dataset.hero === heroClass));

    // colors
    const colorBox = q('colors');
    const drawColors = () => {
      colorBox.innerHTML = factionColors.map((c, i) => `<div class="swatch ${i === color ? 'sel' : ''}" data-color="${i}" title="${factionColorNames[i]}" style="background:#${c.toString(16).padStart(6, '0')};color:#${c.toString(16).padStart(6, '0')}"></div>`).join('');
    };

    // map preview with start zones
    const mapc = q('mapc') as HTMLCanvasElement;
    const usedStarts = () => [myStart, ...bots.map((b) => b.start), ...guestStarts.values()];
    const drawMap = () => {
      const m = maps[mapId];
      q('mapdesc').textContent = m.description + ' Клацніть по зоні, щоб обрати свій старт.';
      const g = mapc.getContext('2d')!;
      const sx = mapc.width / m.W, sy = mapc.height / m.H;
      // quick preview: build terrain via the preset's own generator on a scratch world
      const pv = previewTerrain(mapId);
      const cols: Record<number, string> = { [Terrain.Grass]: '#4f7f36', [Terrain.Dirt]: '#8a6c48', [Terrain.Forest]: '#2f5226', [Terrain.Water]: '#2c5f8e', [Terrain.Sand]: '#c2ad7c', [Terrain.Cursed]: '#3a3036' };
      for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) { g.fillStyle = cols[pv[y * m.W + x]]; g.fillRect(x * sx, y * sy, sx + 0.5, sy + 0.5); }
      g.fillStyle = '#5aff6a';
      g.font = 'bold 22px Cinzel, serif';
      g.textAlign = 'center';
      g.fillText('☠', (m.evil.core[0] + 2) * sx, (m.evil.core[1] + 3) * sy);
      m.starts.forEach((s, i) => {
        const used = usedStarts().indexOf(i);
        const gEntry = [...guestStarts].find(([, st]) => st === i);
        const gInfo = gEntry && host?.guests.get(gEntry[0]);
        const who = used === 0 ? { c: factionColors[color], n: name } : gInfo ? { c: gInfo.color, n: gInfo.name } : used > 0 && used <= bots.length ? { c: botColor(used - 1), n: `Бот ${used}` } : null;
        g.beginPath();
        g.arc(s.x * sx, s.y * sy, 15, 0, Math.PI * 2);
        g.fillStyle = who ? '#' + who.c.toString(16).padStart(6, '0') : 'rgba(255,240,200,.25)';
        g.fill();
        g.lineWidth = 3;
        g.strokeStyle = used === 0 ? '#fff' : 'rgba(0,0,0,.6)';
        g.stroke();
        g.fillStyle = '#fff';
        g.font = 'bold 13px Alegreya Sans, sans-serif';
        g.fillText(who ? who.n : 'вільно', s.x * sx, s.y * sy + 30);
      });
    };
    const botColor = (i: number) => factionColors[(color + 1 + i) % factionColors.length];

    const drawSlots = () => {
      const s = q('slots');
      const heroOpts = (sel: string) => heroes.map((h) => `<option value="${h.id}" ${h.id === sel ? 'selected' : ''}>${h.name}</option>`).join('');
      s.innerHTML = `<div class="slot"><span class="dot" style="background:#${factionColors[color].toString(16).padStart(6, '0')}"></span><span class="grow"><b>${name}</b> · Команда 1</span><span>${content.heroes[heroClass].name}</span></div>` +
        bots.map((b, i) => `<div class="slot"><span class="dot" style="background:#${botColor(i).toString(16).padStart(6, '0')}"></span><span class="grow">Бот ${i + 1}</span>
          <select data-bot="${i}" data-f="team"><option value="ally" ${b.team === 'ally' ? 'selected' : ''}>Союзник</option><option value="enemy" ${b.team === 'enemy' ? 'selected' : ''}>Ворог</option></select>
          <select data-bot="${i}" data-f="difficulty"><option value="easy" ${b.difficulty === 'easy' ? 'selected' : ''}>Легкий</option><option value="normal" ${b.difficulty === 'normal' ? 'selected' : ''}>Звичайний</option></select>
          <select data-bot="${i}" data-f="heroClass">${heroOpts(b.heroClass)}</select>
          <button class="btn small" data-a="rm" data-i="${i}">✕</button></div>`).join('') +
        (host ? [...host.guests.values()].map((g) => `<div class="slot"><span class="dot" style="background:#${g.color.toString(16).padStart(6, '0')}"></span><span class="grow">🌐 <b>${g.name}</b> · Команда 1</span><span>${content.heroes[g.heroClass]?.name ?? ''}</span></div>`).join('') : '') +
        `<div class="slot" style="opacity:.8"><span class="dot" style="background:#5aff6a"></span><span class="grow">Світове зло — окремий елемент карти</span><span>☠</span></div>`;
    };
    const freeStart = () => maps[mapId].starts.findIndex((_, i) => !usedStarts().includes(i));
    const redraw = () => { selHero(); drawColors(); drawSlots(); drawMap(); guest?.hello(name, heroClass, factionColors[color]); };
    const netStatus = (t: string) => (q('netstatus').innerHTML = t);
    const syncGuests = () => {
      if (!host) return;
      for (const id of [...guestStarts.keys()]) if (!host.guests.has(id)) guestStarts.delete(id);
      for (const id of host.guests.keys()) if (!guestStarts.has(id)) { const st = freeStart(); if (st >= 0) guestStarts.set(id, st); }
      netStatus(`Кімната <b style="color:var(--gold)">${host.room}</b> · гравців у мережі: ${host.guests.size}. Код передайте другу.`);
      redraw();
    };
    redraw();

    el.addEventListener('click', (e) => {
      sfx.unlock();
      const t = e.target as HTMLElement;
      const card = t.closest<HTMLElement>('.herocard');
      if (card) { heroClass = card.dataset.hero!; sfx.play('click', 0, 0, true); redraw(); return; }
      const sw = t.closest<HTMLElement>('.swatch');
      if (sw) { color = +sw.dataset.color!; redraw(); return; }
      const a = t.closest<HTMLElement>('[data-a]')?.dataset.a;
      if (a === 'addAlly' || a === 'addEnemy') {
        const s = freeStart();
        if (s < 0 || bots.length >= 2) return;
        bots.push({ team: a === 'addAlly' ? 'ally' : 'enemy', difficulty: 'normal', heroClass: heroes[(bots.length + 1) % heroes.length].id, start: s });
        redraw();
      }
      if (a === 'rm') { bots.splice(+t.closest<HTMLElement>('[data-i]')!.dataset.i!, 1); redraw(); }
      if (a === 'load') { finish({ loadSlot: 'quick' }); }
      if (a === 'host' && !host && !guest) {
        const room = (q('room') as HTMLInputElement).value.trim().toUpperCase() || randomRoom();
        netStatus('Створюю кімнату…');
        HostSession.create(room).then((h) => { host = h; h.onChange = syncGuests; syncGuests(); }).catch((err) => netStatus('⚠ ' + err.message));
      }
      if (a === 'join' && !host && !guest) {
        const room = (q('room') as HTMLInputElement).value.trim().toUpperCase();
        netStatus('Підключаюся…');
        GuestSession.join(room, name).then((g) => {
          guest = g;
          g.hello(name, heroClass, factionColors[color]);
          netStatus(`Ви в кімнаті <b style="color:var(--gold)">${room}</b>. Оберіть героя й колір — хост почне гру.`);
          (el.querySelector('[data-a="start"]') as HTMLButtonElement).disabled = true;
          (el.querySelector('[data-a="start"]') as HTMLButtonElement).textContent = 'Очікуємо хоста…';
          g.onStart = (save, faction) => finish({ guest: { session: g, save, faction } });
        }).catch((err) => netStatus('⚠ ' + err.message));
      }
      if (a === 'start' && !guest) {
        localStorage.setItem('lk:hero', heroClass);
        localStorage.setItem('lk:color', String(color));
        localStorage.setItem('lk:name', name);
        const players: PlayerSetup[] = [{ name, color: factionColors[color], team: 0, kind: 'human', difficulty: 'normal', heroClass, start: myStart }];
        bots.forEach((b, i) => players.push({ name: `${b.team === 'ally' ? 'Союзник' : 'Суперник'} ${i + 1}`, color: botColor(i), team: b.team === 'ally' ? 0 : 1, kind: 'bot', difficulty: b.difficulty, heroClass: b.heroClass, start: b.start }));
        if (host) for (const g of host.guests.values()) {
          const st = guestStarts.get(g.id);
          if (st == null) continue;
          let c = g.color;
          if (players.some((p) => p.color === c)) c = factionColors.find((fc) => !players.some((p) => p.color === fc)) ?? c;
          g.faction = players.length;
          players.push({ name: g.name, color: c, team: 0, kind: 'human', difficulty: 'normal', heroClass: g.heroClass, start: st });
        }
        finish({ setup: { mapId, calm, players }, local: 0, host: host ?? undefined });
      }
    });
    el.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement | HTMLSelectElement;
      if (t.dataset.bot) { (bots[+t.dataset.bot] as any)[t.dataset.f!] = t.value; redraw(); }
      if (t.dataset.k === 'calm') calm = (t as HTMLInputElement).checked;
      if (t.dataset.k === 'map') { mapId = t.value; redraw(); }
    });
    el.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.k === 'name') { name = t.value || 'Гравець'; drawSlots(); drawMap(); }
    });
    mapc.addEventListener('click', (e) => {
      const r = mapc.getBoundingClientRect();
      const m = maps[mapId];
      const x = ((e.clientX - r.left) / r.width) * m.W, y = ((e.clientY - r.top) / r.height) * m.H;
      const i = m.starts.findIndex((s) => Math.hypot(s.x - x, s.y - y) < 8);
      if (i < 0) return;
      const bi = bots.findIndex((b) => b.start === i);
      if (bi >= 0) bots[bi].start = myStart; // swap with a bot
      myStart = i;
      sfx.play('click', 0, 0, true);
      redraw();
    });

    function finish(r: LobbyResult) {
      disposeStage();
      el.style.transition = 'opacity .4s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 400);
      resolve(r);
    }
  });
}

// Terrain preview using the real preset generator (cheap, ~10ms)
import { emptyWorld } from '../sim/map';
import { Nav } from '../sim/nav';
import { Sim } from '../sim/sim';
const previewCache = new Map<string, Uint8Array>();
function previewTerrain(id: string): Uint8Array {
  let t = previewCache.get(id);
  if (!t) {
    const m = maps[id];
    const w = emptyWorld(m.W, m.H, { mapId: id, calm: false, seed: m.seed });
    const sim = new Sim(w, new Nav(m.W, m.H, null));
    m.build(w, sim);
    t = w.terrain;
    previewCache.set(id, t);
  }
  return t;
}
