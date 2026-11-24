/**
 * Pet checks: taming (core book p. 230) and the pet limit (p. 228). The pet twin of `vehicle-checks.mjs`: the crawler rolls
 * their handling skill with a `pet` reference on the card, and the active GM settles the card's final degree (so an Intervene
 * or a reroll counts) into the pet's attitude and its taming records. Nothing here blocks anything (Directive 2): an attempt
 * too soon after the last, or inside the week after a Major Fail, asks one Rule Break confirm.
 *
 * Imports no sheet and not `actor.mjs`.
 */
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { isActiveGM } from '../../utils/gm-relay.mjs';
import { runKeyed } from '../../utils/keyed-queue.mjs';
import { readCheckRecord, effectiveCheck } from '../../utils/roll/check-assists.mjs';
import { flagPath, readFlag } from '../../utils/flags.mjs';
import { isTrustedAssist } from '../../chat/actions/use-assist.mjs';
import { cooldownState, gateCooldown, nextUseRecord } from '../../utils/time/cooldowns.mjs';
import { formatRemaining } from '../../utils/time/timing.mjs';
import { getCurrentFloor } from '../../utils/floor/current-floor.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { hasRuleFlag, RULE_FLAGS } from '../../utils/tag/tag-behaviour.mjs';
import { isMigrationWrite } from '../migrations/world-migration.mjs';
import { PET_TAGS } from '../../data/tag-vocabulary.mjs';
import {
  PET_CHECK_KINDS, TAMING_ATTEMPT, TAMING_LOCKOUT, guidanceFromOutcome, petCheckDifficulty, petLimit, sanitizePetAttitude, tamingAttemptMinutes, tamingResult
} from '../../data/rules/pet-rules.mjs';
import { skillByQuery } from './skill-by-query.mjs';
import { combatantOfActor } from '../combat/combatants.mjs';
import { guidanceApplies, guidanceRecordOf, saveGuidance } from './pet-guidance.mjs';
import { postRolePrompt } from './pet-roles.mjs';
import { currentTimeContext } from './dungeon-time.mjs';
import { minionControllerOf, minionState, settleCommandCheck } from './minion-orders.mjs';

/** The card flag the GM writes on a pet check card: what the check settled (read by the card's render block). */
export const PET_RESULT_FLAG = 'petResult';

/** The tag query that finds the skill that tames and guides, never by name. */
const HANDLING_QUERY = Object.freeze({ all: [PET_TAGS.skillHandling] });

/** The tag query that finds the skill that rides, never by name. */
const RIDING_QUERY = Object.freeze({ all: [PET_TAGS.skillRiding] });

/**
 * The skill a crawler rolls to tame or guide a pet: the owned skill carrying the `pet.skill.handling` tag with the highest
 * Rank, else the untrained stand-in of the first catalog skill that carries it.
 * @param {Actor} actor
 * @returns {object|null}
 */
function handlingSkillFor(actor) {
  return skillByQuery(actor, HANDLING_QUERY);
}

/** The skill a rider rolls to stay on a mount: the owned skill carrying `pet.skill.riding`, else the untrained stand-in. */
const ridingSkillFor = (actor) => skillByQuery(actor, RIDING_QUERY);

const rankOf = (skill) => Number(skill?.modifiedRank ?? skill?.system?.modifiedRank ?? skill?.system?.rank) || 0;

/**
 * How many pets a crawler may bond (p. 228, D13): one, one more at Animal Handling Rank 15, one more for a benefit carrying
 * the `extra-pet` rule flag.
 * @param {Actor} crawler
 * @returns {number}
 */
export function petLimitFor(crawler) {
  return petLimit({ handlingRank: rankOf(handlingSkillFor(crawler)), extraPet: hasRuleFlag(crawler, RULE_FLAGS.extraPet) });
}

/** The pet's Int Mod, the number its Int-Opposed Difficulty adds. */
const intModOf = (pet) => Number(pet?.system?.abilities?.int?.mod) || 0;

