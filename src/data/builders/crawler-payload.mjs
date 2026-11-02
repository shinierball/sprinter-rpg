/**
 * src/data/builders/crawler-payload.mjs
 * The crawler's payload compiler: `buildCrawlerPayload(spec)` builds a complete Crawler actor creation
 * payload from a creator spec. Pure, like the other builders: it reads the content registry and the loadout and catalog
 * readers, and needs no Foundry globals at import. The Crawler Creator app (`src/apps/crawler-creator.mjs`) and the
 * examples compile through `buildPayload('crawler', spec)`, which reaches this module's registered delegate.
 */

import { contentRegistry } from '../../content/registry.mjs';
import {
  STARTER_RANK, STARTER_POTION_COUNT, findLoadout, defaultLoadout, resolveLoadoutId, getStarterWeaponDefinition,
  starterSpellPayload, starterUnarmedPayloads, starterPotionPayload
} from '../../content/creation-loadouts.mjs';
import { findCatalogEntry } from '../../content/catalog-lookup.mjs';
import { getCOGStatModifier } from '../../documents/actor/actor-constants.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { DEFAULT_SIZE, sanitizeSizeId } from '../sizes.mjs';
import { parseFloorNumber, floorLabel } from '../../utils/floor-number.mjs';
import { runForStartFloor, startLevelForFloor } from '../floor-arrivals.mjs';
import { coreSkillPayloads } from '../../utils/core-skills.mjs';
import { registerPayloadDelegate } from './item-payload.mjs';

/**
 * The starter hotlist for a crawler's items, read from their `starterRole` flags only. A starter spell
 * means spell, heal, mana potion; a starter attack means heal, attack; otherwise heal. Shared by `createCrawler` (the
 * created ids) and the pack shaper (the embedded ids), so the two cannot differ.
 * @param {Array<object>} items Item documents or payloads (`id` or `_id`, `flags`)
 * @returns {Object<string, string>} `{ slot1, slot2, ... }` item ids; empty when nothing matches
 */
export function starterHotlist(items) {
  const list = Array.from(items ?? []);
  const byRole = (starterRole) => list.find((i) => i?.flags?.[SYSTEM_ID]?.starterRole === starterRole);
  const idOf = (item) => item?.id ?? item?._id;
  const heal = idOf(byRole('heal'));
  const spell = idOf(byRole('starterSpell'));
  const attack = idOf(byRole('starterAttack'));
  const potion = idOf(byRole('manaPotion'));
  const order = spell ? [spell, heal, potion] : attack ? [heal, attack] : [heal];
  const out = {};
  order.forEach((id, i) => { if (id) out[`slot${i + 1}`] = id; });
  return out;
}

/**
 * Resolve a species id against the registry. An unknown or empty id falls back to the first
 * registered species (the baseline generic crawler when nothing is registered).
 * @param {string} [id]
 * @returns {object} Species definition
 */
export function resolveCreatorSpecies(id) {
  return (id ? contentRegistry.getSpecies(id) : null) || contentRegistry.getSpeciesList()[0];
}

/**
 * A copy of the catalog skill with this identifier, ids stripped; null when the catalog lacks it (or no identifier).
 * @param {string} [identifier]
 * @returns {object|null}
 */
function starterSkillCopy(identifier) {
  const canonical = findCatalogEntry('skills', identifier);
  if (!canonical) return null;
  const copy = globalThis.foundry?.utils?.deepClone ? globalThis.foundry.utils.deepClone(canonical) : structuredClone(canonical);
  delete copy._id;
  delete copy.id;
  return copy;
}

/**
 * Pure compiler function that builds a complete Crawler Actor document payload
 * from a specification object.
 *
 * @param {object} spec
 * @returns {object} Actor creation payload for a Crawler
 */
