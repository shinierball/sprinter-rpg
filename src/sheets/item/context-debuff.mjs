/**
 * The debuff sheet's "Suppresses" editors: one tag query for the buffs it switches off and one for the skills (a smite,
 * core rulebook pp. 312-314). The queries are 1-to-1 schema fields edited through the shared tag-query editor.
 */
import { buildQueryView } from './context-query.mjs';
import { pickOptions } from '../../utils/ui/field-options.mjs';
import { DEBUFF_SEVERITIES, DEBUFF_REPEAT_MODES } from '../../models/items/debuff-model.mjs';
import { buildPickList, identifierEntries } from './context-pick-list.mjs';

const BUCKETS = Object.freeze(['all', 'any', 'none']);

/**
 * @param {object} context the render context
 * @param {object} item the debuff item
 */
export function buildDebuffSuppressesContext(context, item) {
  const suppresses = item.system?.suppresses ?? {};
  context.suppressBuffsQuery = buildQueryView(suppresses.buffs, 'system.suppresses.buffs', BUCKETS);
  context.suppressSkillsQuery = buildQueryView(suppresses.skills, 'system.suppresses.skills', BUCKETS);
}

/**
 * The debuff sheet's Severity select: every {@link DEBUFF_SEVERITIES} entry, the stored one selected.
 * @param {object} context the render context
 * @param {object} item the debuff item
 */
export function buildDebuffSeverityContext(context, item) {
  context.severityOptions = pickOptions(DEBUFF_SEVERITIES, item.system?.severity);
}

/** The label of each repeat mode in the select. */
const REPEAT_LABELS = Object.freeze({ refresh: 'Refresh', stack: 'Stack', promote: 'Promote' });

/**
 * The debuff sheet's "When applied again" select and the chip picker of debuffs that land with it.
 * @param {object} context the render context (`availableDebuffs` is set)
 * @param {object} item the debuff item
 */
export function buildDebuffRepeatContext(context, item) {
  const mode = item.system?.repeat?.mode;
  context.repeatModeOptions = pickOptions(DEBUFF_REPEAT_MODES.map((id) => ({ id, label: REPEAT_LABELS[id] })), mode);
  context.alsoAppliesPicker = buildPickList({
    label: 'Also lands',
    icon: 'fa-link',
    emptyText: 'None. These debuffs land together with this one.',
    choose: '+ Add debuff...',
    placeholder: 'Or an identifier...',
    lists: [{ list: 'alsoApplies', badge: 'DEBUFF', stored: item.system?.alsoApplies, entries: identifierEntries(context.availableDebuffs), customLabel: 'Debuff' }]
  });
}
