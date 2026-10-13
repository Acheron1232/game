// Asset manifest for the Codex image generator.
// Phase 1 assets have no dependencies; phase 2 assets reference a phase 1 image for consistency.

export const STYLE =
  'High quality fantasy pixel-art game asset in the style of Warcraft 3 meets WorldBox and Kingdom Two Crowns, ' +
  '3/4 top-down view seen from slightly above, rich hand-crafted shading, crisp pixel clusters, bold readable silhouette, ' +
  'warm light from the top-left. TRANSPARENT background (alpha), no ground shadow, no text, no labels, no border, no frame.';

export const TEAM =
  'Team-color areas (cloth, cape, tabard, hood, banners, flags, shield emblem) are PURE SATURATED MAGENTA #FF00FF; ' +
  'no other magenta, pink or purple anywhere else in the image.';

const NOTEAM = 'Do not use magenta, pink or purple anywhere.';

const unit = (desc) => `${STYLE} ${TEAM} A single full-body ${desc}, facing right. Square image, character centered with generous margin.`;
const strip = (what, frames, action) =>
  `${STYLE} %TEAM% Sprite sheet: a single horizontal strip of exactly ${frames} animation frames of the SAME ${what} from the reference image ` +
  `(identical colors, size, proportions and equipment), ${action} Frames evenly spaced in equal-width cells, all feet on the same baseline, ` +
  `no overlap between frames, motion smears (if any) are white or gold. Wide image 3:1 aspect ratio.`;
const building = (desc, team = true) =>
  `${STYLE} ${team ? TEAM : NOTEAM} A single ${desc}. Seen from the front-top (3/4 top-down RTS view), whole structure visible including its ground footprint, centered with margin. Square image.`;
const sheet = (desc, team = false) =>
  `${STYLE} ${team ? TEAM : NOTEAM} A sprite sheet of separate game props: ${desc} Each object is clearly separated from the others by wide empty transparent space, arranged in a loose grid, nothing touching or overlapping. Square image.`;
const texture = (desc) =>
  `Seamless tileable top-down ground texture for a 3D RTS, hand-painted stylized look exactly like Warcraft 3 terrain tiles, viewed straight from above, soft even lighting, no perspective, no objects, no shadows, no border: ${desc} The texture fills the entire square image edge to edge and tiles seamlessly.`;

