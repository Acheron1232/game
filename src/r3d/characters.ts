/**
 * Procedural character models (stylized, Warcraft-3-like chunky proportions).
 * Coordinate frame: +Z forward, +Y up. Limbs hang along -Y in bind pose.
 * Weapons in the right hand extend along the hand's -Y axis (continuation of the arm).
 */
import * as THREE from 'three/webgpu';
import { G, M } from './geo';
import { HUMAN, RigTemplate, horseBones, humanBones, type HumanProportions } from './rig';

const C = {
  skin: 0xf0c098, skinDark: 0xd09870, hairBlond: 0xe8c050, hairBrown: 0x6a4428, hairWhite: 0xeeeeea,
  steel: 0xc4ccd8, steelDark: 0x7a8494, gold: 0xf0c040, leather: 0x8a5428, leatherDark: 0x51301a, cloth: 0xd8d8d8,
  linen: 0xe6dcc0, wood: 0x8a5a2e, woodDark: 0x5a3a1e, black: 0x15100c, bone: 0xece2c8, boneDark: 0xb8ab8a, rust: 0x8a6a54,
  zombie: 0x86a070, zombieDark: 0x5a7048, rag: 0x5a4632, green: 0x7dff6a, blue: 0x7ad8ff, white: 0xf4f4f0, grey: 0xa0a0a8,
};
const TEAM = (shade = 0xd0d0d0) => ({ color: shade, team: 1 });

export type WeaponStyle = 'slash' | 'thrust' | 'bow' | 'cast' | 'chop' | 'claw' | 'none';

export interface CharacterModel {
  rig: RigTemplate;
  style: WeaponStyle;
  scale: number;
  mounted: boolean;
  height: number;
}

// ------------------------------------------------------------------ shared body
interface BodyOpts {
  skin?: number;
  legs?: number;
  boots?: number;
  torso?: number;
  arms?: number;
  hands?: number;
  bulk?: number;
  female?: boolean;
  noLegs?: boolean;
  face?: 'normal' | 'beard' | 'none';
  hair?: number | null;
}

function body(r: RigTemplate, o: BodyOpts = {}) {
  const k = o.bulk ?? 1;
  const skin = o.skin ?? C.skin;
  // head
  r.part('head', G.sphere(0.105, 12, 10), M(0, 0.085, 0.005, 0, 0, 0, 1, 1.02, 1), { color: skin, shade: 0.15 });
  r.part('neck', G.cyl(0.042, 0.05, 0.08, 8), M(0, 0.0, 0), { color: skin });
  if (o.face !== 'none') {
    for (const x of [-0.035, 0.035]) {
      r.part('head', G.box(0.026, 0.03, 0.02), M(x, 0.095, 0.094), { color: 0xffffff, shade: 0 });
      r.part('head', G.box(0.014, 0.022, 0.02), M(x, 0.093, 0.102), { color: C.black, shade: 0 });
      r.part('head', G.box(0.04, 0.012, 0.02), M(x, 0.125, 0.096, 0, 0, x > 0 ? -0.15 : 0.15), { color: o.hair ?? C.hairBrown, shade: 0 });
    }
    r.part('head', G.box(0.026, 0.04, 0.03), M(0, 0.07, 0.105), { color: o.skin ? o.skin : C.skinDark, shade: 0 });
    r.part('head', G.box(0.04, 0.008, 0.01), M(0, 0.035, 0.1), { color: 0x9a5040, shade: 0 });
    for (const x of [-0.105, 0.105]) r.part('head', G.sphere(0.022, 6, 5), M(x, 0.085, 0), { color: skin });
  }
  if (o.hair) {
    r.part('head', G.sphere(0.114, 12, 8, ), M(0, 0.11, -0.018, 0, 0, 0, 1.02, 0.78, 1.04), { color: o.hair, shade: 0.3 });
    r.part('head', G.box(0.2, 0.1, 0.06), M(0, 0.06, -0.08), { color: o.hair, shade: 0.3 });
  }
  if (o.face === 'beard') {
    r.part('head', G.cone(0.08, 0.2, 8), M(0, -0.02, 0.07, Math.PI + 0.25, 0, 0), { color: C.hairWhite, shade: 0.2 });
    r.part('head', G.box(0.12, 0.03, 0.04), M(0, 0.045, 0.1), { color: C.hairWhite });
  }
  // torso
  const torso = o.torso ?? C.cloth;
  r.part('chest', G.taper(o.female ? 0.2 : 0.24 * k, o.female ? 0.26 : 0.32 * k, 0.22, 0.16 * k, 0.18 * k), M(0, 0.03, 0), { color: torso });
  r.part('spine', G.taper(0.22 * k, 0.23 * k, 0.12, 0.15 * k), M(0, 0.04, 0), { color: torso });
  r.part('hips', G.taper(0.24 * k, 0.23 * k, 0.11, 0.16 * k), M(0, 0.0, 0), { color: o.legs ?? C.leather });
  // arms
  for (const s of ['L', 'R']) {
    r.part('arm' + s, G.capsule(0.048 * k, 0.11, 3, 8), M(0, -0.08, 0), { color: o.arms ?? torso });
    r.part('fore' + s, G.capsule(0.044 * k, 0.1, 3, 8), M(0, -0.075, 0), { color: o.arms ?? torso });
    r.part('hand' + s, G.sphere(0.05 * k, 8, 6), M(0, -0.035, 0.005, 0, 0, 0, 0.9, 1.1, 1), { color: o.hands ?? skin });
    if (!o.noLegs) {
      r.part('thigh' + s, G.capsule(0.062 * k, 0.12, 3, 8), M(0, -0.1, 0), { color: o.legs ?? C.leather });
      r.part('shin' + s, G.capsule(0.052 * k, 0.13, 3, 8), M(0, -0.1, 0), { color: o.boots ?? o.legs ?? C.leatherDark });
      r.part('foot' + s, G.box(0.09 * k, 0.07, 0.17), M(0, -0.005, 0.035), { color: o.boots ?? C.leatherDark });
    }
  }
}