/**
 * Roll a pet check (a kind of `PET_CHECK_KINDS`): the crawler's handling skill (or, for a riding check, their riding skill) with a `pet`
 * reference, so the card reaches the GM's ingest. A taming attempt asks the lockout gate and then the spacing gate; one confirm
 * at most (the spacing gate takes the lockout's confirm as its own), and a decline rolls nothing and writes nothing. A confirmed
 * attempt carries `ruleBreak: true` on the card and the reference. The Difficulty defaults from the kind.
 * @param {Actor} pet
 * @param {Actor} actor the roller
 * @param {{ kind?: string, dc?: number|null, interactive?: boolean, ruleBreak?: boolean }} [options]
 * @returns {Promise<ChatMessage|null|undefined>} undefined when nothing can be rolled, null when declined
 */
export async function rollPetCheck(pet, actor, { kind = 'tame', dc, interactive, ruleBreak, actionBlockChecked } = {}) {
  const def = PET_CHECK_KINDS[kind];
  if (pet?.type !== 'pet' || !actor || !def) return undefined;
  const skill = def.skill === 'riding' ? ridingSkillFor(actor) : handlingSkillFor(actor);
  if (!skill) return undefined;

  let broke = ruleBreak === true;
  let minutes = 0;
  if (def.resolve === 'attitude') {
    const taming = pet.system?.details?.taming ?? {};
    const now = currentTimeContext(actor);
    minutes = tamingAttemptMinutes(rankOf(skill));
    const name = escapeAttr(pet.name || 'The pet');
    // The lockout first; when it is running its one confirm is the whole confirm, so the spacing gate is told it is already given.
    const locked = await gateCooldown({
      name: `Taming ${name} (locked out after a Major Fail)`, spec: TAMING_LOCKOUT, record: taming.lockout ?? null, now, key: 'lockout', options: { interactive, ruleBreak }
    });
    if (!locked.proceed) return null;
    const spaced = await gateCooldown({
      name: `Taming ${name}`, spec: TAMING_ATTEMPT, record: taming.attempt ?? null, now, amount: minutes, key: 'attempt',
      options: { interactive, ruleBreak: ruleBreak === true || locked.ruleBreak }
    });
    if (!spaced.proceed) return null;
    broke = locked.ruleBreak || spaced.ruleBreak || broke;
  }
  const ref = {
    petUuid: pet.uuid, kind, ruleBreak: broke, minutes,
    dc: dc === undefined ? petCheckDifficulty(kind, { intMod: intModOf(pet), floor: getCurrentFloor() }) : dc
  };
  return actor.rollSkill(skill, { pet: ref, ...(actionBlockChecked === true ? { actionBlockChecked: true } : {}) });
}

/**
 * Roll the command check of a split creature (core p. 203): its controller's handling skill, Unopposed, with a `pet` reference
 * naming the minion so the card reaches the GM's ingest. The caller has recorded the controller's Action.
 * @param {Actor} minion
 * @param {Actor} controller
 * @param {{ ruleBreak?: boolean, actionBlockChecked?: boolean }} [options]
 * @returns {Promise<ChatMessage|null|undefined>} undefined when nothing can be rolled
 */
export async function rollCommandCheck(minion, controller, { ruleBreak, actionBlockChecked } = {}) {
  const def = PET_CHECK_KINDS.command;
  if (!def || !controller || !minion || !minionState(globalThis.game?.combat, minion)) return undefined;
  const skill = handlingSkillFor(controller);
  if (!skill) return undefined;
  const ref = { petUuid: minion.uuid, kind: 'command', ruleBreak: ruleBreak === true, minutes: 0, dc: petCheckDifficulty('command', { floor: getCurrentFloor() }) };
  return controller.rollSkill(skill, { pet: ref, ...(actionBlockChecked === true ? { actionBlockChecked: true } : {}) });
}

/**
 * The Guide control of the combat tracker (core book p. 232): record a `check` Action for the pet's owner on their combatant
 * (over budget asks the ledger's Rule Break; a decline rolls nothing), then roll the guiding check. The roll is told the
 * Action gate was asked, so a bearer who cannot act is asked once.
 * @param {Combat} combat
 * @param {Combatant} petCombatant
 * @param {{ round?: number|null }} [options] the round the tracker shows
 * @returns {Promise<ChatMessage|null|undefined>} undefined when nothing can be rolled, null when declined
 */
