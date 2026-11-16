/**
 * The Rank a ranked buff lands at when a person drops it by hand (core p. 209: a buff's effect grows at set Ranks, and a
 * buff from a spell or skill knows the Rank it was used at; one dragged from a compendium does not). Pure test of which buffs
 * need asking, and the one small dialog that asks.
 */
import { SKILL_SOFT_CAP } from '../skill/rank-limits.mjs';
import { escapeAttr } from '../escape-attr.mjs';
import { buffCardText } from '../card/buff-card-text.mjs';
import { confirmRuleBreak, withRuleBreak } from '../rule-break.mjs';

/** The Rank the dialog starts at. */
const DEFAULT_LANDING_RANK = 1;

/** Keys that gate a row by Rank. */
const RANK_GATES = ['minRank', 'maxRank'];

/** Deepest nesting searched for a gated row. */
const MAX_ROW_DEPTH = 4;

/** Whether any row in `value` (an array of rows, or an object holding them, at any depth) is gated by a Rank above 0. */
function hasRankedRow(value, depth = 0) {
  if (depth > MAX_ROW_DEPTH || !value || typeof value !== 'object') return false;
  if (!Array.isArray(value) && RANK_GATES.some((key) => Number(value[key]) > 0)) return true;
  return Object.values(value).some((inner) => hasRankedRow(inner, depth + 1));
}

/**
 * Whether a dropped buff should ask for its Rank: its Rank is 0 and some row of its is gated by `minRank` or `maxRank`
 * above 0 (read from every row array it has, so a new kind of row array is covered).
 * @param {object} buffData item creation data
 * @returns {boolean}
 */
function needsRankPrompt(buffData) {
  const system = buffData?.system ?? {};
  return !(Number(system.rank) > 0) && hasRankedRow(system);
}

/**
 * Ask which Rank a buff lands at. Closing the dialog answers 0, which counts every row.
 * @param {object} buffData
 * @returns {Promise<number>} an integer from 0 up (a negative or non-numeric answer is 0)
 */
async function askLandingRank(buffData) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.prompt !== 'function') return 0;
  const label = buffCardText('COG.BuffCard.RankLabel');
  const answer = await DialogV2.prompt({
    window: { title: buffCardText('COG.BuffCard.RankTitle') },
    content: `<p>${escapeAttr(buffCardText('COG.BuffCard.RankMessage', { buff: buffData?.name || 'Buff' }))}</p>`
      + `<div class="form-group"><label>${escapeAttr(label)}</label>`
      + `<input type="number" name="rank" value="${DEFAULT_LANDING_RANK}" min="0" step="1"></div>`,
    ok: {
      label: buffCardText('COG.BuffCard.RankConfirm'),
      callback: (event, button) => Number(button.form?.elements?.rank?.value)
    },
    rejectClose: false,
    modal: true
  });
  const rank = Math.trunc(Number(answer));
  return Number.isFinite(rank) ? Math.max(0, rank) : 0;
}

/**
 * Creation data with the Rank a person chose for it, when it needs asking; otherwise the data as given. A Rank above the
 * usual limit asks the Rank Break confirm and, confirmed, lands stamped as a Rule Break.
 * @returns {Promise<object|null>} the data, or null when the person declined the Rule Break (nothing should be created)
 */
export async function withLandingRank(buffData) {
  if (!needsRankPrompt(buffData)) return buffData;
  const rank = await askLandingRank(buffData);
  const data = { ...buffData, system: { ...buffData.system, rank } };
  if (rank <= SKILL_SOFT_CAP) return data;
  const name = buffData?.name || 'Buff';
  const verdict = await confirmRuleBreak({
    title: buffCardText('COG.BuffCard.RankBreakTitle'),
    message: escapeAttr(buffCardText('COG.BuffCard.RankBreakMessage', { buff: name, rank, cap: SKILL_SOFT_CAP })),
    reason: buffCardText('COG.BuffCard.RankBreakMessage', { buff: name, rank, cap: SKILL_SOFT_CAP })
  });
  return verdict.confirmed ? withRuleBreak(data) : null;
}
