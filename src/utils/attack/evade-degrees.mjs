/**
 * How badly a target's Evade failed, for the On Hit "Evade fail" rider list. A leaf
 * module: no imports, so models and chat code can share it.
 */

/** Failure degrees, ascending severity. `none` (the Evade held) sits below all of them and is never a gate. */
export const EVADE_FAIL_DEGREES = Object.freeze(['fail', 'major_fail', 'critical_fail']);

/**
 * The degree of one target's Evade, from an `evade-link` record (`readEvadeRecord`/`findEvadeFor`).
 * - No record, or an ignored Evade (the GM's "Ignore Evade"): `fail` (declining to Evade is a Standard Fail).
 * - `avoided`, `area_half`, `area_none`: `none`.
 * - `hit` with `double` (Natural 1): `critical_fail`; short by 10 or more (`dc - total`): `major_fail`; else `fail`.
 * @param {{ outcome?: string, double?: boolean, total?: number|null, dc?: number|null, ignored?: boolean }|null|undefined} link
 * @returns {'none'|'fail'|'major_fail'|'critical_fail'}
 */
export function evadeFailDegree(link) {
  if (!link || typeof link !== 'object' || link.ignored === true) return 'fail';
  if (link.outcome !== 'hit') return 'none';
  if (link.double === true) return 'critical_fail';
  const total = Number(link.total);
  const dc = Number(link.dc);
  if (link.total !== null && link.total !== undefined && link.dc !== null && link.dc !== undefined
    && Number.isFinite(total) && Number.isFinite(dc) && dc - total >= 10) return 'major_fail';
  return 'fail';
}

/**
 * True when `degree` is at least as bad as `gate`. `none` and unknown degrees meet no gate; an unknown gate is never met.
 * @param {string} degree from `evadeFailDegree`
 * @param {string} gate one of `EVADE_FAIL_DEGREES`
 */
export function meetsEvadeGate(degree, gate) {
  const have = EVADE_FAIL_DEGREES.indexOf(degree);
  const need = EVADE_FAIL_DEGREES.indexOf(gate);
  return have >= 0 && need >= 0 && have >= need;
}
