/**
 * What a vehicle check card knows (`vehicleCardInfo`): its record, roller and vehicle. The after-roll offers of a card are
 * `checkCardInfo` in `check-after-roll.mjs`.
 *
 * Imports no sheet and not `actor.mjs`.
 */
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { readCheckRecord } from '../../utils/roll/check-assists.mjs';
import { cardOutcome } from './vehicle-checks.mjs';

/**
 * What a vehicle check card knows: the record, its roller and vehicle and the degree now. Shared by the card's render and by
 * the click handlers, which recompute it (nothing is trusted from the DOM).
 * @param {object} message
 * @returns {{ record: object, ref: object, roller: object, vehicle: object, outcome: string|null }|null}
 */
export function vehicleCardInfo(message) {
  const record = readCheckRecord(message);
  const ref = record?.vehicle;
  if (!ref) return null;
  const roller = resolveActorByUuid(record.rollerUuid);
  const vehicle = resolveActorByUuid(ref.vehicleUuid);
  if (!roller || vehicle?.type !== 'mount_vehicle') return null;
  return { record, ref, roller, vehicle, outcome: cardOutcome(message) };
}
