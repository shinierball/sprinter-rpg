import { COG_MERCENARIES } from '../content/specs/mercenaries.mjs';

export { COG_MERCENARIES };

/**
 * Retrieve a mercenary template from the catalog by ID.
 * @param {string} id
 * @returns {object|undefined}
 */
export function getMercenaryById(id) {
  return COG_MERCENARIES.find(m => m._id === id || m.id === id);
}

/**
 * Construct an Actor creation data object from a mercenary template.
 * @param {object} template
 * @param {object} [overrides={}]
 * @returns {object}
 */
export function createMercenaryData(template, overrides = {}) {
  const base = structuredClone(template);
  delete base._id;
  const mergeFn = globalThis.foundry?.utils?.mergeObject || ((target, source) => Object.assign(target, source));
  return mergeFn(base, overrides);
}
