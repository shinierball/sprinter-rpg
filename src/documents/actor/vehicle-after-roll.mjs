/**
 * After-roll offers on a vehicle check card: what a card knows (`vehicleCardInfo`).
 *
 * Imports no sheet and not `actor.mjs`.
 */
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { readCheckRecord } from '../../utils/roll/check-assists.mjs';
import { OUTCOME_TAGS } from '../../utils/tag/tag-mechanics.mjs';
import { vehicleCheckSetup } from '../../utils/vehicle/vehicle-check.mjs';
import { afterRollOffers } from '../../utils/roll/after-roll.mjs';
import { findContestMessage } from '../../chat/contest-service.mjs';
import { VEHICLE_CHECK_KINDS } from '../../data/rules/vehicle-rules.mjs';
import { str } from './vehicle-drive-common.mjs';
import { cardOutcome } from './vehicle-checks.mjs';
import { vehicleAfterRollContext } from './check-after-roll.mjs';

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
  const spent = [...record.offersUsed, ...record.shifts.map((s) => s.rowKey)];
  const outcome = cardOutcome(message);
  const def = VEHICLE_CHECK_KINDS[ref.kind];
  let offers = [];
  // A Table 6 card that is no longer the stored result cannot use an offer: its reroll or shift would be skipped as stale.
  const storedId = str(vehicle.system.drive?.result?.messageId);
  const stale = def?.resolve === 'table6' && Boolean(storedId) && storedId !== message.id;
  if (outcome && def && !stale) {
    const setup = vehicleCheckSetup(roller, { ...ref, tag: def.tag });
    const context = vehicleAfterRollContext({ roller, ref, setup, outcomeTag: OUTCOME_TAGS[outcome] });
    offers = afterRollOffers(roller, context, { extraSources: setup.extraSources, outcome, used: spent })
      .filter((o) => o.kind !== 'degreeShift' || def.resolve === 'table6')
      // A leg reroll goes through the contest's own leg roll, so it needs the contest card.
      .filter((o) => o.kind !== 'reroll' || !record.contest?.messageId || Boolean(findContestMessage(record.contest.messageId)));
  }
  return { record, ref, roller, vehicle, outcome, offers, spent };
}
