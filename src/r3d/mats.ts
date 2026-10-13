/** Shared node materials (TSL): vertex colors + team tint + emissive glow + night windows + wind. */
import * as THREE from 'three/webgpu';
import { attribute, float, mix, positionLocal, sin, time, uniform, vec3, vertexColor, instanceIndex, cos } from 'three/tsl';

export const globals = {
  night: uniform(0),
  glowBoost: uniform(1),
  wind: uniform(1),
};

const teamMats = new Map<string, THREE.MeshStandardNodeMaterial>();

/** Material for characters and buildings, tinted by `teamColor` on team-flagged vertices. */
export function teamMaterial(teamColor: number, opts: { wind?: boolean; transparent?: boolean } = {}) {
  const key = `${teamColor}|${opts.wind ? 1 : 0}|${opts.transparent ? 1 : 0}`;
  let m = teamMats.get(key);
  if (m) return m;
  m = new THREE.MeshStandardNodeMaterial();
  const vc = vertexColor() as any;
  const team = attribute('team', 'float') as any;
  const glow = attribute('glow', 'float') as any;
  const night = attribute('night', 'float') as any;
  const metal = attribute('metal', 'float') as any;
  const tc = uniform(new THREE.Color(teamColor));
  (m as any).teamColorU = tc;
  // team areas store a gray shade in the vertex color; multiply with the faction color and lift saturation
  const teamCol = tc.mul(vc.r.mul(1.25).add(0.15));
  m.colorNode = mix(vc, teamCol, team);
  m.emissiveNode = vc.mul(glow.mul(globals.glowBoost).mul(2.2)).add(vec3(1.0, 0.72, 0.35).mul(night.mul(globals.night).mul(1.6)));
  m.roughnessNode = float(0.88).sub(metal.mul(0.55));
  m.metalnessNode = metal.mul(0.15);
  if (opts.wind) m.positionNode = windOffset();
  if (opts.transparent) { m.transparent = true; m.depthWrite = false; }
  teamMats.set(key, m);
  return m;
}

/** Vertex wind sway: stronger towards the top of the model, phase per instance. */
export function windOffset() {
  const h = positionLocal.y.max(0) as any;
  const phase = (instanceIndex.toFloat() as any).mul(1.7);
  const t = time.mul(1.3).add(phase);
  const sway = (sin(t) as any).mul(0.05).add((sin(t.mul(2.3)) as any).mul(0.02)).mul(h).mul(h).mul(globals.wind);
  return (positionLocal as any).add(vec3(sway, 0, (cos(t.mul(0.9)) as any).mul(0.03).mul(h).mul(h).mul(globals.wind)));
}

export function setTeamColor(m: THREE.Material, color: number) {
  (m as any).teamColorU?.value.setHex(color);
}

/** Plain unlit additive material for halos / particles. */
export function glowMaterial(tex: THREE.Texture) {
  const m = new THREE.MeshBasicNodeMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  return m;
}
