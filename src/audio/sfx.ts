/**
 * Procedural sound effects with WebAudio (no audio files needed). Positional attenuation by
 * distance to the camera center. Mods can register new sounds via `sfx.register`.
 */
type Voice = (ctx: AudioContext, out: AudioNode, t: number) => void;

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<string, number>();
  volume = 0.5;
  muted = false;
  listener = { x: 0, y: 0, zoom: 1 };
  private voices: Record<string, Voice> = {};
  private ambience: { stop(): void } | null = null;

  constructor() {
    this.defineDefaults();
  }

  unlock() {
    if (this.ctx) { this.ctx.resume(); return; }
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.startAmbience();
    } catch {
      this.ctx = null;
    }
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = this.muted ? 0 : v;
  }
  toggleMute() {
    this.muted = !this.muted;
    this.setVolume(this.volume);
  }

  register(name: string, v: Voice) {
    this.voices[name] = v;
  }

  play(name: string, x = 0, y = 0, ui = false) {
    if (!this.ctx || !this.master || this.muted) return;
    const now = this.ctx.currentTime;
    const lastAt = this.last.get(name) ?? 0;
    if (now - lastAt < 0.045) return; // de-dupe bursts
    this.last.set(name, now);
    let gain = 1;
    if (!ui) {
      const d = Math.hypot(x - this.listener.x, y - this.listener.y) * this.listener.zoom;
      gain = Math.max(0, 1 - d / 1100);
      if (gain <= 0.02) return;
    }
    const g = this.ctx.createGain();
    g.gain.value = gain;
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = ui ? 0 : Math.max(-0.8, Math.min(0.8, ((x - this.listener.x) * this.listener.zoom) / 700));
    g.connect(pan).connect(this.master);
    this.voices[name]?.(this.ctx, g, now);
  }

  private n(ctx: AudioContext, out: AudioNode, t: number, dur: number, freq: number, q: number, vol: number, type: BiquadFilterType = 'bandpass') {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
    return f;
  }
  private o(ctx: AudioContext, out: AudioNode, t: number, dur: number, f0: number, f1: number, vol: number, type: OscillatorType = 'sine', attack = 0.005) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private defineDefaults() {
    const v = this.voices;
    v.swing = (c, o, t) => this.n(c, o, t, 0.16, 1800 + Math.random() * 600, 1.2, 0.25, 'bandpass');
    v.swingUndead = (c, o, t) => this.n(c, o, t, 0.2, 900, 1, 0.2);
    v.hit = (c, o, t) => { this.n(c, o, t, 0.12, 2500, 3, 0.35); this.o(c, o, t, 0.25, 900 + Math.random() * 400, 600, 0.08, 'triangle'); this.o(c, o, t, 0.12, 160, 60, 0.3); };
    v.bone = (c, o, t) => { for (let i = 0; i < 3; i++) this.n(c, o, t + i * 0.03, 0.05, 2200 + i * 600, 6, 0.25); };
    v.thud = (c, o, t) => { this.o(c, o, t, 0.2, 140, 50, 0.4); this.n(c, o, t, 0.15, 600, 1, 0.3, 'lowpass'); };
    v.bow = (c, o, t) => { this.o(c, o, t, 0.12, 320, 120, 0.15, 'triangle'); this.n(c, o, t + 0.02, 0.25, 3000, 0.8, 0.12, 'highpass'); };
    v.magic = (c, o, t) => { this.o(c, o, t, 0.4, 500, 1400, 0.12, 'sine', 0.02); this.o(c, o, t, 0.4, 750, 2100, 0.06, 'sine', 0.02); };
    v.boom = (c, o, t) => { this.o(c, o, t, 0.45, 220, 40, 0.35); this.n(c, o, t, 0.4, 800, 0.7, 0.3, 'lowpass'); this.o(c, o, t, 0.6, 1200, 300, 0.05, 'sine'); };
    v.nova = (c, o, t) => { this.o(c, o, t, 0.9, 200, 1600, 0.2, 'sawtooth', 0.05); this.n(c, o, t, 0.8, 1200, 0.5, 0.2); };
    v.whirl = (c, o, t) => { for (let i = 0; i < 4; i++) this.n(c, o, t + i * 0.08, 0.2, 1500 + i * 300, 1.5, 0.25); };
    v.volley = (c, o, t) => { for (let i = 0; i < 6; i++) this.n(c, o, t + i * 0.06, 0.3, 3500, 1, 0.1, 'highpass'); };
    v.chop = (c, o, t) => { this.o(c, o, t, 0.12, 260, 120, 0.3, 'triangle'); this.n(c, o, t, 0.08, 1400, 2, 0.25); };
    v.pick = (c, o, t) => { this.o(c, o, t, 0.15, 2400, 1800, 0.12, 'square'); this.n(c, o, t, 0.08, 4000, 4, 0.2); };
    v.pluck = (c, o, t) => this.n(c, o, t, 0.08, 2600, 2, 0.12);
    v.place = (c, o, t) => { this.o(c, o, t, 0.12, 300, 200, 0.2, 'triangle'); this.o(c, o, t + 0.08, 0.15, 450, 300, 0.15, 'triangle'); };
    v.built = (c, o, t) => [523, 659, 784, 1046].forEach((f, i) => this.o(c, o, t + i * 0.09, 0.5, f, f, 0.12, 'triangle', 0.01));
    v.levelUp = (c, o, t) => [392, 523, 659, 784, 1046].forEach((f, i) => this.o(c, o, t + i * 0.07, 0.7, f, f * 1.01, 0.12, 'sine', 0.01));
    v.recruit = (c, o, t) => [440, 554, 659].forEach((f, i) => this.o(c, o, t + i * 0.07, 0.35, f, f, 0.1, 'triangle', 0.01));
    v.horn = (c, o, t) => { [110, 165, 220].forEach((f) => this.o(c, o, t, 2.2, f, f * 0.97, 0.12, 'sawtooth', 0.25)); };
    v.warning = (c, o, t) => { for (let i = 0; i < 3; i++) this.o(c, o, t + i * 0.35, 0.3, 880, 660, 0.1, 'square'); };
    v.victory = (c, o, t) => [262, 330, 392, 523, 659, 784].forEach((f, i) => this.o(c, o, t + i * 0.15, 1.6, f, f, 0.1, 'triangle', 0.02));
    v.collapse = (c, o, t) => { this.n(c, o, t, 1.2, 300, 0.5, 0.5, 'lowpass'); this.o(c, o, t, 0.8, 90, 30, 0.4); };
    v.treeFall = (c, o, t) => { this.n(c, o, t, 0.6, 1800, 0.8, 0.15); this.o(c, o, t + 0.75, 0.4, 110, 40, 0.4); this.n(c, o, t + 0.75, 0.4, 500, 1, 0.3, 'lowpass'); };
    v.heroDeath = (c, o, t) => [392, 330, 262, 196].forEach((f, i) => this.o(c, o, t + i * 0.18, 0.6, f, f * 0.98, 0.12, 'triangle', 0.02));
    v.click = (c, o, t) => this.o(c, o, t, 0.05, 1200, 900, 0.08, 'triangle');
    v.error = (c, o, t) => { this.o(c, o, t, 0.12, 220, 180, 0.15, 'square'); this.o(c, o, t + 0.12, 0.15, 180, 150, 0.15, 'square'); };
    v.ping = (c, o, t) => { this.o(c, o, t, 0.4, 1320, 1320, 0.12, 'sine'); this.o(c, o, t + 0.12, 0.5, 1760, 1760, 0.1, 'sine'); };
    v.move = (c, o, t) => this.o(c, o, t, 0.06, 700, 900, 0.05, 'triangle');
  }

  private startAmbience() {
    const ctx = this.ctx!;
    // soft wind bed: filtered noise with slow LFO
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.value = 0.035;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain();
    lg.gain.value = 250;
    lfo.connect(lg).connect(f.frequency);
    src.connect(f).connect(g).connect(this.master!);
    src.start();
    lfo.start();
    // occasional bird chirps
    const chirp = () => {
      if (!this.ctx) return;
      if (!this.muted && Math.random() < 0.6) {
        const t = ctx.currentTime;
        const base = 2200 + Math.random() * 1500;
        for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) this.o(ctx, this.master!, t + i * 0.12, 0.08, base, base * 1.3, 0.015, 'sine', 0.01);
      }
      setTimeout(chirp, 3000 + Math.random() * 6000);
    };
    setTimeout(chirp, 2000);
    this.ambience = { stop: () => { src.stop(); lfo.stop(); } };
  }
}

export const sfx = new Sfx();
