/**
 * The one module that spells how this system stores a flag: under `flags['sprinter-rpg']` on a document or on
 * plain data (creation data, chat message data, an update). Everything else reads, writes and merges a flag through
 * these functions or through a named accessor built on them.
 */
import { SYSTEM_ID } from '../constants.mjs';

const isBag = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const lookup = (bag, key) => {
  if (!bag || typeof bag !== 'object') return undefined;
  if (key in bag) return bag[key];
  if (!key.includes('.')) return undefined;
  return key.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), bag);
};

/**
 * One flag of this system on a document or on plain data; `undefined` when it is not set.
 * @param {object} doc a document, or data with a `flags` property
 * @param {string} key the flag key (dotted sub-keys allowed)
 */
export function readFlag(doc, key) {
  if (typeof key !== 'string') return undefined;
  return doc?.getFlag?.(SYSTEM_ID, key) ?? lookup(systemFlags(doc), key);
}

/**
 * Unset one flag of this system on a document (the deletion syntax is Foundry's, never written here). Resolves to what
 * `unsetFlag` resolves to; does nothing for a document without the method or a key that is not a string.
 * @param {object} doc a document
 * @param {string} key the flag key (dotted sub-keys allowed)
 */
export function clearFlag(doc, key) {
  if (typeof key !== 'string' || typeof doc?.unsetFlag !== 'function') return Promise.resolve(undefined);
  return doc.unsetFlag(SYSTEM_ID, key);
}

/**
 * The whole bag of this system's flags on a document or on plain data; `{}` when there is none. Not exported: no module
 * in src/ reads a bag (7.78a2 ruling, Question 8); a reader that needs several keys exports it and is its owner.
 */
function systemFlags(doc) {
  return doc?.flags?.[SYSTEM_ID] ?? {};
}

/** The update path of one flag, for `doc.update({ [flagPath('x')]: value })`. */
export function flagPath(key) {
  return `flags.${SYSTEM_ID}.${key}`;
}

/**
 * `data` with `patch` merged into its flags of this system. Other flags and other scopes are kept. A copy: `data`
 * and its nested objects are not changed.
 */
export function withFlags(data, patch) {
  const flags = isBag(data?.flags) ? data.flags : {};
  return { ...data, flags: { ...flags, [SYSTEM_ID]: { ...(isBag(flags[SYSTEM_ID]) ? flags[SYSTEM_ID] : {}), ...patch } } };
}
