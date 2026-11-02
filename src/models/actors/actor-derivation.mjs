/**
 * Pure derivation helpers for actor DataModels.
 * Each function takes items (or plain item-like objects) and returns plain values; nothing here
 * reads or writes an actor. `BaseActorDataModel` composes them in `prepareDerivedBaseStats` and
 * `prepareDerivedItemRanks`.
 */
import { ANIMAL_TAGS, getItemAllTags } from '../../data/tags.mjs';
import { gearSkillGrantBonus } from '../items/base-item-model.mjs';
import { catalogEntries, findCatalogEntry } from '../../content/catalog-lookup.mjs';
import { slugifyIdentifier } from '../../utils/identifier.mjs';
import { normalizeTiming } from '../../utils/timing.mjs';
import { matchesTagQuery } from '../../utils/tag-query.mjs';
import { baseRankOf } from '../../utils/rank-source.mjs';
import { isStaticDefenseRow } from '../../utils/damage-modifiers.mjs';
import { applyRowKind, getRowKind, kindOf } from '../../utils/row-kinds.mjs';

export const STAT_KEYS = ['str', 'int', 'con', 'dex', 'cha'];

const emptyStatMap = (make) => Object.fromEntries(STAT_KEYS.map(k => [k, make()]));

/** True when a stored base score means "not set" (null, undefined or empty string). Zero and negatives are real scores. */
export function isUnsetScore(raw) {
  return raw === null || raw === undefined || raw === '';
}

/**
 * Resolve an ability's base score. An unset or non-finite `unenhanced` falls back to `value`, then 10.
 * @param {{unenhanced?: *, value?: *}} ability
 * @returns {number}
 */
export function resolveBaseScore(ability) {
  const raw = ability?.unenhanced;
  const own = isUnsetScore(raw) ? NaN : Number(raw);
  if (Number.isFinite(own)) return own;
  const v = Number(ability?.value);
  return Number.isFinite(v) ? v : 10;
}

function addLimbs(sys, limbs) {
  const l = sys.limbModifiers || {};
  if (l.arms) limbs.arms += Number(l.arms) || 0;
  if (l.legs) limbs.legs += Number(l.legs) || 0;
  if (l.hands) limbs.hands += Number(l.hands) || 0;
}

function addGearStat(stats, key, value, type) {
  if (!stats[key]) return;
  const val = Number(value);
  if (!Number.isFinite(val) || val === 0) return;
  const t = (type || 'flat').toLowerCase();
  if (t === 'pct' || t === '%') stats[key].pct += val;
  else stats[key].flat += val;
}

/**
 * Equipped gear totals (ability scores, `drBonus`). Resistances and immunities are typed `defenseModifiers`
 * rows, summed separately by `collectStaticDefense`.
 * @param {object[]} equippedGear
 */
export function collectGearBonuses(equippedGear) {
  const out = {
    stats: emptyStatMap(() => ({ flat: 0, pct: 0 })),
    dr: 0
  };
  for (const item of (equippedGear || [])) {
    const sys = item?.system;
    if (!sys) continue;
    if (sys.abilityModifiers) {
      for (const [key, mods] of Object.entries(sys.abilityModifiers)) {
        if (mods) addGearStat(out.stats, key, mods.value, mods.type);
      }
    }
    if (Array.isArray(sys.grants)) {
      for (const g of sys.grants) {
        if (!g) continue;
        if (g.kind === 'stat') addGearStat(out.stats, (g.stat || '').toLowerCase().trim(), g.value, 'flat');
      }
    }
    out.dr += Number(sys.drBonus) || 0;
  }
  return out;
}

/**
 * Totals of the typed `defenseModifiers` rows that hold without an incoming attack:
 * - `tempHp` and `evade` rows apply when their condition matches the defender's own `self.*` tags (empty matches);
 * - `resistance`, `immunity` and `dr` rows apply only when their condition is empty. A conditioned row can
 *   name attack tags, so it is decided per hit by `collectDefenseModifiers` instead (never counted twice);
 * - `reduction` rows are always decided per hit.
 * @param {object[]} sources items or buff-slot entries carrying `defenseModifiers`
 * @param {{ tags: Iterable<string> }} derivedContext a `derived` RollContext of the defender (its `self.*` tags)
 */
export function collectStaticDefense(sources, derivedContext) {
  const out = { dr: 0, evade: 0, tempHp: 0, resistances: new Set(), immunities: new Set() };
  for (const source of (sources || [])) {
    const rows = source?.system?.defenseModifiers ?? source?.defenseModifiers;
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || row.disabled === true || !isStaticDefenseRow(row, derivedContext)) continue;
      applyRowKind('defenseModifiers', getRowKind('defenseModifiers', kindOf('defenseModifiers', row)), 'derived', out, row, { source, tags: derivedContext.tags });
    }
  }
  return out;
}

