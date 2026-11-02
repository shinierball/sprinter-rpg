/**
 * Point-build reader (3.6a R2): the one place that merges the core benefits and detriments (system data) with the
 * entries a content provider registered under the `pointBuild` catalog kind. A registered entry with a core id replaces
 * the core entry in place, so a module can restore its own wording by id. Pure; reads the registry views lazily.
 */
import { catalogEntries } from './catalog-lookup.mjs';
import { COG_POINT_BUILD_BENEFITS, COG_POINT_BUILD_DETRIMENTS } from '../data/point-build-catalog.mjs';

/**
 * @param {object[]} core
 * @param {string} kind 'benefit' | 'detriment'
 * @returns {object[]}
 */
function mergeCore(core, kind) {
  const registered = catalogEntries('pointBuild').filter(e => e?.kind === kind);
  const byId = new Map(registered.map(e => [e.id, e]));
  const coreIds = new Set(core.map(e => e.id));
  return [
    ...core.map(e => byId.get(e.id) ?? e),
    ...registered.filter(e => !coreIds.has(e.id))
  ];
}

/** Core benefits (system order), then registered benefits not overriding a core id. */
export function pointBuildBenefits() {
  return mergeCore(COG_POINT_BUILD_BENEFITS, 'benefit');
}

/** Core detriments (system order), then registered detriments not overriding a core id. */
export function pointBuildDetriments() {
  return mergeCore(COG_POINT_BUILD_DETRIMENTS, 'detriment');
}

/**
 * Registered presets only (`kind: 'preset'`), optionally for one builder type.
 * @param {string} [builderType] 'race' | 'class'
 * @returns {object[]}
 */
export function pointBuildPresets(builderType) {
  return catalogEntries('pointBuild').filter(e => e?.kind === 'preset' && (!builderType || e.builderType === builderType));
}

/**
 * A benefit or detriment by exact id (core or registered).
 * @param {string} id
 * @returns {object|null}
 */
export function findPointBuildEntry(id) {
  if (!id || typeof id !== 'string') return null;
  return pointBuildBenefits().find(e => e.id === id) ?? pointBuildDetriments().find(e => e.id === id) ?? null;
}
