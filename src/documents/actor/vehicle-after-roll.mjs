/**
 * After-roll offers on a vehicle check card: what a card knows (`vehicleCardInfo`), and using an offer (a reroll, or a degree
 * shift the GM applies).
 *
 * Imports no sheet and not `actor.mjs`.
 */
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { buildRollContext } from '../../utils/roll/roll-context.mjs';
import { readCheckRecord, effectiveCheck, isSuccessOutcome } from '../../utils/roll/check-assists.mjs';
import { OUTCOME_TAGS } from '../../utils/tag/tag-mechanics.mjs';
import { skillStandIn } from '../../utils/skill/skill-stand-in.mjs';
import { vehicleCheckSetup, vehicleCheckKeys, withVehicleSources, sanitizeShifts } from '../../utils/vehicle/vehicle-check.mjs';
import { afterRollOffers, offerByKey } from '../../utils/roll/after-roll.mjs';
import { gateItemCooldown } from './cooldown-gate.mjs';
import { changeVehicleCrew } from './vehicle-crew.mjs';
import { findContestMessage } from '../../chat/contest-service.mjs';
import { userOwnsActor } from './personal-space-links.mjs';
import { VEHICLE_CHECK_KINDS } from '../../data/rules/vehicle-rules.mjs';
import { str, cardFlag, VEHICLE_CARD_FLAGS, requestVehicleDrive } from './vehicle-drive-common.mjs';
import { cardOutcome } from './vehicle-checks.mjs';

/**
 * What a vehicle check card knows: the record, its roller and vehicle, the degree now and the offers the roller's rows and
 * the vehicle's make. Shared by the card's render and by the click handlers, which recompute it (nothing is trusted from the DOM).
 * @param {object} message
 * @returns {{ record: object, ref: object, roller: object, vehicle: object, outcome: string|null, offers: object[], spent: string[] }|null}
 */
export function vehicleCardInfo(message) {
  const record = readCheckRecord(message);
  const ref = record?.vehicle;
  if (!ref) return null;
  const roller = resolveActorByUuid(record.rollerUuid);
  const vehicle = resolveActorByUuid(ref.vehicleUuid);
  if (!roller || vehicle?.type !== 'mount_vehicle') return null;
  const shifts = sanitizeShifts(cardFlag(message, VEHICLE_CARD_FLAGS.shifts));
  const used = Array.isArray(cardFlag(message, VEHICLE_CARD_FLAGS.used)) ? cardFlag(message, VEHICLE_CARD_FLAGS.used) : [];
  const spent = [...used, ...shifts.map((s) => s.rowKey)];
  const outcome = cardOutcome(message);
  const def = VEHICLE_CHECK_KINDS[ref.kind];
  let offers = [];
  // A Table 6 card that is no longer the stored result cannot use an offer: its reroll or shift would be skipped as stale.
  const storedId = str(vehicle.system.drive?.result?.messageId);
  const stale = def?.resolve === 'table6' && Boolean(storedId) && storedId !== message.id;
  if (outcome && def && !stale) {
    const setup = vehicleCheckSetup(roller, { ...ref, tag: def.tag });
    const skill = ref.skill ? roller.getSkillByIdentifier?.(ref.skill) ?? null : null;
    const context = withVehicleSources(buildRollContext({
      actor: roller, phase: 'check', item: skill, check: vehicleCheckKeys(ref.skill ? 'skill' : 'stat', ref), other: null,
      tags: [...setup.tags, OUTCOME_TAGS[outcome]].filter(Boolean)
    }), setup);
    offers = afterRollOffers(roller, context, { extraSources: setup.extraSources, outcome, used: spent })
      .filter((o) => o.kind !== 'degreeShift' || def.resolve === 'table6')
      // A leg reroll goes through the contest's own leg roll, so it needs the contest card.
      .filter((o) => o.kind !== 'reroll' || !record.contest?.messageId || Boolean(findContestMessage(record.contest.messageId)));
  }
  return { record, ref, roller, vehicle, outcome, offers, spent };
}

