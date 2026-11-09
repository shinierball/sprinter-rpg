/**
 * Vehicle driving checks: the operate skill and the roll (3.44d), Table 6 settling the stored result, and the check card's
 * flags and the GM's ingest of it.
 *
 * Imports no sheet and not `actor.mjs`.
 */
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { isActiveGM } from '../../utils/gm-relay.mjs';
import { runKeyed } from '../../utils/keyed-queue.mjs';
import { readCheckRecord, effectiveCheck, isSuccessOutcome } from '../../utils/roll/check-assists.mjs';
import { getItemAllTags } from '../active-tags.mjs';
import { skillStandInByQuery } from '../../utils/skill/skill-stand-in.mjs';
import { vehicleCheckDifficulty, applyShifts, sanitizeShifts } from '../../utils/vehicle/vehicle-check.mjs';
import { addAiFavor } from '../../chat/actions/ai-favor-tally.mjs';
import { isTrustedAssist } from '../../chat/actions/use-assist.mjs';
import { getCurrentFloor } from './actor-environment.mjs';
import { availableMove, operateQueryFor, pickOperateSkill, resultEffect, resultDelta, VEHICLE_CHECK_KINDS } from '../../data/rules/vehicle-rules.mjs';
import { vehicleNow, vehicleMoveOf } from './vehicle-move.mjs';
import { wholeFeet, str, say, messageById, cardFlag, cardKey, VEHICLE_CARD_FLAGS } from './vehicle-drive-common.mjs';

/** The skill items of an actor as `pickOperateSkill` entries: tags and Modified Rank. */
function skillEntries(actor) {
  const items = Array.from(actor?.items ?? []).filter((i) => i?.type === 'skill');
  return items.map((item) => ({
    item,
    tags: [...getItemAllTags(item)],
    rank: Number(item.modifiedRank ?? item.system?.modifiedRank ?? item.system?.rank) || 0
  }));
}

/**
 * The skill `actor` rolls to operate `vehicle`: among the actor's skills whose tags match the vehicle's query (its own
 * `operateSkills`, else its kind's), the highest Modified Rank; none owned gives the untrained stand-in of the first
 * catalog skill that matches. Never found by name. Null when nothing matches (the caller rolls a stat check).
 * @param {Actor} actor
 * @param {Actor} vehicle
 * @returns {object|null} an owned skill item or a stand-in
 */
export function operateSkillFor(actor, vehicle) {
  const query = operateQueryFor(vehicle?.system);
  const picked = pickOperateSkill(skillEntries(actor), query);
  if (picked?.item) return picked.item;
  return skillStandInByQuery(actor, query);
}

/**
 * Roll a check to operate a vehicle: the driver's operate skill (a Dex check when the world has no skill for the kind)
 * with a `vehicle` reference, so the card reaches the GM's ingest. The Difficulty defaults from the kind.
 * @param {Actor} vehicle
 * @param {Actor} actor the roller
 * @param {{ kind?: string, dc?: number|null, targetUuids?: string[], headOn?: boolean, ram?: boolean, interactive?: boolean,
 *   ruleBreak?: boolean }} [options] `ram` marks an Evade against a ram, so the check also carries `vehicle.check.ram`;
 *   `interactive` / `ruleBreak` drive the not-the-driver confirm
 * @returns {Promise<ChatMessage|undefined>}
 */
export async function rollVehicleCheck(vehicle, actor, { kind = 'performance', dc, targetUuids = [], headOn = false, ram = false, interactive, ruleBreak } = {}) {
  if (vehicle?.type !== 'mount_vehicle' || !actor) return undefined;
  // R-d: operating a vehicle you are not driving is a Rule Break. Boarding it is a Dex check by anyone, so it is exempt.
  if (kind !== 'board' && str(vehicle.system?.pilotUuid) !== actor.uuid) {
    const message = `${actor.name} is not driving ${vehicle.name}. Roll the check as a Rule Break?`;
    const verdict = await confirmRuleBreak({
      title: say('COG.Vehicle.NotDriver.Title', 'Not the driver'), message, reason: message, options: { interactive, ruleBreak }
    });
    if (!verdict.confirmed) return null;
  }
  const state = { currentMove: wholeFeet(vehicle.system?.drive?.currentMove), floor: getCurrentFloor() };
  const ref = {
    vehicleUuid: vehicle.uuid, kind, targetUuids, headOn, ram,
    dc: dc === undefined ? vehicleCheckDifficulty(kind, state) : dc
  };
  const skill = operateSkillFor(actor, vehicle);
  return skill ? actor.rollSkill(skill, { vehicle: ref }) : actor.rollStat('dex', { vehicle: ref });
}

