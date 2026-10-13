/**
 * Skeleton templates. A model is built once per type: rigid parts are bound to bones and merged
 * into a single skinned geometry (one draw call per unit). Each unit instance gets its own bones.
 */
import * as THREE from 'three/webgpu';
import { GeoBuilder, type PartOpts } from './geo';

export interface BoneDef {
  name: string;
  parent: string | null;
  pos: [number, number, number];
}

export class RigTemplate {
  readonly index: Record<string, number> = {};
  private bindBones: THREE.Bone[] = [];
  private builder = new GeoBuilder();
  geometry!: THREE.BufferGeometry;
  boneInverses!: THREE.Matrix4[];

  constructor(readonly defs: BoneDef[]) {
    defs.forEach((d, i) => (this.index[d.name] = i));
    this.bindBones = this.makeBones();
    this.bindBones[0].updateMatrixWorld(true);
  }

  private makeBones() {
    const bones = this.defs.map((d) => {
      const b = new THREE.Bone();
      b.name = d.name;
      b.position.set(...d.pos);
      return b;
    });
    this.defs.forEach((d, i) => { if (d.parent) bones[this.index[d.parent]].add(bones[i]); });
    return bones;
  }

  /** Bind-pose world matrix of a bone (model space). */
  world(bone: string) {
    return this.bindBones[this.index[bone]].matrixWorld;
  }

  /** Add a rigid part attached to `bone`; `local` is relative to the bone's bind frame. */
  part(bone: string, geo: THREE.BufferGeometry, local: THREE.Matrix4, o: Omit<PartOpts, 'bone'>) {
    if (!(bone in this.index)) throw new Error('no bone ' + bone);
    const m = this.world(bone).clone().multiply(local);
    this.builder.add(geo, m, { ...o, bone: this.index[bone] });
    return this;
  }

  finish() {
    this.geometry = this.builder.build();
    this.boneInverses = this.bindBones.map((b) => b.matrixWorld.clone().invert());
    return this;
  }

  instantiate(material: THREE.Material) {
    const bones = this.makeBones();
    const skeleton = new THREE.Skeleton(bones, this.boneInverses);
    const mesh = new THREE.SkinnedMesh(this.geometry, material);
    mesh.add(bones[0]);
    mesh.bind(skeleton, new THREE.Matrix4());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return { mesh, bones };
  }
}

export interface HumanProportions {
  hip: number;
  spine: number;
  chest: number;
  neck: number;
  shoulderX: number;
  shoulderY: number;
  upperArm: number;
  foreArm: number;
  thighX: number;
  thigh: number;
  shin: number;
}

export const HUMAN: HumanProportions = { hip: 0.46, spine: 0.09, chest: 0.13, neck: 0.16, shoulderX: 0.15, shoulderY: 0.12, upperArm: 0.17, foreArm: 0.15, thighX: 0.075, thigh: 0.21, shin: 0.21 };

export function humanBones(p: HumanProportions = HUMAN, hipsParent: string | null = 'root', hipsPos?: [number, number, number]): BoneDef[] {
  const list: BoneDef[] = [];
  if (hipsParent === 'root') list.push({ name: 'root', parent: null, pos: [0, 0, 0] });
  list.push(
    { name: 'hips', parent: hipsParent, pos: hipsPos ?? [0, p.hip, 0] },
    { name: 'spine', parent: 'hips', pos: [0, p.spine, 0] },
    { name: 'chest', parent: 'spine', pos: [0, p.chest, 0] },
    { name: 'neck', parent: 'chest', pos: [0, p.neck, 0] },
    { name: 'head', parent: 'neck', pos: [0, 0.05, 0] },
    { name: 'cape', parent: 'chest', pos: [0, p.shoulderY + 0.02, -0.1] },
  );
  for (const [s, k] of [['L', 1], ['R', -1]] as const) {
    list.push(
      { name: 'arm' + s, parent: 'chest', pos: [p.shoulderX * k, p.shoulderY, 0] },
      { name: 'fore' + s, parent: 'arm' + s, pos: [0, -p.upperArm, 0] },
      { name: 'hand' + s, parent: 'fore' + s, pos: [0, -p.foreArm, 0] },
      { name: 'thigh' + s, parent: 'hips', pos: [p.thighX * k, -0.02, 0] },
      { name: 'shin' + s, parent: 'thigh' + s, pos: [0, -p.thigh, 0] },
      { name: 'foot' + s, parent: 'shin' + s, pos: [0, -p.shin, 0] },
    );
  }
  return list;
}

export function horseBones(): BoneDef[] {
  const b: BoneDef[] = [
    { name: 'root', parent: null, pos: [0, 0, 0] },
    { name: 'hbody', parent: 'root', pos: [0, 0.66, 0] },
    { name: 'hneck', parent: 'hbody', pos: [0, 0.08, 0.34] },
    { name: 'hhead', parent: 'hneck', pos: [0, 0.3, 0.12] },
    { name: 'htail', parent: 'hbody', pos: [0, 0.06, -0.4] },
  ];
  for (const [s, x, z] of [['FL', 0.12, 0.27], ['FR', -0.12, 0.27], ['BL', 0.12, -0.28], ['BR', -0.12, -0.28]] as const) {
    b.push(
      { name: 'leg' + s, parent: 'hbody', pos: [x, -0.04, z] },
      { name: 'knee' + s, parent: 'leg' + s, pos: [0, -0.26, 0] },
      { name: 'hoof' + s, parent: 'knee' + s, pos: [0, -0.27, 0] },
    );
  }
  return b;
}
