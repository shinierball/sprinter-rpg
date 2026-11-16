/**
 * The Popularity checklist's engine: apply a GM's selection and undo it. Every write is the clicking GM's own (actors, the
 * `sessions` and `popularityChecklist` settings), so there is no relay action: a non-GM client warns and writes nothing,
 * like `awardAchievement`. Popularity goes through `addPopularity` (the actor value plus a ledger entry), never a second
 * writer. The facts it plans on come from `popularity-checklist-facts.mjs`, a Fan Box from `fan-box.mjs`, and the clock
 * records from `popularity-checklist.mjs`, which `actor-environment.mjs` imports; this file imports
 * `actor-environment.mjs`, so the engine stays a separate file (an import cycle otherwise, rail 2).
 */
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { popularityChangesFor } from '../../data/rules/popularity-changes.mjs';
import {
  planChecklist, checklistRuleBreaks, buildCheckRecord, undoEntries, appendApplied, uncrossedByUndo
} from '../../utils/floor/popularity-checklist.mjs';
import { postChecklistSummary, postChecklistUndone, checklistText } from '../../chat/popularity-checklist-card.mjs';
import { getCurrentFloor } from './actor-environment.mjs';
import { addPopularity } from './actor-popularity.mjs';
import { readChecklistState, updateChecklistState } from './popularity-checklist.mjs';
import { gatherChecklistFacts } from './popularity-checklist-facts.mjs';
import { grantFanBox } from './fan-box.mjs';

const KEY = 'COG.PopularityChecklist';
const text = checklistText;

const finite = (value) => (value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null);
const worldNow = () => Number(globalThis.game?.time?.worldTime) || 0;

function notGm() {
  if (globalThis.game?.user && !globalThis.game.user.isGM) {
    globalThis.ui?.notifications?.warn?.(text(`${KEY}.GmOnly`));
    return true;
  }
  return false;
}

/** A change's label as text: its lang key localized when the key exists, else the label itself. */
export function changeLabel(def) {
  const i18n = globalThis.game?.i18n;
  return i18n?.has?.(def.label) && typeof i18n.localize === 'function' ? i18n.localize(def.label) : def.label;
}

const actorOf = (id) => globalThis.game?.actors?.get?.(id) ?? null;

/**
 * Apply a GM's selection: a Rule Break confirm when it needs one, then each change through `addPopularity`, each box
 * through `grantFanBox`, one stored record and one public summary card with Undo. GM only.
 * @param {object} request
 * @param {'session'|'day'|'floor'} request.moment
 * @param {{ sessionId: string, day: number, floor: number }} request.period from `gatherChecklistFacts`
 * @param {{ entries: Array<{ actorId: string, changeId: string, label?: string, delta: number }> }} request.selection
 * @param {Array<{ actorId: string, tier: string, reason: string }>} [request.boxes] 'day-jump' or 'manual'
 * @param {{ interactive?: boolean }} [options] `interactive: false` refuses a Rule Break instead of asking
 * @returns {Promise<object>} the stored record, or `{ cancelled: true }`
 */
export async function applyChecklist({ moment, period, selection, boxes = [] }, { interactive = true } = {}) {
  if (notGm()) return { cancelled: true, reason: 'gm-only' };
  const floor = finite(period?.floor) ?? getCurrentFloor();
  const defs = popularityChangesFor(moment, floor);
  const entries = (selection?.entries ?? [])
    .filter((e) => actorOf(e.actorId) && finite(e.delta) && Number(e.delta) !== 0)
    .map((e) => ({ ...e, label: e.label || changeLabel(defs.find((d) => d.id === e.changeId) ?? { label: '' }) }));
  const picked = { entries };
  const chosenBoxes = boxes.filter((b) => actorOf(b.actorId));

  const { facts } = gatherChecklistFacts(moment, { sessionId: period?.sessionId });
  const plan = planChecklist({ moment, floor, facts, applied: readChecklistState().applied, now: { real: Date.now(), day: period?.day }, defs });
  const ruleBreaks = checklistRuleBreaks(plan, picked);
  if (ruleBreaks.length) {
    const used = ruleBreaks.filter((r) => r.why === 'used').length;
    const first = ruleBreaks.length - used;
    const detail = [
      used ? text(`${KEY}.RuleBreakUsed`, { count: used }) : '',
      first ? text(`${KEY}.RuleBreakFirstFloor`, { count: first }) : ''
    ].filter(Boolean).join('; ');
    const res = await confirmRuleBreak({ title: text(`${KEY}.RuleBreakTitle`), message: text(`${KEY}.RuleBreakMessage`, { detail }), options: { interactive } });
    if (!res.confirmed) return { cancelled: true };
  }

  const reason = text(`${KEY}.ReasonLabel`, { moment: checklistText(`${KEY}.Moment.${moment}`) });
  for (const entry of entries) await addPopularity(actorOf(entry.actorId), Number(entry.delta), entry.label || reason);
  for (const box of chosenBoxes) await grantFanBox(actorOf(box.actorId), box);

  const record = buildCheckRecord({
    moment, period, selection: picked, boxes: chosenBoxes, ruleBreaks,
    by: globalThis.game?.user?.id ?? '', at: Date.now(), worldTime: worldNow()
  });
  const message = entries.length || chosenBoxes.length ? await postChecklistSummary(record) : null;
  record.messageId = message?.id ?? '';
  await updateChecklistState((state) => appendApplied(state, record));
  return record;
}

/**
 * Take an applied record back: the opposite Popularity per crawler (through `addPopularity`, reason "Undo: ..."), the
 * record stamped `undoneAt`, the card marked and a short line posted. A Fan Box already awarded stays; the line names it.
 * The record is claimed before anything is written, so a second call does nothing. GM only.
 * @param {string} checkId
 * @param {{ message?: ChatMessage }} [options] the summary card, when the caller has it
 * @returns {Promise<object|null>} the record, or null (unknown id, already undone, or not a GM)
 */
export async function undoChecklist(checkId, { message } = {}) {
  if (notGm()) return null;
  let claimed = null;
  await updateChecklistState((state) => {
    const applied = (state.applied ?? []).map((r) => {
      if (r.id !== checkId || r.undoneAt || claimed) return r;
      claimed = { ...r, undoneAt: Date.now() };
      return claimed;
    });
    return { ...state, applied };
  });
  if (!claimed) return null;
  const reason = text(`${KEY}.UndoReason`, { label: text(`${KEY}.ReasonLabel`, { moment: checklistText(`${KEY}.Moment.${claimed.moment}`) }) });
  const valuesBefore = {};
  for (const { actorId } of undoEntries(claimed)) valuesBefore[actorId] = Number(actorOf(actorId)?.system?.details?.popularity) || 0;
  for (const { actorId, delta } of undoEntries(claimed)) {
    const actor = actorOf(actorId);
    if (actor) await addPopularity(actor, delta, reason);
  }
  await postChecklistUndone(claimed, message ?? globalThis.game?.messages?.get?.(claimed.messageId), uncrossedByUndo(claimed, valuesBefore));
  return claimed;
}
