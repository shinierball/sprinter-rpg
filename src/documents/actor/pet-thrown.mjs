/**
 * "Thrown" (core book p. 232): a rider who Fails the riding check may be thrown, for 1d6 Bludgeoning per 10 ft of the mount's
 * Move plus its size value. Whether the rider is thrown is the GM's click on the riding card; this posts the damage card (the
 * ordinary damage card, the rider's token targeted) once per riding card. Nothing here blocks anything (Directive 2).
 *
 * Imports no sheet and not `actor.mjs`.
 */
import { flagPath, readFlag, withFlags } from '../../utils/flags.mjs';
import { resolveActorByUuid, findTokenByActorUuid } from '../../utils/actor-uuid.mjs';
import { readCheckRecord, effectiveCheck } from '../../utils/roll/check-assists.mjs';
import { buildRollContext } from '../../utils/roll/roll-context.mjs';
import { vehicleDamageCardHtml } from '../../utils/vehicle/vehicle-damage-card.mjs';
import { isTrustedAssist } from '../../chat/actions/use-assist.mjs';
import { actorSizeNumber } from '../../data/sizes.mjs';
import { THROWN_DAMAGE_TYPE, riderMayBeThrown, thrownFormula } from '../../data/rules/pet-rules.mjs';
import { speakerOf } from './vehicle-drive-common.mjs';
import { creatureMoveOf } from './actor-move.mjs';

/** The card flag the GM's click leaves on a riding card (a second click throws nobody again), and on the damage card. */
export const PET_THROWN_FLAG = 'petThrown';

/**
 * What a riding card says about being thrown, read from the card itself (never from a button): the riding check's pet and
 * roller, and whether its degree is a Fail. Null for any card that is not a riding check or whose roller does not check out.
 * @param {object} message
 * @returns {{ pet: Actor, rider: Actor, outcome: string, mayBeThrown: boolean }|null}
 */
export function ridingCardInfo(message) {
  const record = readCheckRecord(message);
  const ref = record?.pet;
  if (ref?.kind !== 'ride') return null;
  const pet = resolveActorByUuid(ref.petUuid);
  const rider = resolveActorByUuid(record.rollerUuid);
  if (pet?.type !== 'pet' || !rider || !isTrustedAssist(message, rider)) return null;
  const eff = effectiveCheck(record);
  if (!eff || eff.pending) return { pet, rider, outcome: '', mayBeThrown: false };
  return { pet, rider, outcome: eff.outcome, mayBeThrown: riderMayBeThrown(eff.outcome) };
}

/**
 * The GM's "Thrown" on a failed riding card: roll `thrownFormula` for the mount (its Move now, rider bonuses included, and its
 * size value) and post it as a damage card against the rider, whose token is targeted. Once per card.
 * @param {object} message the riding card
 * @returns {Promise<ChatMessage|null>} null when nothing was thrown
 */
export async function throwRiderFromCard(message) {
  if (!globalThis.game?.user?.isGM) return null;
  const info = ridingCardInfo(message);
  if (!info?.mayBeThrown) return null;
  if (readFlag(message, PET_THROWN_FLAG)) return null;
  const { pet, rider } = info;
  const spec = thrownFormula({ move: creatureMoveOf(pet).rated, sizeNumber: actorSizeNumber(pet) });
  const roll = await new Roll(spec).evaluate();
  const total = Math.max(0, Number(roll.total) || 0);
  await message.update({ [flagPath(PET_THROWN_FLAG)]: true });
  const token = findTokenByActorUuid(globalThis.canvas?.tokens?.placeables ?? [], rider.uuid);
  token?.setTarget?.(true, { releaseOthers: true });
  const context = buildRollContext({ actor: pet, phase: 'damage', other: rider });
  const content = vehicleDamageCardHtml({
    attackerUuid: pet.uuid, itemName: 'Thrown', title: `${rider.name ?? 'The rider'} is thrown from ${pet.name ?? 'the mount'}`,
    parts: [{ type: THROWN_DAMAGE_TYPE, finalDamage: total, baseTotal: total, formula: spec }], rollContext: context
  });
  return globalThis.ChatMessage.create(withFlags({
    speaker: speakerOf(pet), content, rolls: [roll]
  }, { [PET_THROWN_FLAG]: { petUuid: pet.uuid, riderUuid: rider.uuid, damage: total } }));
}