function cape(r: RigTemplate, len = 0.55, w = 0.32, color = TEAM(0xc8c8c8)) {
  r.part('cape', G.taper(w * 0.85, w, len, 0.025, 0.025), M(0, -len / 2 + 0.02, 0, 0.06, 0, 0), color);
  r.part('cape', G.box(w * 0.9, 0.05, 0.08), M(0, 0.0, 0.04), color);
}

// ------------------------------------------------------------------ weapons
function sword(r: RigTemplate, hand = 'handR', len = 0.5, color = C.steel) {
  r.part(hand, G.cyl(0.018, 0.018, 0.1, 6), M(0, -0.03, 0.0), { color: C.leatherDark });
  r.part(hand, G.box(0.16, 0.03, 0.04), M(0, -0.085, 0), { color: C.gold, metal: 1 });
  r.part(hand, G.box(0.055, len, 0.014), M(0, -0.1 - len / 2, 0), { color, metal: 1, shade: 0.1 });
  r.part(hand, G.cone(0.028, 0.08, 4), M(0, -0.1 - len - 0.035, 0, Math.PI, Math.PI / 4, 0, 1, 1, 0.3), { color, metal: 1 });
  r.part(hand, G.sphere(0.028, 6, 5), M(0, 0.03, 0), { color: C.gold, metal: 1 });
}

function kiteShield(r: RigTemplate, bone = 'foreL', size = 1) {
  const s = size;
  const pts: [number, number][] = [[0, 0.2 * s], [0.13 * s, 0.15 * s], [0.12 * s, -0.05 * s], [0, -0.24 * s], [-0.12 * s, -0.05 * s], [-0.13 * s, 0.15 * s]];
  // face points outwards (+X for the left arm)
  r.part(bone, G.shape(pts, 0.035), M(0.075, -0.07, 0.02, 0, Math.PI / 2, 0), TEAM(0xd8d8d8));
  r.part(bone, G.shape(pts.map(([x, y]) => [x * 1.12, y * 1.1] as [number, number]), 0.02), M(0.06, -0.07, 0.02, 0, Math.PI / 2, 0), { color: C.steelDark, metal: 1 });
  r.part(bone, G.box(0.03, 0.18 * s, 0.03), M(0.1, -0.05, 0.02), { color: C.gold, metal: 1 });
  r.part(bone, G.box(0.03, 0.03, 0.16 * s), M(0.1, -0.02, 0.02), { color: C.gold, metal: 1 });
}

