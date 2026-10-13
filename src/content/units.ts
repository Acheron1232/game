import type { AbilityDef, HeroDef, UnitDef } from './types';

export const units: Record<string, UnitDef> = {
  villager: {
    id: 'villager', name: 'Житель', sprite: 'villager',
    hp: 30, damage: 2, attackCooldown: 1.2, range: 1, speed: 2.3, aggro: 0, radius: 0.32, scale: 0.42,
    upkeep: 1, xp: 5, tags: ['human', 'villager'], hitFrame: 0.55,
  },
  soldier: {
    id: 'soldier', name: 'Солдат', sprite: 'soldier',
    hp: 50, damage: 6, attackCooldown: 1, range: 1.15, speed: 2.5, aggro: 6.5, radius: 0.34, scale: 0.44,
    upkeep: 1, xp: 10, tags: ['human', 'soldier'], hitFrame: 0.6,
  },
  traveler: {
    id: 'traveler', name: 'Мандрівник', sprite: 'traveler',
    hp: 30, damage: 0, attackCooldown: 1, range: 1, speed: 1.6, aggro: 0, radius: 0.32, scale: 0.42,
    upkeep: 0, xp: 0, tags: ['neutral', 'traveler'],
  },
  skeleton: {
    id: 'skeleton', name: 'Скелет', sprite: 'skeleton',
    hp: 30, damage: 4, attackCooldown: 1.2, range: 1.1, speed: 2.1, aggro: 5, radius: 0.33, scale: 0.44,
    upkeep: 0, xp: 20, points: 1, tags: ['undead'], hitFrame: 0.6,
    light: { color: 0x7dff9a, radius: 1.6, intensity: 0.35 },
  },
  zombie: {
    id: 'zombie', name: 'Зомбі', sprite: 'zombie',
    hp: 60, damage: 5, attackCooldown: 1.5, range: 1.15, speed: 1.35, aggro: 4.5, radius: 0.4, scale: 0.48,
    upkeep: 0, xp: 35, points: 2, tags: ['undead'], hitFrame: 0.65,
    light: { color: 0x9dff6a, radius: 1.4, intensity: 0.25 },
  },
};

export const heroes: Record<string, HeroDef> = {
  hero_warrior: {
    id: 'hero_warrior', name: 'Воїн', title: 'Лицар Світанку', sprite: 'hero_warrior', portrait: 'portrait_warrior',
    description: 'Важка броня і меч. Найміцніший у ближньому бою, вихор б’є всіх навколо.',
    hp: 110, damage: 10, attackCooldown: 1, range: 1.25, speed: 3, aggro: 4, radius: 0.38, scale: 0.5,
    upkeep: 0, xp: 50, tags: ['human', 'hero'], hitFrame: 0.55,
    levelHp: 10, levelDamage: 1, xpLevels: [100, 250, 450, 700], gatherTime: 1, ability: 'whirlwind',
    light: { color: 0xffd28a, radius: 2.6, intensity: 0.5 },
  },
  hero_archer: {
    id: 'hero_archer', name: 'Лучниця', title: 'Слідопитка Лісу', sprite: 'hero_archer', portrait: 'portrait_archer',
    description: 'Стріляє здалеку, швидка. Залп стріл накриває ділянку.',
    hp: 90, damage: 9, attackCooldown: 1, range: 6, speed: 3.3, aggro: 6, radius: 0.36, scale: 0.5,
    projectile: 'arrow', upkeep: 0, xp: 50, tags: ['human', 'hero'], hitFrame: 0.75,
    levelHp: 10, levelDamage: 1, xpLevels: [100, 250, 450, 700], gatherTime: 1, ability: 'volley',
    light: { color: 0xffe2a8, radius: 2.6, intensity: 0.5 },
  },
  hero_mage: {
    id: 'hero_mage', name: 'Маг', title: 'Вершник Аркани', sprite: 'hero_mage', portrait: 'portrait_mage',
    description: 'Маг на коні з посохом. Магічні сфери б’ють по площі, аркана відкидає ворогів.',
    hp: 95, damage: 11, attackCooldown: 1.25, range: 5, speed: 3.6, aggro: 5.5, radius: 0.5, scale: 0.5,
    projectile: 'orb', splash: 1.3, upkeep: 0, xp: 50, tags: ['human', 'hero'], hitFrame: 0.6,
    levelHp: 10, levelDamage: 1, xpLevels: [100, 250, 450, 700], gatherTime: 1.1, ability: 'nova',
    light: { color: 0x8fd0ff, radius: 3.2, intensity: 0.7 },
  },
};

export const abilities: Record<string, AbilityDef> = {
  whirlwind: { id: 'whirlwind', name: 'Вихор', description: 'Удар по всіх ворогах поруч', cooldown: 14, effect: 'aoe_self', radius: 2.2, damage: 22 },
  volley: { id: 'volley', name: 'Залп', description: 'Дощ стріл у вибраній точці', cooldown: 16, effect: 'aoe_target', radius: 2.4, damage: 18, range: 8 },
  nova: { id: 'nova', name: 'Аркана', description: 'Вибух магії навколо мага', cooldown: 15, effect: 'aoe_self', radius: 2.8, damage: 26 },
};
