/**
 * Playing to the Cameras: the award (D-C1 to D-C8).
 *
 * A card whose roll carried a camera choice holds `flags.sprinter-rpg.cameras`. When the roll's result is known the
 * active GM settles Table 52 for it: the automatic Popularity and AI Favor amounts are written once, the difference
 * is written when the result changes (an Intervene, a Called Play, the GM's row pick), and a cell with a GM choice
 * posts a whispered prompt card. Everything is written on the GM's client; the hooks only read the message.
 *
 * Camera Popularity counts on every floor (D-C6, answered b). AI Favor gains while the day's bar is up are withheld
 * (never written from a hook, never a modal); the GM's button asks the Rule Break.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { CAMERAS_FLAG, sanitizeCameraRecord, cameraRowOf, cameraCell, cameraReasonLabel, cameraText } from '../../utils/roll/cameras.mjs';
import { readCheckRecord, effectiveCheck } from '../../utils/roll/check-assists.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { isActiveGM } from '../../utils/gm-relay.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { ruleBreakBadgeHtml, ruleBreakMessageData } from '../../utils/rule-break-visibility.mjs';
import { addPopularity } from '../../documents/actor/actor-popularity.mjs';
import { COGSessionEngine } from '../../documents/session/session-engine.mjs';
import { addAiFavor, aiFavorBarState, setAiFavorBar } from './ai-favor-tally.mjs';
import { isTrustedAssist } from './use-assist.mjs';

/** The chat-message flag on a prompt card: `{ sourceId, row, resolved }`. */
const CAMERA_PROMPT_FLAG = 'cameraPrompt';

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const notify = (level, key, data) => globalThis.ui?.notifications?.[level]?.(cameraText(key, data));
const camerasPath = (tail) => `flags.${SYSTEM_ID}.${CAMERAS_FLAG}.${tail}`;

function flagOf(message, key) {
  return typeof message?.getFlag === 'function' ? message.getFlag(SYSTEM_ID, key) : message?.flags?.[SYSTEM_ID]?.[key];
}

function messageById(id) {
  return typeof id === 'string' && id ? (globalThis.game?.messages?.get?.(id) ?? null) : null;
}

/** "Amazing Success" for a Table 52 row. */
export function cameraRowLabel(row) {
  return cameraText(`COG.Cameras.Row${row}`);
}

/** "+2 Popularity, -1 AI Favor" for a pair of amounts; '' when both are zero. */
export function cameraChangesText({ popularity = 0, aiFavor = 0 } = {}) {
  const parts = [];
  if (popularity) parts.push(cameraText('COG.Cameras.Popularity', { value: signed(popularity) }));
  if (aiFavor) parts.push(cameraText('COG.Cameras.AiFavor', { value: signed(aiFavor) }));
  return parts.join(', ');
}

/**
 * The Table 52 row of a camera card: the GM's pick when set, else the card's check record. A pending card, a card
 * with no record, or several targets that land in different rows have no row (D-C3 a).
 * @param {object} message
 * @param {ReturnType<typeof sanitizeCameraRecord>} [record]
 * @returns {number|null}
 */
function cameraRowFor(message, record = sanitizeCameraRecord(flagOf(message, CAMERAS_FLAG))) {
  if (record?.pickedRow) return record.pickedRow;
  const check = readCheckRecord(message);
  const eff = effectiveCheck(check);
  if (!eff || eff.pending) return null;
  const outcomes = check.evade ? [eff.outcome] : eff.outcomes;
  const rows = new Set(outcomes.map(cameraRowOf));
  return rows.size === 1 && !rows.has(null) ? [...rows][0] : null;
}

/**
 * What settling this card would do right now. Pure reads; null when the card has no camera record or crawler.
 * @returns {null|{ record: object, actor: object, trusted: boolean, row: number|null, cell: object|null,
 *   delta: { popularity: number, aiFavor: number }, withhold: boolean, needsPrompt: boolean, pending: boolean }}
 */