/** Add every `grants[kind: stat]` row of a buff or debuff into `stats` (ability score deltas). */
function addStatGrants(sys, stats) {
  for (const g of (Array.isArray(sys?.grants) ? sys.grants : [])) {
    if (g?.kind !== 'stat') continue;
    const key = String(g.stat ?? '').toLowerCase().trim();
    if (key && stats[key] !== undefined) stats[key] += Number(g.value) || 0;
  }
}

/**
 * Active buff totals (`getActiveBuffs()` entries: `{ system, ...system }`): ability scores (`grants[kind: stat]` rows),
 * and limbs. Temp HP, resistance and immunity come from `defenseModifiers` rows (`collectStaticDefense`).
 * @param {object[]} activeBuffs
 */
export function collectBuffBonuses(activeBuffs) {
  const out = {
    stats: emptyStatMap(() => 0),
    limbs: { arms: 0, legs: 0, hands: 0 }
  };

  for (const buff of (activeBuffs || [])) {
    if (!buff) continue;
    const bSys = buff.system || buff;
    addLimbs(bSys, out.limbs);
    addStatGrants(bSys, out.stats);
  }
  return out;
}

/**
 * Resolve equipped gear `persistentDebuffs` references (names are slugged to identifiers) to debuff
 * documents or catalog definitions, so their `limbModifiers` and stat grants are read. A reference
 * the actor already owns as a debuff item is skipped (the item counts itself); one that matches no
 * catalog entry stays a name-only stub carrying just its identifier (roll modifiers key on it).
 * @param {Iterable<object>} items - the actor's items
 * @param {object[]} equippedGear
 * @returns {object[]} debuff-like objects with `name`, `system.identifier`, and the source gear ids
 */
export function resolvePersistentDebuffs(items, equippedGear) {
  const owned = new Set();
  for (const i of (items || [])) {
    if (i?.type === 'debuff' && i.system?.identifier) owned.add(i.system.identifier);
  }
  const out = [];
  const seen = new Set();
  for (const gear of (equippedGear || [])) {
    const refs = Array.isArray(gear?.system?.persistentDebuffs) ? gear.system.persistentDebuffs : [];
    for (const ref of refs) {
      const identifier = slugifyIdentifier(ref);
      if (!identifier || owned.has(identifier) || seen.has(identifier)) continue;
      seen.add(identifier);
      const def = findCatalogEntry('debuffs', identifier);
      const system = { ...(def?.system || {}), active: true, identifier };
      out.push({
        name: def?.name || String(ref),
        system,
        sourceGearId: gear.id || gear._id,
        sourceGearName: gear.name
      });
    }
  }
  return out;
}

/**
 * Embedded debuff items plus resolved equipped-gear persistent debuffs (limb modifiers and `grants[kind: stat]` rows).
 * @param {object[]} debuffItems - owned debuff items plus the output of {@link resolvePersistentDebuffs}
 */
export function collectDebuffEffects(debuffItems) {
  const out = { stats: emptyStatMap(() => 0), limbs: { arms: 0, legs: 0, hands: 0 } };
  for (const debuff of (debuffItems || [])) {
    const dSys = debuff.system || {};
    addLimbs(dSys, out.limbs);
    addStatGrants(dSys, out.stats);
  }
  return out;
}

const isTagBonus = (g) => g?.kind === 'rank_bonus';

/**
 * rank_bonus grants: equipped gear, active buffs, embedded class and race items.
 * @returns {Array<{query?: object, tag?: string, value?: number, floor?: number, onlyIfOwned?: boolean}>}
 */
export function collectTagBonusGrants({ equippedGear = [], activeBuffs = [], items = [] } = {}) {
  const out = [];
  let anonymous = 0;
  // Each row remembers its source item so rows from one item can be reduced to the largest per skill.
  const take = (item) => {
    const list = item?.system?.grants;
    if (!Array.isArray(list)) return;
    const sourceKey = String(item.id ?? item.uuid ?? item._id ?? '') || `anonymous-${anonymous++}`;
    for (const g of list) if (isTagBonus(g)) out.push({ ...g, sourceKey });
  };
  for (const i of equippedGear) take(i);
  for (const b of activeBuffs) take(b);
  for (const i of items) if (i?.type === 'class' || i?.type === 'race') take(i);
  return out;
}

/**
 * Display name of the catalog skill or spell with this `system.identifier`, or '' when the catalog
 * has none. The rank pipeline keys gear bonuses by normalized name; the identifier is what resolves it.
 */
