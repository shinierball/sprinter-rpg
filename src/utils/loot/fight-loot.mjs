/**
 * Loot after a fight (core pp. 22-23, 170, 215). Pure rules, no documents: the dice a dead mob carries by Floor, the
 * totals for a number of bodies, an even split with the remainder handed out in order, the boss's box tier and map, and
 * the snapshot of a finished combat the GM's Loot card is built from. The writes live in `documents/actor/fight-loot.mjs`.
 */
import { bossStarForTier } from '../../documents/actor/actor-constants.mjs';
import { bossTierFromTags } from '../../data/mob-creation-rules.mjs';
import { BOSS_MAPS } from '../../data/rules/boss-maps.mjs';

/** Each dead mob carries this much Misc. Junk (p. 215). */
export const MOB_JUNK_DICE = '1d6';

/**
 * The gold a dead mob carries, by Floor (p. 215). The book lists Floors 1 to 5 only; a Floor without an entry reads the
 * last one (see `mobGoldDice`). `CONFIG.COG.mobLootByFloor` is this object, so a module fills a higher Floor.
 */
export const MOB_LOOT_BY_FLOOR = {
  1: { gold: '' },
  2: { gold: '1d6' },
  3: { gold: '2d4' },
  4: { gold: '2d6' },
  5: { gold: '2d8' }
};

/** The registry in use: `CONFIG.COG.mobLootByFloor` when set, else this module's own. */
const lootTable = () => globalThis.CONFIG?.COG?.mobLootByFloor ?? MOB_LOOT_BY_FLOOR;

/**
 * The gold dice for a Floor: `{ dice, listed }`. `dice` is '' for a Floor that carries none. Above the highest listed Floor
 * the last entry's dice come back with `listed: false` (a pre-fill for the GM, not a book rule); below Floor 1 there is none.
 * @param {number} floor
 * @returns {{ dice: string, listed: boolean }}
 */
export function mobGoldDice(floor) {
  const table = lootTable();
  const keys = Object.keys(table).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const n = Math.floor(Number(floor));
  if (!keys.length || !Number.isFinite(n) || n < 1) return { dice: '', listed: true };
  if (Object.hasOwn(table, n)) return { dice: String(table[n]?.gold ?? ''), listed: true };
  const last = keys[keys.length - 1];
  return n > last ? { dice: String(table[last]?.gold ?? ''), listed: false } : { dice: '', listed: true };
}

/**
 * One roll each for junk and for gold, multiplied by the number of bodies (p. 215), floored at 0.
 * @param {{ junkRoll: number, goldRoll: number, bodies: number }} p
 * @returns {{ junk: number, gold: number }}
 */
export function mobLootTotals({ junkRoll, goldRoll, bodies }) {
  const n = Math.max(0, Math.floor(Number(bodies)) || 0);
  const times = (roll) => Math.max(0, Math.floor(Number(roll)) || 0) * n;
  return { junk: times(junkRoll), gold: times(goldRoll) };
}

/**
 * An even split in whole numbers: every id gets the same share and the remainder goes one each in the order of `ids`.
 * @param {number} total
 * @param {string[]} ids
 * @returns {Map<string, number>}
 */
export function splitLoot(total, ids) {
  const list = [...ids];
  const out = new Map(list.map((id) => [id, 0]));
  const sum = Math.max(0, Math.floor(Number(total)) || 0);
  if (!list.length) return out;
  const share = Math.floor(sum / list.length);
  let rest = sum - share * list.length;
  for (const id of list) {
    out.set(id, share + (rest > 0 ? 1 : 0));
    if (rest > 0) rest -= 1;
  }
  return out;
}

/** The Boss Box tier of a boss tier (p. 22): the same table as the boss star, named once here. */
const bossBoxTierFor = (tierId) => bossStarForTier(tierId);

/**
 * What a boss of this tier hands out: the Boss Box's loot-box tier and the tier's map row (or null).
 * @param {string} tierId
 * @returns {{ boxTier: string, map: { tag: string, labelKey: string, descriptionKey: string }|null }}
 */
function bossRewardFor(tierId) {
  const id = String(tierId ?? '').toLowerCase().trim().replace(/^mob\.tier\./, '');
  const maps = globalThis.CONFIG?.COG?.bossMaps ?? BOSS_MAPS;
  return { boxTier: bossBoxTierFor(id), map: Object.hasOwn(maps, id) ? maps[id] : null };
}

/**
 * The snapshot of a finished combat the Loot card keeps: the bodies, the bosses and the crawlers in the fight. A body is a
 * defeated mob-side combatant whose actor is a mob (a boss is one too); a crawler is a crawler on the party's side (a Dying one
 * included, most kills first); pets and mercenaries are neither.
 * @param {Array<{ uuid: string, name: string, actorType: string, defeated: boolean, mobSide: boolean, tags?: Iterable<string>,
 *   kills?: number, bossKills?: string[] }>} rows plain combatant rows (`bossKills`: the victim uuids in a crawler's boss log)
 * @returns {{ bodies: number, bosses: Array<{ uuid: string, name: string, tierId: string, boxTier: string, map: object|null, killerUuid: string }>,
 *   crawlers: Array<{ uuid: string, name: string, kills: number }> }}
 */
export function fightLootSnapshot(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const dead = list.filter((r) => r?.actorType === 'mob' && r.mobSide && r.defeated);
  const crawlers = [];
  for (const r of list) {
    if (r?.actorType !== 'crawler' || r.mobSide || crawlers.some((c) => c.uuid === r.uuid)) continue;
    crawlers.push({ uuid: String(r.uuid ?? ''), name: String(r.name ?? ''), kills: Math.max(0, Number(r.kills) || 0), bossKills: r.bossKills ?? [] });
  }
  const bosses = [];
  for (const r of dead) {
    const tierId = bossTierFromTags(r.tags ?? []);
    if (tierId === 'none') continue;
    const killer = crawlers.find((c) => c.bossKills.includes(r.uuid));
    bosses.push({ uuid: String(r.uuid ?? ''), name: String(r.name ?? ''), tierId, ...bossRewardFor(tierId), killerUuid: killer?.uuid ?? '' });
  }
  // most kills first: the order the remainder of a split is handed out in (the nearest the data comes to first dibs, p. 87)
  crawlers.sort((a, b) => b.kills - a.kills);
  return { bodies: dead.length, bosses, crawlers: crawlers.map(({ uuid, name, kills }) => ({ uuid, name, kills })) };
}
