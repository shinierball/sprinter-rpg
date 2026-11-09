/**
 * Sex select: a sheet control over the actor's own `creature.*` sex tag. Nothing is stored twice: the selected
 * option is derived from `system.tags`, and a change rewrites that array. The options are a registry
 * (`CONFIG.COG.sexOptions === SEX_OPTIONS`); a module adds one with `registerSexOption`. Pure: no document or setting reads
 * beyond the actor passed in.
 */

import { SEX_TAGS } from './tag-mechanics.mjs';

/**
 * @typedef {object} SexOptionDef
 * @property {string} id option value ('' is the blank option and has no tag)
 * @property {string} label plain text shown in the select
 * @property {string} [tag] the tag that is this option; absent only for the blank option
 */

/** @type {Record<string, SexOptionDef>} The registry. `CONFIG.COG.sexOptions === SEX_OPTIONS`. Order is the select's order. */
export const SEX_OPTIONS = {
  '': { id: '', label: '' },
  male: { id: 'male', label: 'Male', tag: SEX_TAGS.male },
  female: { id: 'female', label: 'Female', tag: SEX_TAGS.female },
  nonbinary: { id: 'nonbinary', label: 'Non-binary', tag: SEX_TAGS.nonbinary },
  other: { id: 'other', label: 'Other', tag: SEX_TAGS.other }
};

const OPTION_ID = /^[A-Za-z][\w.-]*$/;

/**
 * Add an option. Modules prefix theirs ('my-module.agender') and give it a tag of their own. A bad definition is refused
 * with a console warning.
 * @param {SexOptionDef} def
 * @returns {boolean} whether it was registered
 */
export function registerSexOption(def) {
  const id = def?.id;
  if (typeof id !== 'string' || !OPTION_ID.test(id) || typeof def.tag !== 'string' || !def.tag.trim()) {
    console.warn(`Sprinter RPG | Sex option ${String(id)} was not registered: it needs an id and a tag.`);
    return false;
  }
  SEX_OPTIONS[id] = { ...def, tag: def.tag.trim(), label: String(def.label || id) };
  return true;
}

/** Every registered sex tag. */
function sexTags() {
  return Object.values(SEX_OPTIONS).map((o) => o.tag).filter(Boolean);
}

const tagArray = (tags) => (Array.isArray(tags) ? tags.filter((t) => typeof t === 'string') : []);

/**
 * The select's read model for an actor.
 * @param {object} actor
 * @param {Iterable<string>} [allTags] the actor's full tag set (own + derived), to find a sex tag that comes from an item
 * @returns {{ options: Array<{value: string, label: string, selected: boolean}>, selectedId: string, extra: boolean, derivedHint: {sex: string, source: string}|null }}
 *   `extra` is true when the actor's own tags carry two or more sex tags (the first one is shown). `derivedHint` names the
 *   sex and the item carrying its tag ('' when no embedded item has it) when only a derived source carries one.
 */
export function sexSelectView(actor, allTags = null) {
  const own = tagArray(actor?.system?.tags);
  const entries = Object.values(SEX_OPTIONS).filter((o) => o.tag);
  const present = own.map((t) => entries.find((o) => o.tag === t)).filter(Boolean);
  const selectedId = present[0]?.id ?? '';
  const extra = new Set(present.map((o) => o.id)).size > 1;
  let derivedHint = null;
  if (!present.length && allTags) {
    const all = new Set(allTags);
    const derived = entries.find((o) => all.has(o.tag));
    if (derived) {
      const source = Array.from(actor?.items ?? []).find((i) => tagArray(i?.system?.tags).includes(derived.tag));
      derivedHint = { sex: derived.label, source: source?.name ?? '' };
    }
  }
  const options = Object.values(SEX_OPTIONS).map((o) => ({ value: o.id, label: o.label, selected: o.id === selectedId }));
  return { options, selectedId, extra, derivedHint };
}

/**
 * The actor's own tag array after choosing an option: registry sex tags removed, the chosen option's tag added, every
 * other tag (including ones outside the registry) kept in place.
 * @param {string[]} ownTags
 * @param {string} optionId
 * @returns {string[]|null} null for an unknown option id
 */
export function tagsWithSex(ownTags, optionId) {
  const def = SEX_OPTIONS[String(optionId ?? '')];
  if (!def) return null;
  const sex = new Set(sexTags());
  const kept = tagArray(ownTags).filter((t) => !sex.has(t));
  if (def.tag) kept.push(def.tag);
  return kept;
}

/**
 * Write the choice to `system.tags`. `verdict(tagId)` (optional) is the actor tag permission check; a refusal for any
 * tag added or removed leaves the actor unchanged.
 * @returns {Promise<{ ok: boolean, reason?: string, tagId?: string }>}
 */
export async function setActorSex(actor, optionId, { verdict } = {}) {
  const before = tagArray(actor?.system?.tags);
  const after = tagsWithSex(before, optionId);
  if (!after) return { ok: false, reason: 'unknown' };
  const changed = [...before.filter((t) => !after.includes(t)), ...after.filter((t) => !before.includes(t))];
  if (!changed.length) return { ok: true };
  for (const tagId of changed) {
    const check = verdict?.(tagId);
    if (check && !check.ok) return { ok: false, reason: check.reason, tagId };
  }
  await actor.update({ 'system.tags': after });
  return { ok: true };
}
