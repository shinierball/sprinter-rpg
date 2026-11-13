/**
 * Floor Simulator snapshots and context. Pure (no document class, no dialog, no chat): `snapshotForFloorSim` turns a
 * crawler into plain data, `snapshotFromPayload` does the same for an actor creation payload, and
 * `buildFloorSimContext` gathers what the compiler reads besides it. The document layer
 * (`src/documents/actor/actor-floor-sim.mjs`) re-exports these.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { catalogEntries, findConditionEntry } from '../../content/catalog-lookup.mjs';
import { getFloorArrival, runForStartFloor } from '../floor-arrivals.mjs';
import { prefillAiFavorRating } from '../../utils/character/ai-favor.mjs';
import { getLootTiers } from './loot-tiers.mjs';
import { getItemAllTags } from '../../documents/active-tags.mjs';
import { asTriggersOf, hasAsTrigger } from '../../utils/roll/amazing-success.mjs';
import { getRankCeiling } from '../../utils/skill/rank-cap.mjs';
import { percentStatMode } from '../../utils/character/stat-percent.mjs';
import { collectGearBonuses, statBonuses, collectBuffBonuses, collectDebuffEffects, resolvePersistentDebuffs, resolveBaseScore, STAT_KEYS as DERIVED_STAT_KEYS } from '../../models/actors/actor-derivation.mjs';
import { getStatCaps } from '../../utils/character/stat-caps.mjs';
import { getCOGStatModifier } from '../../documents/actor/actor-constants.mjs';
import { parseFloorNumber } from '../../utils/floor/floor-number.mjs';

const STATS = ['str', 'dex', 'con', 'int', 'cha'];

const intOr = (raw, fallback = 0) => {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) ? n : fallback;
};

const itemList = (actor) => {
  return Array.from(actor?.items ?? []);
};

const flagOf = (actor, key) => actor?.flags?.[SYSTEM_ID]?.[key] ?? actor?.getFlag?.(SYSTEM_ID, key) ?? null;

/** A run (`{ startFloor, done, complete? }`) sanitised: `{ startFloor, done: number[], complete? }` or null. */
export function cleanFloorRun(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const startFloor = parseFloorNumber(raw.startFloor);
  if (!startFloor) return null;
  const done = (Array.isArray(raw.done) ? raw.done : []).map(Number).filter(n => Number.isInteger(n) && n > 0);
  return { startFloor, done, ...(raw.complete ? { complete: true } : {}) };
}

/**
 * Plain data for the compiler; no documents. A crawler carries no run of its own: `floorRun` is the run the caller is
 * compiling (the creator's pipeline passes it), null when none (the compiler then refuses).
 * @param {object} actor
 * @param {{ floorRun?: ({startFloor: number, done: number[], complete?: boolean}|null) }} [options]
 * @returns {object} FloorSnapshot
 */
