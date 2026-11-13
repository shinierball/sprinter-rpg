/**
 * The Bard's audition for a patron (core rulebook pp. 315-316) as plain functions over the Bard and an embedded patron
 * item. The GM starts it; the owner rolls three checks, each with a different Skill; each applied check moves the
 * patron's attitude (the pure ladder is `utils/patron/audition.mjs`). Permissive adjudication: every limit the book sets
 * is a Rule Break the table may confirm, recorded on the item's `ruleBreak` flag.
 */
import { confirmRuleBreak, markRuleBreak } from '../../utils/rule-break.mjs';
import { itemIdentifier } from '../../utils/identifier.mjs';
import { COG_OUTCOME_CONFIG } from '../session/roll-outcomes.mjs';
import { readCheckRecord, effectiveCheck, outcomeIdOf } from '../../utils/roll/check-assists.mjs';
import { auditionStep, auditionUndo } from '../../utils/patron/audition.mjs';
import { PATRON_TABLE_RECIPES } from '../../utils/patron/patron-tables.mjs';
import { PATRON_ATTITUDES, patronageOf } from '../../utils/patron/patronage-state.mjs';
import { murderBan } from '../../utils/patron/endings.mjs';
import { effectiveFloor } from '../../utils/character/race-class-floor.mjs';
import { findBookTable } from '../../sourcery/book-tables.mjs';
import { postPatronCard } from '../../chat/patron-card.mjs';
import { becomePatron, becomeReasons, writePatronage } from './patronage.mjs';
import { say, notify } from './vehicle-drive-common.mjs';

const now = () => Number(globalThis.game?.time?.worldTime) || 0;
const label = (key, fallback) => say(`COG.Patron.Audition.${key}`, fallback);
const attitudeName = (attitude) => label(`Attitude.${attitude}`, attitude.charAt(0).toUpperCase() + attitude.slice(1));
const outcomeName = (outcome) => COG_OUTCOME_CONFIG[outcome]?.label ?? outcome;
const canWrite = (actor) => Boolean(globalThis.game?.user?.isGM || actor?.testUserPermission?.(globalThis.game?.user, 'OWNER'));

/** The Skill's name on the Bard by identifier, else the identifier. */
function skillName(actor, identifier) {
  const owned = Array.from(actor?.items ?? []).find((i) => i?.type === 'skill' && itemIdentifier(i) === identifier);
  return owned?.name ?? identifier;
}

/** A Bard who killed a patron of theirs starts every audition Opposed (p. 316). */
export function auditionStartsOpposed(actor) {
  return murderBan(actor?.items, effectiveFloor(actor)).startOpposed;
}

/**
 * Start a prospect's audition. One Rule Break question lists every rule it breaks (no access, another active patron,
 * unmet criteria, Opposed chosen without the murder rule); Cancel changes nothing. A Bard who killed a patron starts
 * Opposed whatever was chosen.
 * @param {object} actor the Bard
 * @param {object} item an embedded patron item that is a prospect
 * @param {{ attitude?: string, dc?: number|null, options?: object }} [p]
 * @returns {Promise<{ ok: boolean, ruleBreak?: boolean, attitude?: string, reason?: string }>}
 */
export async function startAudition(actor, item, { attitude = 'willing', dc = null, options } = {}) {
  if (!item || patronageOf(item).status !== 'prospect') return { ok: false, reason: 'not-prospect' };
  const forced = auditionStartsOpposed(actor);
  const chosen = forced ? 'opposed' : (PATRON_ATTITUDES.includes(attitude) ? attitude : 'willing');
  const data = { patron: item.name, actor: actor.name };
  const reasons = becomeReasons(actor, item, 'direct', { starting: true });
  if (chosen === 'opposed' && !forced) {
    reasons.push(say('COG.Patron.Audition.OpposedAsk', 'Starting Opposed is only for a patron forced by violence or deception (p. 315)', data));
  }
  let ruleBreak = false;
  if (reasons.length) {
    const answer = await confirmRuleBreak({
      title: say('COG.Patron.Gate.Title', 'Patron'),
      message: say('COG.Patron.Audition.StartAsk', '{reasons}. Start {actor}\'s audition for {patron} anyway as a Rule Break?', { ...data, reasons: reasons.join('; ') }),
      options
    });
    if (!answer.confirmed) return { ok: false, ruleBreak: false, reason: answer.refusal ?? 'cancelled' };
    ruleBreak = true;
  }
  const difficulty = Number.isFinite(Number(dc)) && dc !== null && dc !== '' ? Math.max(0, Math.trunc(Number(dc))) : null;
  await writePatronage(item, { status: 'auditioning', attitude: chosen, audition: { dc: difficulty, steady: false, result: '', checks: [] } });
  if (ruleBreak) await markRuleBreak(item);
  await postPatronCard(actor, {
    title: label('Card.StartTitle', 'Audition'),
    icon: 'fa-microphone-lines',
    audience: 'all',
    lines: [{
      text: say('COG.Patron.Audition.Card.Start', 'Audition: {actor} for {patron}, starting {attitude}', { ...data, attitude: attitudeName(chosen) })
        + (forced ? ` ${label('Card.Forced', '(they killed their last patron)')}` : '')
    }]
  });
  return { ok: true, ruleBreak, attitude: chosen };
}

