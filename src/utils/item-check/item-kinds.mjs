/**
 * src/utils/item-check/item-kinds.mjs
 * Which rule kinds apply to an item, from its type, flags and tags. A kind is not a document type: a weapon is gear
 * with a held slot, a technique is a skill, an attack spell is a spell that rolls an attack.
 */
import { isWeaponGear } from '../gear/wield-mode.mjs';
import { USAGE_KINDS } from '../tag/tag-mechanics.mjs';
import { WEAPON_SKILL_TAG } from '../../data/tag-vocabulary.mjs';

// A scroll is used up and a wand spends charges, so both are consumables to the check.
const CONSUMABLE_LOOT_TYPES = new Set(['consumable', 'potion', 'scroll', 'wand']);

/**
 * @param {{ type?: string, system?: object }} item
 * @returns {string[]} the kinds whose rules run, `*` first
 */
export function itemKindsOf(item) {
  const sys = item?.system ?? {};
  const tags = Array.isArray(sys.tags) ? sys.tags : [];
  const kinds = ['*'];
  switch (item?.type) {
    case 'attack':
      kinds.push('weapon');
      break;
    case 'gear':
      if (isWeaponGear(item)) kinds.push('weapon');
      kinds.push('gear');
      if (tags.includes(USAGE_KINDS.consumable)) kinds.push('consumable');
      break;
    case 'loot':
      if (CONSUMABLE_LOOT_TYPES.has(String(sys.lootType || 'consumable').toLowerCase().trim())) kinds.push('consumable');
      if (String(sys.lootType ?? '').toLowerCase().trim() === 'wand') kinds.push('wand');
      break;
    case 'skill':
      if (sys.isTechnique === true) kinds.push('technique');
      if (tags.includes(WEAPON_SKILL_TAG)) kinds.push('weaponSkill');
      else if (sys.isTechnique !== true && (sys.isAttack === true || sys.checkType === 'attack')) kinds.push('attackSkill');
      break;
    case 'spell':
      if (sys.checkType === 'attack') kinds.push('attackSpell');
      break;
    case 'buff':
    case 'debuff':
      kinds.push(item.type);
      break;
    case 'deity':
    case 'patron':
    case 'achievement':
      kinds.push(item.type);
      break;
    case 'space_upgrade':
      kinds.push('spaceUpgrade');
      break;
    default:
  }
  return kinds;
}