export function catalogNameFor(identifier, catalogs) {
  if (!identifier) return '';
  for (const list of catalogs) {
    const hit = (list || []).find(d => d?.system?.identifier === identifier);
    if (hit) return hit.name;
  }
  return '';
}

/**
 * Name the sheet shows for a skill or spell grant: the catalog document with the grant's
 * `system.identifier`, else the row's `label`. Display only; nothing resolves a grant by this name.
 * @param {{identifier?: string, label?: string}} grant
 * @param {'skill'|'spell'} kind
 * @returns {string}
 */
export function grantDisplayName(grant, kind) {
  const catalogs = [catalogEntries(kind === 'spell' ? 'spells' : 'skills')];
  return catalogNameFor(grant?.identifier, catalogs) || grant?.label || grant?.identifier || '';
}

/** Key of a gear skill/spell bonus entry: a skill and a spell with the same identifier never collide. */
export function gearGrantKey(kind, identifier) {
  return `${kind}:${identifier}`;
}

/**
 * Gear skill and spell bonuses from equipped gear `grants` rows of kind `skill` / `spell`, keyed
 * {@link gearGrantKey}. A row's `value` adds to the owned skill or spell with that `system.identifier`; a spell row's
 * `rank` is the rank an unowned spell is granted at. Names are never matched.
 * @returns {Map<string, {kind: 'skill'|'spell', identifier: string, bonus: number, rank: number, cooldown: ({value: number, unit: string, scaleBy: object|null}|null), label: string, sources: string[], grantSources: {itemId: string, key: string, grantIndex: number, rank: number}[]}>}
 */
export function collectGearSkillBonuses(equippedGear) {
  const map = new Map();
  for (const item of (equippedGear || [])) {
    const grants = item?.system?.grants;
    if (!Array.isArray(grants)) continue;
    for (const [grantIndex, g] of grants.entries()) {
      if ((g?.kind !== 'skill' && g?.kind !== 'spell') || g.mode === 'choice') continue;
      const identifier = String(g.identifier ?? '').trim();
      if (!identifier) continue;
      const key = gearGrantKey(g.kind, identifier);
      if (!map.has(key)) map.set(key, { kind: g.kind, identifier, bonus: 0, rank: 0, cooldown: null, label: String(g.label ?? ''), sources: [], grantSources: [] });
      const entry = map.get(key);
      const bonus = gearSkillGrantBonus(g);
      entry.bonus += bonus;
      if (g.kind === 'spell') {
        entry.rank = Math.max(entry.rank, Number(g.rank) || 1);
        if (!entry.cooldown && normalizeTiming(g.cooldown).unit) entry.cooldown = normalizeTiming(g.cooldown);
        entry.sources.push(bonus ? `${item.name} (+${bonus})` : item.name);
        // Where the use record lives: on this gear, under `grant.spell.<identifier>` (3.12c)
        entry.grantSources.push({ itemId: item.id ?? item._id ?? '', key: `grant.spell.${identifier}`, grantIndex, rank: Number(g.rank) || 1 });
      } else {
        entry.sources.push(`${item.name} (+${bonus})`);
      }
    }
  }
  return map;
}

/**
 * The gear bonus entry for an owned skill or spell: the entry for its `system.identifier`.
 * @param {Map<string, object>} gearSkillBonuses from {@link collectGearSkillBonuses}
 * @param {object} item an owned skill or spell
 * @param {'skill'|'spell'} [kind] defaults to the item's type
 */
export function gearBonusEntryFor(gearSkillBonuses, item, kind = item?.type) {
  const id = item?.system?.identifier;
  if (!id || !gearSkillBonuses) return undefined;
  return gearSkillBonuses.get(gearGrantKey(kind, id));
}

function tagBonusFor(item, tagGrants) {
  if (!tagGrants?.length) return 0;
  const rawTags = item.allTags instanceof Set ? item.allTags : getItemAllTags(item);
  const tagSet = rawTags instanceof Set ? rawTags : new Set(rawTags || []);
  const baseRank = Number(item.system?.rank) || 0;
  // Rows from one source item that match this skill do not stack: only the largest applies.
  const bySource = new Map();
  for (const g of tagGrants) {
    const matches = g.tag ? tagSet.has(g.tag) : Boolean(g.query && matchesTagQuery(tagSet, g.query));
    if (!matches) continue;
    if (g.onlyIfOwned && baseRank <= 0) continue;
    let val = Number(g.value) || 0;
    if (g.floor > 0 && val < 0) val = Math.max(val, g.floor - baseRank);
    const key = g.sourceKey ?? Symbol('row');
    bySource.set(key, bySource.has(key) ? Math.max(bySource.get(key), val) : val);
  }
  let bonus = 0;
  for (const val of bySource.values()) bonus += val;
  return bonus;
}

