/** Precomputed context for the shared Ammunition partial (templates/items/parts/ammunition.hbs): the query view and the count. */
import { buildQueryView } from './context-query.mjs';

const QUERY_BUCKETS = Object.freeze(['all', 'any', 'none']);

/** @param {object} context the item sheet context of a skill or gear item (`context.system.ammunition` is its field) */
export function buildAmmunitionContext(context) {
  const block = context.system?.ammunition ?? {};
  context.ammunition = {
    query: buildQueryView(block.query, 'system.ammunition.query', QUERY_BUCKETS),
    perAttack: Math.max(1, Math.floor(Number(block.perAttack) || 1))
  };
}