/**
 * Roll one audition check with a Skill (the owner or the GM). A Skill already used in this audition is a Rule Break
 * ("each with a different Skill", p. 315).
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function rollAuditionCheck(actor, item, skill, { options } = {}) {
  const audition = patronageOf(item);
  if (audition.status !== 'auditioning' || !skill || !canWrite(actor)) return { ok: false, reason: 'not-auditioning' };
  const identifier = itemIdentifier(skill);
  if (audition.audition.checks.some((c) => c.skill === identifier)) {
    const answer = await confirmRuleBreak({
      title: say('COG.Patron.Gate.Title', 'Patron'),
      message: say('COG.Patron.Audition.UsedAsk', '{skill} was already used in this audition; each check uses a different Skill. Use it again as a Rule Break?', { skill: skill.name }),
      options
    });
    if (!answer.confirmed) return { ok: false, reason: answer.refusal ?? 'cancelled' };
    await markRuleBreak(item);
  }
  await actor.rollSkill(skill, { patron: { kind: 'audition', itemId: item.id, dc: audition.audition.dc } });
  return { ok: true };
}

/** The Difficulty a pending audition card is judged against (a DialogV2 prompt); null when cancelled. */
async function askDifficulty() {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.prompt !== 'function') return null;
  const answer = await DialogV2.prompt({
    window: { title: label('DifficultyTitle', 'Audition Difficulty') },
    content: `<label>${label('Difficulty', 'Difficulty')} <input type="number" name="dc" min="0" step="1" value="" autofocus /></label>`,
    ok: { label: label('DifficultyOk', 'Judge'), callback: (event, button) => button.form.elements.dc?.value ?? '' },
    rejectClose: false
  });
  const n = Number(answer);
  return answer === null || answer === '' || !Number.isFinite(n) ? null : Math.max(0, Math.trunc(n));
}

/** The GM's buttons for a step's event, each only when its table exists. */
async function eventButtons(actor, item, event) {
  if (!event) return [];
  const buttons = [];
  const recipe = event === 'benefit' ? PATRON_TABLE_RECIPES.benefits : PATRON_TABLE_RECIPES.humiliations;
  const tableUuid = await findBookTable(recipe);
  const tableLabel = event === 'benefit' ? label('Button.Benefit', 'Roll Table 70') : label('Button.Humiliation', 'Roll Table 69');
  if (tableUuid) buttons.push({ label: tableLabel, action: 'crawlerDrawTable', data: { 'table-uuid': tableUuid, 'table-name': tableLabel }, gmOnly: true, icon: 'fa-dice' });
  const delta = event === 'benefit' ? 1 : -1;
  buttons.push({
    label: delta > 0 ? label('Button.PopularityUp', '+1 Popularity') : label('Button.PopularityDown', '-1 Popularity'),
    action: 'crawlerPatronPopularity', data: { 'actor-uuid': actor.uuid, delta }, gmOnly: true, icon: delta > 0 ? 'fa-star' : 'fa-star-half-stroke'
  });
  if (event === 'benefit') {
    buttons.push({ label: label('Button.Steady', 'Steady nerves'), action: 'crawlerPatronSteady', data: { 'actor-uuid': actor.uuid, 'item-id': item.id }, gmOnly: true, icon: 'fa-hand' });
  }
  return buttons;
}

/**
 * Apply an audition check card to the audition (the roller's owner or the GM): judge its effective outcome (after-roll
 * shifts and assists count), move the attitude, write the block and post one card for the step. Three checks end it:
 * agreed makes the patron active, declined or stormed off returns them to prospect.
 * @param {ChatMessage} message a skill check card whose record carries a patron ref of kind `audition`
 * @returns {Promise<{ ok: boolean, reason?: string, verdict?: string, event?: string }>}
 */
