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
 * Shiny's setting data has one entry per kind, keyed `setting:<kind>` (species, backgroundTables, creationLoadouts,
 * grindComplications); its `fields` paths are into that kind's data.
 * `fields` records the text a person rewrote; a unit test fails when one no longer matches, so the text cannot change
 * quietly. No document is an exception yet.
 */

/** The mark of the bundled documents that no book filled (the 143 of the Rulebook Content theme). */
export const BUNDLED_AUTHORSHIP = 'ai';

/** @type {Readonly<Record<string, { authorship: string, fields?: Record<string, string>, note?: string }>>} */
export const AUTHORSHIP_LEDGER = Object.freeze({
  'dccex00000000001': { authorship: 'human', fields: { 'name': '324ed70dcc01', 'system.description': 'dde55f682066' } },
  'dccex00000000002': { authorship: 'human', fields: { 'name': 'b5fc5ee70207', 'system.description': '2043145cb22a' } },
  'dccex00000000003': { authorship: 'edited', fields: { 'system.description': '7648d20c94a6' } },
  'dccex00000000004': { authorship: 'edited', fields: { 'system.description': '541e220db430' } },
  'dccex00000000005': { authorship: 'edited', fields: { 'system.description': '06b3f5ee5ffa' } },
  'dccex00000000006': { authorship: 'edited', fields: { 'name': 'e7631498738d' } },
  'dccex00000000008': { authorship: 'human', fields: { 'name': '2e2d4f04f34a', 'system.description': '9ac8cdfabe8e' } },
  'dccex00000000009': { authorship: 'human', fields: { 'name': 'a17ea9c8c94b', 'system.description': '555e9baee83c' } },
  'dccex00000000012': { authorship: 'human', fields: { 'name': '69f3d5e80841', 'system.description': '2fe656e25c52' } },
  'dccex00000000014': { authorship: 'human', fields: { 'name': 'd95aadeb50ee', 'system.description': 'b35b932ccffd' } },
  'dccex00000000015': { authorship: 'human', fields: { 'system.description': 'ef36e3b89e6e' } },
  'dccex00000000016': { authorship: 'human', fields: { 'name': 'd113bfc75e3e', 'system.description': 'fdab1807a0c5' } },
  'dccexi0100000000': { authorship: 'edited', fields: { 'name': 'fea1eae3041c' } }
});

/** The mark of Shiny's creator setting data, by registration kind. The ledger may name a kind as `setting:<kind>` (7.16h). */
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
