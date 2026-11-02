/**
 * Gear skill and spell bonus rows: `system.grants` rows of kind `skill` / `spell` keyed by
 * `system.identifier`. A row's `value` adds to the owned skill or spell; a spell row's `rank` is the rank an unowned
 * spell is granted at. Rows are added by the skill picker or by dropping a skill or spell on the gear sheet, so a
 * row always names its document (the grant validator rejects half-filled rows).
 */
import { identifierOptions } from './identifier-options.mjs';
import { grantDisplayName } from '../../models/actors/actor-derivation.mjs';
import { toRowArray } from '../../models/items/base-item-model.mjs';

/** Kinds the gear bonus table edits. */
export const GEAR_GRANT_KINDS = Object.freeze(['skill', 'spell']);

/** Whether a grant row is a gear skill/spell bonus row (fixed, not a choice). */
export function isGearBonusGrant(row) {
  return GEAR_GRANT_KINDS.includes(row?.kind) && row.mode !== 'choice';
}

/**
 * The grant rows after adding a skill or spell: an existing row for the same kind and identifier gains `value`
 * (or, with `replaceIndex`, that row is pointed at the new identifier); otherwise a new row is appended.
 * @param {Array|object} stored the item's `system.grants`
 * @param {{kind: 'skill'|'spell', identifier: string, label?: string}} ref
 * @param {{value?: number, replaceIndex?: number|null}} [options]
 * @returns {{rows: object[], row: object|null}} a copy of the rows, and the row added or changed (null when `ref` is invalid)
 */
export function addGearGrant(stored, ref, { value = 1, replaceIndex = null } = {}) {
  const rows = toRowArray(stored).map(r => ({ ...r }));
  const kind = GEAR_GRANT_KINDS.includes(ref?.kind) ? ref.kind : null;
  const identifier = String(ref?.identifier ?? '').trim();
  if (!kind || !identifier) return { rows, row: null };
  const label = String(ref.label ?? '').trim();
  if (Number.isInteger(replaceIndex) && isGearBonusGrant(rows[replaceIndex]) && rows[replaceIndex].kind === kind) {
    Object.assign(rows[replaceIndex], { identifier, label, uuid: '' });
    return { rows, row: rows[replaceIndex] };
  }
  const existing = rows.find(r => isGearBonusGrant(r) && r.kind === kind && r.identifier === identifier);
  if (existing) {
    existing.value = (Number(existing.value) || 0) + (Number(value) || 0);
    return { rows, row: existing };
  }
  const row = kind === 'spell'
    ? { kind, identifier, label, rank: 1, value: 0 }
    : { kind, identifier, label, value: Number(value) || 0 };
  rows.push(row);
  return { rows, row };
}

/**
 * Sheet rows for the gear "Skill & Spell bonuses" table, with their index into `system.grants` and a precomputed
 * identifier select (catalog entries of the row's kind; a non-catalog identifier is kept as its own option).
 * @param {Array|object} grants
 * @param {{skills?: object[], spells?: object[]}} [lists] the entries to offer (default: the registry catalogs)
 * @returns {Array<{idx: number, kind: string, isSpell: boolean, identifier: string, name: string, value: number, rank: number, options: Array<{value: string, label: string, selected: boolean}>}>}
 */
export function gearGrantRows(grants, lists = {}) {
  return toRowArray(grants).flatMap((row, idx) => {
    if (!isGearBonusGrant(row)) return [];
    const name = grantDisplayName(row, row.kind);
    return [{
      idx, kind: row.kind, isSpell: row.kind === 'spell', identifier: row.identifier || '', name,
      value: Number(row.value) || 0, rank: Number(row.rank) || 1,
      options: identifierOptions((row.kind === 'spell' ? lists.spells : lists.skills) ?? row.kind, row.identifier, { fallbackLabel: name })
    }];
  });
}
