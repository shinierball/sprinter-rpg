/**
 * Pure builder engine for Mob and Boss creation in Sprinter RPG.
 * Compiles a structured authoring spec into a complete Foundry Actor creation payload
 * with embedded items (attacks, traits, spells, loot) and canonical tags.
 * No UI dependencies; pure functional architecture (CONTRIBUTING §3).
 */

import { resolveHpPerBar } from '../../utils/damage/hp-per-bar.mjs';
import { getCOGStatModifier } from '../../documents/actor/actor-constants.mjs';
import { normalizeBaseDamage } from '../../utils/damage/base-damage.mjs';
import {
  hbSlots,
  recommendedDice,
  bossTierRegistry,
  BARE_BOSS_TIER_ID,
  TIER_TAG_PREFIX,
  MOB_SPEC_TAGS
} from '../mob-creation-rules.mjs';
import { AURA_TAGS } from '../../utils/tag/tag-mechanics.mjs';
import { debuffIdentifier } from '../../utils/identifier.mjs';
import { registerPayloadDelegate } from './item-payload.mjs';
import { ON_HIT_MODES } from '../../models/fields/effect-fields.mjs';
import { mobTokenSize, sanitizeSizeId } from '../sizes.mjs';
import { normalizeElementTag } from '../tag-vocabulary.mjs';
import { firstScalar } from '../../utils/first-scalar.mjs';
import { EVADE_FAIL_DEGREES } from '../../utils/attack/evade-degrees.mjs';
import { listAreaShapes } from '../../utils/area/area-geometry.mjs';

/**
 * Defensive sanitizer for single values against unexpected arrays or comma-delimited strings.
 * @param {*} rawVal
 * @param {*} fallback
 * @returns {*}
 */
function sanitizeValue(rawVal, fallback = '') {
  return firstScalar(rawVal, fallback);
}

/**
 * Defensive sanitizer for numeric inputs.
 * @param {*} rawVal
 * @param {number} fallback
 * @returns {number}
 */
function sanitizeNumber(rawVal, fallback = 0) {
  const clean = sanitizeValue(rawVal, fallback);
  const num = Number(clean);
  return Number.isFinite(num) ? num : fallback;
}

/** A de-duplicated list of bare debuff identifiers from a spec value (array or comma-delimited string). */
function refList(raw) {
  const list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split(',') : []);
  return [...new Set(list.map(debuffIdentifier).filter(Boolean))];
}

const onHitMode = (raw) => (ON_HIT_MODES.includes(raw) ? raw : 'all');

/**
 * The structured `area` of an attack from its spec block `{ shape, radius, lineLength, lineWidth, splash }`.
 * An empty shape is a single-target attack (null). The size fields follow the registered shape's size kind.
 * @returns {object|null}
 */
function buildAttackArea(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const shape = String(sanitizeValue(raw.shape, '')).toLowerCase().trim().replace(/^shape\./, '');
  if (!shape) return null;
  const isLength = listAreaShapes().find((s) => s.id === shape)?.size === 'length';
  const feet = (v, fallback = 0) => Math.max(0, Math.trunc(sanitizeNumber(v, fallback)));
  return {
    hasArea: true,
    shape,
    radius: isLength ? 0 : feet(raw.radius),
    lineLength: isLength ? feet(raw.lineLength) : 0,
    lineWidth: isLength ? feet(raw.lineWidth, 5) : 5,
    splash: feet(raw.splash),
    targetFilter: 'enemies'
  };
}

/** The `onHit` rider lists of an attack spec: any hit, Evade fail (with its degree) and slot loss (with its minimum). */
function buildAttackOnHit(raw) {
  const spec = raw && typeof raw === 'object' ? raw : {};
  const fail = spec.evadeFail && typeof spec.evadeFail === 'object' ? spec.evadeFail : {};
  const loss = spec.slotLoss && typeof spec.slotLoss === 'object' ? spec.slotLoss : {};
  return {
    debuffs: refList(spec.debuffs),
    debuffMode: onHitMode(spec.debuffMode),
    evadeFail: {
      degree: EVADE_FAIL_DEGREES.includes(fail.degree) ? fail.degree : 'major_fail',
      debuffs: refList(fail.debuffs),
      mode: onHitMode(fail.mode)
    },
    slotLoss: {
      minSlotsLost: Math.max(1, Math.trunc(sanitizeNumber(loss.minSlotsLost, 1))),
      debuffs: refList(loss.debuffs),
      mode: onHitMode(loss.mode)
    }
  };
}

