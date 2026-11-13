/**
 * The tag-query editor's view: labelled pills per bucket for the `tag-query-editor`
 * partial, the role select and the per-pill and per-row warning badges.
 * Used by the modifier row editor (`context-rows.mjs`), a technique's `appliesToQuery` and a space upgrade's
 * training skills. Everything the template needs is computed here (CONTRIBUTING §5, precompute complex options).
 * Badges warn; nothing here ever blocks an edit.
 */
import { isPartyTag, isTargetSensitiveTag, splitRoleTag } from '../../data/tag-vocabulary.mjs';
import { getTagDefinition, isValidTag } from '../../data/tag-definitions.mjs';
import { ROW_ARRAYS, rowKindOf } from '../../utils/row-kinds.mjs';
import { queryReferences } from '../../utils/tag/tag-query.mjs';

/** i18n keys of the bucket captions (the editor localizes them). */
const QUERY_BUCKET_LABELS = Object.freeze({
  all: 'COG.Rows.Bucket.All',
  any: 'COG.Rows.Bucket.Any',
  none: 'COG.Rows.Bucket.None'
});

/** The role choices in display order. 'action' is the unprefixed tag (the action's own context). */
const QUERY_ROLES = Object.freeze(['action', 'self', 'subject', 'attacker']);
const ROLE_KEYS = Object.freeze({
  action: 'COG.Rows.Role.Action',
  self: 'COG.Rows.Role.Self',
  subject: 'COG.Rows.Role.Subject',
  attacker: 'COG.Rows.Role.Attacker'
});

/**
 * The role selector options for an array's roles ("The action" first), or null when the editor has no roles
 * (`scaleBy.where`, `appliesToQuery`, `training.allowedSkillTags`, `requires`).
 * @param {readonly string[]|null|undefined} roles
 * @returns {Array<{ value: string, labelKey: string, selected: boolean }>|null}
 */
export function roleOptionsFor(roles) {
  if (!Array.isArray(roles) || !roles.length) return null;
  return QUERY_ROLES.filter((r) => r === 'action' || roles.includes(r))
    .map((value) => ({ value, labelKey: ROLE_KEYS[value], selected: value === 'action' }));
}

/** The roles the rows of an array can see, from the registry (null for an unknown array). */
export function rolesOfArray(arrayKey) {
  return ROW_ARRAYS[arrayKey]?.roles ?? null;
}

/**
 * Build the id a tag editor adds. A tag that is already role-prefixed is kept as typed; a role chosen on top of it is
 * ignored and flagged (`doubleRole`).
 * @param {string} tagId
 * @param {string} role 'action' | 'self' | 'subject' | 'attacker'
 * @param {(role: string, tag: string) => string} spell `roleTag` from tags.mjs
 * @returns {{ id: string, doubleRole: boolean }}
 */
export function composeQueryTag(tagId, role, spell) {
  const id = String(tagId || '').trim();
  if (!id || !QUERY_ROLES.includes(role) || role === 'action') return { id, doubleRole: false };
  if (splitRoleTag(id)) return { id, doubleRole: true };
  return { id: spell(role, id), doubleRole: false };
}

/** The warnings of one stored tag ID for an array whose rows see `roles` (null = not a row condition). */
function pillBadges(id, roles, warnUnprefixed) {
  const split = splitRoleTag(id);
  if (split) {
    return Array.isArray(roles) && !roles.includes(split.role)
      ? [{ key: 'COG.Rows.Badge.RoleNeverSeen', value: split.role }]
      : [];
  }
  if (!warnUnprefixed) return [];
  return isPartyTag(id) ? [{ key: 'COG.Rows.Badge.UnprefixedCreature' }] : [];
}

/** A pill for one tag ID; IDs outside the registry (and not `id.*` identity tags) carry a warning flag. */
export function tagPill(id, roles = null, warnUnprefixed = Array.isArray(roles)) {
  const def = getTagDefinition(id);
  const badges = pillBadges(id, roles, warnUnprefixed);
  return {
    id,
    label: def?.label || id,
    unregistered: !def && !isValidTag(id) && !String(id).startsWith('id.'),
    badges,
    flagged: badges.length > 0
  };
}

/**
 * The view of one tag query for the `tag-query-editor` partial.
 * @param {object} query `{ all, any, none }` (missing buckets read as empty)
 * @param {string} path document path of the query, e.g. `system.damageModifiers.2.condition`
 * @param {readonly string[]} [buckets] buckets to show
 * @param {object} [options]
 * @param {readonly string[]|null} [options.roles] roles the owning array sees; omitted = no role select, no role badges
 * @param {boolean} [options.warnUnprefixed] badge a bare creature tag "whose?" (default: only when `roles` is given, i.e. for a row condition;
 *   a filter that counts creatures, e.g. scale `where`, or a query that is not a row condition does not warn)
 * @param {boolean} [options.gm] may create `situation.*` tags (default: the current user is a GM)
 */
export function buildQueryView(query, path, buckets = ['all', 'any', 'none'], { roles = null, gm, warnUnprefixed = Array.isArray(roles) } = {}) {
  return {
    path,
    roleOptions: roleOptionsFor(roles),
    canCreateSituation: gm ?? globalThis.game?.user?.isGM === true,
    buckets: buckets.map((bucket) => ({
      bucket,
      path,
      label: QUERY_BUCKET_LABELS[bucket] ?? bucket,
      tags: (Array.isArray(query?.[bucket]) ? query[bucket] : []).filter(Boolean).map((id) => tagPill(id, roles, warnUnprefixed))
    }))
  };
}

/**
 * Row-level info badges of a row's condition (spec 8.3): per target / first target for damage and roll rows, always
 * on versus per hit for defense rows. Info only. A row whose kind is not registered gets none.
 * @returns {Array<{ key: string, tone: 'info', isInfo: true }>}
 */
export function conditionBadges(arrayKey, row) {
  const { def } = rowKindOf(arrayKey, row);
  if (!def) return [];
  const condition = row?.condition;
  if (arrayKey === 'defenseModifiers') {
    if (def.static === 'derived') return [{ key: 'COG.Rows.Badge.Static', tone: 'info', isInfo: true }];
    const empty = !queryReferences(condition, () => true);
    if (def.static === 'unconditional' && empty) return [{ key: 'COG.Rows.Badge.StaticUnconditional', tone: 'info', isInfo: true }];
    return [{ key: 'COG.Rows.Badge.PerHit', tone: 'info', isInfo: true }];
  }
  if (!queryReferences(condition, isTargetSensitiveTag)) return [];
  if (def.apply?.target || def.apply?.rollBonus) return [{ key: 'COG.Rows.Badge.PerTarget', tone: 'info', isInfo: true }];
  const rolls = arrayKey === 'attackModifiers' || arrayKey === 'checkModifiers';
  if (rolls && queryReferences(condition, (t) => splitRoleTag(t)?.role === 'subject')) return [{ key: 'COG.Rows.Badge.FirstTarget', tone: 'info', isInfo: true }];
  return [];
}
