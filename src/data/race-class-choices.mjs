/**
 * Race and class choices: the choice-mode grant rows of a definition, their options, the resolution of picks into
 * skills, spells and rank caps, and the prompts' answers (choices and stat pool splits). The moved statics take the
 * applier as their first argument and call it back (`applier.getCatalogOptions`, `applier.promptStatPoolDialog`), so a test
 * that patches one of those on the class still steers.
 */

import { findCatalogEntry } from '../content/catalog-lookup.mjs';
import { offeredEntries, isContentOff } from '../utils/content-source.mjs';
import { matchesTagQuery } from '../utils/tag/tag-query.mjs';
import { getItemAllTags } from '../documents/active-tags.mjs';
import { slugifyIdentifier } from '../utils/identifier.mjs';
import { tagIndex } from '../utils/tag/tag-index.mjs';
import { isRankCapChoice, rankCapRowsFor } from '../utils/skill/rank-cap.mjs';
import { confirmRuleBreak } from '../utils/rule-break.mjs';
import { humanizeId } from '../utils/item-describer/shared.mjs';
import { mayOpenDialogs } from './race-class-grants.mjs';
import { detectStatPools, evaluateStatPool, isStatPool, statPoolRowsFor } from '../utils/character/stat-pool.mjs';

/**
 * Tag queries for choice rows that name only a category; the same queries the bundled choice rows carry, so a
 * category-only row lists the same skills (content rows carry their own `query`).
 */
export const CHOICE_CATEGORY_QUERIES = Object.freeze({
  crafting: { all: ['kind.skill', 'skillGroup.crafting'] },
  weapon: { all: ['kind.skill', 'skillGroup.weapon'] },
  edged_weapon: { all: ['kind.skill', 'weaponGroup.edge'] },
  reach_weapon: { all: ['kind.skill', 'weaponGroup.reach'] },
  ranged_weapon: { all: ['kind.skill', 'weaponGroup.ranged'] },
  melee_weapon: { all: ['kind.skill', 'weaponClass.melee'] },
  spell: { all: ['kind.spell'] }
});

/**
 * The reference the selections give for choice `ch` (the `idx`-th): from an array by position, a lone string for the first
 * choice, or an object by choice id, label, index or category. '' when none: the choice is open.
 * @param {Array|object|string} userSelections
 * @param {object} ch a choice from `detectChoices`
 * @param {number} idx
 * @returns {string}
 */
export function suppliedChoice(userSelections, ch, idx) {
  const refOf = (v) => (v && typeof v === 'object' ? (v.identifier ?? v.value ?? '') : v);
  let selected = '';
  if (Array.isArray(userSelections)) {
    selected = refOf(userSelections[idx]);
  } else if (typeof userSelections === 'string') {
    if (idx === 0) selected = userSelections;
  } else if (userSelections && typeof userSelections === 'object') {
    selected = refOf(userSelections[ch.id] ?? userSelections[ch.label] ?? userSelections[idx] ?? userSelections[ch.category]);
  }
  return String(selected ?? '').trim();
}

/**
 * Resolves a race or class definition's choice and pool grants into fixed rows (create-once): chosen `rank_cap` skills
 * become fixed `rank_cap` rows, and each `stat` pool becomes fixed `stat` rows for its split. Pure. The returned def is
 * the one to apply and embed.
 * @param {object} def
 * @param {{chosenRankCaps?: Array}} resolvedChoices
 * @param {Object<number, Object<string, number>>} [allocations] stat pool splits keyed by grant index
 * @returns {object}
 */
export function fixGrantRows(def, resolvedChoices, allocations = {}) {
  const grants = def.system?.grants;
  if (!Array.isArray(grants) || grants.length === 0) return def;
  const picks = resolvedChoices?.chosenRankCaps || [];
  const rows = grants.flatMap((g, index) => {
    if (isRankCapChoice(g)) return rankCapRowsFor(g, index, picks);
    if (isStatPool(g)) return statPoolRowsFor(g, allocations[index]);
    return [g];
  });
  return { ...def, system: { ...def.system, grants: rows } };
}

/**
 * Detects pending skill or spell choices from a race or class definition's choice-mode grant rows.
 *
 * @param {object} def - Race or Class definition (canonical, world item, or studio build)
 * @returns {Array<object>} Array of choice objects { id, label, type, category, rank, options, sourcePerk }
 */
