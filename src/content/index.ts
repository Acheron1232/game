/**
 * Registers all built-in content. With Vite HMR, editing any content file updates the
 * definitions of the running game in place (the session keeps going).
 */
import { content } from '../engine/registry';
import { abilities, heroes, units } from './units';
import { buildings, props } from './buildings';
import { balance } from './balance';

export function registerContent(mods: { units: typeof units; heroes: typeof heroes; abilities: typeof abilities; buildings: typeof buildings; props: typeof props; balance: typeof balance }) {
  for (const [id, d] of Object.entries(mods.units)) content.register('units', id, structuredClone(d));
  for (const [id, d] of Object.entries(mods.heroes)) content.register('heroes', id, structuredClone(d));
  for (const [id, d] of Object.entries(mods.abilities)) content.register('abilities', id, structuredClone(d));
  for (const [id, d] of Object.entries(mods.buildings)) content.register('buildings', id, structuredClone(d));
  for (const [id, d] of Object.entries(mods.props)) content.register('props', id, structuredClone(d));
  content.setBalance(structuredClone(mods.balance));
  content.reapplyOverrides();
}

registerContent({ units, heroes, abilities, buildings, props, balance });

if (import.meta.hot) {
  const cur = { units, heroes, abilities, buildings, props, balance };
  import.meta.hot.accept(['./units', './buildings', './balance'], ([u, b, bal]) => {
    if (u) Object.assign(cur, { units: u.units, heroes: u.heroes, abilities: u.abilities });
    if (b) Object.assign(cur, { buildings: b.buildings, props: b.props });
    if (bal) cur.balance = bal.balance;
    registerContent(cur);
    console.info('%c[hot] content updated live', 'color:#8f8');
  });
}
