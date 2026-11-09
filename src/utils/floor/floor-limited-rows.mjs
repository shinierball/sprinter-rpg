/**
 * Once-per-floor advancement perks. A roll row with `usesPer: 'floor'` (Human:
 * "add 1 to one skill's Advancement Check each floor") applies to ONE skill per floor. The End-of-floor batch check
 * tags its rolls `check.advancement.floor_end`; for each limited row that matches more than one skill in the run
 * this asks which skill gets it. The record of what was used lives in the actor flag `advancementUsage`, in the
 * same `{ floor: { token, keys } }` shape as popularity's (`utils/floor/popularity.mjs`), so a new floor resets it.
 *
 * A second use on the same floor asks the Rule Break question first (before which skill) and counts as a Rule Break (CONTRIBUTING rule 2). With no UI
 * (`interactive: false`) a row that needs a choice or a confirmation is skipped; a row with exactly one matching
 * skill and no prior use applies without asking.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { evaluateRows } from '../roll/damage-modifiers.mjs';
import { CHECK_TAGS } from '../tag/tag-mechanics.mjs';
import { buildRollContext } from '../roll/roll-context.mjs';
import { popularityTokens, usedKeys, recordUsage } from './popularity.mjs';
import { confirmRuleBreak } from '../rule-break.mjs';
import { getCurrentFloor } from '../../documents/actor/actor-environment.mjs';
import { ADVANCEMENT_USAGE_FLAG } from './floor-row-usage.mjs';

const TEMPLATES = {
  'COG.Advancement.FloorRowTitle': 'Once Per Floor',
  'COG.Advancement.FloorRowPrompt': 'Which skill gets "{label}" this floor?',
  'COG.Advancement.FloorRowPick': 'Apply',
  'COG.Advancement.FloorRowUsed': '{label} was already used this floor. Use it again as a Rule Break?'
};

function t(key, data = {}) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.format === 'function') return i18n.format(key, data);
  return TEMPLATES[key].replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? ''));
}

const escapeHtml = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** The `advancement` context an End-of-floor roll for `skill` is matched against. */
function floorEndTags(actor, skill) {
  return buildRollContext({ actor, phase: 'advancement', item: skill, check: 'advancement', tags: [CHECK_TAGS.advancementFloorEnd] });
}

/**
 * Every `usesPer: 'floor'` row that matches at least one of `skills` in an End-of-floor roll.
 * @param {object} actor
 * @param {Array<object>} skills skill items about to be rolled
 * @returns {Array<{ key: string, row: object, source: object, label: string, skills: Array<object> }>} in row order
 */
function findFloorLimitedRows(actor, skills) {
  const byKey = new Map();
  for (const skill of skills ?? []) {
    // A limited row is judged before the once-per-floor choice exists, so a row only the floor limit rejects still counts
    const candidates = evaluateRows(actor, 'checkModifiers', floorEndTags(actor, skill), { explain: true })
      .filter(e => e.matched || e.reason === 'floorLimit');
    for (const entry of candidates) {
      if (entry.row.usesPer !== 'floor') continue;
      if (!byKey.has(entry.key)) byKey.set(entry.key, { ...entry, label: entry.row.label || entry.source?.name || 'Modifier', skills: [] });
      byKey.get(entry.key).skills.push(skill);
    }
  }
  return [...byKey.values()];
}

/** Ask which of `skills` gets the row. Resolves a skill, or null (closed, or no dialog available). */
async function askWhichSkill(label, skills) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.prompt !== 'function') return null;
  const options = skills.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');
  try {
    const picked = await DialogV2.prompt({
      window: { title: t('COG.Advancement.FloorRowTitle') },
      content: `<p>${escapeHtml(t('COG.Advancement.FloorRowPrompt', { label }))}</p><select name="skill">${options}</select>`,
      ok: {
        label: t('COG.Advancement.FloorRowPick'),
        callback: (_event, button) => button?.form?.elements?.skill?.value ?? null
      },
      rejectClose: false,
      modal: true
    });
    return skills.find(s => s.id === picked) ?? null;
  } catch {
    return null;
  }
}

/**
 * Settle every limited row for an End-of-floor run: which skill gets it, and whether that is a Rule Break. Records the
 * use on the actor for this floor. Rows already used this floor ask first (Rule Break).
 *
 * @param {object} actor
 * @param {Array<object>} skills skill items that will be rolled
 * @param {object} [options] `interactive: false` = no dialogs; `ruleBreak: true` pre-confirms repeats
 * @returns {Promise<{ rows: Map<string, Set<string>>, ruleBreaks: Map<string, boolean> }>} per skill id: the row keys that apply / whether any is a Rule Break
 */
export async function resolveFloorRows(actor, skills, options = {}) {
  const rows = new Map();
  const ruleBreaks = new Map();
  const limited = findFloorLimitedRows(actor, skills);
  if (limited.length === 0) return { rows, ruleBreaks };

  const tokens = popularityTokens({ floor: getCurrentFloor() });
  const record = actor?.flags?.[SYSTEM_ID]?.[ADVANCEMENT_USAGE_FLAG];
  const used = new Set(usedKeys(record, tokens).floor);
  const fired = [];

  for (const entry of limited) {
    // A repeat on the same floor asks the Rule Break question first: declining it spares the user the skill pick.
    const needsChoice = entry.skills.length > 1;
    if (needsChoice && options.interactive === false) continue;
    let ruleBreak = false;
    if (used.has(entry.key)) {
      const res = await confirmRuleBreak({
        title: t('COG.Advancement.FloorRowTitle'),
        message: escapeHtml(t('COG.Advancement.FloorRowUsed', { label: entry.label })),
        options
      });
      if (!res.confirmed) continue;
      ruleBreak = true;
    }
    const target = needsChoice ? await askWhichSkill(entry.label, entry.skills) : entry.skills[0];
    if (!target) continue;
    if (!rows.has(target.id)) rows.set(target.id, new Set());
    rows.get(target.id).add(entry.key);
    if (ruleBreak) ruleBreaks.set(target.id, true);
    used.add(entry.key);
    fired.push({ scope: 'floor', key: entry.key });
  }

  if (fired.length && typeof actor.setFlag === 'function') {
    await actor.setFlag(SYSTEM_ID, ADVANCEMENT_USAGE_FLAG, recordUsage(record, tokens, fired));
  }
  return { rows, ruleBreaks };
}
