/**
 * Playing to the Cameras: the award (D-C1 to D-C8).
 *
 * A card whose roll carried a camera choice holds `flags.sprinter-rpg.cameras`. When the roll's result is known the
 * active GM settles Table 52 for it: the automatic Popularity and AI Favor amounts are written once, the difference
 * is written when the result changes (an Intervene, a Called Play, the GM's pick), and a cell with a GM choice
 * posts a whispered prompt card. Everything is written on the GM's client; the hooks only read the message.
 *
 * Camera Popularity counts on every floor (D-C6, answered b). AI Favor gains while the day's bar is up are withheld
 * (never written from a hook, never a modal); the GM's button asks the Rule Break.
 */
import { isMigrationWrite } from '../../documents/migrations/world-migration.mjs';
import '../../utils/roll/migrate-camera-results.mjs';
import { readCameraFlag, readCameraPrompt, cameraFlagPath, cameraPromptPath, withCameraFlags, sanitizeCameraRecord, cameraResultOf, CAMERA_RESULTS, cameraReasonLabel, cameraText } from '../../utils/roll/cameras.mjs';
import { readCheckRecord, effectiveCheck } from '../../utils/roll/check-assists.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { isActiveGM } from '../../utils/gm-relay.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { ruleBreakBadgeHtml, ruleBreakMessageData } from '../../utils/rule-break-visibility.mjs';
import { addPopularity } from '../../documents/actor/actor-popularity.mjs';
import { COGSessionEngine } from '../../documents/session/session-engine.mjs';
import { addAiFavor, aiFavorBarState, setAiFavorBar } from './ai-favor-tally.mjs';
import { isTrustedAssist } from './use-assist.mjs';
import { withFlags } from '../../utils/flags.mjs';
import { applyBenefactorChoice, benefactorCameraCell, benefactorChoicePlan, benefactorReasonsText, benefactorText } from '../../documents/actor/sponsor-box.mjs';
import { effectiveFloor } from '../../utils/character/race-class-floor.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { messageById } from '../../utils/card/recent-cards.mjs';
import { gmWhisper } from '../../utils/owner-recipients.mjs';


const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const notify = (level, key, data) => globalThis.ui?.notifications?.[level]?.(cameraText(key, data));

/** "Amazing Success" for a Table 52 result id. */
export function cameraResultLabel(result) {
  return cameraText(`COG.Cameras.Result.${result}`);
}

/** "+2 Popularity, -1 AI Favor" for a pair of amounts; '' when both are zero. */
export function cameraChangesText({ popularity = 0, aiFavor = 0 } = {}) {
  const parts = [];
  if (popularity) parts.push(cameraText('COG.Cameras.Popularity', { value: signed(popularity) }));
  if (aiFavor) parts.push(cameraText('COG.Cameras.AiFavor', { value: signed(aiFavor) }));
  return parts.join(', ');
}

/**
 * The Table 52 result id of a camera card: the GM's pick when set, else the card's check record. A pending card, a card
 * with no record, or several targets that land in different results have none (D-C3 a). The migration
 * (`migrate-camera-results.mjs`) reads an old row-3 card's result the same way.
 * @param {object} message
 * @param {ReturnType<typeof sanitizeCameraRecord>} [record]
 * @returns {string|null}
 */
function cameraResultFor(message, record = sanitizeCameraRecord(readCameraFlag(message))) {
  if (record?.pickedResult) return record.pickedResult;
  const check = readCheckRecord(message);
  const eff = effectiveCheck(check);
  if (!eff || eff.pending) return null;
  const outcomes = check.evade ? [eff.outcome] : eff.outcomes;
  const results = new Set(outcomes.map(cameraResultOf));
  return results.size === 1 && !results.has(null) ? [...results][0] : null;
}

/**
 * What settling this card would do right now. Pure reads; null when the card has no camera record or crawler.
 * @returns {null|{ record: object, actor: object, trusted: boolean, result: string|null, cell: object|null,
 *   delta: { popularity: number, aiFavor: number }, withhold: boolean, needsPrompt: boolean, pending: boolean }}
 */
