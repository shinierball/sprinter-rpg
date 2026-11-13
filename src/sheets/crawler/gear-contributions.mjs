/**
 * Does a worn item actually contribute a kind of thing (`CONFIG.COG.gearContributions`)? A zero zone turns kinds off
 * for every worn item, but only the items that give that kind are "not responding". Each detector reads the item with
 * the reader the game itself uses for that kind. The `tags` kind never counts: a tag alone changes nothing the item
 * visibly does, so a plain weapon or a torch is not badged.
 */
import { collectGearBonuses, collectGearSkillBonuses, collectTagBonusGrants } from '../../models/actors/actor-derivation.mjs';
import { collectSenses, hasSenseOverride } from '../../utils/character/senses.mjs';
import { collectOnHitEffects } from '../../utils/attack/on-hit.mjs';
import { isWeaponGear } from '../../utils/gear/wield-mode.mjs';
import { ROW_ARRAYS } from '../../utils/row-kinds.mjs';
import { isGearAura } from '../../documents/actor/gear-aura.mjs';

const listOf = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);

/** Typed rows on any modifier array (damage, defense, roll, craft, ... rows), or a sense, or a rank cap. */
function givesSources(actor, item) {
  const sys = item.system ?? {};
  for (const [key, def] of Object.entries(ROW_ARRAYS)) {
    if (def.modifierRows === false) continue;
    if (listOf(sys[key]).some(row => row.disabled !== true)) return true;
  }
  if (hasSenseOverride(collectSenses(actor, [item]))) return true;
  return listOf(sys.grants).some(g => g.kind === 'rank_cap' && g.mode !== 'choice');
}

/** @type {Record<string, (actor: object, item: object) => boolean>} one detector per default kind */
const DETECTORS = Object.freeze({
  stats: (_actor, item) => Object.values(collectGearBonuses([item], 'live').stats).some(s => s.flat || s.pct),
  armor: (_actor, item) => collectGearBonuses([item]).dr !== 0,
  sources: givesSources,
  tags: () => false,
  ranks: (_actor, item) => collectGearSkillBonuses([item]).size > 0 || collectTagBonusGrants({ equippedGear: [item] }).length > 0,
  grantedAbilities: (_actor, item) => collectGearSkillBonuses([item]).size > 0,
  persistentBuffs: (_actor, item) => listOf(item.system?.persistentBuffs).length > 0,
  persistentDebuffs: (_actor, item) => listOf(item.system?.persistentDebuffs).length > 0,
  attackExtras: (_actor, item) => {
    if (isWeaponGear(item)) return false;
    const sys = item.system ?? {};
    if (sys.ignoreDR || sys.isArmorPiercing) return true;
    const hit = collectOnHitEffects({ sources: [{ item, rank: Infinity }] });
    return Object.values(hit).some(list => Array.isArray(list) && list.length > 0);
  },
  roundHealing: (_actor, item) => {
    const cfg = item.system?.healing;
    return Boolean(Number(cfg?.barsPerRound) > 0 || cfg?.hasHealing || listOf(cfg?.cleanseDebuffs).length);
  },
  aura: (_actor, item) => isGearAura(item)
});

/** True when `item` gives this contribution kind. A kind with no detector (a module's) reads as not given. */
export function contributesKind(actor, item, kind) {
  return DETECTORS[kind]?.(actor, item) === true;
}