function roundShield(r: RigTemplate, bone = 'foreL', radius = 0.15) {
  r.part(bone, G.cyl(radius, radius, 0.03, 12), M(0.075, -0.06, 0.02, 0, 0, Math.PI / 2), TEAM(0xcfcfcf));
  r.part(bone, G.torus(radius, 0.014, 4, 14), M(0.09, -0.06, 0.02, 0, Math.PI / 2, 0), { color: C.steelDark, metal: 1 });
  r.part(bone, G.sphere(0.045, 8, 6), M(0.095, -0.06, 0.02, 0, 0, 0, 0.6, 1, 1), { color: C.steel, metal: 1 });
}

function spear(r: RigTemplate, hand = 'handR') {
  r.part(hand, G.cyl(0.016, 0.016, 1.15, 6), M(0, -0.25, 0), { color: C.wood });
  r.part(hand, G.cone(0.04, 0.17, 4), M(0, -0.9, 0, Math.PI, 0, 0, 1, 1, 0.35), { color: C.steel, metal: 1 });
  r.part(hand, G.box(0.06, 0.02, 0.06), M(0, -0.81, 0), { color: C.gold });
}

function axe(r: RigTemplate, hand = 'handR') {
  r.part(hand, G.cyl(0.017, 0.017, 0.45, 6), M(0, -0.16, 0), { color: C.wood });
  r.part(hand, G.shape([[0, 0.06], [0.11, 0.09], [0.13, 0], [0.11, -0.09], [0, -0.06]], 0.025), M(0, -0.34, 0.02, Math.PI / 2, 0, -Math.PI / 2), { color: C.steel, metal: 1 });
}

function bow(r: RigTemplate, hand = 'handL') {
  // arc along the hand's local Z (vertical when the arm points forward)
  const n = 8, R = 0.42, span = 1.9;
  for (let i = 0; i < n; i++) {
    const a0 = -span / 2 + (span * i) / n, a1 = a0 + span / n;
    const z0 = Math.sin(a0) * R, z1 = Math.sin(a1) * R;
    const y0 = (Math.cos(a0) - 1) * R * 0.35, y1 = (Math.cos(a1) - 1) * R * 0.35;
    const len = Math.hypot(z1 - z0, y1 - y0);
    const ang = Math.atan2(y1 - y0, z1 - z0);
    const th = 0.022 - Math.abs(i - n / 2 + 0.5) * 0.002;
    r.part(hand, G.box(0.03, th, len + 0.01), M(0, -0.03 + (y0 + y1) / 2 + 0.06, (z0 + z1) / 2, -ang, 0, 0), { color: i === 3 || i === 4 ? C.leatherDark : C.wood });
  }
  r.part(hand, G.cyl(0.004, 0.004, Math.sin(span / 2) * R * 2, 3), M(0, -0.03 + (Math.cos(span / 2) - 1) * R * 0.35 + 0.06, 0, Math.PI / 2, 0, 0), { color: C.white });
}

function staff(r: RigTemplate, hand = 'handR', glowColor = C.blue) {
  r.part(hand, G.cyl(0.02, 0.024, 1.25, 6), M(0, 0.25, 0.01), { color: C.wood });
  r.part(hand, G.torus(0.035, 0.012, 4, 8), M(0, 0.86, 0.01, Math.PI / 2, 0, 0), { color: C.gold, metal: 1 });
  for (let i = 0; i < 3; i++) r.part(hand, G.cone(0.015, 0.12, 4), M(Math.cos((i * Math.PI * 2) / 3) * 0.04, 0.92, 0.01 + Math.sin((i * Math.PI * 2) / 3) * 0.04, 0, 0, Math.cos((i * 2.1)) * 0.3), { color: C.gold, metal: 1 });
  r.part(hand, G.octa(0.07), M(0, 1.0, 0.01, 0, 0, 0, 0.8, 1.4, 0.8), { color: glowColor, glow: 1, shade: 0 });
}

