/**
 * Warcraft-3-style RTS camera: looks north from the south at ~55°, pitch flattens when zooming in.
 * Public API is in "pixel" world units (tile * 32) for compatibility with the input/HUD layer.
 */
import * as THREE from 'three/webgpu';

export const TS = 32;

export class Camera3D {
  x = 0; y = 0; // focus (px)
  tx = 0; ty = 0;
  zoom = 1.6;
  targetZoom = 1.6;
  minZoom = 0.55;
  maxZoom = 3.2;
  follow: (() => { x: number; y: number } | null) | null = null;
  private shakeAmt = 0;
  private ray = new THREE.Raycaster();
  private v2 = new THREE.Vector2();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private hit = new THREE.Vector3();

  constructor(readonly cam: THREE.PerspectiveCamera, readonly worldW: number, readonly worldH: number, readonly height: (x: number, y: number) => number) {}

  get dist() {
    return 24 / this.zoom;
  }
  get pitch() {
    const k = (this.zoom - this.minZoom) / (this.maxZoom - this.minZoom);
    return THREE.MathUtils.lerp(0.98, 0.72, Math.min(1, Math.max(0, k)));
  }

  jump(x: number, y: number) {
    this.x = this.tx = x;
    this.y = this.ty = y;
  }

  private pxPerUnit(vh: number) {
    return vh / (2 * this.dist * Math.tan(THREE.MathUtils.degToRad(this.cam.fov / 2)));
  }

  pan(dx: number, dy: number) {
    const k = TS / this.pxPerUnit(this.cam.userData.vh ?? 800);
    this.tx += dx * k;
    this.ty += dy * k * 1.25;
    this.follow = null;
  }

  zoomAt(factor: number, sx: number, sy: number, vw: number, vh: number) {
    const before = this.toWorld(sx, sy, vw, vh);
    const old = this.targetZoom;
    this.targetZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.targetZoom * factor));
    const k = 1 - old / this.targetZoom;
    this.tx += (before.x - this.tx) * k * 0.9;
    this.ty += (before.y - this.ty) * k * 0.9;
  }

  shake(a: number) {
    this.shakeAmt = Math.min(0.6, this.shakeAmt + a * 0.03);
  }

  update(dt: number, vw: number, vh: number) {
    const f = this.follow?.();
    if (f) { this.tx = f.x; this.ty = f.y; }
    this.tx = Math.max(4 * TS, Math.min(this.worldW - 4 * TS, this.tx));
    this.ty = Math.max(4 * TS, Math.min(this.worldH - 2 * TS, this.ty));
    const k = 1 - Math.exp(-dt * 9);
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;
    this.zoom += (this.targetZoom - this.zoom) * (1 - Math.exp(-dt * 10));
    this.shakeAmt *= Math.exp(-dt * 7);
    const fx = this.x / TS, fz = this.y / TS;
    const gy = Math.max(0, this.height(fx, fz));
    const d = this.dist, p = this.pitch;
    const sx = (Math.random() - 0.5) * this.shakeAmt, sy = (Math.random() - 0.5) * this.shakeAmt;
    this.cam.position.set(fx + sx, gy + Math.sin(p) * d + sy, fz + Math.cos(p) * d);
    this.cam.lookAt(fx + sx * 0.5, gy, fz);
    this.cam.userData.vh = vh;
    this.cam.updateMatrixWorld();
  }

  /** Screen → ground (px units). */
  toWorld(sx: number, sy: number, vw: number, vh: number) {
    this.v2.set((sx / vw) * 2 - 1, -(sy / vh) * 2 + 1);
    this.ray.setFromCamera(this.v2, this.cam);
    let h = 0;
    for (let i = 0; i < 3; i++) {
      this.plane.constant = -h;
      if (!this.ray.ray.intersectPlane(this.plane, this.hit)) break;
      h = this.height(this.hit.x, this.hit.z);
    }
    return { x: this.hit.x * TS, y: this.hit.z * TS };
  }

  /** Approximate visible ground rectangle (px units). */
  viewRect(vw: number, vh: number, margin = 0) {
    const pts = [this.toWorld(0, 0, vw, vh), this.toWorld(vw, 0, vw, vh), this.toWorld(0, vh, vw, vh), this.toWorld(vw, vh, vw, vh)];
    return {
      x0: Math.min(...pts.map((p) => p.x)) - margin, x1: Math.max(...pts.map((p) => p.x)) + margin,
      y0: Math.min(...pts.map((p) => p.y)) - margin, y1: Math.max(...pts.map((p) => p.y)) + margin,
    };
  }
}