/**
 * Compile a structured attack specification into an embedded Attack item document data.
 * @param {object} atkSpec
 * @param {object} [context={}]
 * @param {number} [context.mobLevel=1]
 * @param {boolean} [context.isBoss=false]
 * @param {number} [context.defaultFloor=1]
 * @returns {object}
 */
export function buildAttackItem(atkSpec = {}, { mobLevel = 1, isBoss = false, defaultFloor = 1 } = {}) {
  const name = String(atkSpec.name || 'Natural Attack').trim();
  const toHitStat = String(atkSpec.toHitStat || 'dex').toLowerCase().trim();
  const toHitRank = sanitizeNumber(atkSpec.toHitRank, 0);
  const ignoreDR = Boolean(atkSpec.ignoreDR);

  const tags = new Set([MOB_SPEC_TAGS.attack]);

  // Element / Damage Type tag
  const rawElement = sanitizeValue(atkSpec.damageType, '');
  // A damage type with no element tag (Physical) adds none: the tag would be unregistered.
  const elementTag = normalizeElementTag(rawElement);
  if (elementTag) tags.add(elementTag);

  const area = buildAttackArea(atkSpec.area);
  const onHit = buildAttackOnHit(atkSpec.onHit);

  // Shape, area, trigger and condition tags derive from the structure at read time (the riders name the conditions).
  const riderRefs = [...onHit.debuffs, ...onHit.evadeFail.debuffs, ...onHit.slotLoss.debuffs];
  const hasRider = riderRefs.length > 0 || Boolean(atkSpec.riderTags?.length);

  if (Array.isArray(atkSpec.riderTags)) {
    for (const rt of atkSpec.riderTags) {
      if (rt) tags.add(String(rt).trim());
    }
  }

  if (Array.isArray(atkSpec.tags)) {
    for (const t of atkSpec.tags) {
      if (t) tags.add(String(t).trim());
    }
  }

  // Damage Parts
  let damageParts;
  if (Array.isArray(atkSpec.damageParts) && atkSpec.damageParts.length > 0) {
    damageParts = atkSpec.damageParts.map(p => ({
      dice: String(p.dice || ''),
      stat: String(p.stat || ''),
      type: String(p.type || rawElement || 'Physical'),
      value: sanitizeNumber(p.value, 0)
    }));
  } else {
    let diceStr = String(atkSpec.damageDice || '').trim();
    if (!diceStr) {
      const diceCount = atkSpec.dice !== undefined && atkSpec.dice !== null
        ? sanitizeNumber(atkSpec.dice, 1)
        : recommendedDice({
            level: mobLevel,
            floor: atkSpec.floor ?? null,
            isBoss,
            area: Boolean(area),
            rider: hasRider
          });
      const dieSize = String(atkSpec.die || 'd6').trim();
      diceStr = `${diceCount}${dieSize.startsWith('d') ? dieSize : `d${dieSize}`}`;
    }

    damageParts = [
      {
        dice: diceStr,
        stat: String(atkSpec.damageStat || (toHitStat === 'dex' ? 'dex' : 'str')),
        type: String(rawElement || 'Physical'),
        value: sanitizeNumber(atkSpec.damageBonus, 0)
      }
    ];
  }

  // Prose only: the mechanics line is generated from the structured fields at display time.
  const effects = String(atkSpec.effects ?? '');
  const hitRaw = atkSpec.hitDifficulty;
  const hitDifficulty = hitRaw === null || hitRaw === undefined || hitRaw === '' || !Number.isFinite(Number(hitRaw))
    ? null
    : Math.max(0, Math.trunc(Number(hitRaw)));
  const cooldownSpec = atkSpec.cooldown && typeof atkSpec.cooldown === 'object' ? atkSpec.cooldown : null;
  const cooldownUnit = String(sanitizeValue(cooldownSpec?.unit, '')).trim();
  const cooldownValue = Math.max(0, sanitizeNumber(cooldownSpec?.value, 0));
  const cooldown = cooldownUnit && cooldownValue > 0 ? { value: cooldownValue, unit: cooldownUnit } : null;
  // The stat-check save (3.48-9): the target rolls `targetStat` against `customDC` (+ the Floor for a mob attacker).
  const contestSpec = atkSpec.contest && typeof atkSpec.contest === 'object' ? atkSpec.contest : null;
  const contest = contestSpec?.hasContest
    ? {
        hasContest: true,
        contestType: 'dc',
        targetStat: String(sanitizeValue(contestSpec.targetStat, 'dex')).toLowerCase().trim(),
        customDC: Math.max(0, Math.trunc(sanitizeNumber(contestSpec.customDC, 0))),
        onFailDebuff: debuffIdentifier(sanitizeValue(contestSpec.onFailDebuff, ''))
      }
    : null;
  const itemData = {
    name,
    type: 'attack',
    img: atkSpec.img || 'icons/svg/sword.svg',
    system: {
      toHitStat,
      toHitRank,
      damageParts,
      effects,
      ignoreDR,
      hitDifficulty,
      rangeFeet: Math.max(0, Math.trunc(sanitizeNumber(atkSpec.rangeFeet, 0))),
      ...(area ? { area } : {}),
      ...(cooldown ? { cooldown } : {}),
      onHit,
      ...(contest ? { contest } : {}),
      tags: [...tags]
    }
  };

  if (atkSpec._id) itemData._id = atkSpec._id;
  return itemData;
}

