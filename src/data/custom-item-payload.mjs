/**
 * The creation payload of a write-in (custom) document: a Skill or Spell the book does not list, named by the player or
 * the GM. Shared by the Floor Simulator's experience picks (a custom pick, a stub for an uninstalled book document) and the
 * loot box open engine (a hobby Skill rolled from a table), so a write-in is built one way. Built through `buildPayload`.
 */
import { SYSTEM_ID } from '../constants.mjs';
import { buildPayload } from './builders/item-payload.mjs';

/**
 * @param {string} docKind 'skill' | 'spell' (any builder kind)
 * @param {string} name the write-in's name
 * @param {{ identifier?: string, stub?: boolean, warnings?: Array<{path: string, message: string, code: string}> }} [options]
 *   `stub`: stands in for a book document that is not installed (it keeps `identifier` so an import can replace it)
 * @returns {object} the creation payload, Rank 0, flagged `floorCustom` (or `floorStub`)
 */
export function customItemPayload(docKind, name, { identifier = '', stub = false, warnings = [] } = {}) {
  return buildPayload(docKind, {
    name, system: { rank: 0, ...(stub ? { identifier } : {}) },
    flags: { [SYSTEM_ID]: stub ? { floorStub: true } : { floorCustom: true } }
  }, { warnings });
}