export async function guidePet(combat, petCombatant, { round = null } = {}) {
  const pet = petCombatant?.actor;
  if (!guidanceApplies(pet)) return undefined;
  const owner = globalThis.game?.actors?.get?.(pet.system?.details?.ownerId) ?? null;
  const ownerCombatant = combatantOfActor(combat, owner);
  if (!ownerCombatant) {
    globalThis.ui?.notifications?.warn?.(`${pet.name || 'The pet'}'s owner is not in this combat.`);
    return undefined;
  }
  const recorded = await combat.recordCombatantAction(ownerCombatant, { type: 'check', label: `Guide ${pet.name || 'pet'}` }, { round });
  if (!recorded?.success) return null;
  return rollPetCheck(pet, owner, { kind: 'guide', ruleBreak: recorded.ruleBreak === true, actionBlockChecked: true });
}

/**
 * What the sheets show about taming a pet: whether the 20 minute spacing or the week's lockout is running, in words. The Tame
 * control is never disabled; an attempt inside either asks the Rule Break of `rollPetCheck`.
 * @param {Actor} pet
 * @returns {{ locked: boolean, lockoutText: string, waiting: boolean, attemptText: string }}
 */
export function tamingReadout(pet) {
  const taming = pet?.system?.details?.taming ?? {};
  const now = currentTimeContext(null);
  const lock = cooldownState(TAMING_LOCKOUT, taming.lockout ?? null, now);
  const gap = cooldownState(TAMING_ATTEMPT, taming.attempt ?? null, now);
  const left = (state) => formatRemaining(state).replace(' remaining', '');
  return {
    locked: !lock.ready,
    lockoutText: lock.ready ? '' : `No attempts for ${left(lock)}`,
    waiting: !gap.ready,
    attemptText: gap.ready ? '' : `Next attempt in ${left(gap)}`
  };
}

