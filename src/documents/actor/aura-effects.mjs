/**
 * Pure derivations of what an aura grants, from the aura item and the actor that holds it.
 *
 * The caster's client uses these when it writes to an ally directly; the GM uses the same functions to
 * rebuild the same result when it applies a relayed request, so a payload never carries the amounts or
 * the effect items themselves (see aura-relay.mjs).
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { resolveReachedRankBreaks } from '../../utils/skill/rank-breaks.mjs';
import { tempBarBaseSlots } from '../../utils/damage/temp-bars.mjs';
import { normalizeElementTag } from '../../data/tag-vocabulary.mjs';
import { conditionItemData } from './condition-data.mjs';
import { getSpellRank } from './spell-rank.mjs';
import { resolveBuff } from './actor-conditions.mjs';

/** The aura's rank on its holder. */
export function auraRank(holder, item) {
  const sys = item?.system || {};
  return Number(
    item?.type === 'skill'
      ? (holder?.getSkillRank ? holder.getSkillRank(item) : (sys.modifiedRank ?? sys.rank))
      : (holder?.items ? getSpellRank(holder, item) : (sys.modifiedRank ?? sys.rank))
  ) || Number(sys.rank) || 1;
}

/** The `element.<type>` tag an item's temporary bars are limited to (`system.area.absorbElement`); empty = any damage. */
export function absorbElementOf(item) {
  return normalizeElementTag(item?.system?.area?.absorbElement);
}

/**
 * Temporary health bars an aura grants: slot count from the holder's ability mods, hit points per slot
 * from the config and the highest rank break reached. Zeros when the aura grants no temp bars.
 * `element` is the `element.<type>` tag the bars are limited to (the item's `area.absorbElement`), empty for any damage.
 * @returns {{ slots: number, hpPerSlot: number, totalTempHp: number, element: string }}
 */
export function computeAuraTempBars(holder, item) {
  // The aura's own config only (an item with incomplete config is not matched against a catalog; fix the item).
  const sys = item?.system || {};
  const tempBarsConfig = sys.tempBars;
  const none = { slots: 0, hpPerSlot: 0, totalTempHp: 0, element: '' };
  if (!tempBarsConfig?.hasTempBars) return none;

  const rank = auraRank(holder, item);
  let slots = tempBarBaseSlots(tempBarsConfig.slotsFormula, holder?.system?.abilities, { fallbackStat: 'cha' });
  const resolvedBreaks = resolveReachedRankBreaks(item, rank);
  slots = Math.max(1, slots) + (resolvedBreaks.tempBars?.barsGranted || 0);

  // Reached breaks add to the base hit points per slot (cumulative, like every other rank-break field).
  const hpPerSlot = (Number(tempBarsConfig.hpPerSlot) || 2) + (resolvedBreaks.tempBars?.hpPerSlot || 0);

  return { slots, hpPerSlot, totalTempHp: slots * hpPerSlot, element: absorbElementOf(item) };
}

/**
 * The buff items an aura puts on each recipient: one protections/bonuses buff when the config has any,
 * and one buff per granted buff the holder can resolve. Each is stamped with the aura item's UUID.
 * @returns {object[]} item creation data (empty when the aura grants no effect items)
 */
export function buildAuraEffectItems(holder, item) {
  const areaConfig = item?.system?.area;
  const stamp = {
    [SYSTEM_ID]: {
      auraSourceUuid: item?.uuid || '',
      sourceAura: item?.name
    }
  };
  const items = [];

  const hasCombatProtections = (Array.isArray(areaConfig?.grantedResistances) && areaConfig.grantedResistances.length > 0) ||
    (Array.isArray(areaConfig?.grantedImmunities) && areaConfig.grantedImmunities.length > 0) ||
    Boolean(Number(areaConfig?.evadeBonus)) ||
    Boolean(Number(areaConfig?.attackBonus)) ||
    Boolean(Number(areaConfig?.damageBonus));

  if (hasCombatProtections) {
    items.push({
      name: `${item.name} Aura`,
      type: 'buff',
      system: {
        active: true,
        duration: `${item.name} Aura`,
        attackModifiers: Number(areaConfig?.attackBonus) ? [{
          label: `${item.name} Aura Attack Bonus`,
          value: Number(areaConfig.attackBonus)
        }] : [],
        damageModifiers: Number(areaConfig?.damageBonus) ? [{
          mode: 'add',
          value: Number(areaConfig.damageBonus),
          label: `${item.name} Aura Damage Bonus`,
          condition: { all: [], any: [], none: [] }
        }] : [],
        defenseModifiers: [
          ...(Number(areaConfig?.evadeBonus) ? [{ kind: 'evade', value: Number(areaConfig.evadeBonus), label: `${item.name} Aura Evade Bonus` }] : []),
          ...(Array.isArray(areaConfig?.grantedResistances) ? areaConfig.grantedResistances.map(r => ({ kind: 'resistance', damageType: r })) : []),
          ...(Array.isArray(areaConfig?.grantedImmunities) ? areaConfig.grantedImmunities.map(imm => ({ kind: 'immunity', damageType: imm })) : [])
        ]
      },
      flags: structuredClone(stamp)
    });
  }

  if (Array.isArray(areaConfig?.grantedBuffs)) {
    for (const bKey of areaConfig.grantedBuffs) {
      if (!bKey) continue;
      const resolved = holder ? resolveBuff(holder, bKey) : null;
      if (!resolved) continue;
      items.push({
        name: resolved.name,
        type: 'buff',
        system: {
          ...(resolved.system || {}),
          active: true,
          duration: `${item.name} Aura`,
          source: item.name
        },
        flags: structuredClone(stamp)
      });
    }
  }
  return items;
}

/** Debuff names the aura's own config inflicts on enemies in its radius (`system.area`). */
export function inflictedDebuffsOf(item) {
  const area = item?.system?.area || {};
  const names = [];
  if (Array.isArray(area.inflictedDebuffs)) {
    for (const d of area.inflictedDebuffs) {
      if (d && !names.includes(d)) names.push(d);
    }
  }
  return names;
}

/**
 * The debuff item an aura or zone inflicts, stamped with the source item's UUID and the configured debuff ref
 * (`auraDebuffRef`, how a later pulse finds it). A ref that names a condition (`condition.blinded`, a debuff identifier)
 * carries that condition's full data (`conditionItemData`); any other string is a bare debuff of that name. Null when
 * the item does not list that debuff.
 */
export function buildAuraDebuffItem(item, debuffName) {
  if (!debuffName || !inflictedDebuffsOf(item).includes(debuffName)) return null;
  const fallback = {
    name: debuffName,
    type: 'debuff',
    system: {},
    flags: {}
  };
  const data = conditionItemData(debuffName, { requireKnown: true, sourceItem: item }) ?? fallback;
  return {
    ...data,
    system: {
      ...data.system,
      duration: `${item.name} Aura`,
      description: `Inflicted while in ${item.name} radius.`
    },
    flags: {
      ...data.flags,
      [SYSTEM_ID]: {
        ...data.flags?.[SYSTEM_ID],
        auraSourceUuid: item.uuid || '',
        auraDebuffRef: debuffName,
        sourceAura: item.name
      }
    }
  };
}
