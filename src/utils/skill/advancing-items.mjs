/**
 * The owned items that advance in Ranks: Skills, and Spells ("in the ways that count" a Spell is a special type of Skill).
 * Pure: no Foundry, no I/O.
 */
import { hasRuleFlag, RULE_FLAGS } from '../tag/tag-behaviour.mjs';
import { spellMakesCheck } from '../tag/tag-mechanics.mjs';

/**
 * The actor's items that can advance (a `no-ranks` core action never does): Skills first, then Spells.
 * @param {object} actor
 * @returns {object[]}
 */
export function advancingItemsOf(actor) {
  const items = Array.from(actor?.items ?? []).filter(i => !hasRuleFlag(i, RULE_FLAGS.noRanks));
  const skills = items.filter(i => i.type === 'skill');
  return [...skills, ...items.filter(i => i.type === 'spell')];
}

/**
 * Whether casting this spell takes the Used mark: the spell makes a Check, and the cast is the caster's
 * own (a scroll or an item that casts it carries the spell itself, so the reader has no Spell to mark).
 * @param {object} spell
 * @param {object} [opts] the cast's options (`originItem`, `isConsumable`, `isItemEffect` mark a cast carried by an item)
 */
export function castTakesMark(spell, opts = {}) {
  const carried = Boolean(opts?.originItem || opts?.isConsumable || opts?.isItemEffect);
  return !carried && spellMakesCheck(spell);
}
