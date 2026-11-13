/**
 * The "What's missing" part: the item completeness check (`checkItem`) as a list the sheet shows above its body, each
 * finding with its ready fix when it has one, and the action that applies that fix.
 */
import { checkItem } from '../../utils/item-check/check-item.mjs';
import { worldSkillResolver } from '../../utils/skill/weapon-skill-options.mjs';
import { WEAPON_ACTIONS } from './actions-weapon.mjs';

const SEVERITY_ORDER = Object.freeze({ broken: 0, warning: 1, note: 2 });

/** The findings for an item's current data, read against this world's catalogs. */
function liveFindings(item) {
  const data = typeof item.toObject === 'function' ? item.toObject() : { type: item.type, name: item.name, system: item.system };
  return checkItem(data, { resolve: worldSkillResolver() });
}

/**
 * @param {object} context the render context (`findings` is added)
 * @param {object} item
 */
export function buildFindingsContext(context, item) {
  const i18n = globalThis.game?.i18n;
  const rows = liveFindings(item)
    .map((f, index) => ({ f, index }))
    .sort((a, b) => (SEVERITY_ORDER[a.f.severity] - SEVERITY_ORDER[b.f.severity]) || (a.index - b.index));
  context.findings = rows.map(({ f }) => ({
    code: f.code,
    path: f.path,
    severity: f.severity,
    isBroken: f.severity === 'broken',
    text: i18n?.format?.(f.messageKey, f.data) ?? f.messageKey,
    hasFix: Boolean(f.fix),
    fixLabel: f.fix ? (i18n?.localize?.(`COG.ItemFindings.Fix.${f.fix.op}`) ?? f.fix.op) : ''
  }));
  context.hasFindings = context.findings.length > 0;
}

/** Fix operations by `fix.op`; each returns the update to write, or null when it would change nothing. */
const FIX_OPS = Object.freeze({
  addTags(item, fix) {
    const tags = Array.isArray(item.system?.tags) ? [...item.system.tags] : [];
    const added = (Array.isArray(fix.tags) ? fix.tags : []).filter((id) => typeof id === 'string' && !tags.includes(id));
    return added.length ? { 'system.tags': [...tags, ...added] } : null;
  }
});

/**
 * Apply the fix of the live finding with this code and path (the check is re-run, so a stale button does nothing).
 * @returns {Promise<boolean>} true when the item changed
 */
async function applyFinding(sheet, code, path) {
  const item = sheet.item;
  const found = liveFindings(item).find((f) => f.code === code && f.path === path && f.fix);
  if (found?.fix.op === 'pickAttackSkill') {
    // Not an update: the sheet's own attack-Skill picker opens, and the Skill the user picks is what changes the item.
    WEAPON_ACTIONS.openAttackSkillPicker.call(sheet);
    return false;
  }
  const update = found ? FIX_OPS[found.fix.op]?.(item, found.fix) : null;
  if (!update) return false;
  await item.update(update);
  return true;
}

export const FINDING_ACTIONS = {
  async applyFinding(event, target) {
    if (!this.isEditable) return;
    await applyFinding(this, String(target.dataset.code ?? ''), String(target.dataset.path ?? ''));
  }
};