export function buildCrawlerPayload(spec = {}) {
  const speciesData = resolveCreatorSpecies(spec.species);
  const species = speciesData.id;
  const tierSelections = spec.tierSelections || {
    tier1: { background: '', skills: [] },
    tier2: { background: '', skills: [] },
    tier3: { background: '', skills: [] },
    tier4: { background: '', skills: [] }
  };
  const resolved = contentRegistry.resolveSkillRanks(species, tierSelections);
  const floorNumber = parseFloorNumber(spec.floor) || 1;
  // A Floor 3+ start builds the Floor 1 crawler; the Floor Simulator then carries it up the floors
  const floorRun = runForStartFloor(floorNumber).length ? { startFloor: floorNumber, done: [] } : null;
  const floor = floorRun ? floorLabel(1) : floorLabel(floorNumber);

  const stats = {
    str: spec.stats?.str ?? 5,
    dex: spec.stats?.dex ?? 4,
    con: spec.stats?.con ?? 6,
    int: spec.stats?.int ?? 2,
    cha: spec.stats?.cha ?? 3
  };

  const starterMode = spec.starterMode || 'weapon';
  // Starter choices are loadout ids (the registry reader); an unknown id falls back to the slot's first option.
  const wDef = getStarterWeaponDefinition(resolveLoadoutId('weapon', spec.starterWeapon));
  const spellEntry = findLoadout('spell', spec.starterSpell) ?? defaultLoadout('spell');
  const unarmedEntry = findLoadout('unarmed', spec.starterUnarmed) ?? defaultLoadout('unarmed');
  const loadoutWarnings = [];

  // Merge skills with starter combat loadout
  const finalSkillsMap = new Map();
  for (const s of resolved.skills) {
    finalSkillsMap.set(s.ref ? `ref:${s.ref}` : s.name.toLowerCase().trim(), { ...s });
  }

  // Each item the hotlist maps is stamped with its starter role, so the slots never look items up by name.
  const role = (starterRole) => ({ [SYSTEM_ID]: { starterRole } });

  const itemPayloads = [];

  // Build embedded Skill Items
  for (const s of finalSkillsMap.values()) {
    // A skill is a catalog skill only through its `ref` (an id). A row without one, or whose ref the catalog lacks, is
    // built from the row's own name and stat; a ref that misses the catalog is reported (never matched by name).
    const canonical = s.ref ? findCatalogEntry('skills', s.ref) : null;
    const catalogMiss = Boolean(s.ref) && !canonical;
    if (catalogMiss) loadoutWarnings.push(`skill "${s.name}" (${s.ref}) is not in the skill catalog; added as a plain skill`);

    if (canonical) {
      const itemObj = (globalThis.foundry?.utils?.deepClone ? globalThis.foundry.utils.deepClone(canonical) : structuredClone(canonical));
      itemObj.system = itemObj.system || {};
      itemObj.system.rank = s.rank;
      if (s.stat && s.stat !== 'none') {
        itemObj.system.stat = s.stat.toLowerCase();
      }
      // The primary attack skill the Floor Simulator boosts first
      if (s.primary) itemObj.flags = { ...(itemObj.flags || {}), ...role('primarySkill') };
      delete itemObj._id;
      delete itemObj.id;
      itemPayloads.push(itemObj);
    } else {
      itemPayloads.push({
        name: s.name,
        type: 'skill',
        img: 'icons/svg/book.svg',
        ...(s.primary || catalogMiss ? { flags: { [SYSTEM_ID]: { ...(s.primary ? { starterRole: 'primarySkill' } : {}), ...(catalogMiss ? { missingCatalogRef: s.ref } : {}) } } } : {}),
        system: {
          rank: s.rank,
          stat: (s.stat || 'str').toLowerCase(),
          checkType: 'stat',
          damageModifiers: []
        }
      });
    }
  }

  // The starter skills (weapon skill, or unarmed skill and Damage Effect) at Rank 3. A skill the background already
  // gave is raised instead of duplicated (same identifier, else same name).
  const starterSkills = [];
  if (starterMode === 'weapon') {
    const copy = starterSkillCopy(wDef.skillIdentifier);
    starterSkills.push({
      primary: true,
      payload: copy ?? {
        name: wDef.name,
        type: 'skill',
        img: 'icons/svg/book.svg',
        system: {
          ...(wDef.skillIdentifier ? { identifier: wDef.skillIdentifier } : {}),
          rank: STARTER_RANK,
          stat: (wDef.toHitStat || 'str').toLowerCase(),
          checkType: 'stat',
          notes: `Skill: ${wDef.name}`,
          damageModifiers: []
        }
      }
    });
  } else if (starterMode === 'unarmed') {
    const pkg = starterUnarmedPayloads(unarmedEntry, loadoutWarnings);
    if (pkg.skill) starterSkills.push({ primary: true, payload: pkg.skill });
    if (pkg.effect) starterSkills.push({ primary: false, payload: pkg.effect });
  }
  for (const { primary, payload } of starterSkills) {
    const identifier = payload.system?.identifier;
    const lowered = String(payload.name ?? '').toLowerCase().trim();
    const existing = itemPayloads.find(p => p.type === 'skill' && ((identifier && p.system?.identifier === identifier) || String(p.name ?? '').toLowerCase().trim() === lowered));
    if (existing) {
      existing.system = { ...(existing.system ?? {}), rank: Math.max(Number(existing.system?.rank) || 0, STARTER_RANK) };
      if (primary) existing.flags = { ...(existing.flags || {}), ...role('primarySkill') };
      continue;
    }
    payload.system = { ...(payload.system ?? {}), rank: STARTER_RANK };
    if (primary) payload.flags = { ...(payload.flags || {}), ...role('primarySkill') };
    itemPayloads.push(payload);
  }

  // All crawlers start with the Heal spell at Rank 1 (the catalog spell with identifier `heal`)
  const healCanonical = findCatalogEntry('spells', 'heal');
  if (healCanonical) {
    const healItem = (globalThis.foundry?.utils?.deepClone ? globalThis.foundry.utils.deepClone(healCanonical) : structuredClone(healCanonical));
    healItem.system = healItem.system || {};
    healItem.system.rank = 1;
    healItem.system.rankCeiling = 1;
    healItem.flags = { ...(healItem.flags || {}), ...role('heal') };
    delete healItem._id;
    delete healItem.id;
    itemPayloads.push(healItem);
  } else {
    itemPayloads.push({
      name: 'Heal',
      type: 'spell',
      img: 'icons/svg/heal.svg',
      flags: role('heal'),
      system: {
        identifier: 'heal',
        rank: 1,
        rankCeiling: 1,
        stat: 'int',
        manaCost: 2,
        range: 'Self only',
        duration: 'Instantaneous',
        cooldown: { value: 0, unit: '' },
        checkType: 'none',
        baseDamage: { dice: '', stat: 'none', damageType: '' },
        healing: { hasHealing: true, barsFormula: '2' },
        tags: ['school.healing'],
        description: 'Heal 2 Health Bar slots.'
      }
    });
  }

  // If starterMode === 'weapon': add the weapon to inventory (gear), equip it, and add an attack using it
  if (starterMode === 'weapon') {
    // 1. Add weapon to inventory and equip it
    itemPayloads.push({
      name: wDef.name,
      type: 'gear',
      img: wDef.img || 'icons/svg/sword.svg',
      system: {
        slot: 'hands',
        quantity: 1,
        equipped: true,
        drBonus: 0,
        abilityModifiers: {
          str: { value: 0, type: 'flat' },
          int: { value: 0, type: 'flat' },
          con: { value: 0, type: 'flat' },
          dex: { value: 0, type: 'flat' },
          cha: { value: 0, type: 'flat' }
        },
        damageParts: [{ dice: wDef.damageDice, stat: wDef.damageStat, type: wDef.damageType, value: 0 }],
        ...(wDef.skillIdentifier ? { associatedSkills: [wDef.skillIdentifier] } : {}),
        notes: wDef.effects || `Equipped weapon: ${wDef.name}`
      }
    });

    // 2. Add an attack using the equipped item
    itemPayloads.push({
      name: wDef.name,
      type: 'attack',
      img: wDef.img || 'icons/svg/sword.svg',
      flags: role('starterAttack'),
      system: {
        toHitStat: wDef.toHitStat,
        toHitRank: 3,
        damageParts: [{ dice: wDef.damageDice, stat: wDef.damageStat, type: wDef.damageType, value: 0 }],
        ...(wDef.skillIdentifier ? { associatedSkills: [wDef.skillIdentifier] } : {}),
        effects: wDef.effects || ''
      }
    });
  } else if (starterMode === 'spell') {
    const spellItem = starterSpellPayload(spellEntry, loadoutWarnings);
    if (spellItem) {
      spellItem.system = { ...(spellItem.system ?? {}), rank: STARTER_RANK };
      spellItem.flags = { ...(spellItem.flags || {}), ...role('starterSpell') };
      itemPayloads.push(spellItem);
    }

    // The potions restore mana by their outcome row (never by name or notes)
    const potion = starterPotionPayload(STARTER_POTION_COUNT, loadoutWarnings);
    if (potion) {
      potion.flags = { ...(potion.flags || {}), ...role('manaPotion') };
      itemPayloads.push(potion);
    }
  }

  for (const message of loadoutWarnings) console.warn(`Sprinter RPG | Crawler creation: ${message}`);

  // Append any extra items passed in spec
  if (Array.isArray(spec.items)) {
    itemPayloads.push(...spec.items);
  }

  // Core skills (`kind.core`: Intervene, Call a Play) every crawler has, skipping any already in the payload (E7.9 D9)
  itemPayloads.push(...coreSkillPayloads(itemPayloads));

  // Starting items of the chosen race and class, resolved once by `buildStartingItemsSpec`. The record
  // marks each source as given, so applying it to this actor later never duplicates them.
  const startingItems = Array.isArray(spec.startingItems?.items) ? spec.startingItems.items : [];
  const startingRecord = spec.startingItems?.record && typeof spec.startingItems.record === 'object' ? spec.startingItems.record : null;
  itemPayloads.push(...startingItems);

  const conMod = getCOGStatModifier(stats.con);
  const maxHp = 10 * conMod;
  const maxMana = Number(stats.int) || 0;

  const ownership = spec.ownership || {
    default: globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.NONE ?? 0,
    ...(globalThis.game?.user?.id ? { [globalThis.game.user.id]: globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3 } : {})
  };

  const isRuleBreak = Boolean(spec.ruleBreak || spec.isRuleBreak);
  const name = (spec.name || '').trim() || 'New Crawler';

  return {
    name,
    type: 'crawler',
    ownership,
    prototypeToken: {
      actorLink: true,
      name
    },
    system: {
      abilities: {
        str: { value: stats.str, unenhanced: stats.str },
        dex: { value: stats.dex, unenhanced: stats.dex },
        con: { value: stats.con, unenhanced: stats.con },
        int: { value: stats.int, unenhanced: stats.int },
        cha: { value: stats.cha, unenhanced: stats.cha }
      },
      attributes: {
        aiFavor: speciesData.aiFavor,
        size: sanitizeSizeId(spec.size) || DEFAULT_SIZE,
        hp: {
          value: maxHp,
          max: maxHp,
          temp: 0,
          buffTemp: 0,
          pct: 100
        },
        mana: {
          value: maxMana,
          max: maxMana,
          pct: 100
        }
      },
      // Species is the origin at induction, not a race: Race and Class come from the applier
      tags: Array.isArray(speciesData.tags) ? [...speciesData.tags] : [],
      details: {
        floor,
        level: floorRun ? 1 : startLevelForFloor(floorNumber),
        crawlerNumber: spec.crawlerNumber || '',
        pastTrauma: spec.pastTrauma || '',
        looseEnds: spec.looseEnds || '',
        regrets: spec.regrets || ''
      }
    },
    flags: {
      ...(spec.flags || {}),
      ...(isRuleBreak || startingRecord || floorRun
        ? {
            [SYSTEM_ID]: {
              ...(spec.flags?.[SYSTEM_ID] || {}),
              ...(isRuleBreak ? { ruleBreak: true } : {}),
              ...(startingRecord ? { startingItemsGranted: startingRecord } : {}),
              ...(floorRun ? { floorRun } : {})
            }
          }
        : {})
    },
    items: itemPayloads
  };
}


// The one payload entry point delegates here for type 'crawler'.
registerPayloadDelegate('crawler', buildCrawlerPayload);
