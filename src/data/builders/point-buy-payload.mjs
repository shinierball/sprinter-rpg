/**
 * src/data/builders/point-buy-payload.mjs
 * The pure point-buy compiler: `buildPointBuyPayload(spec)` turns a race or class point-buy spec into a
 * creation payload, with no UI and no Foundry globals, so the Race and Class Creator apps, build:packs and the tests
 * share one function. It registers the `race` and `class` payload delegates for `buildPayload` (item-payload.mjs).
 *
 * Spec `system` overlay (3.32): a canonical race or class carries rows the budget builder cannot express, so its spec
 * is the point-buy spec plus `system`, a partial system object that `buildPayload` deep-merges over the builder's
 * result (the overlay wins; arrays and scalars replace). See `buildPayload` in item-payload.mjs.
 */

import { findPointBuildEntry } from '../../content/point-build.mjs';
import { ARCHETYPE_TO_TAG, getTagDefinition } from '../tags.mjs';
import { DEFAULT_SIZE, sanitizeSizeId } from '../sizes.mjs';
import { EARTH_ORIGIN_NOTE, getHeritage, sanitizeHeritageId } from '../rules/heritages.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { validateGrantRow, validateStartingItem } from '../../models/items/base-item-model.mjs';
import { normalizeBaseDamage } from '../../utils/base-damage.mjs';
import { applyPerkRows, catalogRows, PERK_ROW_PATHS } from '../../utils/perk-rows.mjs';
import { slugifyIdentifier } from '../../utils/identifier.mjs';
import { normalizeTiming } from '../../utils/timing.mjs';
import { unfilledParams } from '../../utils/point-build-params.mjs';
import { COG_BENEFIT_TIERS, COG_DETRIMENT_TIERS } from '../rules/point-build-tiers.mjs';
import { registerPayloadDelegate } from './item-payload.mjs';

/**
 * The DR a point-build benefit grants: its own `drBonus`, else the catalog benefit with its id's.
 * @param {{id?: string, drBonus?: number}|null} benefit
 * @returns {number}
 */
export function drBonusOfBenefit(benefit) {
  const own = Number(benefit?.drBonus);
  if (Number.isFinite(own) && own > 0) return own;
  return Number(findPointBuildEntry(benefit?.id)?.drBonus) || 0;
}

/** An archetype tag id from a tag id or a plain name ("Mage" gives `archetype.mage`). */
export function archetypeTagId(value) {
  const v = String(Array.isArray(value) ? value[0] ?? '' : value ?? '').trim().toLowerCase();
  return v.startsWith('archetype.') ? v : `archetype.${v}`;
}

const STAT_NAMES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', cha: 'Charisma' };
const POOL_STATS = ['str', 'dex', 'con', 'int', 'cha'];

/** The `stat` pool grant row a creator stat pool compiles to: the valid options only, and the label when it has one. */
export function statPoolGrantRow(pool) {
  const options = (Array.isArray(pool?.options) ? pool.options : []).filter(o => POOL_STATS.includes(o));
  const row = { kind: 'stat', mode: 'pool', value: Number(pool?.value), options };
  const label = String(pool?.label ?? '').trim();
  if (label) row.label = label;
  return row;
}

/** The `rank_bonus` grant row a creator rank bonus compiles to. `cost` is a ledger label and never reaches it. */
export function rankBonusGrantRow(bonus) {
  const row = { kind: 'rank_bonus', value: Number(bonus?.value) };
  if (bonus?.tag) row.tag = String(bonus.tag).trim();
  if (bonus?.query) row.query = bonus.query;
  if (bonus?.floor) row.floor = Number(bonus.floor);
  if (bonus?.onlyIfOwned) row.onlyIfOwned = true;
  const label = String(bonus?.label ?? '').trim();
  if (label) row.label = label;
  return row;
}

/**
 * Whether the builder keeps a stat pool: more than 0 points and at least one valid stat. The ledger and the payload use
 * this one predicate, so they cannot disagree.
 */
export const statPoolCounts = (pool) => Number(pool?.value) > 0 && validateGrantRow(statPoolGrantRow(pool));

/** Whether the builder keeps a rank bonus: a value other than 0, and a tag or a query with tags. */
export const rankBonusCounts = (bonus) => Number(bonus?.value) !== 0 && validateGrantRow(rankBonusGrantRow(bonus));

/** "+2 stat points (DEX, INT or CHA)": the receipt and description line of a stat pool. */
export function statPoolLabel(pool) {
  const names = statPoolGrantRow(pool).options.map(o => o.toUpperCase());
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : (names[0] ?? '');
  const value = Number(pool?.value) || 0;
  return `+${value} stat ${value === 1 ? 'point' : 'points'} (${list})`;
}