// ------------------------------------------------------------------ characters
export function buildWarrior(): CharacterModel {
  const r = new RigTemplate(humanBones({ ...HUMAN, shoulderX: 0.165 }));
  body(r, { torso: C.steel, arms: 0x8890a0, legs: 0x8890a0, boots: C.steelDark, hands: C.steelDark, bulk: 1.12, hair: C.hairBlond });
  // plate armour
  r.part('chest', G.taper(0.29, 0.38, 0.24, 0.2, 0.22), M(0, 0.04, 0.005), { color: C.steel, metal: 1, shade: 0.2 });
  r.part('chest', G.box(0.16, 0.24, 0.03), M(0, 0.0, 0.11), TEAM(0xd0d0d0));
  r.part('chest', G.sphere(0.04, 8, 6), M(0, 0.06, 0.13, 0, 0, 0, 1, 1, 0.5), { color: C.gold, metal: 1 });
  r.part('chest', G.torus(0.12, 0.02, 4, 12), M(0, 0.15, 0.0, Math.PI / 2, 0, 0, 1.1, 0.9, 1), { color: C.gold, metal: 1 });
  r.part('hips', G.cyl(0.15, 0.15, 0.05, 10), M(0, 0.04, 0), { color: C.leatherDark });
  r.part('hips', G.box(0.06, 0.05, 0.03), M(0, 0.04, 0.15), { color: C.gold, metal: 1 });
  r.part('hips', G.box(0.17, 0.24, 0.025), M(0, -0.1, 0.1, -0.08, 0, 0), TEAM(0xc8c8c8));
  r.part('hips', G.box(0.17, 0.2, 0.025), M(0, -0.08, -0.1, 0.08, 0, 0), TEAM(0xb8b8b8));
  for (const s of ['L', 'R']) {
    const k = s === 'L' ? 1 : -1;
    r.part('arm' + s, G.sphere(0.1, 10, 8), M(0.02 * k, 0.0, 0, 0, 0, 0, 1.15, 0.85, 1.15), { color: C.steel, metal: 1 });
    r.part('arm' + s, G.torus(0.09, 0.016, 4, 12), M(0.02 * k, -0.04, 0, Math.PI / 2, 0, 0), { color: C.gold, metal: 1 });
    r.part('arm' + s, G.cone(0.03, 0.08, 6), M(0.05 * k, 0.07, 0, 0, 0, -0.5 * k), TEAM(0xd0d0d0));
    r.part('fore' + s, G.cyl(0.058, 0.05, 0.13, 8), M(0, -0.08, 0), { color: C.steel, metal: 1 });
    r.part('shin' + s, G.cyl(0.062, 0.055, 0.17, 8), M(0, -0.11, 0.005), { color: C.steel, metal: 1 });
    r.part('shin' + s, G.sphere(0.05, 8, 6), M(0, -0.005, 0.04), { color: C.steel, metal: 1 });
    r.part('thigh' + s, G.cyl(0.07, 0.064, 0.14, 8), M(0, -0.08, 0), { color: 0x8890a0, metal: 0.5 });
  }
  cape(r, 0.62, 0.36);
  sword(r, 'handR', 0.52);
  kiteShield(r, 'foreL', 1.15);
  r.finish();
  return { rig: r, style: 'slash', scale: 1.75, mounted: false, height: 1.1 };
}

export function buildArcher(): CharacterModel {
  const r = new RigTemplate(humanBones({ ...HUMAN, shoulderX: 0.135, upperArm: 0.165, thigh: 0.22, shin: 0.22 }));
  body(r, { torso: C.leather, arms: C.skin, legs: 0x5a4030, boots: C.leatherDark, female: true, hair: C.hairBlond });
  // hood + long hair
  r.part('head', G.sphere(0.125, 12, 8, ), M(0, 0.1, -0.02, 0, 0, 0, 1.0, 1.0, 1.05), TEAM(0xc8c8c8));
  r.part('head', G.box(0.17, 0.3, 0.05), M(0, -0.02, -0.08), { color: C.hairBlond, shade: 0.35 });
  r.part('head', G.cone(0.06, 0.12, 6), M(0, 0.2, -0.08, -0.7, 0, 0), TEAM(0xc0c0c0));
  r.part('chest', G.taper(0.22, 0.28, 0.2, 0.17, 0.18), M(0, 0.03, 0.006), { color: C.leather, metal: 0.4 });
  r.part('chest', G.box(0.03, 0.26, 0.2), M(0.0, 0.02, 0.0, 0, 0, 0.7), { color: C.leatherDark });
  r.part('hips', G.taper(0.25, 0.24, 0.16, 0.18), M(0, -0.05, 0), TEAM(0xc0c0c0));
  r.part('hips', G.cyl(0.14, 0.14, 0.04, 10), M(0, 0.05, 0), { color: C.leatherDark });
  for (const s of ['L', 'R']) {
    r.part('fore' + s, G.cyl(0.054, 0.048, 0.11, 8), M(0, -0.08, 0), { color: C.leatherDark });
    r.part('arm' + s, G.sphere(0.07, 8, 6), M(0, 0.0, 0, 0, 0, 0, 1.1, 0.8, 1.1), { color: C.leather, metal: 0.4 });
    r.part('shin' + s, G.cyl(0.062, 0.05, 0.18, 8), M(0, -0.08, 0), { color: C.leatherDark });
  }
  cape(r, 0.58, 0.3);
  // quiver
  r.part('chest', G.cyl(0.05, 0.045, 0.34, 8), M(0.07, 0.0, -0.13, 0.25, 0, -0.35), { color: C.leatherDark });
  for (let i = 0; i < 4; i++) r.part('chest', G.box(0.03, 0.07, 0.008), M(0.12 + i * 0.012, 0.18, -0.08 - i * 0.012, 0.25, i * 0.6, -0.35), { color: C.white });
  bow(r, 'handL');
  r.finish();
  return { rig: r, style: 'bow', scale: 1.68, mounted: false, height: 1.12 };
}

