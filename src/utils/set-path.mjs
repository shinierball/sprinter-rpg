/**
 * Pure dotted-path setter for plain objects (builds have no `foundry.utils`). Creates missing objects on the way,
 * mutates and returns `obj`. A key of `__proto__`, `constructor` or `prototype` is refused.
 * @param {object} obj
 * @param {string} path e.g. `system.abilities.str.unenhanced`
 * @param {*} value
 * @returns {object} the same `obj`
 */
export function setPath(obj, path, value) {
  const keys = String(path).split('.');
  if (keys.some(k => k === '__proto__' || k === 'constructor' || k === 'prototype')) return obj;
  let cur = obj;
  for (const key of keys.slice(0, -1)) {
    if (cur[key] === null || typeof cur[key] !== 'object') cur[key] = {};
    cur = cur[key];
  }
  cur[keys.at(-1)] = value;
  return obj;
}
