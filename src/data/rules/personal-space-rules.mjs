/** Personal-space lookups and upgrade-to-item payload (code). The space type and upgrade tables are content (`../personal-spaces.mjs`). */

import { contentRegistry } from '../../content/registry.mjs';
import { buildPayload } from '../builders/item-payload.mjs';

export function getSpaceTypeInfo(typeKey) {
  return contentRegistry.getSpaceType(typeKey);
}

export function getSpaceUpgrade(upgradeId) {
  const upgrades = contentRegistry.getSpaceUpgrades();
  return upgrades.find(u => u.id === upgradeId) || null;
}

/** Crafting station type on a catalog entry to the table type tag the `craftingTable` field holds. */
const STATION_TABLE_TAGS = Object.freeze({ alchemy: 'crafting.table.alchemist', forge: 'crafting.table.blacksmith', workbench: 'crafting.table.tinkerer' });

/**
 * Turn a catalog upgrade entry (the flat shape in `COG_SPACE_UPGRADES`) into the creation payload of an embedded
 * `space_upgrade` item. The entry's `id` becomes the item's `identifier`, which is how the space finds it again.
 * @param {object} def a catalog entry from the content registry
 * @returns {object} item creation payload (never throws; problems are logged by the builder)
 */
export function spaceUpgradeItemData(def) {
  const num = (...vals) => { for (const v of vals) if (Number.isFinite(Number(v)) && v !== undefined && v !== null && v !== '') return Number(v); return 0; };
  const tier = Math.max(1, Math.trunc(num(def?.tier)) || 1);
  const system = {
    identifier: String(def?.id ?? ''),
    tier,
    cost: Math.max(0, num(def?.cost)),
    purchased: true,
    description: String(def?.description ?? ''),
    tags: [def?.typeTag].filter(t => typeof t === 'string' && t),
    bonuses: {
      defenseBonus: num(def?.defenseBonus),
      stashCapacityBonus: num(def?.stashBonus, def?.stashCapacityBonus),
      restRecoveryBonus: num(def?.hoursReduction, def?.restRecoveryBonus),
      mercenaryCapacityBonus: num(def?.mercenaryCapacity, def?.mercenaryCapacityBonus),
      petCapacityBonus: num(def?.petCapacityBonus),
      mountCapacityBonus: num(def?.mountCapacityBonus),
      wellRestedBonus: num(def?.wellRestedBonus),
      bonusGrindHours: num(def?.bonusGrindHours),
      advancementBonus: num(def?.advancementBonus),
      bonusTempBars: num(def?.bonusTempBars),
      tempBarsHpPerSlot: num(def?.tempBarsHpPerSlot),
      removesInjuriesOnRest: Boolean(def?.removesInjuriesOnRest),
      mercenaryDiscountPct: num(def?.mercenaryDiscountPct),
      buffs: Array.isArray(def?.buffs) ? def.buffs.filter(b => typeof b === 'string' && b) : []
    }
  };
  // A training room's fields are stored on the entry as they are on the item; nothing is derived from the tier.
  if (def?.training && typeof def.training === 'object') system.training = structuredClone(def.training);
  if (def?.craftingStationType) {
    const station = String(def.craftingStationType);
    system.craftingTable = { enabled: true, tableTypeTag: STATION_TABLE_TAGS[station] ?? `crafting.table.${station}`, baseTier: tier };
  }
  return buildPayload('space_upgrade', { name: def?.name, system }, { warnings: [] });
}
