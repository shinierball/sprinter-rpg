import { conditionTagId, debuffIdentifier } from '../utils/identifier.mjs';
import { getDamageParts } from '../utils/damage-parts.mjs';
import { isWeaponGear, getWieldMode } from '../utils/wield-mode.mjs';
import { hasOnHitDebuff, hasOnHitEffect, hasLifesteal, hasDispel } from '../utils/on-hit.mjs';
import { heritageTag, sanitizeHeritageId } from './rules/heritages.mjs';
import {
  ARCHETYPE_TO_TAG, STAT_TO_TAG, WEAPON_CATEGORY_TAGS, damageTypeToElement, getReachedRankBreaks, getTagDefinition, resolveAreaShape, identityTag
} from './tags.mjs';

/**
 * Runtime tags derived from an item's structured fields (never persisted). Re-exported by `tags.mjs`; the import
 * back into `tags.mjs` is a function-only cycle (nothing here runs at module load).
 */

/**
 * Every `system.*` path `computeDerivedTags` reads, for a pack index fetch (a v14 index returns only the fields it is
 * asked for, so a path missing here silently drops derived tags for pack entries). Keep it in step with the function
 * below; `tests/index-fields-drift-3-56p.test.mjs` compares an index entry's tags with the full document's for every
 * bundled spec. Also covers what `getReachedRankBreaks`, `getWieldMode`, `isWeaponGear` and the on-hit helpers read.
 */
export const DERIVED_TAG_FIELDS = Object.freeze([
  'system.identifier', 'system.stat', 'system.toHitStat', 'system.damageType', 'system.baseDamage', 'system.damageParts',
  'system.isAttack', 'system.category', 'system.checkType', 'system.isTechnique',
  'system.techniqueConfig', 'system.rank', 'system.modifiedRank', 'system.totalRank', 'system.rankBreaks',
  'system.healing', 'system.ignoreDR', 'system.isArmorPiercing', 'system.critMultiplier', 'system.critMultiplierR5',
  'system.critMultiplierR15', 'system.onHit', 'system.fumbleDebuff', 'system.contest', 'system.isWeapon',
  'system.weaponCategory', 'system.weaponType', 'system.slot', 'system.wieldMode', 'system.wieldedOneHanded',
  'system.tags', 'system.archetypes', 'system.area', 'system.delivery', 'system.durationConfig', 'system.tempBars',
  'system.light', 'system.outcomes', 'system.grants', 'system.spaceType', 'system.isSpaceUpgrade', 'system.upgradeType', 'system.heritage'
]);

/** Whether any tag in the list has a definition carrying `flag` (read from the definition: this module sits below tag-behaviour.mjs). */
function anyTagHasFlag(tags, flag) {
  for (const t of tags) {
    if (typeof t === 'string' && getTagDefinition(t.trim())?.flags?.includes(flag)) return true;
  }
  return false;
}

/** Whether an item's area is a lingering zone (D6): a point-anchored area with a lasting duration and a per-pulse effect. */
function isZoneArea(sys, def) {
  if (def?.anchor !== 'point') return false;
  const type = sys.durationConfig?.type;
  if (!type || type === 'instant') return false;
  const a = sys.area || {};
  const has = (v) => Array.isArray(v) && v.some(x => typeof x === 'string' && x.trim());
  return Boolean(a.hasPeriodicDamage || a.isHoT || Number(a.healingBars) > 0 || has(a.inflictedDebuffs) || has(a.pulseConditions) || has(a.cleanseDebuffs));
}

/** A lowercased, trimmed string from text or the first entry of an array; '' for anything else (CONTRIBUTING §4). */
function lc(v) {
  const val = Array.isArray(v) ? v[0] : v;
  return typeof val === 'string' ? val.trim().toLowerCase() : '';
}

/**
 * Compute derived runtime tags for an item from its structured properties.
 * These tags are NOT persisted in the database; they are calculated on the fly.
 * @param {object} item
 * @returns {Set<string>}
 */
