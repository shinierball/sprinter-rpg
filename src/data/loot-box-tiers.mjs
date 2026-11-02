/**
 * Loot box tiers: the registry behind `CONFIG.COG.lootBoxTiers` (keyed by tier id).
 * Its own registry (not the boss tiers) so homebrew can add box tiers without touching boss tiers.
 */

import { firstScalar } from '../utils/first-scalar.mjs';

export const DEFAULT_LOOT_BOX_TIER = 'bronze';

export const LOOT_BOX_TIERS = Object.freeze({
  bronze: Object.freeze({ id: 'bronze', label: 'Bronze' }),
  silver: Object.freeze({ id: 'silver', label: 'Silver' }),
  gold: Object.freeze({ id: 'gold', label: 'Gold' }),
  platinum: Object.freeze({ id: 'platinum', label: 'Platinum' }),
  legendary: Object.freeze({ id: 'legendary', label: 'Legendary' }),
  celestial: Object.freeze({ id: 'celestial', label: 'Celestial' })
});

/** The live registry (`CONFIG.COG.lootBoxTiers`), falling back to the bundled one. */
export function lootBoxTierRegistry() {
  return globalThis.CONFIG?.COG?.lootBoxTiers || LOOT_BOX_TIERS;
}

/**
 * Resolve a raw tier value to a registered tier id; unknown or missing falls back to bronze.
 * @param {*} raw
 * @returns {string}
 */
export function resolveLootBoxTier(raw) {
  const val = firstScalar(raw);
  const id = String(val).trim().toLowerCase();
  const registry = lootBoxTierRegistry();
  return id && Object.prototype.hasOwnProperty.call(registry, id) ? id : DEFAULT_LOOT_BOX_TIER;
}

/**
 * Select options for the registered tiers.
 * @param {string} [selected]
 * @returns {{key: string, label: string, selected: boolean}[]}
 */
export function lootBoxTierOptions(selected = DEFAULT_LOOT_BOX_TIER) {
  const current = resolveLootBoxTier(selected);
  return Object.entries(lootBoxTierRegistry()).map(([key, def]) => ({
    key,
    label: def?.label || key,
    selected: key === current
  }));
}