export function cameraAwardPlan(message) {
  const record = sanitizeCameraRecord(readCameraFlag(message));
  if (!record) return null;
  const actor = resolveActorByUuid(record.actorUuid);
  if (!actor || actor.type === 'mob') return null;
  const result = cameraResultFor(message, record);
  const cell = result ? benefactorCameraCell(record.choice, result) : null;
  // A converted card paid under the old table and is history: nothing is settled on it again.
  if (record.closed) {
    return { record, actor, trusted: isTrustedAssist(message, actor), result, cell, delta: { popularity: 0, aiFavor: 0 }, withhold: false, needsPrompt: false, pending: false };
  }
  const want = cell?.auto ?? { popularity: 0, aiFavor: 0 };
  const delta = { popularity: want.popularity - record.settled.popularity, aiFavor: want.aiFavor - record.settled.aiFavor };
  const withhold = Boolean(result) && delta.aiFavor > 0 && aiFavorBarState(actor).barred;
  const needsPrompt = Boolean(cell?.choices?.length) && !record.resultPrompts[result];
  const sameWithheld = withhold ? record.withheld?.aiFavor === delta.aiFavor : !record.withheld;
  const pending = Boolean(result) && (record.settled.result !== result || delta.popularity !== 0 || (delta.aiFavor !== 0 && !withhold) || needsPrompt || !sameWithheld);
  return { record, actor, trusted: isTrustedAssist(message, actor), result, cell, delta, withhold, needsPrompt, pending };
}

function lineCard(actor, content, { ruleBreak = false, flags = {} } = {}) {
  const data = withFlags({
    speaker: globalThis.ChatMessage?.getSpeaker?.({ actor }),
    content: `<div class="cog-chat-card cog-camera-award">${content}</div>`
  }, { cameraAward: true, ruleBreak, ...flags });
  return globalThis.ChatMessage?.create?.(ruleBreak ? ruleBreakMessageData(data) : data);
}

function lineHtml(text, ruleBreak = false) {
  return `<p><i class="fa-solid fa-video"></i> ${escapeAttr(text)}${ruleBreak ? ` ${ruleBreakBadgeHtml({ cls: '' })}` : ''}</p>`;
}

async function logSponsor(actor, choiceLabel) {
  try {
    if (!COGSessionEngine.getActiveSessionId?.()) return;
    await COGSessionEngine.createManualEvent({ type: 'manual', actorId: actor.id, name: cameraText('COG.Cameras.SponsorLog', { choice: choiceLabel }) });
  } catch (err) {
    console.warn('Sprinter RPG | Could not log the Sponsor choice', err);
  }
}

async function postPrompt(message, plan) {
  const { record, actor, result, cell } = plan;
  const reason = cameraReasonLabel(record.choice);
  const buttons = cell.choices.map(c => `<button type="button" class="cog-camera-choice" data-action="crawlerCameraChoice" data-gm-only="true" data-choice-id="${escapeAttr(c.id)}">${escapeAttr(c.label)}</button>`).join('');
  const whisper = gmWhisper();
  const created = await globalThis.ChatMessage?.create?.(withCameraFlags({
    speaker: globalThis.ChatMessage?.getSpeaker?.({ actor }),
    content: `<div class="cog-chat-card cog-camera-prompt"><p>${escapeAttr(cameraText('COG.Cameras.PromptTitle', { reason, name: actor.name, result: cameraResultLabel(result) }))}</p><div class="cog-camera-choices">${buttons}</div></div>`,
    ...(whisper?.length ? { whisper } : {})
  }, { prompt: { sourceId: message.id, result, resolved: null } }));
  if (created?.id) await message.update({ [cameraFlagPath(`resultPrompts.${result}`)]: created.id });
}

async function settleNow(message) {
  const plan = cameraAwardPlan(message);
  if (!plan) return { skipped: 'no-record' };
  if (!plan.trusted) return { skipped: 'untrusted' };
  if (plan.result === null) return { skipped: 'pending' };
  if (!plan.pending) return { skipped: 'settled' };
  const { record, actor, result, cell, delta, withhold } = plan;
  const aiDelta = withhold ? 0 : delta.aiFavor;
  const settled = { result, popularity: record.settled.popularity + delta.popularity, aiFavor: record.settled.aiFavor + aiDelta };
  const withheld = withhold ? { aiFavor: delta.aiFavor } : null;
  // Claim first: a second pass (the update hook of this very write) then sees nothing left to do.
  await message.update({ [cameraFlagPath('settled')]: settled, [cameraFlagPath('withheld')]: withheld });

  const reason = `${cameraReasonLabel(record.choice)} (${cameraResultLabel(result)})`;
  if (delta.popularity) await addPopularity(actor, delta.popularity, reason);
  if (aiDelta) await addAiFavor(actor, aiDelta, reason, { interactive: false });
  if (cell?.bar && record.settled.result !== result) await setAiFavorBar(actor);
  if (record.settled.result !== result || delta.popularity || aiDelta) {
    const changes = cameraChangesText({ popularity: delta.popularity, aiFavor: aiDelta });
    const base = changes
      ? cameraText('COG.Cameras.Line', { reason: cameraReasonLabel(record.choice), name: actor.name, changes, result: cameraResultLabel(result) })
      : cameraText('COG.Cameras.LineNone', { reason: cameraReasonLabel(record.choice), name: actor.name, result: cameraResultLabel(result) });
    const text = cell?.text ? `<p>${escapeAttr(cell.text)}</p>` : '';
    await lineCard(actor, lineHtml(base) + text);
  }
  if (plan.needsPrompt) await postPrompt(message, plan);
  return { settled, withheld };
}