export function detectChoices(applier, def) {
  if (!def) return [];
  const choices = [];
  let idx = 0;

  // 0. Structured system.grants (Sprinter RPG 3.0.0 Tagging & Grants Engine)
  const grants = def.system?.grants || def.grants;
  if (Array.isArray(grants) && grants.length > 0) {
    for (const [grantIndex, g] of grants.entries()) {
      if (g.mode === 'choice') {
        const count = Number(g.count) || 1;
        const hasExplicitOptions = Array.isArray(g.options) && g.options.length > 0;
        for (let i = 0; i < count; i++) {
          choices.push({
            id: `choice_${idx++}`,
            label: g.label ? (count > 1 ? `${g.label} ${i + 1}` : g.label) : `Choice (Rank ${g.rank || 1})`,
            // A rank_cap choice picks a skill whose cap rises; it is a skill pick but grants no skill.
            type: g.kind === 'rank_cap' ? 'skill' : (g.kind || 'skill'),
            grantKind: g.kind || 'skill',
            grantIndex,
            category: g.category || (hasExplicitOptions ? 'options' : (g.kind === 'spell' ? 'spell' : 'weapon')),
            rank: g.kind === 'rank_cap' ? (Number(g.value) || 1) : (Number(g.rank) || 1),
            count: 1,
            filter: g.query || null,
            options: hasExplicitOptions ? [...g.options] : null,
            distinct: Boolean(g.distinct),
            sourcePerk: g.label || ''
          });
        }
      }
    }
  }

  return choices;
}

/**
 * The options of a choice descriptor as `{ value: identifier, label: name }`: the row's explicit
 * `options` (identifiers), else the skills / spells its tag query (or its category's query) matches in the tag index,
 * else in the catalog. There are no hard-coded name lists.
 *
 * @param {object} choice
 * @returns {Array<{value: string, label: string}>}
 */
export function getCatalogOptions(applier, choice) {
  if (!choice) return [];
  const kind = choice.type === 'spell' ? 'spell' : 'skill';
  const catalogKind = kind === 'spell' ? 'spells' : 'skills';
  const options = (pairs) => {
    const seen = new Set();
    return pairs
      .filter(o => o.value && !seen.has(o.value) && seen.add(o.value))
      .sort((a, b) => a.label.localeCompare(b.label));
  };
  if (Array.isArray(choice.options) && choice.options.length > 0) {
    return options(choice.options.map(id => {
      const ref = String(id ?? '').trim();
      return { value: ref, label: findCatalogEntry(catalogKind, ref)?.name || humanizeId(ref) };
    }));
  }
  // A choice row carries its own query; a category-only row uses its category's query; else every skill (or spell).
  const query = choice.filter || CHOICE_CATEGORY_QUERIES[choice.category] || { all: [`kind.${kind}`] };
  const toOptions = (list) => options(list.map(m => ({ value: String(m.identifier || m.system?.identifier || ''), label: m.name || '' })));
  let indexed;
  try {
    indexed = toOptions(tagIndex.find(query, { type: kind, exclude: isContentOff }) || []);
  } catch (_) {
    indexed = [];
  }
  if (indexed.length) return indexed;
  return toOptions(offeredEntries(catalogKind).filter(d => matchesTagQuery(getItemAllTags({ ...d, type: d.type || kind }), query)));
}

/**
 * Resolves detected choices against user selections into structured arrays. A selection is
 * an identifier (a catalog skill or spell, exact match), or a typed write-in, which becomes a stub whose identifier
 * is the write-in's slug. With no selection the first option is taken; a choice with no options grants nothing.
 *
 * @param {object} def
 * @param {Array<object>} choices
 * @param {Array|object|string} userSelections identifiers (or `{ identifier }` objects) by choice id, label or index
 * @returns {{ chosenSkills: Array<object>, chosenSpells: Array<object>, chosenRankCaps: Array<object> }}
 */
