/**
 * Default system pipeline. Each system is a pure function over the world; with Vite HMR an edited
 * system module is swapped into the running simulation without losing any state.
 */
import type { Sim } from '../sim';
import { behaviorSystem } from './behavior';
import { botSystem } from './bot';
import { combatSystem } from './combat';
import { buildingSystem, economySystem, jobsSystem, registerFactionHooks } from './economy';
import { evilSystem, registerEvilHooks } from './evil';
import { movementSystem } from './movement';

const live = new Set<Sim>();

export function installSystems(sim: Sim) {
  sim.addSystem('bot', botSystem);
  sim.addSystem('evil', evilSystem);
  sim.addSystem('jobs', jobsSystem);
  sim.addSystem('behavior', behaviorSystem);
  sim.addSystem('movement', movementSystem);
  sim.addSystem('combat', combatSystem);
  sim.addSystem('buildings', buildingSystem);
  sim.addSystem('economy', economySystem);
  registerEvilHooks(sim);
  registerFactionHooks(sim);
  live.add(sim);
}

export function uninstall(sim: Sim) {
  live.delete(sim);
}

if (import.meta.hot) {
  import.meta.hot.accept(['./behavior', './bot', './combat', './economy', './evil', './movement'], ([beh, bot, com, eco, evi, mov]) => {
    for (const sim of live) {
      if (beh) sim.replaceSystem('behavior', beh.behaviorSystem);
      if (bot) sim.replaceSystem('bot', bot.botSystem);
      if (com) sim.replaceSystem('combat', com.combatSystem);
      if (eco) { sim.replaceSystem('jobs', eco.jobsSystem); sim.replaceSystem('economy', eco.economySystem); sim.replaceSystem('buildings', eco.buildingSystem); eco.registerFactionHooks(sim); }
      if (evi) { sim.replaceSystem('evil', evi.evilSystem); evi.registerEvilHooks(sim); }
      if (mov) sim.replaceSystem('movement', mov.movementSystem);
    }
    console.info('%c[hot] systems swapped into the running simulation', 'color:#8f8');
  });
}