export function cameraAwardPlan(message) {
  const record = sanitizeCameraRecord(flagOf(message, CAMERAS_FLAG));
  if (!record) return null;
  const actor = resolveActorByUuid(record.actorUuid);
  if (!actor || actor.type === 'mob') return null;
  const row = cameraRowFor(message, record);
  const cell = row ? cameraCell(record.choice, row) : null;
  const want = cell?.auto ?? { popularity: 0, aiFavor: 0 };
  const delta = { popularity: want.popularity - record.settled.popularity, aiFavor: want.aiFavor - record.settled.aiFavor };
  const withhold = Boolean(row) && delta.aiFavor > 0 && aiFavorBarState(actor).barred;
  const needsPrompt = Boolean(cell?.choices?.length) && !record.prompts[row];
  const sameWithheld = withhold ? record.withheld?.aiFavor === delta.aiFavor : !record.withheld;
  const pending = Boolean(row) && (record.settled.row !== row || delta.popularity !== 0 || (delta.aiFavor !== 0 && !withhold) || needsPrompt || !sameWithheld);
  return { record, actor, trusted: isTrustedAssist(message, actor), row, cell, delta, withhold, needsPrompt, pending };
}

function lineCard(actor, { content, ruleBreak = false, flags = {} }) {
  const data = {
    speaker: globalThis.ChatMessage?.getSpeaker?.({ actor }),
    content: `<div class="cog-chat-card cog-camera-award">${content}</div>`,
    flags: { [SYSTEM_ID]: { cameraAward: true, ruleBreak, ...flags } }
  };
  return globalThis.ChatMessage?.create?.(ruleBreak ? ruleBreakMessageData(data) : data);
}

function lineHtml(text, ruleBreak = false) {
  return `<p><i class="fa-solid fa-video"></i> ${escapeHtml(text)}${ruleBreak ? ` ${ruleBreakBadgeHtml({ cls: '' })}` : ''}</p>`;
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
  const { record, actor, row, cell } = plan;
  const reason = cameraReasonLabel(record.choice);
  const buttons = cell.choices.map(c => `<button type="button" class="cog-camera-choice" data-action="crawlerCameraChoice" data-gm-only="true" data-choice-id="${escapeHtml(c.id)}">${escapeHtml(c.label)}</button>`).join('');
  const whisper = globalThis.ChatMessage?.getWhisperRecipients?.('GM')?.map(u => u.id);
  const created = await globalThis.ChatMessage?.create?.({
    speaker: globalThis.ChatMessage?.getSpeaker?.({ actor }),
    content: `<div class="cog-chat-card cog-camera-prompt"><p>${escapeHtml(cameraText('COG.Cameras.PromptTitle', { reason, name: actor.name, row: cameraRowLabel(row) }))}</p><div class="cog-camera-choices">${buttons}</div></div>`,
    ...(whisper?.length ? { whisper } : {}),
    flags: { [SYSTEM_ID]: { [CAMERA_PROMPT_FLAG]: { sourceId: message.id, row, resolved: null } } }
  });
  if (created?.id) await message.update({ [camerasPath(`prompts.${row}`)]: created.id });
}

