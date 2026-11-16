/**
 * What a check card stores so a later reroll or degree shift can read how it was rolled: the roll's context
 * (`flags.<system>.checkContext`) and the uuid of the skill, weapon or spell rolled (the record's `itemUuid`; '' for a
 * Stat check or an Evade). The five roll paths spread `flags` into the card's flags and pass `itemUuid` to
 * `buildCheckRecord`.
 */
import { serializeRollContext } from '../../utils/roll/roll-context.mjs';

/** The card flag that holds the roll's serialized context. */
export const CHECK_CONTEXT_FLAG = 'checkContext';

/**
 * @param {object} rollContext the roll's RollContext
 * @param {{ uuid?: string }|null} [item] the skill, weapon or spell rolled
 * @returns {{ flags: { checkContext?: object }, itemUuid: string }}
 */
export function checkRerollStamp(rollContext, item = null) {
  return { flags: { [CHECK_CONTEXT_FLAG]: serializeRollContext(rollContext) }, itemUuid: typeof item?.uuid === 'string' ? item.uuid : '' };
}