export function computeDerivedTags(item) {
  const derived = new Set();
  if (!item) return derived;

  const type = item.type;
  if (type) {
    derived.add(`kind.${type}`);
  }

  const sys = item.system || {};

  // Identity tag if identifier is present
  if (sys.identifier && typeof sys.identifier === 'string' && sys.identifier.trim()) {
    derived.add(identityTag(type, sys.identifier));
  }

  // Governing Stat
  const statVal = lc(sys.stat) || lc(sys.toHitStat);
  if (statVal && STAT_TO_TAG[statVal]) {
    derived.add(STAT_TO_TAG[statVal]);
  }

  // Element / Damage type -> element
  // A skill's or spell's damage type lives in its structured Base Damage; other items carry it at the top level.
  const itemDamageType = sys.damageType || (type === 'skill' || type === 'spell' ? sys.baseDamage?.damageType : '');
  if (itemDamageType) {
    const el = damageTypeToElement(itemDamageType);
    if (el) derived.add(el);
  }
  for (const part of getDamageParts(sys)) {
    if (!part.type) continue;
    const el = damageTypeToElement(part.type);
    if (el) derived.add(el);
  }

  // Skill attack
  if (type === 'skill' && sys.isAttack) {
    derived.add('action.attack');
  }

  // Skill and spell role from the exact select values (never from text): Check Type id `passive` is a passive item, id
  // `attack` an attack, and the technique flags a technique. A skill's weapon group and discipline are stored
  // `weaponGroup.*` and `skillGroup.*` tags, not derived. A spell's interrupt role is its stored `action.interrupt` tag.
  if (type === 'skill' || type === 'spell') {
    const checkKind = String(sys.checkType ?? '').toLowerCase().trim();
    if (checkKind === 'passive') derived.add('action.passive');
    if (checkKind === 'attack') derived.add('action.attack');
  }
  if (type === 'skill') {
    if (sys.isTechnique === true || sys.techniqueConfig?.isDamageEffect === true) derived.add('kind.technique');
  }

  // Rank-gated tags: tags listed on every rank break the item has reached
  for (const rb of getReachedRankBreaks(item)) {
    const rbTags = Array.isArray(rb.data?.tags) ? rb.data.tags : [];
    for (const t of rbTags) if (typeof t === 'string' && t.trim()) derived.add(t.trim());
  }

  // Healing, HoT, and Cleansing derived tags
  if (sys.healing?.hasHealing) {
    derived.add('action.heal');
    derived.add('resource.hp-bars');
    if (sys.healing.isHoT) {
      derived.add('action.hot');
      derived.add('duration.rounds');
    }
    if (Array.isArray(sys.healing.cleanseDebuffs) && sys.healing.cleanseDebuffs.length > 0) {
      derived.add('action.cleanse');
    }
  }

  // Armor Piercing / Ignore DR derived tags
  if (sys.ignoreDR || sys.isArmorPiercing || sys.techniqueConfig?.isArmorPiercing) {
    derived.add('action.armor_piercing');
    derived.add('action.ignore_dr');
  }

  // Condition Triggers & Rank Break Triggers
  let hasCritTrigger = Boolean(
    (sys.critMultiplier && Number(sys.critMultiplier) > 1) ||
    (sys.critMultiplierR5 && Number(sys.critMultiplierR5) > 1) ||
    (sys.critMultiplierR15 && Number(sys.critMultiplierR15) > 1)
  );
  let hasOnHitTrigger = hasOnHitEffect(sys);

  if (sys.rankBreaks && typeof sys.rankBreaks === 'object') {
    for (const rb of Object.values(sys.rankBreaks)) {
      if (rb && typeof rb === 'object') {
        if (Number(rb.critMultiplier) > 1) hasCritTrigger = true;
        if (rb.debuff) hasOnHitTrigger = true;
      }
    }
  }

  if (hasCritTrigger) {
    derived.add('trigger.crit');
  }
  if (sys.fumbleDebuff) {
    derived.add('trigger.fumble');
  }
  if (hasOnHitTrigger) {
    derived.add('trigger.on_hit');
  }
  if (Array.isArray(sys.onHit?.slotLoss?.debuffs) && sys.onHit.slotLoss.debuffs.some(d => typeof d === 'string' && d.trim())) {
    derived.add('trigger.on_slot_loss');
  }
  // An attack's rider and save debuffs name the conditions it can inflict: `condition.<x>` derives from them (3.48).
  if (type === 'attack') {
    const refs = [
      ...(Array.isArray(sys.onHit?.debuffs) ? sys.onHit.debuffs : []),
      ...(Array.isArray(sys.onHit?.evadeFail?.debuffs) ? sys.onHit.evadeFail.debuffs : []),
      ...(Array.isArray(sys.onHit?.slotLoss?.debuffs) ? sys.onHit.slotLoss.debuffs : []),
      sys.contest?.onFailDebuff
    ];
    for (const ref of refs) {
      if (typeof ref !== 'string' || !ref.trim()) continue;
      const tag = conditionTagId(debuffIdentifier(ref));
      if (tag) derived.add(tag);
    }
  }
  // Lifesteal and dispel are the structured On Hit parts; the tags come from them, never the other way (3.13-2).
  if (hasLifesteal(sys)) derived.add('rule.lifesteal');
  if (hasDispel(sys)) derived.add('action.dispel');

  // Debuff item condition tag derivation
  if (type === 'debuff') {
    derived.add('kind.debuff');
    // The condition tag comes from the stored identifier (E4.4), never the name: renaming changes no tag.
    const conditionTag = conditionTagId(sys.identifier);
    if (conditionTag) derived.add(conditionTag);
  }

  // Items that inflict debuffs/conditions derive action.inflict_debuff
  const hasInflictDebuff = Boolean(
    hasOnHitDebuff(sys) ||
    sys.techniqueConfig?.debuffId ||
    (Array.isArray(sys.area?.inflictedDebuffs) && sys.area.inflictedDebuffs.length > 0) ||
    sys.contest?.onFailDebuff
  );
  if (hasInflictDebuff) {
    derived.add('action.inflict_debuff');
  }

  // Weapon gear
  if (type === 'gear' && (sys.isWeapon || sys.category === 'weapon')) {
    derived.add('kind.weapon');
  }

  // Weapon group tags from a gear item's weaponCategory
  if (typeof sys.weaponCategory === 'string') {
    const wgTag = WEAPON_CATEGORY_TAGS[sys.weaponCategory.toLowerCase().trim()];
    if (wgTag) derived.add(wgTag);
  }

  // Wield tags for weapons
  if (isWeaponGear(item) || type === 'attack') {
    const mode = getWieldMode(sys, { itemType: type, handless: anyTagHasFlag([...(Array.isArray(sys.tags) ? sys.tags : []), ...derived], 'no-hands') });
    if (mode === 'one_handed' || mode === 'two_handed') {
      derived.add(`wield.${mode}`);
    }
  }


  // A race's heritage: `heritage.<id>` from the stored id (D8), so a class can require one
  if (type === 'race') derived.add(heritageTag(sanitizeHeritageId(sys.heritage)));

  // Class archetypes
  if (type === 'class') {
    for (const a of Array.isArray(sys.archetypes) ? sys.archetypes : []) {
      const key = String(a).replace(/^archetype\./, '').toLowerCase().trim();
      if (ARCHETYPE_TO_TAG[key]) derived.add(ARCHETYPE_TO_TAG[key]);
      else if (String(a).startsWith('archetype.')) derived.add(a);
    }
  }

  // Any area shape (a shape tag whose definition carries the `area` flag) is also `shape.aoe`, so rows can say
  // `shape.aoe` and match every shape, including module-registered ones. Read from the definition here: this module
  // sits below tag-behaviour.mjs.
  if (Array.isArray(sys.tags) && sys.tags.some(t => typeof t === 'string' && getTagDefinition(t.trim())?.flags?.includes('area'))) {
    derived.add('shape.aoe');
  }

  // Area and targeting tags
  if (sys.area && (sys.area.hasArea || Number(sys.area.radius) > 0 || Number(sys.area.lineLength) > 0)) {
    derived.add('shape.aoe');
    const geo = resolveAreaShape(sys.area.shape);
    derived.add(`shape.${geo.id}`);
    if (Number(sys.area.splash) > 0) derived.add('shape.splash');
    if (sys.area.targetFilter) {
      const tf = lc(sys.area.targetFilter);
      if (['allies', 'enemies', 'all', 'self', 'pet', 'mount', 'vehicle'].includes(tf)) {
        derived.add(`target.${tf}`);
      }
    }
    // A caster-anchored shape (burst, cone, line) is self-targeting; the shape decides the anchor.
    if (geo.def.anchor === 'caster') derived.add('target.self');
    if (isZoneArea(sys, geo.def)) derived.add('rule.hazard');
  }

  // An aura follows its caster, so it is self-targeting.
  if (sys.delivery === 'aura') {
    derived.add('target.self');
  }

  // Delivery mode
  if (sys.delivery) {
    const deliv = lc(sys.delivery);
    if (['placed', 'aura', 'self', 'target'].includes(deliv)) {
      derived.add(`delivery.${deliv}`);
      if (deliv === 'aura') {
        derived.add('shape.aura');
      }
    }
  }

  // Duration
  if (sys.durationConfig?.type) {
    const durType = lc(sys.durationConfig.type);
    if (['instant', 'rounds', 'minutes', 'hours', 'combat', 'permanent', 'short_rest', 'long_rest', 'full_day_rest'].includes(durType)) {
      derived.add(`duration.${durType}`);
    }
  }

  // Temporary health bars rule
  if (sys.tempBars?.hasTempBars === true) {
    derived.add('rule.temp-health-bars');
  }

  // Light emission rule
  if (sys.light && (sys.light.dim > 0 || sys.light.bright > 0)) {
    derived.add('rule.emits-light');
  }

  // Contested / Opposed Check rule
  if (sys.contest?.hasContest) {
    derived.add('action.contested');
    const cType = lc(sys.contest.contestType) || 'dc';
    if (cType === 'opposed') {
      derived.add('action.opposed');
      derived.add('contest.opposed');
    } else {
      derived.add('contest.dc');
    }
    const tStat = lc(sys.contest.targetStat);
    if (['str', 'dex', 'con', 'int', 'cha'].includes(tStat)) {
      derived.add(`contest.${tStat}`);
    }
  }

  // Consumable outcomes / effects derived tags
  const outcomes = Array.isArray(sys.outcomes) ? sys.outcomes : [];
  for (const outcome of outcomes) {
    if (!outcome) continue;
    const outType = lc(outcome.type);
    const res = lc(outcome.resource);
    if (outType === 'restore_resource' || outType === 'mana' || res === 'mana') {
      derived.add('action.restore');
      derived.add('resource.mana');
    }
    if (outType === 'heal' || outType === 'heal_bars' || outcome.healBars) {
      derived.add('action.heal');
      derived.add('resource.hp-bars');
    }
    if (outType === 'heal_over_time' || outType === 'hot') {
      derived.add('action.heal');
      derived.add('resource.hp-bars');
      derived.add('duration.rounds');
    }
  }

  // Structured grants derived tags
  const grants = Array.isArray(sys.grants) ? sys.grants : [];
  for (const g of grants) {
    if (!g) continue;
    if (g.kind === 'stat' && STAT_TO_TAG[lc(g.stat)]) {
      derived.add(STAT_TO_TAG[lc(g.stat)]);
    }
    if (g.kind === 'spell') {
      derived.add('kind.spell');
    }
    if (g.kind === 'skill') {
      derived.add('kind.skill');
    }
  }

  // Personal Space & Upgrade tags
  if (type === 'personal_space') {
    derived.add('kind.personal_space');
    if (sys.spaceType) {
      derived.add(sys.spaceType);
    }
  }
  if (type === 'upgrade' || sys.isSpaceUpgrade) {
    derived.add('kind.upgrade');
    if (sys.upgradeType) {
      derived.add(sys.upgradeType);
    }
  }

  return derived;
}