/** "+1 Rank: Edged Weapon" or "-1 Rank: matching skills": the receipt and description line of a rank bonus. */
export function rankBonusLabel(bonus) {
  const value = Number(bonus?.value) || 0;
  const tag = String(bonus?.tag ?? '').trim();
  const target = tag ? (getTagDefinition(tag)?.label || tag) : 'matching skills';
  return `${value > 0 ? '+' : ''}${value} Rank: ${target}`;
}

/**
 * The bullet list of a build's abilities: stat bonuses and penalties, DR, skills, spells, benefits, buffs, detriments and
 * debuffs, read from the spec alone.
 * @param {object} spec
 * @returns {string[]}
 */
export function compileAbilitiesList(spec = {}) {
  const arr = (v) => (Array.isArray(v) ? v : []);
  const list = [];
  const pos = [];
  const neg = [];
  for (const [s, v] of Object.entries(spec.stats ?? {})) {
    const name = STAT_NAMES[String(s).toLowerCase()] || String(s).toUpperCase();
    if (v > 0) pos.push(`+${v} ${name}`);
    else if (v < 0) neg.push(`${v} ${name}`);
  }
  if (pos.length) list.push(pos.join(', '));
  if (neg.length) list.push(neg.join(', '));
  if (Number(spec.drBonus) > 0 && !arr(spec.selectedBenefits).some(b => drBonusOfBenefit(b) > 0)) {
    list.push(`+${spec.drBonus} Damage Reduction (DR)`);
  }
  for (const s of arr(spec.skills)) {
    if (s.name && s.rank > 0) list.push(`+${s.rank} ${s.name} Skill${s.isPassive ? ' (Passive)' : ''}`);
  }
  for (const sp of arr(spec.spells)) {
    if (sp.name && sp.rank > 0) list.push(`+${sp.rank} ${sp.name} Spell${sp.isPassive ? ' (Passive)' : ''}`);
  }
  for (const pool of arr(spec.statPools)) if (statPoolCounts(pool)) list.push(statPoolLabel(pool));
  for (const bonus of arr(spec.rankBonuses)) if (rankBonusCounts(bonus)) list.push(rankBonusLabel(bonus));
  for (const p of arr(spec.perks)) list.push(p);
  for (const b of arr(spec.selectedBenefits)) list.push(b.customText || b.name || findPointBuildEntry(b.id)?.name);
  for (const cb of arr(spec.customBenefits)) list.push(cb.name);
  for (const buf of arr(spec.buffs)) list.push(buf.name + (buf.description ? `: ${buf.description}` : ''));
  for (const d of arr(spec.detriments)) list.push(d);
  for (const d of arr(spec.selectedDetriments)) list.push(d.customText || d.name || findPointBuildEntry(d.id)?.name);
  for (const cd of arr(spec.customDetriments)) list.push(cd.name);
  for (const deb of arr(spec.debuffs)) list.push(deb.name + (deb.description ? `: ${deb.description}` : ''));
  // A row with no name or text (a blank custom benefit) says nothing, so it has no line.
  return list.filter((line) => typeof line === 'string' && line.trim() !== '');
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** The catalog-copy keys of a buff or debuff row: its identifier, icon and frozen `system`. */
function effectSeed(row) {
  return {
    ...(row.identifier ? { identifier: String(row.identifier) } : {}),
    ...(row.img ? { img: String(row.img) } : {}),
    ...(isPlainObject(row.system) ? { system: structuredClone(row.system) } : {})
  };
}

/**
 * One `system.grantedEffects[]` entry from a creator's buff or debuff row: `{ type, name, img, system }`.
 * A row picked from the catalog carries its own `system`; a typed row gets its description and, for a debuff, a
 * severity from its tier. `tier`, `cost` and `extraPoints` are ledger labels and never reach the item.
 * @returns {object|null} null for a row with no name
 */
function grantedEffectEntry(type, row) {
  const name = String(row?.name ?? '').trim();
  if (!name) return null;
  const hasSystem = isPlainObject(row.system);
  const system = hasSystem ? structuredClone(row.system) : {};
  const identifier = String(row.identifier ?? '').trim();
  if (identifier) system.identifier = identifier;
  if (!hasSystem) {
    if (row.description) system.description = `<p>${row.description}</p>`;
    if (type === 'debuff') system.severity = row.tier === 'minor' ? 'Minor' : 'Major';
  }
  return { type, name, img: row.img || '', system };
}

/**
 * The point-buy spec a Race or Class Creator edits: the content of a build, normalised from `seed` the
 * way the creators' constructors always did. Creator UI state (accordions, search, the target crawler) stays on the app.
 * @param {string} [builderType='class']
 * @param {object} [seed={}]
 * @returns {object}
 */
export function blankPointBuySpec(builderType = 'class', seed = {}) {
  return {
    builderType,
    ...(seed.img ? { img: String(seed.img) } : {}),
    ...(builderType === 'class' ? {
      archetypes: Array.isArray(seed.archetypes) && seed.archetypes.length ? seed.archetypes.map(archetypeTagId) : [ARCHETYPE_TO_TAG.fighter],
      isEarthClass: seed.isEarthClass !== undefined ? Boolean(seed.isEarthClass) : true
    } : {}),
    name: seed.name || '',
    description: seed.description || '',
    prerequisites: seed.prerequisites || '',
    heritage: sanitizeHeritageId(seed.heritage),
    size: sanitizeSizeId(seed.size ?? DEFAULT_SIZE),
    stats: {
      str: Number(seed.stats?.str) || 0,
      dex: Number(seed.stats?.dex) || 0,
      con: Number(seed.stats?.con) || 0,
      int: Number(seed.stats?.int) || 0,
      cha: Number(seed.stats?.cha) || 0
    },
    drBonus: seed.drBonus !== undefined ? Number(seed.drBonus) : 0,
    skills: Array.isArray(seed.skills)
      ? seed.skills.map(s => ({
          name: s.name || '',
          ...(s.identifier ? { identifier: String(s.identifier) } : {}),
          rank: Number(s.rank) || 1,
          isPassive: Boolean(s.isPassive),
          ...(s.stat ? { stat: s.stat } : {}),
          checkType: s.checkType || 'stat',
          checkNote: s.checkNote || '',
          baseDamage: normalizeBaseDamage(s.baseDamage),
          canGainRanks: s.canGainRanks !== undefined ? Boolean(s.canGainRanks) : true,
          cooldown: normalizeTiming(s.cooldown),
          notes: s.notes || '',
          cost: (Number(s.rank) || 1) * 2
        }))
      : [],
    spells: Array.isArray(seed.spells)
      ? seed.spells.map(sp => ({
          name: sp.name || '',
          ...(sp.identifier ? { identifier: String(sp.identifier) } : {}),
          rank: Number(sp.rank) || 1,
          isPassive: Boolean(sp.isPassive),
          mpCost: Number(sp.mpCost) || 0,
          cost: (Number(sp.rank) || 1) * 2
        }))
      : [],
    buffs: Array.isArray(seed.buffs)
      ? seed.buffs.map(b => ({
          name: b.name || '',
          ...effectSeed(b),
          description: b.description || '',
          tier: b.tier || 'moderate',
          cost: Number(b.cost !== undefined ? b.cost : (COG_BENEFIT_TIERS[b.tier]?.cost ?? 2))
        }))
      : [],
    debuffs: Array.isArray(seed.debuffs)
      ? seed.debuffs.map(d => ({
          name: d.name || '',
          ...effectSeed(d),
          description: d.description || '',
          tier: d.tier || 'moderate',
          extraPoints: Number(d.extraPoints !== undefined ? d.extraPoints : (COG_DETRIMENT_TIERS[d.tier]?.extraPoints ?? 2))
        }))
      : [],
    selectedBenefits: Array.isArray(seed.selectedBenefits) ? [...seed.selectedBenefits] : [],
    selectedDetriments: Array.isArray(seed.selectedDetriments) ? [...seed.selectedDetriments] : [],
    customBenefits: Array.isArray(seed.customBenefits) ? [...seed.customBenefits] : [],
    customDetriments: Array.isArray(seed.customDetriments) ? [...seed.customDetriments] : [],
    statPools: Array.isArray(seed.statPools) ? seed.statPools.map(p => ({ ...p })) : [],
    rankBonuses: Array.isArray(seed.rankBonuses) ? seed.rankBonuses.map(r => ({ ...r })) : []
  };
}

/**
 * The typed grant row for a skill or spell the builder references: by uuid or identifier (or a choice row). `name` is
 * display text only (`label`); a skill with neither reference gets its name's slug as identifier.
 * @returns {object|null} null when the entry names nothing
 */
function referenceGrantRow(kind, entry) {
  // A pick-one entry (`choice: true`) is a choice row: the player picks the skill or spell when the item is applied.
  if (entry.choice) {
    const row = { kind, mode: 'choice', count: 1, rank: Number(entry.rank) || 1, category: entry.category || (kind === 'spell' ? 'spell' : 'weapon') };
    const label = entry.name || entry.label;
    if (label) row.label = String(label);
    return row;
  }
  const uuid = String(entry.uuid || '').trim();
  const identifier = String(entry.identifier || '').trim() || (uuid ? '' : slugifyIdentifier(entry.name ?? entry.label));
  if (!uuid && !identifier) return null;
  const row = { kind, rank: Number(entry.rank) || 1 };
  if (uuid) row.uuid = uuid;
  if (identifier) row.identifier = identifier;
  const label = entry.name || entry.label;
  if (label) row.label = String(label);
  if (kind === 'skill' && entry.stat) row.stat = entry.stat;
  if (normalizeTiming(entry.cooldown).unit) row.cooldown = entry.cooldown;
  return row;
}

/**
 * Pure compiler function that builds a complete Point-Buy Item document payload
 * from a specification object.
 *
 * @param {object} spec
 * @returns {object} Item document creation payload
 */
export function buildPointBuyPayload(spec = {}) {
  const builderType = spec.builderType || 'class';
  const name = spec.name || (builderType === 'race' ? 'Unnamed Custom Race' : 'Custom Class');

  const stats = {
    str: Number(spec.stats?.str) || 0,
    dex: Number(spec.stats?.dex) || 0,
    con: Number(spec.stats?.con) || 0,
    int: Number(spec.stats?.int) || 0,
    cha: Number(spec.stats?.cha) || 0
  };

  const drBonus = Number(spec.drBonus) || 0;

  const selectedBenefits = Array.isArray(spec.selectedBenefits) ? spec.selectedBenefits : [];
  const customBenefits = Array.isArray(spec.customBenefits) ? spec.customBenefits : [];
  const selectedDetriments = Array.isArray(spec.selectedDetriments) ? spec.selectedDetriments : [];
  const customDetriments = Array.isArray(spec.customDetriments) ? spec.customDetriments : [];

  const descHtml = spec.description ? `<p>${spec.description}</p>` : '';
  const abilities = compileAbilitiesList(spec);
  const abilitiesHtml = abilities.length ? `<ul>${abilities.map(a => `<li>${a}</li>`).join('')}</ul>` : '';
  // The Earth / Alien note: a race's heritage note, and the Earth class's Earth Origin Box note.
  const heritageNote = builderType === 'race'
    ? (getHeritage(spec.heritage)?.note ?? '')
    : (spec.isEarthClass === true ? EARTH_ORIGIN_NOTE : '');
  const noteHtml = heritageNote && !descHtml.includes(heritageNote) ? `<p>${heritageNote}</p>` : '';

  const isRuleBreak = Boolean(spec.ruleBreak || spec.isRuleBreak);

  // Typed grants[] rows (kind: stat | skill | spell | rank_bonus) and nothing else; see grantRowErrors().
  const grants = [];

  // 1. Stat bonuses
  for (const [st, val] of Object.entries(stats)) {
    if (val !== 0) grants.push({ kind: 'stat', stat: st, value: val });
  }

  // 2. Skill grants, 3. Spell grants
  for (const [kind, list] of [['skill', spec.skills], ['spell', spec.spells]]) {
    for (const entry of (Array.isArray(list) ? list : [])) {
      const row = referenceGrantRow(kind, entry);
      if (row) grants.push(row);
    }
  }

  // 4. Rank bonuses: the creator's list (a row the ledger would not count is left out), then canon's own rank_bonus grants.
  const rankBonusRows = [
    ...(Array.isArray(spec.rankBonuses) ? spec.rankBonuses : []).filter(rankBonusCounts),
    ...(Array.isArray(spec.grants) ? spec.grants.filter(g => g?.kind === 'rank_bonus') : []),
    ...(Array.isArray(spec.system?.grants) ? spec.system.grants.filter(g => g?.kind === 'rank_bonus') : [])
  ].map(rankBonusGrantRow);
  for (const row of rankBonusRows) if (validateGrantRow(row)) grants.push(row);

  // 5. Additional explicit spec.grants of the other kinds (stat, skill, spell)
  if (Array.isArray(spec.grants)) {
    for (const g of spec.grants) {
      if (!g || !['stat', 'skill', 'spell'].includes(g.kind)) continue;
      const row = g.kind === 'stat'
        ? { kind: 'stat', stat: g.stat, value: Number(g.value) }
        : referenceGrantRow(g.kind, g);
      if (!row || !validateGrantRow(row)) continue;
      const alreadyAdded = grants.some(existing =>
        existing.kind === row.kind &&
        (row.kind === 'stat' ? existing.stat === row.stat : (existing.identifier === row.identifier && existing.uuid === row.uuid)));
      if (!alreadyAdded) grants.push(row);
    }
  }

  // 6. Structured rows: the rows of each selected catalog benefit/detriment (filled from its `params`), rows a
  // custom benefit carries, and stat pools. Applied with the same function the perk conversion uses.
  const perkRows = [];
  const unfilled = []; // E7.7: picked entries whose parameters are not all chosen; their rows are left out, never half-filled
  for (const picked of [...selectedBenefits, ...selectedDetriments]) {
    const entry = Array.isArray(picked?.rows) ? picked : findPointBuildEntry(picked?.id);
    perkRows.push(...catalogRows(entry, picked?.params));
    const missing = unfilledParams(entry, picked?.params);
    if (missing.length) unfilled.push({ id: entry?.id ?? picked?.id, name: entry?.name ?? picked?.name, params: missing });
  }
  for (const custom of [...customBenefits, ...customDetriments]) {
    // A grant row must be well-formed: the schema's validator rejects a bad one, which would fail the whole Item.create.
    // A starting item that names nothing is dropped (the creator shows a chip), never a hard block.
    if (Array.isArray(custom?.rows)) {
      perkRows.push(...custom.rows.filter(r => r && Object.hasOwn(PERK_ROW_PATHS, r.path) && r.row !== undefined
        && (r.path !== 'system.grants' || validateGrantRow(r.row))
        && (r.path !== 'system.startingItems' || validateStartingItem(r.row))));
    }
  }
  for (const pool of Array.isArray(spec.statPools) ? spec.statPools : []) {
    if (statPoolCounts(pool)) perkRows.push({ path: 'system.grants', row: statPoolGrantRow(pool) });
  }
  const grantedEffects = [
    ...(Array.isArray(spec.buffs) ? spec.buffs : []).map(b => grantedEffectEntry('buff', b)),
    ...(Array.isArray(spec.debuffs) ? spec.debuffs : []).map(d => grantedEffectEntry('debuff', d))
  ].filter(Boolean);
  const structuredFields = applyPerkRows({ grants, tags: [] }, perkRows); // appends to `grants` in place
  const structuredTags = structuredFields.tags;
  delete structuredFields.grants;
  delete structuredFields.tags;

  return {
    name,
    type: builderType,
    img: spec.img || (builderType === 'race' ? 'icons/svg/mystery-man.svg' : 'icons/svg/book.svg'),
    system: {
      // The perk and detriment bullets are human text; grant rows, `requires` and `startingItems` are the only structured
      // form. Stats, skills and spells live in `grants` alone (no mirrors).
      description: descHtml + abilitiesHtml + noteHtml,
      prerequisites: spec.prerequisites || '',
      // Heritage and size belong to races: ClassDataModel has neither field.
      ...(builderType === 'race' ? { heritage: sanitizeHeritageId(spec.heritage), size: sanitizeSizeId(spec.size ?? DEFAULT_SIZE) } : {}),
      ...(builderType === 'class' && Array.isArray(spec.archetypes) ? { archetypes: spec.archetypes.map(archetypeTagId) } : {}),
      drBonus,
      grants,
      ...(grantedEffects.length ? { grantedEffects } : {}),
      ...structuredFields,
      ...(structuredTags.length ? { tags: structuredTags } : {})
    },
    flags: {
      ...(spec.flags || {}),
      [SYSTEM_ID]: {
        ...(spec.flags?.[SYSTEM_ID] || {}),
        ...(unfilled.length ? { unfilledParams: unfilled } : {}),
        ...(isRuleBreak ? { ruleBreak: true } : {})
      }
    }
  };
}

export const buildPointBuyItemPayload = buildPointBuyPayload;

/**
 * Pure compiler function that builds a Race Item document creation payload from a spec.
 * @param {object} spec point-buy spec, plus an optional `system` overlay (see the file header)
 * @returns {object} Item creation payload for a custom Race
 */
export function buildRacePayload(spec = {}) {
  return buildPointBuyPayload({
    ...spec,
    builderType: 'race',
    baseBudget: spec.baseBudget ?? 25
  });
}

/**
 * Pure compiler function that builds a Class Item document creation payload from a spec.
 * @param {object} spec point-buy spec, plus an optional `system` overlay (see the file header)
 * @returns {object} Item creation payload for a custom Class
 */
export function buildClassPayload(spec = {}) {
  return buildPointBuyPayload({
    ...spec,
    builderType: 'class',
    baseBudget: spec.baseBudget ?? 30
  });
}

// The one payload entry point delegates here for types 'race' and 'class'.
registerPayloadDelegate('race', buildRacePayload);
registerPayloadDelegate('class', buildClassPayload);
