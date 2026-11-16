/**
 * Boss maps (core pp. 23, 215; the human's ruling 1184). Pure data: the tags live here, with the tag catalog, not in engine code.
 */

/**
 * The map a boss tier drops, by tier id. A row is `{ tag, labelKey, descriptionKey }`; a tier with no row (Province, Floor,
 * Dungeon) leaves the map to the GM. City and Country are the human's homebrew (ruling 1184). `CONFIG.COG.bossMaps` is this object.
 */
export const BOSS_MAPS = {
  neighborhood: { tag: 'rule.grind-map-neighborhood', labelKey: 'COG.FightLoot.Map.neighborhood.Label', descriptionKey: 'COG.FightLoot.Map.neighborhood.Description' },
  borough: { tag: 'rule.grind-map-borough', labelKey: 'COG.FightLoot.Map.borough.Label', descriptionKey: 'COG.FightLoot.Map.borough.Description' },
  city: { tag: 'rule.grind-map-city', labelKey: 'COG.FightLoot.Map.city.Label', descriptionKey: 'COG.FightLoot.Map.city.Description' },
  country: { tag: 'rule.map-country', labelKey: 'COG.FightLoot.Map.country.Label', descriptionKey: 'COG.FightLoot.Map.country.Description' }
};
