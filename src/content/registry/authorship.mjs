/**
 * src/content/registry/authorship.mjs
 * Authorship marks (who wrote a document) and the AI-content level that hides them (7.16).
 *
 * Every function takes the registry instance first and reads its `_authorship` and `_aiContentLevel` fields.
 */

import { SYSTEM_ID } from '../../constants.mjs';

/** The values of the `aiContent` setting. */
const AI_CONTENT_LEVELS = Object.freeze(['show', 'hide-ai', 'hide-ai-edited']);

const AUTHORSHIP_ID = /^[a-z0-9._-]{1,40}$/;

/**
 * Fresh authorship state with the three built-in marks. `rank` orders them for hiding: the higher, the more AI.
 * @param {object} reg
 */
export function initAuthorship(reg) {
  /** @type {Map<string, object>} authorship id -> { id, label, icon, rank } */
  reg._authorship = new Map();
  /** @type {string} the AI-content level when the setting is unavailable (7.16f) */
  reg._aiContentLevel = 'show';
  registerAuthorship(reg, 'human', { label: 'COG.Authorship.Human', icon: 'fa-solid fa-feather', rank: 0 });
  registerAuthorship(reg, 'edited', { label: 'COG.Authorship.Edited', icon: 'fa-solid fa-user-pen', rank: 1 });
  registerAuthorship(reg, 'ai', { label: 'COG.Authorship.Ai', icon: 'fa-solid fa-robot', rank: 2 });
}

/**
 * Register an authorship mark: who wrote a document, as stamped in `source.authorship`.
 * @param {object} reg
 * @param {string} id lowercase id, `/^[a-z0-9._-]{1,40}$/`
 * @param {{ label: string, icon?: string, rank?: number }} config `label`: a lang key or text; `rank`: 0 is a person, higher is more AI
 */
export function registerAuthorship(reg, id, config = {}) {
  if (typeof id !== 'string' || !AUTHORSHIP_ID.test(id)) return;
  const text = (v) => (typeof v === 'string' ? v : '');
  reg._authorship.set(id, {
    id, label: text(config.label) || id, icon: text(config.icon),
    rank: Number.isFinite(config.rank) ? config.rank : 0
  });
}

/** @returns {{ id: string, label: string, icon: string, rank: number }|null} the mark, or null when the id is not registered */
export function getAuthorship(reg, id) {
  return reg._authorship.get(id) ?? null;
}

/** @returns {Array<{ id: string, label: string, icon: string, rank: number }>} every registered mark, lowest rank first */
export function listAuthorship(reg) {
  return [...reg._authorship.values()].sort((a, b) => a.rank - b.rank);
}

/**
 * The AI-content level (7.16f): the `aiContent` world setting (`show`, `hide-ai`, `hide-ai-edited`), falling back to
 * the test/early-boot value when the setting is unavailable. Any other value reads as `show`.
 * @param {object} reg
 * @returns {'show'|'hide-ai'|'hide-ai-edited'}
 */
export function getAiContentLevel(reg) {
  let raw = null;
  try {
    raw = globalThis.game?.settings?.get?.(SYSTEM_ID, 'aiContent');
  } catch (_e) {
    // World setting not yet registered or unavailable
  }
  const level = typeof raw === 'string' && raw ? raw : reg._aiContentLevel;
  return AI_CONTENT_LEVELS.includes(level) ? level : 'show';
}

/** Set the AI-content level (used when world settings are not yet ready or in testing). */
export function setAiContentLevel(reg, level) {
  reg._aiContentLevel = AI_CONTENT_LEVELS.includes(level) ? level : 'show';
}

/**
 * Whether the authorship mark `id` is hidden at the current level: `hide-ai` hides the `ai` rank and above,
 * `hide-ai-edited` the `edited` rank and above. An empty or unregistered id is never hidden.
 * @param {object} reg
 * @param {string} id
 * @param {string} [level] a level to ask about instead of the current one
 * @returns {boolean}
 */
export function isAuthorshipHidden(reg, id, level = getAiContentLevel(reg)) {
  if (level !== 'hide-ai' && level !== 'hide-ai-edited') return false;
  const mark = typeof id === 'string' && id ? getAuthorship(reg, id) : null;
  const threshold = getAuthorship(reg, level === 'hide-ai' ? 'ai' : 'edited');
  return Boolean(mark && threshold) && mark.rank >= threshold.rank;
}

/** The `authorship` option of a registration when it is a valid id, else ''. */
export function authorshipOption(options) {
  const v = options?.authorship;
  return typeof v === 'string' && AUTHORSHIP_ID.test(v) ? v : '';
}