/**
 * The trait types `buildTraitItem` has a branch for, plus `custom` (the generic branch: free tags and a description).
 * The Mob Creator's type select offers exactly these.
 */
export const MOB_TRAIT_TYPES = Object.freeze(['damageMultiplier', 'aura', 'hot', 'resistance', 'immunity', 'custom']);

/**
 * Compile a trait preset specification into an embedded Buff item document data.
 * Supports: damageMultiplier, aura, hot, resistance, immunity, and generic buffs.
 * @param {object} traitSpec
 * @returns {object}
 */
export function buildTraitItem(traitSpec = {}) {
  const type = String(traitSpec.type || '').toLowerCase().trim();
  const name = String(traitSpec.name || 'Trait').trim();
  const img = traitSpec.img || 'icons/svg/aura.svg';

  if (type === 'damagemultiplier' || type === 'damage_multiplier') {
    const damageType = String(traitSpec.damageType || 'Physical');
    const multiplier = sanitizeNumber(traitSpec.multiplier, 2);
    const itemData = {
      name,
      type: 'buff',
      img,
      system: {
        tags: [],
        damageModifiers: [
          {
            label: name,
            mode: 'multiply',
            damageType,
            multiplier
          }
        ]
      }
    };
    if (traitSpec._id) itemData._id = traitSpec._id;
    return itemData;
  }

  if (type === 'aura') {
    const itemData = {
      name,
      type: 'buff',
      img,
      system: {
        tags: [...AURA_TAGS],
        description: String(traitSpec.effects || traitSpec.description || '')
      }
    };
    if (traitSpec._id) itemData._id = traitSpec._id;
    return itemData;
  }

  if (type === 'hot') {
    const itemData = {
      name,
      type: 'buff',
      img,
      system: {
        tags: [MOB_SPEC_TAGS.hot],
        description: String(traitSpec.effects || traitSpec.description || '')
      }
    };
    if (traitSpec._id) itemData._id = traitSpec._id;
    return itemData;
  }

  if (type === 'resistance') {
    const itemData = {
      name,
      type: 'buff',
      img,
      system: {
        tags: [],
        defenseModifiers: [
          {
            label: name,
            kind: 'resistance',
            damageType: String(traitSpec.damageType || '')
          }
        ]
      }
    };
    if (traitSpec._id) itemData._id = traitSpec._id;
    return itemData;
  }

  if (type === 'immunity') {
    const itemData = {
      name,
      type: 'buff',
      img,
      system: {
        tags: [],
        defenseModifiers: [
          {
            label: name,
            kind: 'immunity',
            damageType: String(traitSpec.damageType || '')
          }
        ]
      }
    };
    if (traitSpec._id) itemData._id = traitSpec._id;
    return itemData;
  }

  const tags = new Set();
  if (Array.isArray(traitSpec.tags)) {
    for (const t of traitSpec.tags) if (t) tags.add(String(t).trim());
  }

  const itemData = {
    name,
    type: 'buff',
    img,
    system: {
      tags: [...tags],
      description: String(traitSpec.effects || traitSpec.description || '')
    }
  };
  if (traitSpec._id) itemData._id = traitSpec._id;
  return itemData;
}

/**
 * Compile a spell specification into an embedded Spell item document data.
 * @param {object} spellSpec
 * @returns {object}
 */
export function buildSpellItem(spellSpec = {}) {
  const tags = new Set();
  if (Array.isArray(spellSpec.tags)) {
    for (const t of spellSpec.tags) if (t) tags.add(String(t).trim());
  }

  const itemData = {
    name: String(spellSpec.name || 'Spell').trim(),
    type: 'spell',
    img: spellSpec.img || 'icons/svg/aura.svg',
    system: {
      rank: sanitizeNumber(spellSpec.rank, 1),
      stat: String(spellSpec.stat || 'int').toLowerCase(),
      manaCost: sanitizeNumber(spellSpec.manaCost, 5),
      range: String(spellSpec.range || '30 feet'),
      duration: String(spellSpec.duration || 'Instantaneous'),
      checkType: String(spellSpec.checkType || 'attack'),
      baseDamage: normalizeBaseDamage(spellSpec.baseDamage),
      description: String(spellSpec.description || ''),
      notes: String(spellSpec.notes || ''),
      tags: [...tags]
    }
  };
  if (spellSpec._id) itemData._id = spellSpec._id;
  return itemData;
}

