/** HTML overlay for world-anchored health bars and floating combat text. */
import * as THREE from 'three/webgpu';

const css = `
.ov { position: fixed; inset: 0; pointer-events: none; z-index: 5; overflow: hidden; }
.hb { position: absolute; height: 6px; border-radius: 3px; background: rgba(12,8,4,.85); box-shadow: 0 0 0 1px rgba(0,0,0,.6); transform: translate(-50%, -50%); }
.hb i { position: absolute; left: 1px; top: 1px; bottom: 1px; border-radius: 2px; }
.hb b { position: absolute; left: 0; right: 0; bottom: -3px; height: 2px; border-radius: 1px; }
.hb .lv { position: absolute; left: -15px; top: -4px; width: 13px; height: 13px; border-radius: 50%; background: #2a1a0a; border: 1.5px solid #ffd36a; color: #ffd36a; font: 800 9px/10px Cinzel, serif; text-align: center; }
.hb .sub { position: absolute; left: 1px; right: 1px; top: 8px; height: 4px; border-radius: 2px; background: rgba(12,8,4,.85); }
.hb .sub i { top: 0; bottom: 0; left: 0; }
.ft { position: absolute; font: 700 15px Cinzel, serif; color: #fff4e0; text-shadow: 0 0 3px #000, 0 2px 2px #000; transform: translate(-50%, -50%); white-space: nowrap; will-change: transform, opacity; }
`;

interface Bar { el: HTMLDivElement; fill: HTMLElement; team: HTMLElement; lv: HTMLElement; sub: HTMLElement; subFill: HTMLElement; used: boolean }
interface FText { el: HTMLDivElement; pos: THREE.Vector3; t: number; vy: number }

export class Overlay {
  readonly root = document.createElement('div');
  private bars: Bar[] = [];
  private used = 0;
  private texts: FText[] = [];
  private v = new THREE.Vector3();

  constructor() {
    this.root.className = 'ov';
    const st = document.createElement('style');
    st.textContent = css;
    this.root.appendChild(st);
    document.body.appendChild(this.root);
  }

  begin() {
    this.used = 0;
  }

  project(p: THREE.Vector3, cam: THREE.Camera, vw: number, vh: number): [number, number] | null {
    this.v.copy(p).project(cam);
    if (this.v.z > 1 || this.v.x < -1.1 || this.v.x > 1.1 || this.v.y < -1.1 || this.v.y > 1.1) return null;
    return [(this.v.x * 0.5 + 0.5) * vw, (-this.v.y * 0.5 + 0.5) * vh];
  }

  bar(p: THREE.Vector3, cam: THREE.Camera, vw: number, vh: number, ratio: number, w: number, team: string | null, level = 0, sub?: { ratio: number; color: string }) {
    const s = this.project(p, cam, vw, vh);
    if (!s) return;
    let b = this.bars[this.used];
    if (!b) {
      const el = document.createElement('div');
      el.className = 'hb';
      el.innerHTML = '<i></i><b></b><div class="lv"></div><div class="sub"><i></i></div>';
      this.root.appendChild(el);
      b = { el, fill: el.children[0] as HTMLElement, team: el.children[1] as HTMLElement, lv: el.children[2] as HTMLElement, sub: el.children[3] as HTMLElement, subFill: el.children[3].children[0] as HTMLElement, used: true };
      this.bars.push(b);
    }
    this.used++;
    b.el.style.display = 'block';
    b.el.style.left = s[0] + 'px';
    b.el.style.top = s[1] + 'px';
    b.el.style.width = w + 'px';
    const r = Math.max(0, Math.min(1, ratio));
    b.fill.style.width = `calc(${r * 100}% - 2px)`;
    b.fill.style.background = r > 0.5 ? 'linear-gradient(#8ef06a,#3a9a2a)' : r > 0.25 ? 'linear-gradient(#ffe070,#c09a20)' : 'linear-gradient(#ff7a5a,#b02a1a)';
    b.team.style.display = team ? 'block' : 'none';
    if (team) b.team.style.background = team;
    b.lv.style.display = level ? 'block' : 'none';
    if (level) b.lv.textContent = String(level);
    b.sub.style.display = sub ? 'block' : 'none';
    if (sub) { b.subFill.style.width = `${Math.max(0, Math.min(1, sub.ratio)) * 100}%`; b.subFill.style.background = sub.color; }
  }

  end() {
    for (let i = this.used; i < this.bars.length; i++) this.bars[i].el.style.display = 'none';
  }

  text(p: THREE.Vector3, str: string, color = '#fff4e0', size = 15) {
    if (this.texts.length > 50) return;
    const el = document.createElement('div');
    el.className = 'ft';
    el.textContent = str;
    el.style.color = color;
    el.style.fontSize = size + 'px';
    this.root.appendChild(el);
    this.texts.push({ el, pos: p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0, 0)), t: 0, vy: 1.6 });
  }

  updateTexts(dt: number, cam: THREE.Camera, vw: number, vh: number) {
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const f = this.texts[i];
      f.t += dt;
      f.pos.y += f.vy * dt;
      f.vy *= Math.exp(-2.5 * dt);
      const s = this.project(f.pos, cam, vw, vh);
      if (!s || f.t > 1.2) { f.el.remove(); this.texts.splice(i, 1); continue; }
      const pop = 1 + Math.max(0, 0.15 - f.t) * 4;
      f.el.style.transform = `translate(${s[0]}px, ${s[1]}px) translate(-50%,-50%) scale(${pop})`;
      f.el.style.left = '0px';
      f.el.style.top = '0px';
      f.el.style.opacity = String(Math.min(1, (1.2 - f.t) * 3));
    }
  }

  destroy() {
    this.root.remove();
  }
}