const queues = new Map();

/**
 * Settle Table 52 for a card (active GM only; `force` is the GM's Award button, which skips the active-GM check but
 * not the trust check). Calls for one message run one after another, so a write and the hook it triggers never overlap.
 * @param {object} message
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<object>}
 */
export function settleCameraAward(message, { force = false } = {}) {
  if (!message?.id) return Promise.resolve({ skipped: 'no-message' });
  if (!readCameraFlag(message)) return Promise.resolve({ skipped: 'no-record' });
  if (force ? !globalThis.game?.user?.isGM : !isActiveGM()) return Promise.resolve({ skipped: 'not-gm' });
  const run = (queues.get(message.id) ?? Promise.resolve()).catch(() => {}).then(() => settleNow(message));
  queues.set(message.id, run);
  run.finally(() => { if (queues.get(message.id) === run) queues.delete(message.id); }).catch(() => {});
  return run;
}

let hooksRegistered = false;
/** Settle on every create and update of a camera card (registered once, from the ready hook). */
export function registerCameraHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;
  const onMessage = (message) => {
    if (!readCameraFlag(message)) return;
    settleCameraAward(message).catch(err => console.warn('Sprinter RPG | Camera award failed', err));
  };
  globalThis.Hooks?.on?.('createChatMessage', onMessage);
  globalThis.Hooks?.on?.('updateChatMessage', (message, _changes, options) => { if (!isMigrationWrite(options)) onMessage(message); });
}

/** Tests only. */
export function resetCameraHooks() {
  hooksRegistered = false;
}

function gmOnly() {
  if (globalThis.game?.user?.isGM) return true;
  notify('warn', 'COG.Cameras.GmOnly');
  return false;
}

/** The GM names the result when the engine cannot (`data-result`, one of `CAMERA_RESULTS`); the card then settles from it. */
export async function handleCameraPickRow(event, button, message) {
  if (!gmOnly()) return;
  const result = button?.dataset?.result;
  if (!CAMERA_RESULTS.includes(result)) return;
  const record = sanitizeCameraRecord(readCameraFlag(message));
  if (!record || record.closed) return;
  await message.update({ [cameraFlagPath('pickedResult')]: result });
  await settleCameraAward(message, { force: true });
}

/** The GM's Award button: settle now, whether or not an active GM saw the update. */
export async function handleCameraAward(event, button, message) {
  if (!gmOnly()) return;
  const res = await settleCameraAward(message, { force: true });
  if (res?.skipped === 'untrusted') notify('warn', 'COG.Cameras.Untrusted');
}

/** Prompt cards whose choice is being applied now, so a double click applies once. */
const choicesInFlight = new Set();

/**
 * The same choice with Sponsor Boxes: a box choice asks one Rule Break naming every limit it passes (no Sponsor, a box
 * already this Floor, a Major Fail's bar) before the prompt is claimed, so a refusal leaves the prompt open for another pick.
 */