const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);

/**
 * Writes item.system.{itemBonus, boonBonus, modifiedRank, totalSkill, statMod} and the
 * document accessors (baseRank, itemBonus, ..., itemSources).
 */
export function deriveSkillRanks(skills, { abilities, gearSkillBonuses = new Map(), tagGrants = [], animalSkillsLocked = false } = {}) {
  // Each skill's itemBonus (gear + tag grants) is computed once and used in both passes.
  const bonuses = new Map();
  for (const item of skills) {
    const gearData = gearBonusEntryFor(gearSkillBonuses, item, 'skill');
    bonuses.set(item, (gearData ? gearData.bonus : 0) + tagBonusFor(item, tagGrants));
  }

  // Weapon groups are tags (`weaponGroup.*`), not skills: there is no group-skill type bonus.
  for (const item of skills) {
    const baseRank = baseRankOf(item);
    const gearData = gearBonusEntryFor(gearSkillBonuses, item, 'skill');
    const itemBonus = bonuses.get(item);
    const boonBonus = Number(item.system?.boonBonus) || 0;
    const modifiedRank = Math.max(0, baseRank + itemBonus + boonBonus);
    const stat = item.system?.stat || 'str';
    const statMod = abilities?.[stat]?.mod ?? 0;
    const totalSkill = modifiedRank + statMod;

    if (item.system) {
      item.system.itemBonus = itemBonus;
      item.system.boonBonus = boonBonus;
      item.system.modifiedRank = modifiedRank;
      item.system.effectiveRank = modifiedRank;
      item.system.totalSkill = totalSkill;
      item.system.statMod = statMod;
    }
    item.baseRank = baseRank;
    item.itemBonus = itemBonus;
    item.boonBonus = boonBonus;
    item.modifiedRank = modifiedRank;
    item.effectiveRank = modifiedRank;
    item.statMod = statMod;
    item.statModStr = signed(statMod);
    item.totalSkill = totalSkill;
    item.totalSkillStr = signed(totalSkill);
    item.itemSources = gearData ? gearData.sources.join(', ') : '';

    // Animal skills (`skillGroup.animal`) are kept but unusable while the actor is locked out of them (permissive: Rule Break)
    const unusable = Boolean(animalSkillsLocked && getItemAllTags(item).has?.(ANIMAL_TAGS.skill));
    if (item.system) item.system.unusable = unusable;
    item.unusable = unusable;
  }
}

/**
 * An animal-origin actor (`species.animal`) that holds a race item whose tags do not include `creature.animal`
 * (and carries `creature.animal` from nowhere else, e.g. a polymorph buff) cannot use its animal skills.
 * Derived on every prepare: nothing is stored, so race swaps, reverts and polymorph need no bookkeeping.
 * @param {Set<string>} tagSet the actor's collected tag set
 * @param {object[]} items the actor's items
 * @returns {boolean}
 */
export function animalSkillsLockedFor(tagSet, items = []) {
  if (!tagSet?.has?.(ANIMAL_TAGS.origin)) return false;
  if (tagSet.has(ANIMAL_TAGS.creature)) return false;
  return items.some(i => i?.type === 'race');
}

/**
 * Writes spell.system.{itemBonus, modifiedRank, effectiveRank, statMod} and spell.{baseRank, itemBonus, modifiedRank, effectiveRank, statMod, statModStr}.
 * baseRank = Number(rank) || 1; modifiedRank = Math.max(1, baseRank + itemBonus).
 */
export function deriveSpellRanks(spells, { abilities, gearSkillBonuses = new Map(), tagGrants = [] } = {}) {
  for (const spell of spells) {
    const baseRank = Number(spell.system?.rank) || 1;
    const gearData = gearBonusEntryFor(gearSkillBonuses, spell, 'spell');
    const itemBonus = (gearData ? gearData.bonus : 0) + tagBonusFor(spell, tagGrants);
    const modifiedRank = Math.max(1, baseRank + itemBonus);
    const stat = spell.system?.stat || 'int';
    const statMod = abilities?.[stat]?.mod ?? 0;
    if (spell.system) {
      spell.system.itemBonus = itemBonus;
      spell.system.modifiedRank = modifiedRank;
      spell.system.effectiveRank = modifiedRank;
      spell.system.statMod = statMod;
    }
    spell.baseRank = baseRank;
    spell.itemBonus = itemBonus;
    spell.modifiedRank = modifiedRank;
    spell.effectiveRank = modifiedRank;
    spell.statMod = statMod;
    spell.statModStr = signed(statMod);
  }
}