const NO_EFFECT = Object.freeze({ damagePercent: 0, aiFavor: 0, nextAdvantage: false, choice: '' });

const favorReason = (outcome) => `Vehicle check (${outcome})`;

const sameResult = (prev, next) => (Number(prev.setAt) || 0) === next.setAt && ['outcome', 'choice', 'combatId', 'messageId', 'driverUuid'].every((k) => str(prev[k]) === next[k])
  && (prev.round ?? null) === next.round && (prev.gm === true) === next.gm && (prev.ruleBreak === true) === next.ruleBreak
  && (Number(prev.applied?.damage) || 0) === next.applied.damage && (Number(prev.applied?.aiFavor) || 0) === next.applied.aiFavor;

/**
 * Write the vehicle's stored Table 6 result and everything it implies: damage and AI Favor as the change against what was
 * already applied (so a changed choice, shift or reroll never double-counts), the speed clamped to the new available Move,
 * and the Advantage an Amazing Success owes the driver. One write; nothing is written when nothing changed.
 * @param {Actor} vehicle
 * @param {object} p
 * @param {string} p.outcome a Table 6 degree id, '' to clear
 * @param {string} [p.choice] a Critical choice id
 * @param {string} [p.messageId] the card the result came from
 * @param {string} [p.driverUuid]
 * @param {boolean} [p.gm] set by the GM's override, not a roll
 * @param {boolean} [p.ruleBreak]
 * @param {{ combatId?: string, round?: number|null }} [p.now] the combat round the result belongs to
 * @param {boolean} [p.consumeAdvantage] the card's roll used the Advantage this driver was owed
 * @param {number} [p.setAt] the time of a GM's override or clear; an older card cannot replace it
 * @returns {Promise<{ changed: boolean, choice: string, effect: object }>}
 */