export const PHASE1 = {
  // heroes
  hero_warrior: { prompt: unit('human WARRIOR hero, heavy plate armor with gold trim, longsword in the right hand and a kite shield, flowing cape, idle combat-ready stance') , skip: true },
  hero_archer: { prompt: unit('human female ARCHER hero (ranger), elegant leather armor, hood and cape, longbow in hand, quiver of arrows, idle ready stance'), skip: true },
  hero_mage: { prompt: unit('human battle MAGE hero riding a white war horse, tall glowing staff with blue crystal, wizard robe and hat, horse caparison'), skip: true },
  // units
  villager: { prompt: unit('human peasant VILLAGER worker, simple linen shirt with a team-color tunic and cap, leather apron, holding a woodcutting axe, sturdy friendly look, idle') },
  soldier: { prompt: unit('human MILITIA SOLDIER, chainmail and kettle helmet, team-color tabard, spear and round wooden shield, idle guard stance') },
  traveler: { prompt: `${STYLE} ${NOTEAM} A single full-body neutral wandering human TRAVELER, weathered brown hooded cloak, big backpack with bedroll and pots, wooden walking staff, facing right, idle. Square image, centered with generous margin.` },
  skeleton: { prompt: `${STYLE} ${NOTEAM} A single full-body undead SKELETON warrior, yellowed bones, rusty notched sword and broken round shield, tattered dark rags, faint sickly green glow in the eye sockets, menacing hunched stance, facing right. Square image, centered with generous margin.` },
  zombie: { prompt: `${STYLE} ${NOTEAM} A single full-body undead ZOMBIE, big bloated rotten greenish-grey flesh, torn peasant clothes, slack jaw, long claws, slow shambling stance with arms reaching forward, facing right. Square image, centered with generous margin.` },
  // human buildings
  townhall_1: { prompt: building('medieval human WOODEN TOWN HALL (level 1): large timber longhouse with thatched roof, carved wooden pillars, double door, two burning torches at the entrance, team-color banners hanging on the front') },
  townhall_2: { prompt: building('medieval human STONE TOWN HALL (level 2 upgrade): fortified stone keep with slate roof and a small tower, arched gate, wooden beams, burning braziers, big team-color banners and a flag on the tower') },
  house: { prompt: building('small cozy medieval human HOUSE / cottage: timber frame, thatched roof, stone chimney, lit warm window, small team-color flag above the door') },
  farm: { prompt: building('medieval human FARM: small wooden barn with hay loft next to a fenced wheat field with golden crops in neat rows, scarecrow, team-color pennant on the barn') },
  sawmill: { prompt: building('medieval human SAWMILL / lumber mill: open timber shed with a big circular saw blade, stacked logs and planks, sawdust, a team-color banner on a pole') },
  barracks: { prompt: building('medieval human BARRACKS: sturdy timber and stone military hall, weapon racks with spears and shields outside, training dummy, team-color banners at the doors') },
  tower: { prompt: building('medieval human GUARD TOWER: tall narrow stone and wood watchtower with a wooden roof, archer platform at the top, a burning torch, team-color flag on top. Tall vertical composition') },
  construction: { prompt: building('medieval CONSTRUCTION SITE foundation: square stone foundation with wooden scaffolding, stacked planks, rope, a hammer and a small pile of stones, unfinished timber frame', false) },
  // evil
  dark_core_1: { prompt: building('cursed undead DARK CORE (level 1): a jagged black obsidian crystal monolith rising from a ring of cracked earth and bones, pulsing sickly green and violet-free ghostly green energy cracks, small ritual candles', false) },
  dark_core_2: { prompt: building('cursed undead DARK CORE (level 2): a larger jagged black obsidian crystal spire with floating rock shards around it, thick glowing toxic green energy veins, bone spikes and chains around its base', false) },
  dark_core_3: { prompt: building('cursed undead DARK CORE (level 3, fully grown): a massive towering black obsidian crystal citadel spire, crown of floating shards, intense glowing toxic green energy, ring of skull pillars and chains, ominous', false) },
  graveyard: { prompt: building('cursed undead GRAVEYARD: patch of dead earth with crooked tombstones, open graves, a dead gnarled tree, rusty iron fence, green ghostly mist and candles', false) },
  // nature + props sheets
  sheet_trees: { prompt: sheet('6 different lush fantasy trees: 2 broad green oaks, 2 tall dark-green pines, 1 white birch, 1 round autumn orange tree. Each tree whole with trunk visible.') },
  sheet_cursed: { prompt: sheet('6 cursed dead things: 3 gnarled dead black trees with twisted branches, 1 bone pile with skulls, 2 crooked broken tombstones.') },
  sheet_rocks: { prompt: sheet('6 grey stone deposits / mineable boulders of different shapes and sizes, some with chiselled cracks and small sparkling quartz, mossy bits.') },
  sheet_bushes: { prompt: sheet('6 plants: 3 lush berry bushes full of red berries, 1 picked-empty berry bush with no berries, 2 clumps of tall grass with small wildflowers.') },
  sheet_ruins: { prompt: sheet('6 ancient fantasy ruins: broken marble column, crumbling stone archway, ancient standing rune stone with glowing blue runes, toppled knight statue, mossy broken wall segment, small ruined shrine with a glowing blue sigil.') },
  sheet_props: { prompt: sheet('8 village props: a standing torch on a wooden pole with fire, an iron brazier with fire, a campfire with logs, a traveler canvas tent, a wooden signpost, a stack of crates, two barrels, a haystack.') },
  sheet_icons: { prompt: `${STYLE} ${NOTEAM} A 4x4 grid sheet of 16 square fantasy RPG UI icons, each icon in its own cell with empty space between: wood logs, grey stone, bread and apple (food), house (population), crossed swords, shield, hammer, skull, wheat sheaf, axe, pickaxe, gold crown, heart, star (experience), horn (alarm), banner flag. Square image.` },
  sheet_fx: { prompt: `${STYLE} ${NOTEAM} A sprite sheet of separate magic and combat VFX elements, each clearly separated: a wooden arrow with feathers pointing right, a blazing blue arcane fireball orb pointing right, a white sword slash arc, a puff of grey smoke, a golden sparkle star burst, a green necrotic skull flame. Square image.` },
  portraits: { prompt: `${STYLE} ${TEAM} Three separate square character PORTRAIT busts side by side in a row with space between, painted RPG style: 1) blonde heavy-armored warrior man with gold lion pauldrons and team-color cape, 2) blonde hooded female archer with team-color hood, 3) old bearded wizard with team-color wizard hat. Wide image 3:1 aspect ratio.` },
  // terrain
  tex_grass: { prompt: texture('lush green meadow grass with subtle variation, tiny flowers and clover.') },
  tex_dirt: { prompt: texture('packed brown dirt path with small pebbles.') },
  tex_cursed: { prompt: texture('cursed dead blackened earth with ashen cracks and faint toxic green glowing fissures, scattered tiny bones.') },
  tex_water: { prompt: texture('deep clear blue lake water with gentle ripples and soft highlights.') },
  tex_forest: { prompt: texture('dark green forest floor with moss, fallen leaves and twigs.') },
  tex_sand: { prompt: texture('light shore sand mixed with small stones.') },
};