export const findCarrier = (info, offer) => {
  for (const actor of [info.roller, info.vehicle]) {
    const item = Array.from(actor.items ?? []).find((i) => (offer.itemUuid && i.uuid === offer.itemUuid) || (offer.itemId && i.id === offer.itemId));
    if (item) return item;
  }
  return null;
};

/** Run the same check again as the reroll offer says: same skill, same vehicle, same Difficulty, linked to the card it replaces. */
async function rerollVehicleCheck(info, message, offer) {
  const contest = info.record.contest;
  if (contest?.messageId) {
    // A contest leg rerolls through the leg roll, which carries `options.contest` (the Move Rate line and the leg's reference).
    const { rollContestLeg } = await import('../../chat/contest-ingest.mjs');
    const leg = await rollContestLeg({ message: findContestMessage(contest.messageId), legId: contest.legId, participantId: contest.participantId, skillId: info.ref.skill || null });
    return leg.message ?? null;
  }
  const ref = { ...info.ref, rerollOf: message.id, rerollKey: offer.rowKey };
  const skill = ref.skill ? skillStandIn(info.roller, ref.skill) : null;
  return skill ? info.roller.rollSkill(skill, { vehicle: ref }) : info.roller.rollStat(ref.stat || 'dex', { vehicle: ref });
}

/**
 * Use one after-roll offer of a vehicle check card. Gates the source item's cooldown first (a Rule Break when it is on
 * cooldown; declining keeps the card as it was), then rerolls the check or asks the GM to shift its degree.
 * @param {object} message the card
 * @param {string} rowKey the offer's row key
 * @param {{ interactive?: boolean, ruleBreak?: boolean }} [options] go to the cooldown Rule Break confirm
 * @returns {Promise<{ ok: boolean, reason?: string, message?: object }>}
 */
export async function useAfterRollOffer(message, rowKey, options = {}) {
  const info = vehicleCardInfo(message);
  if (!info) return { ok: false, reason: 'no-card' };
  const user = globalThis.game?.user;
  if (!userOwnsActor(info.roller, user)) return { ok: false, reason: 'forbidden' };
  const offer = offerByKey(info.offers, str(rowKey));
  if (!offer) return { ok: false, reason: 'no-offer' };
  const item = findCarrier(info, offer);
  const shifting = offer.kind === 'degreeShift';
  if (item) {
    const gate = await gateItemCooldown(info.roller, item, { options });
    if (!gate.proceed) return { ok: false, reason: 'cooldown-declined' };
    // A shift records its own use on the GM (`applyShift` gates the carrier again); a reroll records it here.
    if (!shifting) {
      if (item.parent && !userOwnsActor(item.parent, user)) {
        const reply = await requestVehicleDrive(info.vehicle, 'useItem', { itemId: item.id, messageId: message.id, rowKey: offer.rowKey });
        if (!reply.ok) return { ok: false, reason: reply.reason ?? 'error' };
      } else {
        await gate.commit();
      }
    }
  }
  if (shifting) {
    const reply = await requestVehicleDrive(info.vehicle, 'shift', { messageId: message.id, rowKey: offer.rowKey });
    return { ok: reply.ok, reason: reply.reason };
  }
  const rolled = await rerollVehicleCheck(info, message, offer);
  if (!rolled) return { ok: false };
  // The row is spent on the card it rerolled, whatever the kind (a Table 6 ingest marks it too, once).
  await requestVehicleDrive(info.vehicle, 'spend', { messageId: message.id, rowKey: offer.rowKey });
  if (info.ref.kind === 'board') await embarkAfterReroll(info, rolled);
  return { ok: true, message: rolled };
}

/** A rerolled boarding check that was made puts the boarder aboard (no Rule Break); a failed one leaves them off. */
async function embarkAfterReroll(info, rolled) {
  const record = readCheckRecord(rolled);
  if (!record || !isSuccessOutcome(effectiveCheck(record)?.outcome)) return;
  if ((info.vehicle.system?.occupants ?? []).some((o) => o?.uuid === info.roller.uuid)) return;
  await changeVehicleCrew(info.vehicle, info.roller, 'embark', { boardCheck: 'skip' });
}