export async function settleVehicleResult(vehicle, { outcome = '', choice = '', messageId = '', driverUuid = '', gm = false, ruleBreak = false, now, consumeAdvantage = false, setAt = 0 } = {}) {
  const system = vehicle.system ?? {};
  const prev = system.drive?.result ?? {};
  const prevApplied = { damage: Number(prev.applied?.damage) || 0, aiFavor: Number(prev.applied?.aiFavor) || 0 };
  const effect = outcome ? resultEffect(outcome, choice) : NO_EFFECT;
  const maxHp = Number(system.attributes?.hp?.max) || 0;

  // A new driver takes over a result: the AI Favor the old one was given goes back first.
  let appliedFavor = prevApplied.aiFavor;
  const prevDriver = resolveActorByUuid(prev.driverUuid);
  if (appliedFavor > 0 && prev.driverUuid && prev.driverUuid !== driverUuid && prevDriver) {
    if (await addAiFavor(prevDriver, -appliedFavor, favorReason('undone'), { interactive: false })) appliedFavor = 0;
  }
  const delta = resultDelta({ damage: prevApplied.damage, aiFavor: appliedFavor }, effect, maxHp);
  const driver = resolveActorByUuid(driverUuid);
  let favorNow = appliedFavor;
  if (delta.aiFavor === 0) favorNow = delta.next.aiFavor;
  else if (driver && await addAiFavor(driver, delta.aiFavor, favorReason(outcome || 'cleared'), { interactive: false })) favorNow = delta.next.aiFavor;

  const here = now ?? {};
  const round = here.round === null || here.round === undefined || !Number.isFinite(Number(here.round)) ? null : Number(here.round);
  const next = {
    outcome, choice: effect.choice, combatId: str(here.combatId), round,
    messageId, driverUuid, applied: { damage: delta.next.damage, aiFavor: favorNow }, gm, ruleBreak, setAt: Number(setAt) || 0
  };
  const update = {};
  if (!sameResult(prev, next)) update['system.drive.result'] = next;

  if (delta.damage !== 0) {
    const hp = Number(system.attributes?.hp?.value);
    const base = Number.isFinite(hp) ? hp : maxHp;
    update['system.attributes.hp.value'] = Math.max(0, Math.min(maxHp, base - delta.damage));
  }

  // Advantage: set by an Amazing Success, spent by the next operate check, and withdrawn if the result that gave it changes.
  const owed = str(system.drive?.advantageFor);
  const prevGaveAdvantage = prev.outcome ? resultEffect(prev.outcome, prev.choice).nextAdvantage : false;
  let advantageFor = owed;
  if (consumeAdvantage && owed === driverUuid) advantageFor = '';
  if (prevGaveAdvantage && owed && owed === str(prev.driverUuid) && !effect.nextAdvantage) advantageFor = '';
  if (effect.nextAdvantage && driverUuid) advantageFor = driverUuid;
  if (advantageFor !== owed) update['system.drive.advantageFor'] = advantageFor;

  // The speed never stays above what this round's Move allows.
  const nowKey = { combatId: next.combatId, round: next.round };
  const { rated } = vehicleMoveOf(vehicle, { now: nowKey });
  const available = availableMove({ rated, result: outcome ? next : null, now: nowKey });
  if (wholeFeet(system.drive?.currentMove) > available) update['system.drive.currentMove'] = available;

  if (!Object.keys(update).length) return { changed: false, choice: effect.choice, effect };
  await vehicle.update(update);
  return { changed: true, choice: effect.choice, effect };
}

/** The combat round a card's roll was made in, else the running combat now. */
function recordNow(record) {
  return record.combatId ? { combatId: record.combatId, round: record.round } : vehicleNow();
}

/** Show the settled degree and choice on the card (written only when it differs, so the update hook stops). */
export async function syncCard(message, { outcome, choice, note = '' }) {
  const current = cardFlag(message, VEHICLE_CARD_FLAGS.result) ?? {};
  if (current.outcome === outcome && (current.choice ?? '') === choice && (current.note ?? '') === note) return;
  await message.update({ [cardKey(VEHICLE_CARD_FLAGS.result)]: { outcome, choice, note } });
}

/** The degree a card stands at: the rolled degree after the shifts recorded on it. Null while the Difficulty is open. */
export function cardOutcome(message) {
  const record = readCheckRecord(message);
  if (!record?.vehicle) return null;
  const eff = effectiveCheck(record);
  if (!eff || eff.pending) return null;
  return applyShifts(eff.outcome, sanitizeShifts(cardFlag(message, VEHICLE_CARD_FLAGS.shifts)));
}

async function ingestTable6(message, record, vehicle, roller, outcome) {
  const ref = record.vehicle;
  const stored = vehicle.system.drive?.result ?? {};
  const storedId = str(stored.messageId);
  const isNew = storedId !== message.id;
  // A reroll replaces the stored result only when the card it rerolls is the stored one.
  if (isNew && ref.rerollOf && ref.rerollOf !== storedId) return { skipped: 'not-current' };
  if (isNew && storedId && !ref.rerollOf) {
    const old = messageById(storedId);
    if (old && Number(old.timestamp) > Number(message.timestamp)) return { skipped: 'stale' };
  }
  // A GM's override or clear is newer than any card made before it, whatever re-renders that card later.
  if (isNew && Number(stored.setAt) > 0 && Number(message.timestamp) < Number(stored.setAt)) return { skipped: 'stale' };
  const choice = isNew ? '' : str(stored.choice);
  const driving = str(vehicle.system.pilotUuid) === roller.uuid;
  const settled = await settleVehicleResult(vehicle, {
    outcome, choice, messageId: message.id, driverUuid: roller.uuid, ruleBreak: !driving,
    now: recordNow(record), consumeAdvantage: isNew && ref.advantage
  });
  await syncCard(message, { outcome, choice: settled.choice });
  if (isNew && ref.rerollOf) {
    const old = messageById(ref.rerollOf);
    const used = Array.isArray(cardFlag(old, VEHICLE_CARD_FLAGS.used)) ? cardFlag(old, VEHICLE_CARD_FLAGS.used) : [];
    if (old && ref.rerollKey && !used.includes(ref.rerollKey)) await old.update({ [cardKey(VEHICLE_CARD_FLAGS.used)]: [...used, ref.rerollKey] });
  }
  return { ingested: true, changed: settled.changed, outcome };
}

