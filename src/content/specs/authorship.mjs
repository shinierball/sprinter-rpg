/**
 * src/content/specs/authorship.mjs
 * The authorship ledger (7.16): who wrote the documents the system ships. The collectors stamp
 * `flags['sprinter-rpg'].source.authorship` from a set's default (`EXAMPLE_SET_META[].authorship`, `BUNDLED_AUTHORSHIP`
 * below) and, when a document is named here, from its entry. The spec files never change for authorship.
 *
 * Marks (registered in the content registry): `ai` (written with AI), `edited` (AI text a person edited), `human`.
 *
 * `AUTHORSHIP_LEDGER` is keyed by document `_id` (an embedded item takes its parent's mark):
 *   `{ authorship, fields?: { '<spec path>': '<12 hex chars of the sha256 of the field text>' }, note? }`
 * `fields` records the text a person rewrote; a unit test fails when one no longer matches, so the text cannot change
 * quietly. No document is an exception yet.
 */

/** The mark of the bundled documents that no book filled (the 143 of the Rulebook Content theme). */
export const BUNDLED_AUTHORSHIP = 'ai';

/** @type {Readonly<Record<string, { authorship: string, fields?: Record<string, string>, note?: string }>>} */
export const AUTHORSHIP_LEDGER = Object.freeze({});

/** The mark of Shiny's creator setting data, by registration kind. */
export const SETTING_AUTHORSHIP = Object.freeze({
  species: 'ai',
  backgroundTables: 'ai',
  creationLoadouts: 'ai',
  grindComplications: 'ai'
});

/**
 * The mark a spec gets: its ledger entry's when it has one, else `fallback`.
 * @param {string} id document `_id`
 * @param {string} fallback the set or bundled default
 * @param {Record<string, { authorship: string }>} [ledger=AUTHORSHIP_LEDGER]
 * @returns {string}
 */
export function authorshipFor(id, fallback, ledger = AUTHORSHIP_LEDGER) {
  const own = typeof id === 'string' && Object.hasOwn(ledger, id) ? ledger[id]?.authorship : '';
  return typeof own === 'string' && own ? own : fallback;
}