/** Apply one GM choice from a prompt card, once. */
export async function handleCameraChoice(event, button, message) {
  if (!gmOnly()) return;
  const prompt = readCameraPrompt(message);
  if (!prompt) return;
  if (prompt.resolved) {
    notify('info', 'COG.Cameras.AlreadyResolved');
    return;
  }
  if (choicesInFlight.has(message.id)) return;
  choicesInFlight.add(message.id);
  try {
    const source = messageById(prompt.sourceId);
    const plan = source ? cameraAwardPlan(source) : null;
    if (!plan) {
      notify('warn', 'COG.Cameras.NoActor');
      return;
    }
    if (plan.result !== prompt.result) {
      notify('warn', 'COG.Cameras.RowChanged');
      return;
    }
    const choice = plan.cell?.choices?.find(c => c.id === button?.dataset?.choiceId);
    if (!choice) {
      notify('warn', 'COG.Cameras.ChoiceGone');
      return;
    }
    const { actor, record } = plan;
    const floor = record.floor || effectiveFloor(actor);
    const boxPlan = benefactorChoicePlan(actor, choice.benefactor, floor);
    let ruleBreak = false;
    if (boxPlan?.reasons.length) {
      const res = await confirmRuleBreak({
        title: benefactorText('COG.Sponsor.Benefactor.ReasonTitle'),
        message: benefactorText('COG.Sponsor.Benefactor.ReasonMessage', { name: actor.name, reasons: benefactorReasonsText(boxPlan.reasons) })
      });
      if (!res.confirmed) return;
      ruleBreak = true;
      // Another GM client may have answered while the question was open.
      if (readCameraPrompt(messageById(message.id) ?? message)?.resolved) {
        notify('info', 'COG.Cameras.AlreadyResolved');
        return;
      }
    }
    await message.update({
      [cameraPromptPath('resolved')]: choice.id,
      content: `<div class="cog-chat-card cog-camera-prompt"><p>${escapeAttr(cameraText('COG.Cameras.Chosen', { choice: choice.label }))}</p></div>`
    });
    const reason = `${cameraReasonLabel(record.choice)}: ${choice.label}`;
    const popularity = Number(choice.popularity) || 0;
    const aiFavor = Number(choice.aiFavor) || 0;
    let aiWritten = true;
    if (popularity) await addPopularity(actor, popularity, reason);
    if (aiFavor) aiWritten = await addAiFavor(actor, aiFavor, reason);
    if (choice.bar) await setAiFavorBar(actor);
    const applied = choice.benefactor ? await applyBenefactorChoice(actor, choice.benefactor, { floor }) : null;
    const reasonLabel = cameraReasonLabel(record.choice);
    let text;
    if (applied?.boxName) text = benefactorText('COG.Sponsor.Benefactor.Line', { reason: reasonLabel, name: actor.name, box: applied.boxName });
    else if (applied && !applied.written && applied.reason === 'no-sponsor') text = benefactorText('COG.Sponsor.Benefactor.LineNoSponsor', { reason: reasonLabel, name: actor.name });
    else {
      const changes = cameraChangesText({ popularity, aiFavor: aiWritten ? aiFavor : 0 });
      text = cameraText('COG.Cameras.ChoiceLine', { reason: reasonLabel, name: actor.name, choice: changes ? `${choice.label} (${changes})` : choice.label });
    }
    await lineCard(actor, lineHtml(text, ruleBreak), { ruleBreak });
    if (applied?.boxName) await logSponsor(actor, applied.boxName);
    else if (choice.note && applied?.written !== false) await logSponsor(actor, choice.note);
  } finally {
    choicesInFlight.delete(message.id);
  }
}

/** The GM awards the AI Favor a bar withheld, as a Rule Break. */
export async function handleCameraWithheld(event, button, message) {
  if (!gmOnly()) return;
  const plan = cameraAwardPlan(message);
  const amount = plan?.record?.withheld?.aiFavor ?? 0;
  if (!plan || !plan.trusted || !amount) return;
  const { actor, record } = plan;
  const res = await confirmRuleBreak({
    title: cameraText('COG.Cameras.WithheldTitle'),
    message: cameraText('COG.Cameras.WithheldMessage', { name: actor.name, n: signed(amount) })
  });
  if (!res.confirmed) return;
  await message.update({
    [cameraFlagPath('settled.aiFavor')]: record.settled.aiFavor + amount,
    [cameraFlagPath('withheld')]: null
  });
  const reason = `${cameraReasonLabel(record.choice)} (Rule Break)`;
  await addAiFavor(actor, amount, reason, { ruleBreak: true });
  await lineCard(actor, lineHtml(cameraText('COG.Cameras.Line', { reason: cameraReasonLabel(record.choice), name: actor.name, changes: cameraChangesText({ aiFavor: amount }), result: plan.result ? cameraResultLabel(plan.result) : '' }), true), { ruleBreak: true });
}
