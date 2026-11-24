/**
 * No second try after a Major Fail in the scene (core p. 61, Checking Again): a crawler who got a Major or Critical Fail
 * on a Skill cannot test that Skill again in the same scene. Permissive adjudication: a later roll of that Skill asks a
 * Rule Break and never blocks. "The scene" is the scene epoch (`getSceneEpoch`): a combat start, a combat end or the
 * HUD's New Scene button moves it. The lock is read from the chat log: every check card records its roller, the scene
 * and the Skill's identifier (`buildCheckRecord`), and the degree is derived on read, so a late Difficulty or an AI Favor
 * reroll always counts right.
 */
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { langText } from '../../utils/lang-text.mjs';
import { readCheckRecord, effectiveCheck } from '../../utils/roll/check-assists.mjs';
import { messageList, MAX_CARD_SCAN } from '../../utils/card/recent-cards.mjs';
import { sanitizeContestRef } from '../../utils/contest/contest-roll.mjs';
import { sanitizeVehicleRef } from '../../utils/vehicle/vehicle-check.mjs';
import { sanitizePetCheckRef } from '../../utils/pet/pet-check-ref.mjs';
import { PET_CHECK_KINDS } from '../../data/rules/pet-rules.mjs';
import { COG_OUTCOME_CONFIG, COG_ROLL_OUTCOMES as O } from '../session/roll-outcomes.mjs';
import { getSceneEpoch } from './dungeon-time.mjs';

const TEXT = Object.freeze({
  'COG.RetryGate.Title': 'No Second Try',
  'COG.RetryGate.Reason': '{name} rolled a {degree} on {skill} this scene: no second try until the scene changes (a combat starts or ends, or the New Scene button is pressed; core p. 61).',
  'COG.RetryGate.Question': 'Roll it again anyway as a Rule Break?'
});
const retryText = langText(TEXT);

/** The result of a roll that is not held back. */
const RETRY_GATE_CLEAR = Object.freeze({ proceed: true, ruleBreak: false, flags: Object.freeze({}) });

/** The pet check kind whose roll the book orders whatever the last result: riding (core p. 232). */
const RIDE_KIND = 'ride';

/**
 * The Major or Critical Fail the actor rolled on the Skill in this scene: `{ message, outcome }` for the newest such
 * card, else null (also when the Skill has no identifier). Every recorded roll of the Skill counts,
 * a roll the gate does not hold back included.
 * @param {object} actor
 * @param {string} skillIdentifier
 * @param {Iterable<object>} [messages] the chat log, oldest first
 */
function majorFailThisScene(actor, skillIdentifier, messages = globalThis.game?.messages) {
  if (!skillIdentifier || !actor?.uuid) return null;
  const scene = getSceneEpoch();
  const list = messageList(messages).slice(-MAX_CARD_SCAN);
  for (let i = list.length - 1; i >= 0; i--) {
    const record = readCheckRecord(list[i]);
    if (!record || (record.kind !== 'skill' && record.kind !== 'attack')) continue;
    if (record.rollerUuid !== actor.uuid || record.scene !== scene || record.skillIdentifier !== skillIdentifier) continue;
    const outcome = effectiveCheck(record)?.outcomes.find((o) => o === O.MAJOR_FAILURE || o === O.CRITICAL_FAILURE);
    if (outcome) return { message: list[i], outcome };
  }
  return null;
}

/**
 * The rolls the book's own procedures order whatever the last result (Questions 1465 (a), 1475 (a)): a race or chase leg
 * (core pp. 74-75), a taming check (its own week lockout, core p. 230), a riding check (core p. 232) and a vehicle operate
 * check (core p. 72).
 * @param {object} options the `rollSkill` options
 */
function retryExempt(options = {}) {
  if (sanitizeContestRef(options.contest) || sanitizeVehicleRef(options.vehicle)) return true;
  const kind = sanitizePetCheckRef(options.pet)?.kind;
  return Boolean(kind) && (kind === RIDE_KIND || PET_CHECK_KINDS[kind]?.resolve === 'attitude');
}

/**
 * The reason a roll of the Skill is held back, or null.
 * @param {object} actor
 * @param {string} skillIdentifier
 * @param {string} skillName
 * @returns {string|null}
 */
export function retryReasonFor(actor, skillIdentifier, skillName) {
  const found = majorFailThisScene(actor, skillIdentifier);
  if (!found) return null;
  return retryText('COG.RetryGate.Reason', {
    name: actor.name ?? '',
    degree: COG_OUTCOME_CONFIG[found.outcome]?.label ?? found.outcome,
    skill: skillName
  });
}

/**
 * The gate of `rollSkill`: asks a Rule Break when the Skill has a Major Fail this scene. A Rule Break retry does not clear
 * the lock, so each later roll asks again.
 * @param {object} actor
 * @param {object} skill
 * @param {object} options the `rollSkill` options (`ruleBreak`, `interactive`, the procedure refs)
 * @returns {Promise<{ proceed: boolean, ruleBreak: boolean, flags: object }>}
 */
export async function gateRetryAfterMajorFail(actor, skill, options = {}) {
  if (retryExempt(options)) return RETRY_GATE_CLEAR;
  const reason = retryReasonFor(actor, String(skill?.system?.identifier ?? ''), skill?.name ?? '');
  if (!reason) return RETRY_GATE_CLEAR;
  const verdict = await confirmRuleBreak({
    title: retryText('COG.RetryGate.Title'),
    message: `${reason} ${retryText('COG.RetryGate.Question')}`,
    reason,
    options
  });
  return verdict.confirmed
    ? { proceed: true, ruleBreak: true, flags: { ruleBreak: true, retryRuleBreak: true } }
    : { proceed: false, ruleBreak: false, flags: {} };
}