/**
 * Compile a loot specification into an embedded Loot item document data.
 * @param {object} lootSpec
 * @returns {object}
 */
export function buildLootItem(lootSpec = {}) {
  const tags = new Set();
  if (Array.isArray(lootSpec.tags)) {
    for (const t of lootSpec.tags) if (t) tags.add(String(t).trim());
  }

  const itemData = {
    name: String(lootSpec.name || 'Loot').trim(),
    type: 'loot',
    img: lootSpec.img || 'icons/svg/chest.svg',
    system: {
      quantity: sanitizeNumber(lootSpec.quantity, 1),
      notes: String(lootSpec.notes || ''),
      description: String(lootSpec.description || ''),
      tags: [...tags]
    }
  };
  if (lootSpec._id) itemData._id = lootSpec._id;
  return itemData;
}

/**
 * Pure compiler: transforms a structured authoring spec into a complete Foundry Actor creation payload.
 * Produces valid MobDataModel system schema, token sizing, and embedded items with canonical tags.
 * @param {object} spec
 * @returns {object}
 */
export function buildMobActorData(spec = {}) {
  const name = String(spec.name || 'Unnamed Mob').trim();
  const level = Math.max(1, sanitizeNumber(spec.level, 1));
  const designFloor = Math.max(1, sanitizeNumber(spec.designFloor, 1));
  const size = sanitizeSizeId(spec.size) || 'tiny'; // Default Tiny per plan §5.2
  const creatureType = String(spec.creatureType || '').trim();

  // Boss tier & encounter classification
  let bossTier = null;
  if (spec.bossTier && spec.bossTier !== 'none') {
    bossTier = String(spec.bossTier).toLowerCase().trim().replace(/^mob\.tier\./, '');
  }
  const isBoss = Boolean(spec.isBoss || bossTier);
  const isUnique = Boolean(spec.isUnique || spec.isUniqueBoss);
  const isSummoned = Boolean(spec.isSummoned);
  const isMinion = Boolean(spec.isMinion);

  // Compile Actor Tags
  const actorTags = new Set();
  if (isBoss) {
    const tierId = bossTier || BARE_BOSS_TIER_ID;
    actorTags.add(bossTierRegistry()[tierId]?.tag || `${TIER_TAG_PREFIX}${tierId}`);
  }
  if (isUnique) {
    actorTags.add(MOB_SPEC_TAGS.unique);
  }
  if (isMinion) actorTags.add(MOB_SPEC_TAGS.minion);
  if (isSummoned) actorTags.add(MOB_SPEC_TAGS.summoned);
  if (Array.isArray(spec.tags)) {
    for (const t of spec.tags) if (t) actorTags.add(String(t).trim());
  }

  // Base abilities & modifiers
  const statBase = isBoss ? 5 : 1;
  const abilities = {};
  for (const k of ['str', 'dex', 'con', 'int', 'cha']) {
    const raw = spec.abilities?.[k];
    const val = sanitizeNumber(raw, statBase);
    abilities[k] = {
      value: val,
      unenhanced: val,
      mod: getCOGStatModifier(val)
    };
  }

  // Health bars and HP
  const conMod = abilities.con.mod > 0 ? abilities.con.mod : 1;
  const derivedBars = hbSlots({
    level,
    bossTier,
    floor: designFloor
  });

  const explicitBars = (spec.bars !== undefined && spec.bars !== null && spec.bars !== '')
    ? sanitizeNumber(spec.bars, null)
    : (spec.hp?.bars !== undefined && spec.hp?.bars !== null && spec.hp?.bars !== '')
      ? sanitizeNumber(spec.hp.bars, null)
      : null;

  const initialBars = explicitBars ?? derivedBars;

  const sourceHpPerBar = spec.hpPerBar ?? spec.hp?.hpPerBar;
  const hpPerBar = resolveHpPerBar(
    (sourceHpPerBar !== undefined && sourceHpPerBar !== null && sourceHpPerBar !== '') ? sanitizeNumber(sourceHpPerBar, 0) : 0,
    conMod
  );

  const maxHp = initialBars * hpPerBar;
  // With derived bars the real maximum depends on the floor when the actor is prepared, so a stored
  // full-health number would exceed it on a lower floor (44/28). null = full health at the live max.
  const curHp = spec.hp?.value !== undefined
    ? sanitizeNumber(spec.hp.value, maxHp)
    : (explicitBars === null ? null : maxHp);

  // Defenses
  let evadeBase = null;
  if (spec.evadeBase !== undefined && spec.evadeBase !== null && spec.evadeBase !== '') {
    evadeBase = sanitizeNumber(spec.evadeBase, null);
  } else if (spec.attributes?.evadeBase !== undefined && spec.attributes?.evadeBase !== null && spec.attributes?.evadeBase !== '') {
    evadeBase = sanitizeNumber(spec.attributes.evadeBase, null);
  }

  let surpriseBase = null;
  if (spec.surpriseBase !== undefined && spec.surpriseBase !== null && spec.surpriseBase !== '') {
    surpriseBase = sanitizeNumber(spec.surpriseBase, null);
  } else if (spec.attributes?.surpriseBase !== undefined && spec.attributes?.surpriseBase !== null && spec.attributes?.surpriseBase !== '') {
    surpriseBase = sanitizeNumber(spec.attributes.surpriseBase, null);
  }

  const armorDR = sanitizeNumber(spec.dr?.armor ?? spec.dr, 0);

  // Speed
  const moveSpeed = sanitizeNumber(spec.move ?? spec.speed?.move, 20);
  const stepSpeed = sanitizeNumber(spec.step ?? spec.speed?.step, 10);

  // Mana
  const manaVal = sanitizeNumber(spec.mana?.value ?? spec.mana, 0);

  // Sizing & Prototype Token
  const tokenSize = spec.tokenSize ? sanitizeNumber(spec.tokenSize, 1) : mobTokenSize(size);

  // Compile Embedded Items
  const items = [];

  // Attacks
  if (Array.isArray(spec.attacks)) {
    for (const atk of spec.attacks) {
      if (atk) items.push(buildAttackItem(atk, { mobLevel: level, isBoss, defaultFloor: designFloor }));
    }
  }

  // Traits / Buffs
  const traitList = spec.traits || [];
  if (Array.isArray(traitList)) {
    for (const tr of traitList) {
      if (tr) items.push(buildTraitItem(tr));
    }
  }

  // Spells
  if (Array.isArray(spec.spells)) {
    for (const spl of spec.spells) {
      if (spl) items.push(buildSpellItem(spl));
    }
  }

  // Loot items (ensure at least 1 loot remains item exists)
  const lootList = spec.loot || [];
  if (Array.isArray(lootList) && lootList.length > 0) {
    for (const lt of lootList) {
      if (lt) items.push(buildLootItem(lt));
    }
  } else {
    items.push(buildLootItem({
      name: `${name} Remains`,
      quantity: 1,
      notes: `Harvested materials or trophy from ${name}.`,
      description: `Remains from defeating ${name}. Can be traded or used in crafting.`
    }));
  }

  const floorStr = spec.floor
    ? (String(spec.floor).startsWith('Floor') ? String(spec.floor) : `Floor ${spec.floor}`)
    : `Floor ${designFloor}`;

  const payload = {
    name,
    type: 'mob',
    img: spec.img || 'icons/svg/skull.svg',
    tokenWidth: tokenSize,
    tokenHeight: tokenSize,
    prototypeToken: {
      name,
      width: tokenSize,
      height: tokenSize,
      disposition: -1,
      ...(spec.prototypeToken || {})
    },
    system: {
      abilities,
      attributes: {
        hp: {
          value: curHp,
          max: maxHp,
          temp: 0,
          pct: 100,
          bars: explicitBars,
          hpPerBar
        },
        mana: {
          value: manaVal,
          max: manaVal,
          pct: 100
        },
        evade: {
          items: 0,
          buffs: 0,
          total: 0
        },
        dr: {
          armor: armorDR,
          items: 0,
          buffs: 0,
          total: armorDR
        },
        speed: {
          move: moveSpeed,
          step: stepSpeed
        },
        aiFavor: 0,
        size,
        evadeBase,
        surpriseBase,
        treasure: spec.treasure || ''
      },
      details: {
        level,
        designFloor,
        floor: floorStr,
        creatureType,
        description: String(spec.description || '').trim(),
        aiDescription: String(spec.aiDescription || '').trim(),
        notes: String(spec.notes || '').trim(),
        special: String(spec.special || '').trim()
      },
      tags: [...actorTags]
    },
    items
  };

  if (spec._id) payload._id = spec._id;
  return payload;
}

// The one payload entry point delegates here for type 'mob'.
registerPayloadDelegate('mob', buildMobActorData);
