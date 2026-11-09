/**
 * Display helpers for attack rows on the crawler sheet.
 * Re-exported from `src/sheets/crawler-sheet.mjs`.
 */
import { resolveAttackToHit } from '../../utils/attack/to-hit-display.mjs';
import { cooldownBadge } from '../../utils/time/cooldown-badge.mjs';
import { currentTimeContext } from '../../documents/actor/dungeon-time.mjs';
import { attackEffectsText } from '../../utils/attack/attack-mechanics.mjs';
import { conditionLabel } from '../../documents/actor/condition-data.mjs';
import { attackDamageDisplay } from '../../utils/damage/damage-parts.mjs';

/**
 * Prepares consistent display properties for attack table rows
 * (supporting both native attack items and equipped weapon gear).
 * @param {object} item 
 * @param {object} actor 
 * @returns {object}
 */
export function prepareAttackDisplay(item, actor) {
  const sys = item.system || {};
  const isGear = item.type === 'gear';
  // To-Hit: the roll's stat and everything the roll would add with no toggle ticked (3.10), shared with the attack profiles
  const { toHitRank, toHitStat, hit } = resolveAttackToHit(item, actor);

  // Gear weapons get their badge from the inventory context; an attack item gets it here.
  if (item.type === 'attack' && actor) item.cooldownBadge = cooldownBadge(actor, item, currentTimeContext(actor));
  item.toHitStat = toHitStat;
  item.statMod = hit.statMod;
  item.toHitRank = toHitRank;
  item.toHitMod = hit.total;
  item.toHitDiceParts = hit.diceParts;
  item.displayToHitStat = toHitStat.toUpperCase();
  item.displayToHitRank = toHitRank;
  item.displayToHit = `${item.displayToHitStat} (${toHitRank})`;
  item.toHitFormula = hit.formula;
  item.displayToHitFormula = hit.formula;

  // Damage formula display
  item.displayDamage = attackDamageDisplay(item, actor);

  item.displayEffects = attackEffectsText(item, { labelOf: conditionLabel });
  item.isWeaponGear = isGear;
  item.isAttackEquipped = sys.equipped !== false;

  const favor = typeof actor?.getAiFavorRating === 'function' ? actor.getAiFavorRating(item) : null;
  item.favorConditional = favor?.conditional ?? [];

  return item;
}
