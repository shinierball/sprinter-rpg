/**
 * Option lists for the item sheet's selects, precomputed with `selected` flags (CONTRIBUTING §5).
 * A stored value outside a list is kept as an extra "(Custom)" option so authors never lose it.
 */

export const ABILITIES = Object.freeze({ str: 'Strength', int: 'Intelligence', con: 'Constitution', dex: 'Dexterity', cha: 'Charisma' });

export const DEFAULT_DAMAGE_TYPES = Object.freeze([
  'Acid', 'Bludgeoning', 'Electric', 'Fire', 'Force', 'Holy', 'Ice', 'Necrotic', 'Piercing', 'Poison', 'Psychic', 'Slashing', 'Sonic'
]);

export const ARCHETYPES = Object.freeze(['Fighter', 'Mage', 'Cleric', 'Rogue', 'Bard', 'Monk', 'Paladin', 'Ranger', 'Druid', 'Warlock', 'Sorcerer', 'Barbarian']);
export const WEAPON_CATEGORIES = Object.freeze(['Power Weapons', 'Edge', 'Bashing', 'Reach', 'Ranged', 'Hand to Hand', 'Utility', 'Exotic']);
export const WEAPON_TYPES = Object.freeze([
  'Chainsaw', 'Broadsword', 'Longsword', 'Shortsword', 'Dagger', 'Battleaxe', 'Axe',
  'Warhammer', 'Mace', 'Club', 'Spear', 'Halberd', 'Polearm', 'Quarterstaff',
  'Crossbow', 'Heavy Crossbow', 'Light Crossbow', 'Longbow', 'Shortbow',
  'Pistol', 'Rifle', 'Shotgun', 'Blaster', 'Fist / Unarmed', 'Brass Knuckles', 'Pugilism', 'Exotic'
]);
export const FLOORS = Object.freeze([
  'Floor 1', 'Floor 2', 'Floor 3', 'Floor 4', 'Floor 5', 'Floor 6', 'Floor 7', 'Floor 8', 'Floor 9',
  'Floor 10', 'Floor 11', 'Floor 12', 'Floor 13', 'Floor 14', 'Floor 15', 'Floor 16', 'Floor 17', 'Floor 18',
  'Overworld', 'Celestial'
]);

export const PROFICIENCY_MODES = Object.freeze([
  { id: 'highest', label: 'Highest Precedence (Specialization)' },
  { id: 'manual', label: 'Manual Selection' }
]);
export const WIELD_MODES = Object.freeze([
  { id: 'one_handed', label: 'One-Handed' },
  { id: 'two_handed', label: 'Two-Handed' },
  { id: 'two_handed_disadv_1h', label: 'Two-Handed (Disadvantage if 1-Handed)' }
]);
export const TARGET_FILTERS = Object.freeze([
  { id: 'allies', label: 'Allies Only' },
  { id: 'enemies', label: 'Enemies Only' },
  { id: 'self', label: 'Self Only' },
  { id: 'all', label: 'All / Any Target' }
]);
export const CONTEST_STATS = Object.freeze([
  { id: 'str', label: 'Strength (STR)' },
  { id: 'dex', label: 'Dexterity (DEX)' },
  { id: 'con', label: 'Constitution (CON)' },
  { id: 'int', label: 'Intelligence (INT)' },
  { id: 'cha', label: 'Charisma (CHA)' }
]);
export const CONTEST_TYPES = Object.freeze([
  { id: 'dc', label: 'DC Challenge (Target rolls vs DC)' },
  { id: 'opposed', label: 'Opposed Contest (Roll vs Roll)' }
]);
export const INTERRUPT_RANGE_FROM = Object.freeze([
  { value: 'defender', label: 'Protected Ally' },
  { value: 'attacker', label: 'Attacker' }
]);

/**
 * `{ value, label, selected }` options for `values`, matching `current` case-insensitively.
 * A non-empty `current` that matches nothing is appended as `"<current> (Custom)"`, selected.
 * @param {readonly string[]} values
 * @param {*} current stored value
 * @param {{ match?: (current: string, value: string) => boolean }} [options]
 */
export function choiceOptions(values, current, { match } = {}) {
  const cur = String(current ?? '').trim();
  const matches = match ?? ((c, v) => c.toLowerCase() === v.toLowerCase());
  const options = values.map((v) => ({ value: v, label: v, selected: matches(cur, v) }));
  if (cur && !options.some((o) => o.selected)) options.push({ value: cur, label: `${cur} (Custom)`, selected: true });
  return options;
}

/** Ability keys with their short labels, in sheet order. */
export const STAT_KEYS = Object.freeze(['str', 'dex', 'con', 'int', 'cha']);

/**
 * Exact-match `{ value, label, selected }` options. `entries` are strings or `{ id, label }`; a leading blank option
 * is added when `blankLabel` is given. Unlike `choiceOptions` an unknown stored value is not appended.
 */
export function pickOptions(entries, current, { blankLabel = null } = {}) {
  const cur = String(current ?? '');
  const options = entries.map((e) => {
    const value = typeof e === 'string' ? e : e.id;
    return { value, label: typeof e === 'string' ? e : e.label, selected: cur === value };
  });
  if (blankLabel !== null) options.unshift({ value: '', label: blankLabel, selected: !cur });
  return options;
}

/** STR..CHA options for a stat select; `blankLabel` adds the leading empty choice (Auto, None). */
export function statOptions(current, { blankLabel = null } = {}) {
  return pickOptions(STAT_KEYS.map((k) => ({ id: k, label: k.toUpperCase() })), current, { blankLabel });
}
