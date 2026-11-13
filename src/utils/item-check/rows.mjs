/**
 * src/utils/item-check/rows.mjs
 * The row-level findings gear, buffs and debuffs share: grant rows that are incomplete, modifier rows that are inert,
 * and skill, spell, buff and debuff references this world cannot resolve. Reuses `grantRowErrors` and `tagBehaviourErrors`
 * (which runs `rowKindErrors` on every row and checks each row's condition tags) and the reference tables the
 * item-from-words check reads, never a second copy.
 */
import { finding } from './registry.mjs';
import { grantRowErrors } from '../../models/items/grant-validation.mjs';
import { tagBehaviourErrors, TAG_ROW_ARRAYS } from '../tag/tag-behaviour.mjs';
import { resolveReference } from '../item-from-words/check-references.mjs';
import { GRANT_REFERENCES, LIST_REFERENCES } from '../item-from-words/draft-fields.mjs';
import { stringList } from './read.mjs';

const REFERENCE_LISTS = ['persistentBuffs', 'persistentDebuffs'];

/** @param {object} item @param {{ resolve: object }} ctx @returns {Array<import('./registry.mjs').Finding>} */
export function rowFindings(item, ctx) {
  const sys = item.system ?? {};
  const out = [];

  (Array.isArray(sys.grants) ? sys.grants : []).forEach((grant, i) => {
    const path = `system.grants[${i}]`;
    for (const detail of grantRowErrors(grant)) out.push(finding('row.grant-incomplete', 'broken', path, { detail }));
    const kind = GRANT_REFERENCES[grant?.kind];
    if (!kind || grant.disabled === true) return;
    const ref = grant.identifier || grant.uuid;
    if (ref && resolveReference(kind, ref, ctx.resolve).status === 'unresolved') out.push(finding('row.reference-unresolved', 'warning', path, { kind, ref: String(ref) }));
  });

  const rows = Object.fromEntries(TAG_ROW_ARRAYS.filter((key) => Array.isArray(sys[key])).map((key) => [key, sys[key]]));
  if (Object.keys(rows).length) {
    for (const detail of tagBehaviourErrors({ id: 'item', rows })) out.push(finding('row.incomplete', 'warning', 'system', { detail }));
  }

  for (const key of REFERENCE_LISTS) {
    for (const ref of stringList(item, key)) {
      if (resolveReference(LIST_REFERENCES[key], ref, ctx.resolve).status === 'unresolved') out.push(finding('row.reference-unresolved', 'warning', `system.${key}`, { kind: LIST_REFERENCES[key], ref }));
    }
  }
  return out;
}
