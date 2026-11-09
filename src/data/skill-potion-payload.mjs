/**
 * The skill potion loot item: a one-use consumable whose `skill_rank` outcome adds Ranks to a skill (`increaseSkillRank`
 * runs it on Use). Shared by the Floor Simulator (its Starting Loot "+3 Skill Potion") and the loot box open engine (a
 * picked `skill` of a `choice` row, 7.3i). Built through `buildPayload('loot', ...)` like any user-made loot.
 */
import { buildPayload } from './builders/item-payload.mjs';

/**
 * @param {{ name: string, identifier: string }} skill the skill the potion trains
 * @param {number} [ranks=1] the Ranks added (floored at 1)
 * @param {{ name?: string, warnings?: Array<{path: string, message: string, code: string}> }} [options]
 *   `name` is the potion's name ('' = "Skill Potion: <Skill>"); `warnings` is passed to `buildPayload`
 * @returns {object} the loot creation payload
 */
export function skillPotionPayload(skill, ranks = 1, { name = '', warnings = [] } = {}) {
  const added = Math.max(1, Math.floor(Number(ranks)) || 1);
  const skillName = String(skill?.name ?? '').trim() || String(skill?.identifier ?? '');
  const identifier = String(skill?.identifier ?? '');
  return buildPayload('loot', {
    name: String(name ?? '').trim() || `Skill Potion: ${skillName}`,
    system: {
      quantity: 1, lootType: 'consumable', usedInto: 'empty-bottle', executionMode: 'all',
      notes: `Permanently adds ${added} Ranks to ${skillName}.`,
      outcomes: [{ name: 'Study', type: 'skill_rank', skillIdentifier: identifier, skillName, rankBonus: added, targetType: 'self' }]
    }
  }, { warnings });
}