export function buildMage(): CharacterModel {
  const hb = horseBones();
  const hum = humanBones({ ...HUMAN, thigh: 0.19, shin: 0.19 }, 'hbody', [0, 0.12, -0.02]);
  const r = new RigTemplate([...hb, ...hum]);
  // ---- horse
  const hw = C.white, hg = 0xd8d8dc;
  r.part('hbody', G.sphere(0.25, 12, 10), M(0, 0, 0, 0, 0, 0, 0.95, 1.0, 1.85), { color: hw, shade: 0.35 });
  r.part('hbody', G.sphere(0.2, 10, 8), M(0, 0.02, 0.3, 0, 0, 0, 1, 1.05, 1), { color: hw, shade: 0.35 });
  r.part('hbody', G.sphere(0.21, 10, 8), M(0, 0.02, -0.32, 0, 0, 0, 1.05, 1.0, 1), { color: hw, shade: 0.35 });
  r.part('hneck', G.taper(0.17, 0.11, 0.38, 0.22, 0.16), M(0, 0.14, 0.03, 0.5, 0, 0), { color: hw });
  r.part('hneck', G.box(0.05, 0.36, 0.1), M(0, 0.17, -0.06, 0.45, 0, 0), { color: hg, shade: 0.3 });
  r.part('hhead', G.taper(0.15, 0.11, 0.18, 0.14, 0.12), M(0, 0.02, 0.0), { color: hw });
  r.part('hhead', G.taper(0.12, 0.1, 0.24, 0.1, 0.09), M(0, -0.02, 0.17, Math.PI / 2 - 0.25, 0, 0), { color: hw });
  r.part('hhead', G.box(0.1, 0.06, 0.06), M(0, -0.08, 0.27, -0.25, 0, 0), { color: 0xc8c0c0 });
  for (const x of [-0.05, 0.05]) {
    r.part('hhead', G.cone(0.025, 0.08, 4), M(x, 0.12, -0.03, -0.2, 0, 0), { color: hw });
    r.part('hhead', G.sphere(0.018, 6, 5), M(x * 1.35, 0.03, 0.06), { color: C.black });
  }
  r.part('hhead', G.box(0.13, 0.03, 0.2), M(0, 0.02, 0.1, -0.2, 0, 0), { color: C.leatherDark });
  r.part('hhead', G.box(0.13, 0.08, 0.08), M(0, 0.07, -0.02), TEAM(0xc8c8c8));
  // caparison + saddle
  for (const x of [-0.25, 0.25]) {
    r.part('hbody', G.box(0.02, 0.3, 0.5), M(x, -0.08, 0.05), TEAM(0xd0d0d0));
    r.part('hbody', G.box(0.025, 0.035, 0.52), M(x * 1.01, -0.23, 0.05), { color: C.gold, metal: 1 });
  }
  r.part('hbody', G.box(0.5, 0.04, 0.5), M(0, 0.2, 0.05), TEAM(0xc8c8c8));
  r.part('hbody', G.box(0.3, 0.08, 0.3), M(0, 0.24, -0.02), { color: C.leather });
  // legs
  for (const s of ['FL', 'FR', 'BL', 'BR']) {
    const back = s[0] === 'B';
    r.part('leg' + s, G.capsule(back ? 0.075 : 0.06, 0.16, 3, 8), M(0, -0.1, back ? -0.02 : 0), { color: hw });
    r.part('knee' + s, G.capsule(0.04, 0.18, 3, 6), M(0, -0.12, 0), { color: hw });
    r.part('knee' + s, G.cyl(0.06, 0.05, 0.06, 8), M(0, -0.22, 0), { color: hg });
    r.part('hoof' + s, G.cyl(0.05, 0.058, 0.06, 8), M(0, -0.0, 0.0), { color: 0x4a4440 });
  }
  r.part('htail', G.cone(0.08, 0.5, 6), M(0, -0.18, -0.06, Math.PI - 0.45, 0, 0), { color: hg, shade: 0.4 });
  // ---- rider (robed mage)
  body(r, { torso: 0xc8c8c8, arms: 0xc8c8c8, legs: C.leatherDark, boots: C.leatherDark, face: 'beard', hair: C.hairWhite });
  r.part('chest', G.taper(0.26, 0.32, 0.24, 0.18, 0.2), M(0, 0.03, 0), TEAM(0xc8c8c8));
  r.part('chest', G.box(0.04, 0.24, 0.02), M(0, 0.03, 0.105), { color: C.gold, metal: 1 });
  r.part('hips', G.lathe([[0.15, 0.06], [0.22, -0.1], [0.3, -0.3], [0.31, -0.32]], 10), M(0, 0, 0), TEAM(0xb8b8b8));
  r.part('hips', G.cyl(0.14, 0.14, 0.04, 10), M(0, 0.05, 0), { color: C.gold, metal: 1 });
  for (const s of ['L', 'R']) {
    r.part('arm' + s, G.sphere(0.075, 8, 6), M(0, -0.01, 0), TEAM(0xc0c0c0));
    r.part('fore' + s, G.cyl(0.07, 0.05, 0.13, 8), M(0, -0.09, 0), TEAM(0xb0b0b0));
  }
  // wizard hat
  r.part('head', G.cyl(0.2, 0.2, 0.025, 14), M(0, 0.15, 0), TEAM(0xb8b8b8));
  r.part('head', G.cone(0.13, 0.36, 10), M(0.0, 0.33, -0.03, -0.25, 0, 0.12), TEAM(0xc8c8c8));
  r.part('head', G.torus(0.125, 0.018, 4, 12), M(0, 0.17, 0, Math.PI / 2, 0, 0), { color: C.gold, metal: 1 });
  r.part('head', G.octa(0.025), M(0, 0.18, 0.13), { color: C.blue, glow: 1 });
  cape(r, 0.45, 0.32);
  staff(r, 'handR');
  r.finish();
  return { rig: r, style: 'cast', scale: 1.6, mounted: true, height: 1.55 };
}

