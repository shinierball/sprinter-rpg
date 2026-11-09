/**
 * The Tome loot item: a one-use consumable whose `learn_spell` outcome teaches a spell at a Rank (`learnSpellFromTome`
 * runs it at read time). Shared by the Floor Simulator (a spell too costly to learn arrives as a tome) and the loot box
 * open engine (a `spell` prize is a tome, 7.3 D4). Built through `buildPayload('loot', ...)` like any user-made loot.
 */
import { buildPayload } from './builders/item-payload.mjs';

/**
 * @param {{ name: string, identifier: string }} spell the spell the tome teaches
 * @param {number} [rank=1] the Rank taught (floored at 1)
 * @param {{ warnings?: Array<{path: string, message: string, code: string}> }} [options] passed to `buildPayload`
 * @returns {object} the loot creation payload
 */
export function tomePayload(spell, rank = 1, { warnings = [] } = {}) {
  const taught = Math.max(1, Math.floor(Number(rank)) || 1);
  return buildPayload('loot', {
    name: `Tome of ${spell.name}`,
    system: {
      quantity: 1, lootType: 'consumable', executionMode: 'all',
      outcomes: [{ name: `Learn ${spell.name}`, type: 'learn_spell', spellIdentifier: spell.identifier, rank: taught, weight: 1 }],
      notes: `Read to learn ${spell.name} at Rank ${taught}. Can be traded or sold.`
    }
  }, { warnings });
}
