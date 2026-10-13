import type { BuildingDef, PropDef } from './types';

export const buildings: Record<string, BuildingDef> = {
  townhall: {
    id: 'townhall', name: 'Ратуша', description: 'Центр поселення: 4 місця, відродження героя, лікування. Рівень 2 — кам’яна.',
    sprite: 'townhall_1', levelSprites: ['townhall_1', 'townhall_2'], size: [4, 3], cost: { wood: 30 }, buildTime: 30, hp: 800,
    housing: 4, popCap: [12, 20], upgrade: { cost: { wood: 60, stone: 30 }, time: 60 }, scale: 0.5, icon: 'ic_crown', hotkey: 'T', order: 0, buildable: true,
  },
  house: {
    id: 'house', name: 'Будинок', description: 'Ще 4 місця для жителів.', sprite: 'house', size: [2, 2], cost: { wood: 20 }, buildTime: 30, hp: 220,
    housing: 4, scale: 0.5, icon: 'ic_house', hotkey: 'H', order: 1, buildable: true, requires: { building: 'townhall' },
  },
  farm: {
    id: 'farm', name: 'Ферма', description: '8 їжі за хвилину з одним працівником.', sprite: 'farm', size: [3, 3], cost: { wood: 25 }, buildTime: 30, hp: 220,
    housing: 0, produces: { res: 'food', perMin: 8, role: 'farmer', workers: 1 }, scale: 0.5, icon: 'ic_wheat', hotkey: 'F', order: 2, buildable: true, requires: { building: 'townhall' },
  },
  sawmill: {
    id: 'sawmill', name: 'Лісопильня', description: '10 дерева за хвилину з одним працівником.', sprite: 'sawmill', size: [3, 2], cost: { wood: 20 }, buildTime: 30, hp: 250,
    housing: 0, produces: { res: 'wood', perMin: 10, role: 'lumber', workers: 1 }, scale: 0.5, icon: 'ic_axe', hotkey: 'L', order: 3, buildable: true, requires: { building: 'townhall' },
  },
  barracks: {
    id: 'barracks', name: 'Казарма', description: 'Перетворює жителів на солдатів (10 дерева, 15 с).', sprite: 'barracks', size: [3, 3], cost: { wood: 40 }, buildTime: 30, hp: 450,
    housing: 0, scale: 0.5, icon: 'ic_swords', hotkey: 'B', order: 4, buildable: true, requires: { building: 'townhall' },
  },
  tower: {
    id: 'tower', name: 'Вежа', description: 'Автоматичний захист у малому радіусі.', sprite: 'tower', size: [2, 2], cost: { wood: 25, stone: 15 }, buildTime: 30, hp: 350,
    housing: 0, attack: { damage: 8, cooldown: 1.5, range: 6, projectile: 'arrow' }, scale: 0.5, icon: 'ic_shield', hotkey: 'W', order: 5, buildable: true, requires: { building: 'townhall' },
  },
  dark_core: {
    id: 'dark_core', name: 'Темне осердя', description: 'Серце нежиті. Зруйнуйте його, щоб перемогти світове зло.', sprite: 'dark_core_1',
    levelSprites: ['dark_core_1', 'dark_core_2', 'dark_core_3'], size: [4, 4], cost: {}, buildTime: 1, hp: 600, housing: 0, scale: 0.5, icon: 'ic_skull', hotkey: '', order: 99, evil: true,
  },
  graveyard: {
    id: 'graveyard', name: 'Кладовище', description: 'Виробляє нежить.', sprite: 'graveyard', size: [4, 3], cost: {}, buildTime: 1, hp: 200, housing: 0, scale: 0.5, icon: 'ic_skull', hotkey: '', order: 99, evil: true,
  },
};

export const props: Record<string, PropDef> = {
  tree: { id: 'tree', sprites: ['tree_oak1', 'tree_oak2', 'tree_pine1', 'tree_pine2', 'tree_birch', 'tree_autumn'], res: 'wood', amount: 50, blocks: true, scale: 0.5, sway: 1 },
  pine: { id: 'pine', sprites: ['tree_pine1', 'tree_pine2'], res: 'wood', amount: 50, blocks: true, scale: 0.5, sway: 0.7 },
  rock: { id: 'rock', sprites: ['rock1', 'rock2', 'rock3', 'rock4', 'rock5', 'rock6'], res: 'stone', amount: 120, blocks: true, scale: 0.5 },
  berry: { id: 'berry', sprites: ['berry1', 'berry2', 'berry3'], res: 'food', amount: 25, regen: 1 / 15, blocks: false, scale: 0.5, sway: 0.4 },
  deadtree: { id: 'deadtree', sprites: ['dead_tree1', 'dead_tree2', 'dead_tree3'], blocks: true, scale: 0.5, sway: 0.2 },
  ruin: { id: 'ruin', sprites: ['ruin_column', 'ruin_arch', 'ruin_statue', 'ruin_wall'], blocks: true, scale: 0.5 },
  runestone: { id: 'runestone', sprites: ['ruin_runestone', 'ruin_shrine'], blocks: true, scale: 0.5 },
  tomb: { id: 'tomb', sprites: ['tomb1', 'tomb2', 'bone_pile'], blocks: false, scale: 0.5 },
  grass: { id: 'grass', sprites: ['grass1', 'grass2'], blocks: false, scale: 0.5, sway: 1.4 },
  tent: { id: 'tent', sprites: ['tent'], blocks: true, scale: 0.5 },
  campfire: { id: 'campfire', sprites: ['campfire'], blocks: true, scale: 0.5 },
  torch: { id: 'torch', sprites: ['torch'], blocks: false, scale: 0.55 },
  brazier: { id: 'brazier', sprites: ['brazier'], blocks: true, scale: 0.5 },
  deco: { id: 'deco', sprites: ['crates', 'barrels', 'haystack', 'signpost'], blocks: false, scale: 0.5 },
};