export function buildVillager(): CharacterModel {
  const r = new RigTemplate(humanBones());
  body(r, { torso: 0xc8c8c8, arms: C.linen, legs: 0x6a5a40, boots: C.leatherDark, hair: C.hairBrown });
  r.part('chest', G.taper(0.25, 0.31, 0.22, 0.17, 0.18), M(0, 0.03, 0), TEAM(0xc8c8c8));
  r.part('hips', G.taper(0.26, 0.24, 0.16, 0.18), M(0, -0.04, 0), TEAM(0xb8b8b8));
  r.part('hips', G.cyl(0.13, 0.13, 0.035, 10), M(0, 0.05, 0), { color: C.leatherDark });
  r.part('chest', G.box(0.2, 0.3, 0.02), M(0, -0.12, 0.1), { color: C.leather });
  // cap
  r.part('head', G.sphere(0.115, 10, 6, ), M(0, 0.13, -0.01, 0, 0, 0, 1.0, 0.6, 1.0), TEAM(0xc0c0c0));
  r.part('head', G.cyl(0.06, 0.07, 0.03, 8), M(0, 0.2, -0.03), TEAM(0xb0b0b0));
  axe(r, 'handR');
  r.finish();
  return { rig: r, style: 'chop', scale: 1.38, mounted: false, height: 1.0 };
}