const sameRecord =(a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Write what a taming card settled, in one update: the new attitude, the attempt record, the lockout when the result starts
 * one, and the card that did it (so the same card seen twice changes nothing, and a card whose degree an Intervene shifted
 * is settled again from the attitude before it). An attempt never moves a lockout: only a Major Fail or worse starts one,
 * from that moment. The GM's own change of the attitude since is left alone.
 * @param {Actor} pet
 * @param {{ outcome: string, messageId?: string, ruleBreak?: boolean, minutes?: number, at?: number, now?: object }} p
 * @returns {Promise<{ changed: boolean, from: string, result: object }>}
 */
async function settleTaming(pet, { outcome, messageId = '', ruleBreak = false, minutes = 0, at = 0, now } = {}) {
  const details = pet.system?.details ?? {};
  const taming = details.taming ?? {};
  const last = taming.last ?? null;
  const again = Boolean(last) && last.messageId === messageId;
  if (again && last.outcome === outcome) return { changed: false, from: sanitizePetAttitude(last.from), result: tamingResult({ attitude: last.from, outcome }) };

  const current = sanitizePetAttitude(details.attitude);
  const from = again ? sanitizePetAttitude(last.from) : current;
  const result = tamingResult({ attitude: from, outcome });
  const clock = now ?? currentTimeContext(null);
  const update = {};

  const attempt = again ? taming.attempt : nextUseRecord({ value: minutes || TAMING_ATTEMPT.value, unit: TAMING_ATTEMPT.unit }, taming.attempt ?? null, clock, { ruleBreak, key: 'attempt' });
  if (!sameRecord(attempt, taming.attempt)) update['system.details.taming.attempt'] = attempt;

  // The GM changing the attitude after the card (the override) is not undone by a later shift of the same card.
  const overridden = again && current !== sanitizePetAttitude(last.to);
  if (!overridden && result.attitude !== current) update['system.details.attitude'] = result.attitude;

  const priorLockout = again ? (last.priorLockout ?? null) : (taming.lockout ?? null);
  let lockout = taming.lockout ?? null;
  if (result.lockout && !(again && last.lockout)) lockout = nextUseRecord(TAMING_LOCKOUT, priorLockout, clock, { ruleBreak, key: 'lockout' });
  else if (!result.lockout && again && last.lockout) lockout = priorLockout;
  if (!sameRecord(lockout, taming.lockout)) update['system.details.taming.lockout'] = lockout;

  update['system.details.taming.last'] = { messageId, outcome, from, to: result.attitude, lockout: result.lockout, priorLockout, at: Number(at) || 0 };
  await pet.update(update);
  // Newly Bonded by this card (a shifted degree counts once): ask for the pet's role (core book p. 231).
  const wasBonded = again ? last.to === 'bonded' : from === 'bonded';
  if (!wasBonded && result.attitude === 'bonded') await postRolePrompt(pet);
  return { changed: true, from, result };
}

/**
 * Write what a guiding card settled onto the pet's combatant in the running combat (the active GM writes it). The state lasts
 * the combat because the combatant does. A card's own result is replaced when an Intervene or reroll shifts it; a different
 * card only counts while the pet is not yet guided (a Fail leaves it out so the owner may try again, and a guided or hiding
 * pet is not re-rolled by a later card). Nothing here blocks the pet: its Actions ask the Rule Break (`pet-guidance.mjs`).
 * @param {Actor} pet
 * @param {{ outcome: string, crawlerUuid?: string, messageId?: string }} p
 * @returns {Promise<{ changed: boolean, state: string|null, skipped?: string }>}
 */
async function settleGuidance(pet, { outcome, crawlerUuid = '', messageId = '' } = {}) {
  if (!guidanceApplies(pet)) return { changed: false, state: null, skipped: 'not-guided-pet' };
  const combatant = combatantOfActor(globalThis.game?.combat, pet);
  if (!combatant) return { changed: false, state: null, skipped: 'no-combatant' };
  const current = guidanceRecordOf(combatant);
  const state = guidanceFromOutcome(outcome);
  const sameCard = Boolean(messageId) && current.messageId === messageId;
  if (!sameCard && current.state !== 'none') return { changed: false, state: current.state, skipped: 'already-settled' };
  if (sameCard && current.state === state) return { changed: false, state };
  if (!sameCard && state === 'none') return { changed: false, state };
  await saveGuidance(combatant, { state, byUuid: crawlerUuid, messageId });
  return { changed: true, state };
}

/** The degree a pet check card stands at: the rolled degree after the shifts on its record. Null while the Difficulty is open. */
function petCardOutcome(record) {
  const eff = effectiveCheck(record);
  if (!eff || eff.pending) return null;
  return eff.outcome;
}

/** Show the settled result on the card (written only when it differs, so the update hook stops). */
async function syncPetCard(message, shown) {
  if (sameRecord(readFlag(message, PET_RESULT_FLAG), shown)) return;
  await message.update({ [flagPath(PET_RESULT_FLAG)]: shown });
}

/**
 * Read a pet check card and apply what its kind settles. The degree is always `effectiveCheck(readCheckRecord(message))` from
 * the GM's own copy of the card, after the shifts recorded on it, so an Intervene counts and nothing numeric comes from a
 * request. Runs on the GM; the caller holds the pet's queue.
 * @param {object} message the roll card
 * @returns {Promise<{ ingested?: boolean, skipped?: string, changed?: boolean, outcome?: string }>}
 */
async function ingestPetCheckNow(message) {
  const record = readCheckRecord(message);
  const ref = record?.pet;
  if (!ref) return { skipped: 'no-reference' };
  const pet = resolveActorByUuid(ref.petUuid);
  if (pet?.type !== 'pet') return { skipped: 'no-pet' };
  const roller = resolveActorByUuid(record.rollerUuid);
  if (!roller) return { skipped: 'no-roller' };
  if (!isTrustedAssist(message, roller)) return { skipped: 'untrusted' };
  const def = PET_CHECK_KINDS[ref.kind];
  if (!def) return { skipped: 'unknown-kind' };
  if (def.resolve !== 'attitude' && def.resolve !== 'guidance') return { skipped: def.resolve };
  const outcome = petCardOutcome(record);
  if (!outcome) return { skipped: 'pending' };
  if (def.resolve === 'guidance') {
    const guided = await settleGuidance(pet, { outcome, crawlerUuid: roller.uuid, messageId: message.id });
    if (guided.state) await syncPetCard(message, { outcome, guidance: guided.state });
    return { ingested: true, changed: guided.changed, outcome, skipped: guided.skipped };
  }

  const last = pet.system?.details?.taming?.last ?? null;
  // An older card seen after a newer one settled is not counted again; the GM's attitude select is the override.
  if (last && last.messageId !== message.id && Number(message.timestamp) < Number(last.at)) {
    // The card still shows it was not counted.
    const standing = sanitizePetAttitude(pet.system?.details?.attitude);
    await syncPetCard(message, { outcome, from: standing, to: standing, lockout: false, attacks: false, stale: true });
    return { skipped: 'stale' };
  }
  const settled = await settleTaming(pet, { outcome, messageId: message.id, ruleBreak: ref.ruleBreak, minutes: ref.minutes, at: Number(message.timestamp) || 0 });
  await syncPetCard(message, { outcome, from: settled.from, to: settled.result.attitude, lockout: settled.result.lockout, attacks: settled.result.attacks, ruleBreak: ref.ruleBreak });
  return { ingested: true, changed: settled.changed, outcome };
}

/**
 * Settle a command check card (a split creature, core p. 203) into its controller's commanded list. Runs on the GM; the caller
 * holds the controller's command queue.
 * @param {object} message the roll card
 */
async function ingestCommandCheckNow(message) {
  const record = readCheckRecord(message);
  const ref = record?.pet;
  const creature = ref ? resolveActorByUuid(ref.petUuid) : null;
  if (!creature) return { skipped: 'no-pet' };
  const roller = resolveActorByUuid(record.rollerUuid);
  if (!roller) return { skipped: 'no-roller' };
  if (!isTrustedAssist(message, roller)) return { skipped: 'untrusted' };
  // Only the minion's controller commands it: a card naming another controller's minion changes nothing
  if (minionControllerOf(creature)?.uuid !== roller.uuid) return { skipped: 'not-controller' };
  const outcome = petCardOutcome(record);
  if (!outcome) return { skipped: 'pending' };
  const settled = await settleCommandCheck(creature, { outcome, prior: readFlag(message, PET_RESULT_FLAG) });
  if (settled.skipped) return { skipped: settled.skipped };
  await syncPetCard(message, { outcome, command: { commanded: settled.commanded.includes(creature.uuid), added: settled.added, count: settled.group.length } });
  return { ingested: true, changed: settled.changed, outcome };
}

/** The queue a command card runs on: its controller's combatant, whose whole list the settle rewrites. */
function commandQueueKey(ref) {
  const combat = globalThis.game?.combat;
  const controller = minionState(combat, resolveActorByUuid(ref.petUuid))?.controller;
  const combatant = controller ? combatantOfActor(combat, controller) : null;
  return combatant ? `minion-commands:${combatant.uuid}` : `pet:${ref.petUuid}`;
}

/**
 * Take a pet check card into the pet (active GM only), one card at a time per pet.
 * @param {object} message
 */
function ingestPetCheck(message) {
  const ref = readCheckRecord(message)?.pet;
  if (!ref) return Promise.resolve({ skipped: 'no-reference' });
  if (!isActiveGM()) return Promise.resolve({ skipped: 'not-active-gm' });
  if (PET_CHECK_KINDS[ref.kind]?.resolve === 'command') return runKeyed(commandQueueKey(ref), () => ingestCommandCheckNow(message));
  return runKeyed(`pet:${ref.petUuid}`, () => ingestPetCheckNow(message));
}

let hooksRegistered = false;

/** Register the ingest hooks (once). Called from the ready hook. */
export function registerPetCheckHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;
  const onMessage = (message) => ingestPetCheck(message).catch((err) => console.warn('Sprinter RPG | Pet check ingest failed', err));
  globalThis.Hooks?.on?.('createChatMessage', onMessage);
  globalThis.Hooks?.on?.('updateChatMessage', (message, _changes, options) => (isMigrationWrite(options) ? undefined : onMessage(message)));
}