export async function applyAuditionCheck(message) {
  const record = readCheckRecord(message);
  const ref = record?.patron;
  if (!record || ref?.kind !== 'audition') return { ok: false, reason: 'not-audition' };
  const actor = globalThis.fromUuidSync?.(record.rollerUuid) ?? null;
  const item = actor?.items.get(ref.itemId) ?? null;
  if (!actor || !item || !canWrite(actor)) return { ok: false, reason: 'no-access' };
  const patronage = patronageOf(item);
  if (patronage.status !== 'auditioning') {
    notify('warn', label('NotAuditioning', 'That audition is not under way.'));
    return { ok: false, reason: 'not-auditioning' };
  }
  if (patronage.audition.checks.some((c) => c.messageId === message.id)) {
    notify('warn', label('AlreadyApplied', 'That check is already applied.'));
    return { ok: false, reason: 'already-applied' };
  }
  const eff = effectiveCheck(record);
  let outcome = eff.outcome;
  if (eff.pending) {
    if (patronage.audition.dc === null && !globalThis.game?.user?.isGM) {
      notify('warn', label('Check.Waiting', 'Waiting for the GM to set the Difficulty'));
      return { ok: false, reason: 'gm-sets-difficulty' };
    }
    const dc = patronage.audition.dc ?? await askDifficulty();
    if (dc === null) return { ok: false, reason: 'no-difficulty' };
    if (patronage.audition.dc === null) await writePatronage(item, { audition: { dc } });
    outcome = outcomeIdOf(eff.total, dc, record.d20);
  }
  const { state, event, verdict } = auditionStep(
    { attitude: patronage.attitude, checks: patronage.audition.checks, steady: patronage.audition.steady, result: patronage.audition.result },
    { outcome, skill: ref.skill, messageId: message.id, at: now() }
  );
  await writePatronage(item, { attitude: state.attitude, audition: { checks: state.checks, result: state.result } });
  const last = state.checks[state.checks.length - 1];
  if (verdict === 'agreed') await becomePatron(actor, item, { via: 'audition', gated: false, anotherPatron: true });
  else if (verdict === 'declined' || verdict === 'stormedOff') await writePatronage(item, { status: 'prospect' });
  const data = { patron: item.name, actor: actor.name, skill: skillName(actor, ref.skill), outcome: outcomeName(outcome), from: attitudeName(last.from), to: attitudeName(last.to) };
  const lines = [{
    text: say('COG.Patron.Audition.Card.Step', '{skill}: {outcome}. Attitude {from} -> {to}', data),
    buttons: await eventButtons(actor, item, event)
  }];
  const ending = {
    agreed: ['Agreed', '{patron} agrees to be {actor}\'s patron.'],
    declined: ['Declined', '{patron} declines.'],
    stormedOff: ['StormedOff', '{patron} storms off.']
  }[verdict];
  if (ending) lines.push({ text: say(`COG.Patron.Audition.Card.${ending[0]}`, ending[1], data) });
  await postPatronCard(actor, { title: say('COG.Patron.Audition.Card.Title', 'Audition: {patron}', data), icon: 'fa-microphone-lines', audience: 'all', lines });
  return { ok: true, verdict, event };
}

/**
 * Take back the last applied check (GM). An audition that had ended goes back to under way: an agreed patron leaves
 * `patron` for `auditioning`.
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function undoAuditionCheck(actor, item) {
  const patronage = patronageOf(item);
  if (!globalThis.game?.user?.isGM || !patronage.audition.checks.length) return { ok: false, reason: 'nothing-to-undo' };
  const state = auditionUndo({ attitude: patronage.attitude, checks: patronage.audition.checks, steady: patronage.audition.steady, result: patronage.audition.result });
  const patch = { attitude: state.attitude, audition: { checks: state.checks, result: '' } };
  if (patronage.status === 'patron' && patronage.via === 'audition') Object.assign(patch, { status: 'auditioning', via: '', since: null });
  else if (patronage.status === 'prospect') patch.status = 'auditioning';
  await writePatronage(item, patch);
  return { ok: true };
}

/** [Steady nerves] (a benefit, p. 316): the audition's shifts are gentler from now on (GM). */
export async function setAuditionSteady(actor, item) {
  if (!globalThis.game?.user?.isGM) return { ok: false, reason: 'gm-only' };
  await writePatronage(item, { audition: { steady: true } });
  return { ok: true };
}