/** Any operate card but boarding spends the Advantage its roller was owed (the card says it used it). Nothing else is settled. */
async function spendOwedAdvantage(message, record, vehicle, roller) {
  const ref = record.vehicle;
  if (ref.kind === 'board' || !ref.advantage || str(vehicle.system.drive?.advantageFor) !== roller.uuid) return;
  const stored = vehicle.system.drive?.result ?? {};
  const gave = messageById(str(stored.messageId));
  // An older card re-rendering after a newer Amazing Success must not spend the new Advantage.
  if (gave && Number(gave.timestamp) > Number(message.timestamp)) return;
  if (Number(stored.setAt) > 0 && Number(message.timestamp) < Number(stored.setAt)) return;
  await vehicle.update({ 'system.drive.advantageFor': '' });
}

async function ingestStop(message, vehicle, outcome) {
  if (cardFlag(message, VEHICLE_CARD_FLAGS.stop)) return { skipped: 'done' };
  const stopped = isSuccessOutcome(outcome);
  if (stopped && wholeFeet(vehicle.system.drive?.currentMove) > 0) await vehicle.update({ 'system.drive.currentMove': 0 });
  await message.update({
    [cardKey(VEHICLE_CARD_FLAGS.stop)]: true,
    [cardKey(VEHICLE_CARD_FLAGS.result)]: { outcome, choice: '', note: stopped ? '' : 'gm' }
  });
  return { ingested: true, stopped };
}

/**
 * Read a vehicle check card and apply what its kind settles: Table 6 (the stored result), braking (the speed). The result
 * is always `effectiveCheck(readCheckRecord(message))` from the GM's own copy of the card, after the shifts recorded on it,
 * so an Intervene counts and nothing numeric comes from a request. Runs on the GM; the caller holds the vehicle's queue.
 * @param {object} message the roll card
 * @returns {Promise<{ ingested?: boolean, skipped?: string, changed?: boolean }>}
 */
export async function ingestVehicleCheckNow(message) {
  const record = readCheckRecord(message);
  const ref = record?.vehicle;
  if (!ref) return { skipped: 'no-reference' };
  const vehicle = resolveActorByUuid(ref.vehicleUuid);
  if (vehicle?.type !== 'mount_vehicle') return { skipped: 'no-vehicle' };
  const roller = resolveActorByUuid(record.rollerUuid);
  if (!roller) return { skipped: 'no-roller' };
  if (!isTrustedAssist(message, roller)) return { skipped: 'untrusted' };
  const def = VEHICLE_CHECK_KINDS[ref.kind];
  if (!def) return { skipped: 'unknown-kind' };
  if (def.resolve !== 'table6') await spendOwedAdvantage(message, record, vehicle, roller);
  const outcome = cardOutcome(message);
  if (!outcome) return { skipped: 'pending' };
  if (def.resolve === 'table6') return ingestTable6(message, record, vehicle, roller, outcome);
  if (def.resolve === 'stop') return ingestStop(message, vehicle, outcome);
  return { skipped: def.resolve };
}

/**
 * Take a vehicle check card into the vehicle (active GM only), one card at a time per vehicle.
 * @param {object} message
 */
export function ingestVehicleCheck(message) {
  const ref = readCheckRecord(message)?.vehicle;
  if (!ref) return Promise.resolve({ skipped: 'no-reference' });
  if (!isActiveGM()) return Promise.resolve({ skipped: 'not-active-gm' });
  return runKeyed(`vehicle:${ref.vehicleUuid}`, () => ingestVehicleCheckNow(message));
}