export const PHASE2 = {
  hero_warrior_walk: { ref: 'hero_warrior', skip: true, prompt: strip('armored warrior hero', 4, 'WALKING to the right: frame1 left leg forward, frame2 passing, frame3 right leg forward, frame4 passing.') },
  hero_warrior_attack: { ref: 'hero_warrior', prompt: strip('armored warrior hero', 4, 'performing a sword ATTACK to the right: frame1 wind-up sword raised high, frame2 mid swing, frame3 full strike forward, frame4 recovery.') },
  hero_archer_walk: { ref: 'hero_archer', prompt: strip('female archer hero', 4, 'WALKING to the right: frame1 left leg forward, frame2 passing, frame3 right leg forward, frame4 passing.') },
  hero_archer_attack: { ref: 'hero_archer', prompt: strip('female archer hero', 4, 'SHOOTING her bow to the right: frame1 nocking an arrow, frame2 drawing the bowstring, frame3 full draw aiming, frame4 release with the string snapping forward.') },
  hero_mage_walk: { ref: 'hero_mage', prompt: strip('mage riding the white horse', 4, 'the horse TROTTING to the right with the rider: 4 frames of a trot gait cycle with clearly alternating horse legs.') },
  hero_mage_attack: { ref: 'hero_mage', prompt: strip('mage riding the white horse', 4, 'CASTING a spell to the right while mounted: frame1 staff lowered, frame2 staff raised with crystal charging bright blue, frame3 staff thrust forward releasing blue magic, frame4 recovery.') },
  villager_walk: { ref: 'villager', prompt: strip('peasant villager', 4, 'WALKING to the right carrying the axe: frame1 left leg forward, frame2 passing, frame3 right leg forward, frame4 passing.') },
  villager_work: { ref: 'villager', prompt: strip('peasant villager', 4, 'WORKING: chopping with the axe to the right: frame1 axe raised high over the shoulder, frame2 swinging down, frame3 axe impact low with wood chips, frame4 pulling back.') },
  soldier_walk: { ref: 'soldier', prompt: strip('militia soldier', 4, 'WALKING to the right: frame1 left leg forward, frame2 passing, frame3 right leg forward, frame4 passing.') },
  soldier_attack: { ref: 'soldier', prompt: strip('militia soldier', 4, 'performing a spear THRUST attack to the right: frame1 spear drawn back, frame2 lunging, frame3 full thrust extended, frame4 recovery.') },
  traveler_walk: { ref: 'traveler', noteam: true, prompt: strip('wandering traveler', 4, 'WALKING to the right with the staff: frame1 left leg forward, frame2 passing, frame3 right leg forward, frame4 passing.') },
  skeleton_walk: { ref: 'skeleton', noteam: true, prompt: strip('undead skeleton warrior', 4, 'WALKING with a jerky gait to the right: frame1 left leg forward, frame2 passing, frame3 right leg forward, frame4 passing.') },
  skeleton_attack: { ref: 'skeleton', noteam: true, prompt: strip('undead skeleton warrior', 4, 'ATTACKING with the rusty sword to the right: frame1 wind-up, frame2 swing, frame3 strike, frame4 recovery.') },
  zombie_walk: { ref: 'zombie', noteam: true, prompt: strip('undead zombie', 4, 'SHAMBLING slowly to the right: 4 frames of a heavy limping walk cycle.') },
  zombie_attack: { ref: 'zombie', noteam: true, prompt: strip('undead zombie', 4, 'ATTACKING to the right: frame1 arms raised, frame2 lunging, frame3 claws slashing down, frame4 recovery.') },
};