export function snapshotForFloorSim(actor, { floorRun = null } = {}) {
  const system = actor?.system ?? {};
  const abilities = {};
  for (const key of STATS) {
    const a = system.abilities?.[key] ?? {};
    const value = intOr(a.value, 10);
    abilities[key] = { value, unenhanced: intOr(a.unenhanced, value), cap: a.statCap === null || a.statCap === undefined ? null : intOr(a.statCap, null) };
  }
  const skills = [];
  const spells = [];
  const weapons = [];
  let hasRace = false;
  let hasClass = false;
  for (const item of itemList(actor)) {
    const role = item.flags?.[SYSTEM_ID]?.starterRole ?? null;
    if (item.type === 'skill') {
      skills.push({
        id: item.id, identifier: item.system?.identifier ?? '', name: item.name, rank: intOr(item.system?.rank), rankCeiling: getRankCeiling(item),
        tags: [...getItemAllTags(item)], starterRole: role, aiFavor: prefillAiFavorRating(item.system?.aiFavorRatings), aiFavorRatings: structuredClone(item.system?.aiFavorRatings ?? [])
      });
    } else if (item.type === 'spell') {
      spells.push({
        id: item.id, identifier: item.system?.identifier ?? '', name: item.name, rank: intOr(item.system?.rank), rankCeiling: getRankCeiling(item),
        manaCost: intOr(item.system?.manaCost), aiFavor: intOr(item.system?.aiFavor), starterRole: role
      });
    } else if (item.type === 'gear' && item.system?.isWeapon === true) {
      weapons.push({
        id: item.id, name: item.name, equipped: Boolean(item.system?.equipped), attackId: null,
        skillIdentifier: item.system?.associatedSkills?.[0] || null, aiFavor: prefillAiFavorRating(item.system?.aiFavorRatings), aiFavorRatings: structuredClone(item.system?.aiFavorRatings ?? []), hasAsTrigger: hasAsTrigger(item), asTriggers: structuredClone(asTriggersOf(item)), tags: Array.from(item.system?.tags ?? []),
        grants: structuredClone(Array.from(item.system?.grants ?? [])), damageModifiers: structuredClone(Array.from(item.system?.damageModifiers ?? [])),
        enchantments: structuredClone(Array.from(item.system?.enchantments ?? []))
      });
    } else if (item.type === 'race') hasRace = true;
    else if (item.type === 'class') hasClass = true;
  }
  // A weapon's pre-filled AI Favor also counts the linked skill's rows (3.25d-3b); aiFavorRatings stays the gear's own.
  for (const w of weapons) {
    const linked = w.skillIdentifier ? itemList(actor).find(i => i.type === 'skill' && i.system?.identifier === w.skillIdentifier) : null;
    if (linked) w.aiFavor = Math.max(w.aiFavor, prefillAiFavorRating(linked.system?.aiFavorRatings));
  }
  const history = flagOf(actor, 'floorHistory');
  return {
    actorUuid: actor?.uuid ?? '', name: actor?.name ?? '', type: actor?.type ?? '',
    level: Math.max(1, intOr(system.details?.level, 1)), floor: parseFloorNumber(system.details?.floor) || 1,
    pendingStatPoints: Math.max(0, intOr(system.details?.pendingStatPoints)), abilities,
    aiFavor: intOr(system.attributes?.aiFavor), popularity: intOr(system.details?.popularity), manaMax: intOr(system.attributes?.mana?.max),
    skills, spells, weapons, hasRace, hasClass, floorHistory: Array.isArray(history) ? structuredClone(history) : [],
    floorRun: cleanFloorRun(floorRun)
  };
}

/**
 * The derived values of a crawler payload, computed without Foundry: Enhanced scores (Unenhanced + equipped gear + active
 * buffs and debuffs, the same collectors the DataModel's `prepareDerivedBaseStats` uses), the race and class stat caps,
 * and the HP and Mana maximums. A payload's items need `_id`s only for the snapshot, not here.
 * Not counted: `statSubstitutions` rows on the Health Bar stat, and a dispel that suspends a buff.
 * @param {object} payload an actor creation payload (`system`, `items`)
 * @returns {{ abilities: Object<string, {unenhanced: number, value: number, mod: number, statCap: (number|null), gearBonus: number, buffBonus: number}>, hpMax: number, manaMax: number }}
 */
