/**
 * A fall (core p. 76): the GM's Harsh Conditions dialog posts one ordinary damage card per faller, 1d6 Bludgeoning per 10 feet
 * (at most 20d6) with the prone state riding on its Apply, and a "Land prone only" button for a fall too short to hurt.
 * Each card is bound to its faller (`data-bound-target-uuid`), so its buttons never land on anyone else. Nothing is applied
 * until the GM presses a button; a faller with `perk.no_fall_damage` gets a note and the GM decides (Directive 2).
 *
 * Imports no sheet and not `actor.mjs`.
 */
import { firstScalar } from '../../utils/first-scalar.mjs';
import { langText } from '../../utils/lang-text.mjs';
import { buildRollContext } from '../../utils/roll/roll-context.mjs';
import { vehicleDamageCardHtml } from '../../utils/vehicle/vehicle-damage-card.mjs';
import { FALL_DAMAGE_TYPE, FALL_LANDING_CONDITION, fallFormula } from '../../data/rules/falling.mjs';
import { collectActorTags } from '../active-tags.mjs';
import { NO_FALL_DAMAGE_TAG } from '../../utils/tag/tag-mechanics.mjs';
import { speakerOf } from './vehicle-drive-common.mjs';

/** English fallbacks of the `COG.HarshConditions.*` keys used here (the headless test world has no i18n). */
const fallText = langText({
  'COG.HarshConditions.FallTitle': '{name} falls {feet} ft',
  'COG.HarshConditions.FallItem': 'Falling',
  'COG.HarshConditions.LandProne': 'Land prone only',
  'COG.HarshConditions.NoFallDamage': '{name} takes no damage from falling. The GM decides.'
});

/**
 * Post the fall card of one faller. GM only.
 * @param {Actor} actor the faller
 * @param {number|string} feet how far; a whole number of feet, never below 0
 * @returns {Promise<ChatMessage|null>} null when the user is not the GM
 */
export async function postFallDamage(actor, feet) {
  if (!globalThis.game?.user?.isGM || !actor) return null;
  const fallen = Math.max(0, Math.trunc(Number(firstScalar(feet, 0))) || 0);
  const { formula } = fallFormula(fallen);
  const roll = formula ? await new Roll(formula).evaluate() : null;
  const total = Math.max(0, Number(roll?.total) || 0);
  const name = actor.name ?? '';
  const notes = collectActorTags(actor).has(NO_FALL_DAMAGE_TAG) ? [fallText('COG.HarshConditions.NoFallDamage', { name })] : [];
  const content = vehicleDamageCardHtml({
    attackerUuid: '',
    itemName: fallText('COG.HarshConditions.FallItem'),
    title: fallText('COG.HarshConditions.FallTitle', { name, feet: fallen }),
    parts: [{ type: FALL_DAMAGE_TYPE, finalDamage: total, baseTotal: total, formula }],
    rollContext: buildRollContext({ actor: null, phase: 'damage', other: actor }),
    debuffs: [FALL_LANDING_CONDITION],
    boundTargetUuid: actor.uuid,
    notes,
    extraButtons: [{
      label: fallText('COG.HarshConditions.LandProne'),
      action: 'crawlerApplyCondition',
      data: { 'condition-tag': FALL_LANDING_CONDITION }
    }]
  });
  return globalThis.ChatMessage.create({ speaker: speakerOf(actor), content, rolls: roll ? [roll] : [] });
}