export function buildSoldier(): CharacterModel {
  const r = new RigTemplate(humanBones({ ...HUMAN, shoulderX: 0.155 }));
  body(r, { torso: 0x9aa0a8, arms: 0x9aa0a8, legs: 0x6a5a48, boots: C.leatherDark, hands: C.leatherDark, bulk: 1.05, hair: C.hairBrown });
  r.part('chest', G.taper(0.27, 0.34, 0.24, 0.18, 0.2), M(0, 0.03, 0), { color: 0x9aa0a8, metal: 0.6, jitter: 0.12 });
  r.part('chest', G.box(0.2, 0.26, 0.025), M(0, 0.0, 0.1), TEAM(0xd0d0d0));
  r.part('chest', G.box(0.2, 0.26, 0.025), M(0, 0.0, -0.1), TEAM(0xc0c0c0));
  r.part('hips', G.box(0.2, 0.2, 0.025), M(0, -0.09, 0.09), TEAM(0xc8c8c8));
  r.part('hips', G.box(0.2, 0.18, 0.025), M(0, -0.08, -0.09), TEAM(0xb8b8b8));
  r.part('hips', G.cyl(0.14, 0.14, 0.04, 10), M(0, 0.05, 0), { color: C.leatherDark });
  // kettle helmet
  r.part('head', G.sphere(0.12, 10, 6, ), M(0, 0.12, 0, 0, 0, 0, 1, 0.75, 1), { color: C.steel, metal: 1 });
  r.part('head', G.cyl(0.18, 0.19, 0.02, 12), M(0, 0.11, 0), { color: C.steelDark, metal: 1 });
  r.part('head', G.cone(0.02, 0.06, 4), M(0, 0.22, 0), TEAM(0xd0d0d0));
  for (const s of ['L', 'R']) r.part('arm' + s, G.sphere(0.075, 8, 6), M(0, 0, 0, 0, 0, 0, 1.1, 0.8, 1.1), { color: C.steel, metal: 1 });
  roundShield(r, 'foreL');
  spear(r, 'handR');
  r.finish();
  return { rig: r, style: 'thrust', scale: 1.5, mounted: false, height: 1.05 };
}

export function buildTraveler(): CharacterModel {
  const r = new RigTemplate(humanBones());
  const cloak = 0x7a5a3a;
  body(r, { torso: cloak, arms: cloak, legs: 0x5a6040, boots: C.leatherDark, hair: C.hairBrown });
  r.part('head', G.sphere(0.13, 10, 8), M(0, 0.1, -0.025, 0, 0, 0, 1, 1.05, 1.08), { color: cloak, shade: 0.4 });
  r.part('chest', G.taper(0.3, 0.36, 0.26, 0.2, 0.22), M(0, 0.03, 0), { color: cloak });
  r.part('hips', G.lathe([[0.14, 0.06], [0.2, -0.1], [0.24, -0.34]], 9), M(0, 0, 0), { color: cloak, shade: 0.4 });
  r.part('cape', G.box(0.22, 0.28, 0.14), M(0, -0.16, -0.05), { color: C.leather });
  r.part('cape', G.cyl(0.06, 0.06, 0.3, 8), M(0, 0.0, -0.06, 0, 0, Math.PI / 2), { color: 0xa09070 });
  r.part('cape', G.sphere(0.06, 8, 6), M(0.13, -0.24, -0.03), { color: 0x3a3a3a, metal: 1 });
  staff(r, 'handR', 0x8a6a40);
  r.finish();
  return { rig: r, style: 'none', scale: 1.38, mounted: false, height: 1.0 };
}