export function derivedStatsFromPayload(payload) {
  const items = Array.from(payload?.items ?? []);
  const equippedGear = items.filter(i => i?.type === 'gear' && i.system?.equipped);
  const gear = collectGearBonuses(equippedGear, percentStatMode());
  const activeBuffs = items.filter(i => i?.type === 'buff' && i.system?.active);
  for (const g of equippedGear) {
    for (const key of Array.isArray(g.system?.persistentBuffs) ? g.system.persistentBuffs : []) {
      const found = key ? findConditionEntry('buffs', String(key).trim()) : null;
      if (found) activeBuffs.push(found);
    }
  }
  const buffs = collectBuffBonuses(activeBuffs);
  const debuffs = collectDebuffEffects([...items.filter(i => i?.type === 'debuff'), ...resolvePersistentDebuffs(items, equippedGear)]);
  const caps = getStatCaps({ items });
  const abilities = {};
  for (const key of DERIVED_STAT_KEYS) {
    const unenhanced = resolveBaseScore(payload?.system?.abilities?.[key]);
    const buffFlat = (buffs.stats[key] || 0) + (debuffs.stats[key] || 0);
    const buffPct = (buffs.pct[key] || 0) + (debuffs.pct[key] || 0);
    const { gearBonus, buffBonus } = statBonuses(unenhanced, gear.stats[key], buffFlat, buffPct);
    const value = unenhanced + gearBonus + buffBonus;
    abilities[key] = { unenhanced, value, mod: getCOGStatModifier(value), statCap: caps[key] ?? null, gearBonus, buffBonus };
  }
  return { abilities, hpMax: 10 * abilities.con.mod, manaMax: Number(abilities.int.value) || 0 };
}

/**
 * The same plain data as `snapshotForFloorSim`, from an actor creation payload instead of a document (D4 (b)): the
 * derived scores come from {@link derivedStatsFromPayload}, then `snapshotForFloorSim` reads the rest unchanged. Items
 * need an `_id` to be listed. `actorUuid` is empty.
 * @param {object} payload
 * @param {{ floorRun?: ({startFloor: number, done: number[], complete?: boolean}|null) }} [options] the pending run the
 *   compiler reads (a payload carries none: the pipeline passes the run it is compiling)
 * @returns {object} FloorSnapshot
 */
export function snapshotFromPayload(payload, { floorRun = null } = {}) {
  const derived = derivedStatsFromPayload(payload);
  const system = structuredClone(payload?.system ?? {});
  system.abilities = system.abilities ?? {};
  for (const key of DERIVED_STAT_KEYS) {
    system.abilities[key] = { ...(system.abilities[key] ?? {}), unenhanced: derived.abilities[key].unenhanced, value: derived.abilities[key].value, statCap: derived.abilities[key].statCap };
  }
  system.attributes = { ...(system.attributes ?? {}), mana: { ...(system.attributes?.mana ?? {}), max: derived.manaMax } };
  const flags = structuredClone(payload?.flags ?? {});
  const items = (Array.from(payload?.items ?? [])).map(i => ({
    ...structuredClone(i), id: i._id ?? i.id
  }));
  return snapshotForFloorSim({ name: payload?.name ?? '', type: payload?.type ?? '', uuid: '', system, flags, items }, { floorRun });
}

/**
 * The compiler context for an arrival and a run (`{ startFloor, done }` or null), from the content catalog alone. Pure
 * apart from the catalog reads; the creator's pipeline calls it with the run it is compiling.
 * @param {number|object} arrival A floor number or an arrival definition
 * @param {{startFloor: number, done: number[]}|null} floorRun
 * @returns {object} FloorSimContext
 */
export function buildFloorSimContext(arrival, floorRun) {
  const definition = arrival && typeof arrival === 'object' ? arrival : getFloorArrival(arrival);
  const arrivals = floorRun ? runForStartFloor(floorRun.startFloor) : [];
  const duplicateSubstitute = arrivals.some(n => Boolean(getFloorArrival(n)?.spellDuplicateSubstitute));
  return {
    arrival: definition ?? null,
    run: { startFloor: floorRun?.startFloor ?? null, arrivals, spellDuplicateSubstitute: duplicateSubstitute },
    tables: {},
    catalog: {
      skills: catalogEntries('skills').map(d => ({ identifier: d.system?.identifier ?? '', name: d.name, tags: d.system?.tags ?? [], stat: d.system?.stat ?? '', rankCeiling: getRankCeiling(d) })),
      spells: catalogEntries('spells').map(d => ({ identifier: d.system?.identifier ?? '', name: d.name, manaCost: intOr(d.system?.manaCost), tags: d.system?.tags ?? [], aiFavor: intOr(d.system?.aiFavor), rankCeiling: getRankCeiling(d) }))
    },
    lootTiers: getLootTiers()
  };
}

