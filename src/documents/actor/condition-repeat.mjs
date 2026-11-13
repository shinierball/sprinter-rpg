/**
 * What a new application of a debuff does on an actor that may already carry it (a pure rule: no dialog, no write).
 * `applyCondition` acts on the verdict; the GM's ruling for an `ask` is `condition-repeat-ask.mjs`.
 */
import { getItemAllTags } from '../active-tags.mjs';

/** The GM's answers to an `ask` verdict: nothing more happens, or the plain debuff lands beside the one already there. */
export const REPEAT_RULINGS = Object.freeze({ NONE: 'none', BESIDE: 'beside' });

const carriesTag = (item, tagId) => Array.from(item?.allTags || getItemAllTags(item)).includes(tagId);

/** The identifier a debuff is stored under. */
const identifierOf = (item) => String(item?.system?.identifier ?? '').trim();

/**
 * @param {Iterable<object>} actorItems the actor's embedded items
 * @param {object} debuffData the incoming debuff's item data (`system.repeat`)
 * @param {string} tagId the incoming debuff's condition tag
 * @returns {{ action: 'create'|'refresh'|'promote'|'ask', existing: object|null, into: string }}
 *   `ask`: `existing` is the debuff the pair would become (the Long-Term form), already on the actor.
 */
export function repeatVerdict(actorItems, debuffData, tagId) {
  const debuffs = Array.from(actorItems ?? []).filter((i) => i?.type === 'debuff');
  const same = tagId ? (debuffs.find((i) => carriesTag(i, tagId)) ?? null) : null;
  const mode = debuffData?.system?.repeat?.mode;
  const into = String(debuffData?.system?.repeat?.into ?? '').trim();
  if (mode === 'stack') return { action: 'create', existing: same, into: '' };
  if (mode === 'promote' && into) {
    const promoted = debuffs.find((i) => identifierOf(i) === into);
    if (promoted) return { action: 'ask', existing: promoted, into };
    return same ? { action: 'promote', existing: same, into } : { action: 'create', existing: null, into };
  }
  return same ? { action: 'refresh', existing: same, into: '' } : { action: 'create', existing: null, into: '' };
}