async function settleNow(message) {
  const plan = cameraAwardPlan(message);
  if (!plan) return { skipped: 'no-record' };
  if (!plan.trusted) return { skipped: 'untrusted' };
  if (plan.row === null) return { skipped: 'pending' };
  if (!plan.pending) return { skipped: 'settled' };
  const { record, actor, row, cell, delta, withhold } = plan;
  const aiDelta = withhold ? 0 : delta.aiFavor;
  const settled = { row, popularity: record.settled.popularity + delta.popularity, aiFavor: record.settled.aiFavor + aiDelta };
  const withheld = withhold ? { aiFavor: delta.aiFavor } : null;
  // Claim first: a second pass (the update hook of this very write) then sees nothing left to do.
  await message.update({ [camerasPath('settled')]: settled, [camerasPath('withheld')]: withheld });

  const reason = `${cameraReasonLabel(record.choice)} (${cameraRowLabel(row)})`;
  if (delta.popularity) await addPopularity(actor, delta.popularity, reason);
  if (aiDelta) await addAiFavor(actor, aiDelta, reason, { interactive: false });
  if (record.settled.row !== row || delta.popularity || aiDelta) {
    const changes = cameraChangesText({ popularity: delta.popularity, aiFavor: aiDelta });
    const base = changes
      ? cameraText('COG.Cameras.Line', { reason: cameraReasonLabel(record.choice), name: actor.name, changes, row: cameraRowLabel(row) })
      : cameraText('COG.Cameras.LineNone', { reason: cameraReasonLabel(record.choice), name: actor.name, row: cameraRowLabel(row) });
    const text = cell?.text ? `<p>${escapeHtml(cell.text)}</p>` : '';
    await lineCard(actor, { content: lineHtml(base) + text });
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
  if (!flagOf(message, CAMERAS_FLAG)) return Promise.resolve({ skipped: 'no-record' });
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
    if (!flagOf(message, CAMERAS_FLAG)) return;
    settleCameraAward(message).catch(err => console.warn('Sprinter RPG | Camera award failed', err));
  };
  globalThis.Hooks?.on?.('createChatMessage', onMessage);
  globalThis.Hooks?.on?.('updateChatMessage', onMessage);
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

/** The GM names the result when the engine cannot (`data-row` 1-4); the card then settles from it. */
export async function handleCameraPickRow(event, button, message) {
  if (!gmOnly()) return;
  const row = Number(button?.dataset?.row);
  if (!Number.isInteger(row) || row < 1 || row > 4) return;
  if (!sanitizeCameraRecord(flagOf(message, CAMERAS_FLAG))) return;
  await message.update({ [camerasPath('pickedRow')]: row });
  await settleCameraAward(message, { force: true });
}

/** The GM's Award button: settle now, whether or not an active GM saw the update. */
export async function handleCameraAward(event, button, message) {
  if (!gmOnly()) return;
  const res = await settleCameraAward(message, { force: true });
  if (res?.skipped === 'untrusted') notify('warn', 'COG.Cameras.Untrusted');
}

/** Apply one GM choice from a prompt card, once. */
export async function handleCameraChoice(event, button, message) {
  if (!gmOnly()) return;
  const prompt = flagOf(message, CAMERA_PROMPT_FLAG);
  if (!prompt) return;
  if (prompt.resolved) {
    notify('info', 'COG.Cameras.AlreadyResolved');
    return;
  }
  const source = messageById(prompt.sourceId);
  const plan = source ? cameraAwardPlan(source) : null;
  if (!plan) {
    notify('warn', 'COG.Cameras.NoActor');
    return;
  }
  if (plan.row !== prompt.row) {
    notify('warn', 'COG.Cameras.RowChanged');
    return;
  }
  const choice = plan.cell?.choices?.find(c => c.id === button?.dataset?.choiceId);
  if (!choice) return;
  const { actor, record } = plan;
  // Claim the prompt before writing so a second click cannot apply again.
  await message.update({
    [`flags.${SYSTEM_ID}.${CAMERA_PROMPT_FLAG}.resolved`]: choice.id,
    content: `<div class="cog-chat-card cog-camera-prompt"><p>${escapeHtml(cameraText('COG.Cameras.Chosen', { choice: choice.label }))}</p></div>`
  });
  const reason = `${cameraReasonLabel(record.choice)}: ${choice.label}`;
  const popularity = Number(choice.popularity) || 0;
  const aiFavor = Number(choice.aiFavor) || 0;
  let aiWritten = true;
  if (popularity) await addPopularity(actor, popularity, reason);
  if (aiFavor) aiWritten = await addAiFavor(actor, aiFavor, reason);
  if (choice.bar) await setAiFavorBar(actor);
  const changes = cameraChangesText({ popularity, aiFavor: aiWritten ? aiFavor : 0 });
  await lineCard(actor, {
    content: lineHtml(cameraText('COG.Cameras.ChoiceLine', { reason: cameraReasonLabel(record.choice), name: actor.name, choice: changes ? `${choice.label} (${changes})` : choice.label }))
  });
  if (choice.note) await logSponsor(actor, choice.note);
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
    [camerasPath('settled.aiFavor')]: record.settled.aiFavor + amount,
    [camerasPath('withheld')]: null
  });
  const reason = `${cameraReasonLabel(record.choice)} (Rule Break)`;
  await addAiFavor(actor, amount, reason, { ruleBreak: true });
  await lineCard(actor, {
    ruleBreak: true,
    content: lineHtml(cameraText('COG.Cameras.Line', { reason: cameraReasonLabel(record.choice), name: actor.name, changes: cameraChangesText({ aiFavor: amount }), row: plan.row ? cameraRowLabel(plan.row) : '' }), true)
  });
}
