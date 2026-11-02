/**
 * Item identifiers. `system.identifier` is the stable key every runtime lookup uses; names are for
 * humans. An item created without one gets its name's slug once (`COGItem#_preCreate`); renaming it later changes
 * nothing.
 */

const isAlnum = (ch) => (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9');

/**
 * A name as an identifier slug: lowercase, every run of non-alphanumerics becomes one `-`, no leading or trailing `-`.
 * @param {*} text
 * @returns {string}
 */
export function slugifyIdentifier(text) {
  return String(text ?? '').toLowerCase().split('').map(ch => (isAlnum(ch) ? ch : '-')).join('')
    .split('-').filter(Boolean).join('-');
}

/** A debuff reference as the bare identifier item sheets store (`condition.stiff_legs` and `Stiff Legs` both give `stiff-legs`). */
export function debuffIdentifier(ref) {
  return slugifyIdentifier(String(ref ?? '').trim().replace(/^condition\./, ''));
}

/**
 * The condition tag a debuff with `identifier` carries (E4.4): `condition.<identifier>`, with `-` spelled `_` so the
 * tag keeps the registered `condition.stiff_legs` form. The one helper `computeDerivedTags`, `applyCondition` and
 * `getItemInflictedConditions` share; renaming a debuff never changes it.
 * @param {*} identifier - a stored `system.identifier` (or an identifier-shaped reference)
 * @returns {string} '' when there is no identifier
 */
export function conditionTagId(identifier) {
  const slug = slugifyIdentifier(identifier).split('-').join('_');
  return slug ? `condition.${slug}` : '';
}

/**
 * The identifier of an item or item data: its stored `system.identifier`, else the slug of its name. Only for items
 * being created or compared at creation (the stored identifier is authoritative afterwards).
 * @param {{name?: string, system?: {identifier?: string}}|null|undefined} itemOrData
 * @returns {string}
 */
export function itemIdentifier(itemOrData) {
  const stored = String(itemOrData?.system?.identifier ?? '').trim();
  return stored || slugifyIdentifier(itemOrData?.name);
}

/**
 * Whether a stored debuff reference (an identifier, or a `condition.*` tag) names the debuff with this identifier. The
 * template helper `sameDebuff` for the debuff selects, which store identifiers (never a name).
 * @param {*} stored
 * @param {*} identifier
 * @returns {boolean}
 */
export function sameDebuffRef(stored, identifier) {
  const tag = (ref) => {
    const clean = String(ref ?? '').trim();
    return clean.startsWith('condition.') ? clean : conditionTagId(clean);
  };
  const a = tag(stored);
  return !!a && a === tag(identifier);
}
