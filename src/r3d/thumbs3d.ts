/** Renders 3D models into small images for the HUD (building cards, hero portraits). */
import * as THREE from 'three/webgpu';
import { content } from '../engine/registry';
import { Animator } from './anim';
import { buildingModel } from './buildings3d';
import { characterModel } from './characters';
import type { Engine } from './engine';
import { teamMaterial } from './mats';

const images = new Map<string, string>();
export const thumbState = { version: 0 };
const EMPTY = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

export function thumbnail(key: string, color = 0x3d7bff): string {
  const hit = images.get(key + ':' + color) ?? images.get(key);
  if (hit) return hit;
  for (const [k, v] of images) if (k.startsWith(key + ':')) return v;
  return EMPTY;
}

async function snap(engine: Engine, scene: THREE.Scene, cam: THREE.Camera, size: number): Promise<string> {
  const r = engine.renderer;
  const rt = new THREE.RenderTarget(size, size, { samples: 4 });
  r.setRenderTarget(rt);
  await r.renderAsync(scene, cam);
  r.setRenderTarget(null);
  const px = (await r.readRenderTargetPixelsAsync(rt, 0, 0, size, size)) as Uint8Array;
  rt.dispose();
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const flip = !(r.backend as any).isWebGPUBackend;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const si = ((flip ? size - 1 - y : y) * size + x) * 4, di = (y * size + x) * 4;
    for (let k = 0; k < 3; k++) img.data[di + k] = Math.round(Math.pow(px[si + k] / 255, 1 / 2.2) * 255);
    img.data[di + 3] = px[si + 3];
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
}

function studio() {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdde8ff, 0x6a5a40, 2.2));
  const sun = new THREE.DirectionalLight(0xfff0d8, 3.2);
  sun.position.set(3, 6, 5);
  scene.add(sun);
  return scene;
}

export async function generateThumbnails(engine: Engine, teamColor: number) {
  try {
    for (const d of Object.values(content.buildings)) {
      if (!d.buildable) continue;
      const scene = studio();
      const m = buildingModel(d.id, 1);
      const mesh = new THREE.Mesh(m.geo, teamMaterial(teamColor));
      mesh.rotation.y = -0.5;
      scene.add(mesh);
      const box = new THREE.Box3().setFromObject(mesh);
      const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3()).length();
      const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
      cam.position.set(c.x, c.y + s * 0.55, c.z + s * 1.55);
      cam.lookAt(c);
      images.set('b:' + d.id, await snap(engine, scene, cam, 128));
      thumbState.version++;
    }
    for (const id of Object.keys(content.heroes)) {
      const scene = studio();
      const model = characterModel(id);
      const { mesh, bones } = model.rig.instantiate(teamMaterial(teamColor));
      const a = new Animator(bones, model.style, model.mounted);
      for (let i = 0; i < 30; i++) a.update(0.05, { speed: 0, swing: -1, action: 'slash', dead: false, deadT: 0, hitT: 9 });
      mesh.updateMatrixWorld(true);
      scene.add(mesh);
      const head = bones.find((b) => b.name === 'head')!;
      const hp = new THREE.Vector3().setFromMatrixPosition(head.matrixWorld);
      const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
      cam.position.set(hp.x + 0.25, hp.y + 0.12, hp.z + 0.75);
      cam.lookAt(hp.x, hp.y + 0.03, hp.z);
      images.set('p:' + id + ':' + teamColor, await snap(engine, scene, cam, 160));
      thumbState.version++;
      mesh.skeleton.dispose();
    }
  } catch (e) {
    console.warn('[thumbs] failed', e);
  }
}
