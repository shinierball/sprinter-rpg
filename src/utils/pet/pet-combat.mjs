/**
 * Pet and mount combat rules: the mounted-only weapon check and what stops a pet being ridden (the rider's roll tag and
 * label are in `pet-riding.mjs`). The pet twin of `utils/vehicle/vehicle-combat.mjs`; nothing here writes or blocks (Directive 2).
 *
 * Only the attack gate and the companion code import it; the roll collectors must not (it reads the tag hub), so they use
 * `pet-riding.mjs`. It reads `vehicle-lookup`, not `vehicle-combat`, for the same reason.
 */
import { mountOf } from './pet-lookup.mjs';
import { vehicleOf } from '../vehicle/vehicle-lookup.mjs';
import { getSizeInfo } from '../../data/sizes.mjs';
import { hasRuleFlag, RULE_FLAGS } from '../tag/tag-behaviour.mjs';
import { confirmRuleBreak } from '../rule-break.mjs';
import { escapeAttr } from '../escape-attr.mjs';

/**
 * Why an attack with a mounted-only weapon is owed a Rule Break: the item carries the `mounted-only` rule flag and its user
 * neither rides a pet nor is aboard a vehicle.
 * @param {Actor|null} actor
 * @param {object|null} item
 * @returns {string|null}
 */
function mountedOnlyCause(actor, item) {
  if (!actor || !item) return null;
  if (!hasRuleFlag(item, RULE_FLAGS.mountedOnly)) return null;
  if (mountOf(actor) || (actor.type !== 'mount_vehicle' && vehicleOf(actor))) return null;
  return `${actor.name || 'The attacker'} is not mounted. Attack with the ${item.name || 'weapon'} anyway as a Rule Break?`;
}

/**
 * The Rule Break gate for a mounted-only weapon used unmounted (never a block).
 * @param {Actor} actor the attacker
 * @param {object} item the attack item
 * @param {{ options?: object }} [params] the attack's options (`ruleBreak`, `interactive`)
 * @returns {Promise<{ proceed: boolean, ruleBreak: boolean, flags: object }>}
 */
export async function gateMountedOnly(actor, item, { options = {} } = {}) {
  const none = { proceed: true, ruleBreak: false, flags: {} };
  const reason = mountedOnlyCause(actor, item);
  if (!reason) return none;
  const message = `${escapeAttr(actor.name || 'The attacker')} is not mounted. Attack with the ${escapeAttr(item.name || 'weapon')} anyway as a Rule Break?`;
  const verdict = await confirmRuleBreak({ title: 'Not mounted', message, reason, options });
  if (!verdict.confirmed) return { proceed: false, ruleBreak: false, flags: {} };
  return { proceed: true, ruleBreak: true, flags: { ruleBreak: true } };
}

const sizeValueOf = (actor) => actor?.system?.attributes?.sizeNumber ?? (getSizeInfo(actor?.system?.attributes?.size)?.size || 4);

/** True when the pet wears a saddle: any tag on it, or on gear it wears, with the `mount` rule flag (a magical saddle carries one). */
const wearsSaddle = (pet) => hasRuleFlag(pet, RULE_FLAGS.mount);

/**
 * Why a crawler may not ride this pet by the book: the mount is not at least one size class larger than its rider (even a
 * dedicated mount), and a pet that is not a dedicated mount wears no saddle (a magical saddle, or any `mount` rule flag).
 * An empty list means no problem. `assignRider` asks a Rule Break when there are any.
 * @param {Actor} pet
 * @param {Actor} crawler
 * @returns {string[]}
 */
export function rideProblems(pet, crawler) {
  const problems = [];
  if (!pet || !crawler) return problems;
  if (!(sizeValueOf(pet) > sizeValueOf(crawler))) problems.push(`${pet.name || 'The mount'} is not one size class larger than ${crawler.name || 'the rider'}.`);
  if (pet.system?.details?.isMount !== true && !wearsSaddle(pet)) problems.push(`${pet.name || 'The pet'} wears no saddle.`);
  return problems;
}