export function resolveChoices(applier, def, choices, userSelections = {}) {
  const chosenSkills = [];
  const chosenSpells = [];
  const chosenRankCaps = [];

  if (!choices || choices.length === 0) {
    return { chosenSkills, chosenSpells, chosenRankCaps };
  }

  choices.forEach((ch, idx) => {
    const selected = suppliedChoice(userSelections, ch, idx) || (applier.getCatalogOptions(ch)[0]?.value ?? '');
    if (!selected) return;

    const rank = ch.rank || 1;
    const catalogKind = ch.type === 'spell' ? 'spells' : 'skills';
    const doc = findCatalogEntry(catalogKind, selected);
    const identifier = doc?.system?.identifier || slugifyIdentifier(selected);
    const name = doc?.name || selected;

    if (ch.grantKind === 'rank_cap') {
      chosenRankCaps.push({ grantIndex: ch.grantIndex, identifier, name, choiceId: ch.id });
      return;
    }

    if (ch.type === 'spell') {
      chosenSpells.push({ name, identifier, rank, mpCost: doc?.system?.manaCost || 0, choiceId: ch.id });
    } else {
      chosenSkills.push({ name, identifier, rank, isPassive: Boolean(doc?.system?.isPassive), choiceId: ch.id });
    }
  });

  return { chosenSkills, chosenSpells, chosenRankCaps };
}

/**
 * Asks for, or reads, the stat pool splits of a definition (the dialog loop and its confirms). Only the pools that were
 * answered (`options.statPools`, or the dialog) are returned; an unanswered one is left to the planner's headless default.
 *
 * @param {object} def
 * @param {object} [options] `statPools` (allocations keyed by grant index) answers without a dialog
 * @returns {Promise<{statPools: Object<number, Object<string, number>>, overBudget: number[]}|null>} null when the user cancels or leaves a given split incomplete
 */
export async function collectStatPools(applier, def, options = {}) {
  const statPools = {};
  const overBudget = [];
  const grants = def.system?.grants;
  if (!Array.isArray(grants) || grants.length === 0) return { statPools, overBudget };
  const interactive = mayOpenDialogs(options);

  for (const pool of detectStatPools(grants)) {
    const given = options.statPools?.[pool.grantIndex];
    let chosen = null;
    if (given !== undefined) {
      chosen = evaluateStatPool(pool, given);
      if (!chosen.complete) {
        globalThis.ui?.notifications?.warn?.(`${def.name}: allocate all ${pool.points} stat points before applying.`);
        return null;
      }
      if (chosen.over) {
        const res = await confirmRuleBreak({
          title: 'Stat Pool Over Budget',
          message: `${chosen.spent} of ${pool.points} stat points allocated. Apply anyway as a Rule Break?`,
          options
        });
        if (!res.confirmed) return null;
        overBudget.push(pool.grantIndex);
      }
    } else if (interactive) {
      while (!chosen) {
        const raw = await applier.promptStatPoolDialog(def, pool);
        if (raw === null) return null; // cancelled
        const evaluated = evaluateStatPool(pool, raw);
        if (!evaluated.complete) continue;
        if (evaluated.over) {
          const res = await confirmRuleBreak({
            title: 'Stat Pool Over Budget',
            message: `${evaluated.spent} of ${pool.points} stat points allocated. Apply anyway as a Rule Break?`,
            options
          });
          if (!res.confirmed) continue;
          overBudget.push(pool.grantIndex);
        }
        chosen = evaluated;
      }
    } else {
      continue; // headless and unanswered: the planner takes the default split
    }
    statPools[pool.grantIndex] = chosen.allocation;
  }
  return { statPools, overBudget };
}

/**
 * The answers to every prompt of a race or class apply, as the planner's `selections`: the choices (from
 * `options.choices`, the choices dialog, or left to the headless default) and the stat pool splits.
 *
 * @param {object} def
 * @param {object} [options]
 * @returns {Promise<{selections: {choices?: *, statPools: object}, overBudget: number[]}|null>} null when cancelled
 */
export async function collectSelections(applier, def, options = {}) {
  const selections = {};
  const choiceRows = applier.detectChoices(def);
  if (choiceRows.length > 0) {
    if (options.choices !== undefined) selections.choices = options.choices;
    else if (mayOpenDialogs(options)) {
      const picked = await applier.promptChoicesDialog(def, choiceRows, options);
      if (picked === null) return null; // User cancelled
      selections.choices = picked;
    }
  }
  const pools = await applier.collectStatPools(def, options);
  if (!pools) return null;
  selections.statPools = pools.statPools;
  return { selections, overBudget: pools.overBudget };
}
