// Example runtime mod for «Живі королівства».
// Load during a session:  game.mods.load('/mods/example-mod.js')   (or drag this file onto the window)
// A mod receives the game API and may return a dispose function.

export const name = 'Благословення врожаю';

export default function register(game) {
  // 1. patch content live: farms become more productive
  const oldRate = game.get('buildings.farm.produces.perMin');
  game.patch('buildings.farm.produces.perMin', 12);

  // 2. add a brand new simulation system: heroes regenerate slowly near rune stones
  game.systems.add('runeBlessing', (sim, dt) => {
    for (const f of sim.world.factions) {
      const h = sim.get(f.heroId);
      if (!h || h.respawnAt != null || h.hp >= h.maxHp) continue;
      for (const e of sim.world.entities.values()) {
        if (e.def === 'runestone' && Math.hypot(e.x - h.x, e.y - h.y) < 4) { h.hp = Math.min(h.maxHp, h.hp + 3 * dt); break; }
      }
    }
  }, { after: 'economy' });

  // 3. a new ability effect + switch the warrior to it
  game.abilities.thunder = (sim, src, x, y, r, dmg) => {
    for (const u of [...sim.units]) if (sim.isEnemy(src, u) && Math.hypot(u.x - src.x, u.y - src.y) < r + 1) sim.damage(u, dmg * 1.3, src.id);
  };
  game.patch('abilities.whirlwind.effect', 'thunder');

  // 4. react to events
  const off = game.on('built', (b) => { if (b.def === 'farm') game.notice('Поле благословенне: +50% врожаю', 'good'); });

  game.notice('Мод «Благословення врожаю» активний', 'good');
  return () => {
    off();
    game.systems.remove('runeBlessing');
    game.patch('buildings.farm.produces.perMin', oldRate);
    game.patch('abilities.whirlwind.effect', 'aoe_self');
  };
}
