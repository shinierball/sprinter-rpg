/**
 * Stored-data migration for Playing to the Cameras cards. Release 8.0.0 to 8.3.0 named a card's Table 52 row by a number
 * 1-4 (`cameras.settled.row`, `cameras.pickedRow`, `cameras.prompts` keyed by row, and `cameraPrompt.row` on a prompt card).
 * The table has six printed rows now, named by result id (`settled.result`, `pickedResult`, `resultPrompts`,
 * `cameraPrompt.result`). Old row 3 stood for Near Miss, Standard Fail and Major Fail together, so it is read from the card's
 * own check record, exactly as the award's `cameraResultFor` reads a result.
 *
 * A converted card that had settled is `closed`: it paid under the table of its day and is never settled again, because
 * the amounts it paid (and the GM's choices, which were never recorded on the card) cannot be re-derived for the new rows.
 *
 * The result ids are copied here, not imported, so the conversion stays fixed if the table's ids ever change. The award's
 * reader (`chat/actions/cameras.mjs`) imports this file; `utils/roll/cameras.mjs` does not, as `check-assists.mjs`
 * would then close an import cycle through `roll-context.mjs`.
 */
import { registerMigration } from '../migrations/registry.mjs';
import { readFlag } from '../flags.mjs';
import { CHECK_RECORD_FLAG as CHECK, effectiveCheck } from './check-assists.mjs';
import { readCameraFlag, readCameraPrompt, withCameraFlags } from './cameras.mjs';

/** Old row to result id; row 3 is read from the card's outcome. */
const OLD_ROW = Object.freeze({ 1: 'amazing', 2: 'success', 4: 'critical-fail' });
/** The three outcomes old row 3 covered. */
const ROW_3_OUTCOME = Object.freeze({ near_miss: 'near-miss', failure: 'fail', major_failure: 'major-fail' });

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const rowOf = (value) => {
  const n = Number(value);
  return value !== '' && value !== null && Number.isInteger(n) && n >= 1 && n <= 4 ? n : null;
};

/** The result id an old row 3 card was in: its check record's outcome, `fail` when it has none, is pending or its targets disagree. */
function rowThreeResult(source) {
  const check = readFlag(source, CHECK);
  const eff = isRecord(check) ? effectiveCheck(check) : null;
  if (!eff || eff.pending) return 'fail';
  const outcomes = check.evade ? [eff.outcome] : eff.outcomes;
  const results = new Set((Array.isArray(outcomes) ? outcomes : []).map((outcome) => ROW_3_OUTCOME[outcome] ?? 'fail'));
  return results.size === 1 ? [...results][0] : 'fail';
}

/** The converted `cameras` record, or null when it holds none of the three old keys. */
function convertCard(source, record) {
  const settled = isRecord(record.settled) ? record.settled : null;
  const hasSettledRow = Boolean(settled) && 'row' in settled;
  if (!hasSettledRow && !('pickedRow' in record) && !('prompts' in record)) return null;
  const three = rowThreeResult(source);
  const resultOf = (row) => {
    const n = rowOf(row);
    return n === 3 ? three : (OLD_ROW[n] ?? null);
  };
  const { pickedRow, prompts, ...next } = record;
  if (hasSettledRow) {
    const { row, ...rest } = settled;
    const result = resultOf(row);
    next.settled = { ...(result ? { result } : {}), ...rest };
    if (result) next.closed = true;
  }
  if ('pickedRow' in record) {
    const result = resultOf(pickedRow);
    if (result && next.pickedResult === undefined) next.pickedResult = result;
  }
  if ('prompts' in record) {
    const moved = {};
    if (isRecord(prompts)) {
      for (const [row, id] of Object.entries(prompts)) {
        const result = resultOf(row);
        if (result && typeof id === 'string' && id) moved[result] = id;
      }
    }
    next.resultPrompts = { ...moved, ...(isRecord(record.resultPrompts) ? record.resultPrompts : {}) };
  }
  return next;
}

registerMigration({
  id: 'camera-results',
  release: '8.4.0',
  covers: [],
  documents: {
    ChatMessage(source) {
      const patch = {};
      const record = readCameraFlag(source);
      if (isRecord(record)) {
        const converted = convertCard(source, record);
        if (converted) patch.record = converted;
      }
      const prompt = readCameraPrompt(source);
      if (isRecord(prompt) && 'row' in prompt) {
        const { row, ...rest } = prompt;
        const n = rowOf(row);
        const result = n === 3 ? 'fail' : (OLD_ROW[n] ?? null);
        patch.prompt = { ...rest, ...(result && rest.result === undefined ? { result } : {}) };
      }
      return Object.keys(patch).length ? withCameraFlags(source, patch) : source;
    }
  }
});
