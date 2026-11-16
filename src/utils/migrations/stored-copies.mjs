/**
 * Stored copies: places where the system keeps a copy of one document's data inside other data (a race's granted buffs,
 * the pending-secrets setting, archived combats, chat card snapshots). The tree walk never calls the copied type's
 * migration there, so each owner declares its place and a migration that converts the type converts the copies too.
 * The stored-shape rail reads these registrations.
 */

const COPIES = new Map();

const keyOf = (copy) => `${copy.of}@${copy.at}`;

/**
 * @param {{ of: string, at: string }} copy `of`: `<Doc>.<type>` whose data is copied; `at`: the stored-shape key of the place holding the copy
 * @returns {boolean} false, with a console error, when refused (malformed, or the same place registered twice)
 */
export function registerStoredCopy(copy) {
  const wellFormed = copy !== null && typeof copy === 'object'
    && typeof copy.of === 'string' && /^[A-Za-z]+\.[A-Za-z0-9_-]+$/.test(copy.of)
    && typeof copy.at === 'string' && copy.at.length > 0;
  if (!wellFormed) {
    console.error('Sprinter RPG | registerStoredCopy refused: give { of: "<Doc>.<type>", at: "<stored-shape key>" }.');
    return false;
  }
  if (COPIES.has(keyOf(copy))) {
    console.error(`Sprinter RPG | registerStoredCopy refused "${keyOf(copy)}": already registered.`);
    return false;
  }
  COPIES.set(keyOf(copy), Object.freeze({ of: copy.of, at: copy.at }));
  return true;
}

/** Every registered copy place, in registration order (a frozen copy). */
export function storedCopies() {
  return Object.freeze([...COPIES.values()]);
}

/** Test hook: unregister only the given keys (`"<of>@<at>"`). */
export function _resetStoredCopiesForTests(keys = []) {
  for (const key of keys) COPIES.delete(key);
}