export function buildSkeleton(): CharacterModel {
  const r = new RigTemplate(humanBones({ ...HUMAN, shoulderX: 0.14 }));
  const b = C.bone, bd = C.boneDark;
  // skull
  r.part('head', G.sphere(0.1, 10, 8), M(0, 0.1, 0, 0, 0, 0, 0.95, 1, 1.05), { color: b, shade: 0.2 });
  r.part('head', G.box(0.13, 0.05, 0.1), M(0, 0.02, 0.03), { color: b });
  for (const x of [-0.035, 0.035]) {
    r.part('head', G.sphere(0.03, 6, 5), M(x, 0.1, 0.085), { color: C.black });
    r.part('head', G.sphere(0.017, 6, 5), M(x, 0.1, 0.1), { color: C.green, glow: 1, shade: 0 });
  }
  r.part('head', G.box(0.1, 0.012, 0.02), M(0, 0.04, 0.09), { color: C.black });
  r.part('neck', G.cyl(0.02, 0.02, 0.1, 5), M(0, 0, 0), { color: bd });
  // ribcage and spine
  for (let i = 0; i < 4; i++) r.part('chest', G.torus(0.11 - i * 0.012, 0.014, 4, 10), M(0, 0.1 - i * 0.05, 0.0, Math.PI / 2, 0, 0, 1, 0.75, 1), { color: b });
  r.part('chest', G.cyl(0.018, 0.018, 0.26, 5), M(0, 0.0, -0.06), { color: bd });
  r.part('spine', G.cyl(0.02, 0.02, 0.14, 5), M(0, 0.03, -0.03), { color: bd });
  r.part('hips', G.taper(0.2, 0.14, 0.07, 0.1), M(0, -0.01, 0), { color: b });
  r.part('hips', G.box(0.24, 0.16, 0.18), M(0, -0.08, 0.0), { color: C.rag, shade: 0.4, jitter: 0.15 });
  r.part('chest', G.box(0.36, 0.06, 0.12), M(0, 0.13, 0.0), { color: bd });
  for (const s of ['L', 'R']) {
    r.part('arm' + s, G.cyl(0.018, 0.016, 0.16, 5), M(0, -0.085, 0), { color: b });
    r.part('arm' + s, G.sphere(0.035, 6, 5), M(0, 0, 0), { color: bd });
    r.part('fore' + s, G.cyl(0.016, 0.014, 0.14, 5), M(0, -0.075, 0), { color: b });
    r.part('hand' + s, G.box(0.04, 0.06, 0.03), M(0, -0.03, 0), { color: b });
    r.part('thigh' + s, G.cyl(0.022, 0.018, 0.2, 5), M(0, -0.1, 0), { color: b });
    r.part('shin' + s, G.sphere(0.03, 6, 5), M(0, 0, 0), { color: bd });
    r.part('shin' + s, G.cyl(0.018, 0.016, 0.2, 5), M(0, -0.1, 0), { color: b });
    r.part('foot' + s, G.box(0.06, 0.04, 0.13), M(0, 0, 0.03), { color: b });
  }
  sword(r, 'handR', 0.4, C.rust);
  r.part('foreL', G.cyl(0.13, 0.13, 0.025, 7, ), M(0.07, -0.06, 0.02, 0, 0, Math.PI / 2), { color: 0x6a5038, jitter: 0.2 });
  r.part('foreL', G.sphere(0.03, 6, 5), M(0.085, -0.06, 0.02), { color: C.rust, metal: 1 });
  r.finish();
  return { rig: r, style: 'slash', scale: 1.48, mounted: false, height: 1.0 };
}

export function buildZombie(): CharacterModel {
  const r = new RigTemplate(humanBones({ ...HUMAN, shoulderX: 0.17, upperArm: 0.2, foreArm: 0.18 }));
  body(r, { skin: C.zombie, torso: 0x6a5a48, arms: C.zombie, legs: 0x4a4038, boots: C.zombieDark, hands: C.zombieDark, bulk: 1.18, hair: null });
  r.part('chest', G.sphere(0.2, 10, 8), M(0, 0.0, 0.02, 0, 0, 0, 1.05, 0.95, 0.95), { color: 0x6a5a48, jitter: 0.18 });
  r.part('spine', G.sphere(0.17, 10, 8), M(0, 0.0, 0.04), { color: C.zombie, shade: 0.4 });
  r.part('head', G.box(0.12, 0.04, 0.06), M(0, 0.02, 0.07, 0.3, 0, 0), { color: C.zombieDark });
  for (const x of [-0.035, 0.035]) r.part('head', G.sphere(0.02, 6, 5), M(x, 0.1, 0.095), { color: 0xd8ff8a, glow: 0.6 });
  for (let i = 0; i < 3; i++) r.part('chest', G.box(0.02, 0.1, 0.02), M(-0.05 + i * 0.04, -0.05, 0.19), { color: C.bone });
  for (const s of ['L', 'R']) for (let i = 0; i < 3; i++) r.part('hand' + s, G.cone(0.012, 0.07, 4), M(-0.02 + i * 0.02, -0.08, 0.01, Math.PI, 0, 0), { color: C.bone });
  r.finish();
  return { rig: r, style: 'claw', scale: 1.55, mounted: false, height: 1.05 };
}

const builders: Record<string, () => CharacterModel> = {
  hero_warrior: buildWarrior,
  hero_archer: buildArcher,
  hero_mage: buildMage,
  villager: buildVillager,
  soldier: buildSoldier,
  traveler: buildTraveler,
  skeleton: buildSkeleton,
  zombie: buildZombie,
};

const cache = new Map<string, CharacterModel>();
export function characterModel(def: string): CharacterModel {
  let m = cache.get(def);
  if (!m) {
    m = (builders[def] ?? buildVillager)();
    cache.set(def, m);
  }
  return m;
}

/** Mods can register new procedural characters. */
export function registerCharacter(def: string, build: () => CharacterModel) {
  builders[def] = build;
  cache.delete(def);
}

export type { THREE };
