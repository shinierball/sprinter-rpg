/**
 * Sprinter RPG - Race & Class Application & Reversal Engine
 * Manages selecting, applying, and cleanly reverting Race and Class benefits,
 * ability modifiers, skill ranks, spells, and sizes on Crawler characters.
 */

import { catalogEntries, findCatalogEntry } from '../content/catalog-lookup.mjs';
import { matchesTagQuery } from '../utils/tag-query.mjs';
import { getItemAllTags, ARCHETYPE_TO_TAG } from './tags.mjs';
import { itemIdentifier, slugifyIdentifier } from '../utils/identifier.mjs';
import { DEFAULT_SIZE, sanitizeSizeId } from './sizes.mjs';
import { companionHeritageId, heritageGroups, heritageLabel, sanitizeHeritageId } from './rules/heritages.mjs';
import { catalogNameFor } from '../models/actors/actor-derivation.mjs';
import { tagIndex } from '../apps/tag-index.mjs';
import { SYSTEM_ID } from '../constants.mjs';
import { isRankCapChoice, rankCapRowsFor } from '../utils/rank-cap.mjs';
import { dialogAnswer } from '../utils/dialog-answer.mjs';
import { confirmRuleBreak } from '../utils/rule-break.mjs';
import { confirmRequires } from '../utils/requires.mjs';
import { confirmRaceClassFloor, raceClassText } from '../utils/race-class-floor.mjs';
import { normalizeTiming } from '../utils/timing.mjs';
import { grantStartingItems } from './starting-items.mjs';
import { humanizeId } from '../utils/item-describer/shared.mjs';
import { RACE_CLASS_KINDS, mayOpenDialogs, resolveKindChoices, grantKindItems, grantKindEffects, embedKindItem, appliedKindRecord } from './race-class-grants.mjs';
import { detectStatPools, evaluateStatPool, defaultPoolAllocation, isStatPool, statPoolRowsFor } from '../utils/stat-pool.mjs';

/**
 * Adds (sign = 1) or removes (sign = -1) per-stat deltas on an actor's abilities,
 * writing `value` and `unenhanced` into `updates`. `unenhanced` falls back to the
 * current value when the actor has none recorded.
 * @param {object} actor
 * @param {object} updates Update payload being built (mutated).
 * @param {Record<string, number>} stats Stat key to delta.
 * @param {1|-1} sign
 */
export function addAbilityDeltas(actor, updates, stats, sign) {
  for (const [stat, delta] of Object.entries(stats)) {
    if (delta !== 0 && actor.system?.abilities?.[stat]) {
      const curVal = Number(actor.system.abilities[stat].value ?? 10);
      const curUnenh = Number(actor.system.abilities[stat].unenhanced ?? curVal);
      updates[`system.abilities.${stat}.value`] = curVal + sign * delta;
      updates[`system.abilities.${stat}.unenhanced`] = curUnenh + sign * delta;
    }
  }
}

/**
 * Writes the DR and movement changes granted by a race/class bonus bundle into `updates`.
 * @param {object} actor
 * @param {object} updates Update payload being built (mutated).
 * @param {{drBonus?: number, movement?: object}} bonuses
 */
export function addDrAndMovementBonuses(actor, updates, bonuses) {
  if (bonuses.drBonus) {
    const curDR = Number(actor.system?.attributes?.dr?.buffs) || 0;
    updates['system.attributes.dr.buffs'] = curDR + bonuses.drBonus;
  }
  if (bonuses.movement) {
    if (bonuses.movement.walkDelta) {
      const curMove = Number(actor.system?.attributes?.speed?.move) || 20;
      updates['system.attributes.speed.move'] = curMove + bonuses.movement.walkDelta;
    }
    if (bonuses.movement.climb) updates['system.attributes.speed.climb'] = bonuses.movement.climb;
    if (bonuses.movement.swim) updates['system.attributes.speed.swim'] = bonuses.movement.swim;
    if (bonuses.movement.fly) updates['system.attributes.speed.fly'] = bonuses.movement.fly;
    if (bonuses.movement.burrow) updates['system.attributes.speed.burrow'] = bonuses.movement.burrow;
  }
}

/**
 * Writes the reversal of previously applied DR and movement bonuses into `updates`.
 * DR never drops below 0; granted special speeds reset to 0.
 * @param {object} actor
 * @param {object} updates Update payload being built (mutated).
 * @param {{drBonus?: number, movement?: object}} [applied] The stored applied record.
 */
export function revertDrAndMovementBonuses(actor, updates, applied) {
  if (applied?.drBonus) {
    const curDR = Number(actor.system?.attributes?.dr?.buffs) || 0;
    updates['system.attributes.dr.buffs'] = Math.max(0, curDR - applied.drBonus);
  }
  if (applied?.movement) {
    if (applied.movement.walkDelta) {
      const curMove = Number(actor.system?.attributes?.speed?.move) || 20;
      updates['system.attributes.speed.move'] = curMove - applied.movement.walkDelta;
    }
    if (applied.movement.climb) updates['system.attributes.speed.climb'] = 0;
    if (applied.movement.swim) updates['system.attributes.speed.swim'] = 0;
    if (applied.movement.fly) updates['system.attributes.speed.fly'] = 0;
    if (applied.movement.burrow) updates['system.attributes.speed.burrow'] = 0;
  }
}

/**
 * The embedded skill or spell an applied-grant record points at: by the item id the applier stored, else by the
 * grant's identifier. Never by name.
 */
function findAppliedItem(actor, type, record) {
  const items = actor?.items;
  if (!items?.find) return undefined;
  if (record?.id) {
    const byId = items.find(i => i.type === type && i.id === record.id);
    if (byId) return byId;
  }
  return record?.identifier ? items.find(i => i.type === type && i.system?.identifier === record.identifier) : undefined;
}

/**
 * A race or class definition by exact reference: the catalog entry with that `_id` / `id` / `system.identifier`,
 * else the world item with that id / uuid / identifier (as data, with its uuid; a uuid only locates a dropped or
 * scripted item, it is never what `details.race` stores). `prefer` picks among several
 * matches (two races may share an identifier). Names are never matched.
 */
function findDefinition(catalogKind, itemType, ref, prefer) {
  const matches = (d) => d && (d._id === ref || d.id === ref || d.uuid === ref || (!!d.system?.identifier && d.system.identifier === ref));
  const pick = (list) => (prefer ? list.find(d => prefer(d) && matches(d)) : null) || list.find(matches) || null;
  const canonical = pick(catalogEntries(catalogKind));
  if (canonical) return canonical;
  const worldItems = [...(globalThis.game?.items ?? [])].filter(i => i.type === itemType);
  const world = pick(worldItems);
  return world ? { ...(world.toObject ? world.toObject() : world), uuid: world.uuid } : null;
}

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
 * True for an item a race or a class created. When both grant the same skill or spell the first creates it and the other
 * adds ranks, so either one's mark means the item goes when its last rank does.
 */
function grantedByRaceOrClass(item) {
  return ['race', 'class'].includes(item?.getFlag?.(SYSTEM_ID, 'grantedBy'));
}

/** Actors whose race or class the applier is changing right now (a counter per actor id, since the calls nest). */
const applying = new Map();

async function whileApplying(actor, fn) {
  const id = actor?.id;
  if (id) applying.set(id, (applying.get(id) ?? 0) + 1);
  try {
    return await fn();
  } finally {
    if (id) {
      const left = (applying.get(id) ?? 1) - 1;
      if (left > 0) applying.set(id, left); else applying.delete(id);
    }
  }
}

/**
 * `deleteItem` handler: deleting a race or class item from a crawler reverts it the way `removeRace` /
 * `removeClass` does, so its effects, skills and stat pool points go with it. Not run for the applier's own deletes.
 * The delete has already happened, so a revert that fails only warns (CONTRIBUTING rule 2: never block a delete).
 * @param {Item} item
 * @param {object} [_options]
 * @param {string} [userId]
 * @returns {Promise<boolean|null>} true reverted, null when the hook did not apply
 */
export async function onRaceClassItemDelete(item, _options, userId) {
  const kind = item?.type;
  const actor = item?.parent;
  if (!actor || !Object.hasOwn(RACE_CLASS_KINDS, kind) || actor.type !== 'crawler') return null;
  if (userId && globalThis.game?.user?.id && userId !== globalThis.game.user.id) return null;
  if (applying.has(actor.id)) return null;
  const record = actor.getFlag?.(SYSTEM_ID, RACE_CLASS_KINDS[kind].flagKey);
  if (!record) return null;
  if (record.itemId && record.itemId !== item.id) return null;
  try {
    await (kind === 'race' ? COGRaceClassApplier.removeRace(actor) : COGRaceClassApplier.removeClass(actor));
    return true;
  } catch (err) {
    console.error(`Sprinter RPG | Could not revert ${kind} "${item.name}" after it was deleted:`, err);
    globalThis.ui?.notifications?.warn?.(`${item.name} was deleted, but its effects could not all be removed. Check the crawler.`);
    return null;
  }
}

export class COGRaceClassApplier {

  // =========================================================================
  // DEFINITION LOOKUPS
  // =========================================================================

  /**
   * Finds a race definition by exact reference: a catalog entry's `_id` / `id` / `system.identifier`,
   * or a world race item's id / uuid / identifier. Names are never matched.
   *
   * @param {string|object} identifier - reference, or a definition / item (returned as data)
   * @param {{preferPet?: boolean, actor?: Actor}} [options] two races may share an identifier (an Earth race and a
   *   pet race): a pet prefers the pet one
   * @returns {object|null}
   */
  static findRace(identifier, options = {}) {
    if (!identifier) return null;
    if (typeof identifier === 'object') {
      return identifier.toObject ? { ...identifier.toObject(), uuid: identifier.uuid } : identifier;
    }
    const isPetRace = (r) => (r.system?.tags || []).includes('companion.pet');
    const preferPet = Boolean(options?.preferPet || options?.actor?.type === 'pet');
    return findDefinition('races', 'race', identifier, preferPet ? isPetRace : null);
  }

  /**
   * Finds a class definition by exact reference; see {@link findRace}.
   *
   * @param {string|object} identifier - reference, or a definition / item (returned as data)
   * @returns {object|null}
   */
  static findClass(identifier) {
    if (!identifier) return null;
    if (typeof identifier === 'object') {
      return identifier.toObject ? { ...identifier.toObject(), uuid: identifier.uuid } : identifier;
    }
    return findDefinition('classes', 'class', identifier, null);
  }

  /**
   * The value `details.race` / `details.class` stores for a definition: its `system.identifier`, always. A world item
   * is found again by that identifier; an item created without one already got its name's slug
   * (`COGItem#_preCreate`), so the slug stands in only for data not yet created.
   * @param {object|null} def
   * @returns {string}
   */
  static definitionRef(def) {
    if (!def) return '';
    return itemIdentifier(def);
  }

  /**
   * Display name of a race or class reference: the actor's embedded item, else the definition the
   * reference resolves to, else the stored text itself (a mercenary's free-text class).
   * @param {'race'|'class'} type
   * @param {string} ref the stored `details.race` / `details.class`
   * @param {{actor?: Actor}} [options]
   * @returns {string}
   */
  static definitionLabel(type, ref, { actor = null } = {}) {
    const embedded = actor?.items?.find((i) => i.type === type);
    if (embedded?.name) return embedded.name;
    const value = String(ref ?? '').trim();
    if (!value) return '';
    const def = type === 'race' ? this.findRace(value, { actor }) : this.findClass(value);
    return def?.name || value;
  }

  // =========================================================================
  // GRANT DECOMPOSITION (STATS, SKILLS, SPELLS, SIZE)
  // =========================================================================

  /**
   * Decomposes structured grants (system.grants) into concrete bonus components. Stat, skill and
   * spell rows are read here; `rank_bonus` rows are live (derived from the embedded item), and DR,
   * movement and size come from the item's own `drBonus`, `movement` and `size` fields. A definition
   * with no grants (or only prose) yields zero bonuses and no skills or spells.
   * @param {object} def
   * @returns {{stats: object, skills: object[], spells: object[], drBonus: number, movement: object, size: string|null}}
   */
  static parseGrants(def) {
    const grants = def?.system?.grants || def?.grants;
    const stats = { str: 0, dex: 0, con: 0, int: 0, cha: 0 };
    const skills = [];
    const spells = [];
    const drBonus = Number(def?.system?.drBonus) || 0;
    const movement = { walkDelta: 0, climb: 0, swim: 0, fly: 0, burrow: 0 };
    for (const key of Object.keys(movement)) movement[key] = Number(def?.system?.movement?.[key]) || 0;
    const size = def?.system?.size || null;

    for (const g of (Array.isArray(grants) ? grants : [])) {
      if (!g) continue;
      if (g.kind === 'stat') {
        const st = String(g.stat || '').toLowerCase().trim();
        if (stats[st] !== undefined && g.mode !== 'pool') stats[st] += Number(g.value) || 0;
      } else if (g.kind === 'skill' && g.mode !== 'choice') {
        skills.push({
          uuid: g.uuid || '',
          identifier: g.identifier || '',
          name: catalogNameFor(g.identifier, [catalogEntries('skills')]) || g.label || '',
          rank: Number(g.rank) || 1,
          stat: g.stat || undefined,
          cooldown: normalizeTiming(g.cooldown).unit ? g.cooldown : undefined
        });
      } else if (g.kind === 'spell' && g.mode !== 'choice') {
        spells.push({
          uuid: g.uuid || '',
          identifier: g.identifier || '',
          name: catalogNameFor(g.identifier, [catalogEntries('spells')]) || g.label || '',
          rank: Number(g.rank) || 1
        });
      }
    }

    return { stats, skills, spells, drBonus, movement, size };
  }

  /**
   * Fully decomposes a race definition into applied bonuses.
   */
  static parseRaceBonuses(raceDef) {
    if (!raceDef) return null;
    const { stats, skills, spells, drBonus, movement, size: grantSize } = this.parseGrants(raceDef);

    return {
      name: raceDef.name,
      heritage: sanitizeHeritageId(raceDef.system?.heritage),
      // '' is a race that leaves the creature's size alone (D10): it is never looked up
      size: grantSize ? sanitizeSizeId(grantSize) : '',
      stats,
      skills,
      spells,
      choices: this.detectChoices(raceDef),
      drBonus,
      movement
    };
  }

  /**
   * Fully decomposes a class definition into applied bonuses.
   */
  static parseClassBonuses(classDef) {
    if (!classDef) return null;
    const { stats, skills, spells, drBonus, movement } = this.parseGrants(classDef);

    return {
      name: classDef.name,
      archetypes: Array.isArray(classDef.system?.archetypes) ? [...classDef.system.archetypes] : [],
      stats,
      skills,
      spells,
      choices: this.detectChoices(classDef),
      drBonus,
      movement
    };
  }

  // =========================================================================
  // CHOICE DETECTION, CATALOGING, & WIZARD PROMPT
  // =========================================================================

  /**
   * Detects pending skill or spell choices from a race or class definition's choice-mode grant rows.
   *
   * @param {object} def - Race or Class definition (canonical, world item, or studio build)
   * @returns {Array<object>} Array of choice objects { id, label, type, category, rank, options, sourcePerk }
   */
  static detectChoices(def) {
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
  static getCatalogOptions(choice) {
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
      indexed = toOptions(tagIndex.find(query, { type: kind }) || []);
    } catch (_) {
      indexed = [];
    }
    if (indexed.length) return indexed;
    return toOptions(catalogEntries(catalogKind).filter(d => matchesTagQuery(getItemAllTags({ ...d, type: d.type || kind }), query)));
  }

  /**
   * Prompts the user with an interactive dialog to choose skills or spells.
   *
   * @param {object} def - Race or Class definition object
   * @param {Array<object>} choices - Array of choice objects from detectChoices
   * @param {object} [options={}]
   * @returns {Promise<object|null>} Object mapping choice IDs to selected identifiers (or write-in text), or null if cancelled
   */
  static async promptChoicesDialog(def, choices, options = {}) {
    if (!choices || choices.length === 0) return {};

    // Build Choice HTML rows
    const rowsHtml = choices.map((ch) => {
      const catalog = this.getCatalogOptions(ch);
      const optionsHtml = catalog.map(opt => `<option value="${opt.value}">${opt.label}</option>`).join('');
      return `
        <div class="cog-choice-row cog-bg-surface" style="margin-bottom: 12px; padding: 8px; border: 1px solid var(--cog-divider); border-radius: 4px;">
          <div class="cog-text" style="font-weight: bold; font-family: 'Oswald', sans-serif; font-size: 13px; margin-bottom: 4px; display: flex; justify-content: space-between;">
            <span><i class="fa-solid fa-crosshairs cog-text-accent"></i> ${ch.label}</span>
            <span class="cog-badge cog-bg-accent-fill cog-text-on-fill" style="font-size: 11px; padding: 1px 6px; border-radius: 2px;">Rank +${ch.rank}</span>
          </div>
          ${ch.sourcePerk ? `<div class="cog-text-muted" style="font-size: 11px; margin-bottom: 6px; font-style: italic;">From perk: "${ch.sourcePerk}"</div>` : ''}
          <div style="display: flex; gap: 8px; align-items: center;">
            <select name="${ch.id}" class="cog-choice-select" data-choice-id="${ch.id}" style="flex: 1; padding: 4px; font-size: 12px;">
              ${optionsHtml}
              <option value="__custom__">-- Custom Write-in... --</option>
            </select>
          </div>
          <input type="text" name="${ch.id}_custom" class="cog-choice-custom" data-choice-id="${ch.id}" placeholder="Enter custom name..." style="display: none; width: 100%; margin-top: 6px; padding: 4px; font-size: 12px; box-sizing: border-box;" />
        </div>
      `;
    }).join('');

    const content = `
      <div class="cog-dialog-choices" style="padding: 6px; font-family: 'Oswald', sans-serif;">
        <div class="cog-bg-accent-fill cog-text-on-fill" style="padding: 8px 10px; border-radius: 4px 4px 0 0; margin-bottom: 10px;">
          <h3 style="margin: 0; font-size: 16px; text-transform: uppercase; letter-spacing: 0.5px;">
            <i class="fa-solid fa-list-check"></i> Choose: ${def.name}
          </h3>
          <p style="margin: 4px 0 0; font-size: 11px; opacity: 0.9;">
            This ${def.type || 'definition'} provides choices for skills or spells. Select your preferences below:
          </p>
        </div>
        <div class="cog-choices-form">
          ${rowsHtml}
        </div>
      </div>
    `;

    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: `${def.name} - Select Choices` },
      position: { width: 480 },
      classes: ['cog-dialog', 'cog-choices-wizard'],
      content,
      buttons: [
        {
          action: 'confirm',
          icon: 'fas fa-check',
          label: 'Confirm & Apply',
          default: true,
          callback: (event, button) => {
            const els = button.form.elements;
            const selections = {};
            for (const ch of choices) {
              const selVal = els[ch.id]?.value;
              // An identifier from the list, or a typed write-in (resolveChoices makes it a stub with its slug).
              if (selVal === '__custom__') {
                const customVal = (els[`${ch.id}_custom`]?.value || '').trim();
                selections[ch.id] = customVal || (this.getCatalogOptions(ch)[0]?.value ?? '');
              } else {
                selections[ch.id] = selVal || (this.getCatalogOptions(ch)[0]?.value ?? '');
              }
            }
            return selections;
          }
        },
        { action: 'cancel', icon: 'fas fa-times', label: 'Cancel', callback: () => null }
      ],
      rejectClose: false,
      render: (event, dialog) => {
        const root = dialog.element;
        for (const select of root.querySelectorAll('.cog-choice-select')) {
          select.addEventListener('change', () => {
            const custom = root.querySelector(`input[name="${select.dataset.choiceId}_custom"]`);
            if (!custom) return;
            const isCustom = select.value === '__custom__';
            custom.style.display = isCustom ? '' : 'none';
            if (isCustom) custom.focus();
          });
        }
      }
    });
    // A null Cancel callback comes back as the action name 'cancel'; only the Confirm object is an answer.
    return dialogAnswer(result);
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
  static resolveChoices(def, choices, userSelections = {}) {
    const chosenSkills = [];
    const chosenSpells = [];
    const chosenRankCaps = [];

    if (!choices || choices.length === 0) {
      return { chosenSkills, chosenSpells, chosenRankCaps };
    }

    const refOf = (v) => (v && typeof v === 'object' ? (v.identifier ?? v.value ?? '') : v);
    choices.forEach((ch, idx) => {
      let selected = '';
      if (Array.isArray(userSelections)) {
        selected = refOf(userSelections[idx]);
      } else if (typeof userSelections === 'string') {
        if (idx === 0) selected = userSelections;
      } else if (userSelections && typeof userSelections === 'object') {
        selected = refOf(userSelections[ch.id] ?? userSelections[ch.label] ?? userSelections[idx] ?? userSelections[ch.category]);
      }
      selected = String(selected ?? '').trim() || (this.getCatalogOptions(ch)[0]?.value ?? '');
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
   * Resolves a race or class definition's choice and pool grants into fixed rows (create-once): chosen
   * `rank_cap` skills become fixed `rank_cap` rows, and each `stat` pool becomes fixed `stat` rows for the
   * player's split. The returned def is the one to apply and embed.
   *
   * @param {object} def
   * @param {{chosenRankCaps?: Array}} resolvedChoices
   * @param {object} [options] `statPools` (allocations keyed by grant index) answers without a dialog
   * @returns {Promise<{def: object, ruleBreak: boolean}|null>} null when the user cancels
   */
  static async resolveGrantRows(def, resolvedChoices, options = {}) {
    const grants = def.system?.grants;
    if (!Array.isArray(grants) || grants.length === 0) return { def, ruleBreak: false };

    const pools = detectStatPools(grants);
    const allocations = {};
    let ruleBreak = false;
    const interactive = mayOpenDialogs(options);

    for (const pool of pools) {
      const given = options.statPools?.[pool.grantIndex];
      let chosen = null;
      if (given !== undefined) {
        chosen = evaluateStatPool(pool, given);
        if (!chosen.complete) {
          globalThis.ui?.notifications?.warn?.(`${def.name}: allocate all ${pool.points} stat points before applying.`);
          options.warned = true; // applyRaceClassChoices need not warn "not applied" as well
          return null;
        }
        if (chosen.over) {
          const res = await confirmRuleBreak({
            title: 'Stat Pool Over Budget',
            message: `${chosen.spent} of ${pool.points} stat points allocated. Apply anyway as a Rule Break?`,
            options
          });
          if (!res.confirmed) return null;
          ruleBreak = true;
        }
      } else if (interactive) {
        while (!chosen) {
          const raw = await this.promptStatPoolDialog(def, pool);
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
            ruleBreak = true;
          }
          chosen = evaluated;
        }
      } else {
        chosen = evaluateStatPool(pool, defaultPoolAllocation(pool));
      }
      allocations[pool.grantIndex] = chosen.allocation;
    }

    const picks = resolvedChoices?.chosenRankCaps || [];
    const rows = grants.flatMap((g, index) => {
      if (isRankCapChoice(g)) return rankCapRowsFor(g, index, picks);
      if (isStatPool(g)) return statPoolRowsFor(g, allocations[index]);
      return [g];
    });
    return { def: { ...def, system: { ...def.system, grants: rows } }, ruleBreak };
  }

  /**
   * Asks the player to split a stat pool across its options. Submitting needs every point allocated; going
   * over budget is allowed here and confirmed as a Rule Break by the caller.
   *
   * @param {object} def
   * @param {{points: number, options: string[], label: string}} pool
   * @returns {Promise<object|null>} stat key to points, or null when cancelled
   */
  static async promptStatPoolDialog(def, pool) {
    const rows = pool.options.map(stat => `
      <div class="cog-choice-row" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <label for="pool_${stat}" style="font-family: 'Oswald', sans-serif; text-transform: uppercase;">${stat}</label>
        <input type="number" id="pool_${stat}" name="pool_${stat}" class="cog-pool-input" min="0" step="1" value="0" style="width: 64px; text-align: center;" />
      </div>`).join('');
    const content = `
      <div class="cog-dialog-choices" style="padding: 6px; font-family: 'Oswald', sans-serif;">
        <p>${pool.label || 'Stat points'}: split <strong>${pool.points}</strong> points across ${pool.options.map(o => o.toUpperCase()).join(', ')}.</p>
        ${rows}
        <p class="cog-pool-remaining">Remaining: <strong>${pool.points}</strong></p>
      </div>`;

    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: `${def.name} - Stat Points` },
      position: { width: 380 },
      classes: ['cog-dialog', 'cog-choices-wizard'],
      content,
      buttons: [
        {
          action: 'confirm',
          icon: 'fas fa-check',
          label: 'Confirm & Apply',
          default: true,
          callback: (event, button) => {
            const allocation = {};
            for (const stat of pool.options) allocation[stat] = Number(button.form.elements[`pool_${stat}`]?.value) || 0;
            return allocation;
          }
        },
        { action: 'cancel', icon: 'fas fa-times', label: 'Cancel', callback: () => null }
      ],
      rejectClose: false,
      render: (event, dialog) => {
        const root = dialog.element;
        const refresh = () => {
          const allocation = {};
          for (const stat of pool.options) allocation[stat] = Number(root.querySelector(`[name="pool_${stat}"]`)?.value) || 0;
          const { remaining, complete } = evaluateStatPool(pool, allocation);
          const label = root.querySelector('.cog-pool-remaining strong');
          if (label) label.textContent = String(remaining);
          const confirmBtn = root.querySelector('button[data-action="confirm"]');
          if (confirmBtn) confirmBtn.disabled = !complete;
        };
        for (const input of root.querySelectorAll('.cog-pool-input')) input.addEventListener('input', refresh);
        refresh();
      }
    });
    // DialogV2 hands a null callback result back as the button's action ('cancel'), and a closed window as null:
    // only the Confirm callback's allocation object is a real answer.
    return dialogAnswer(result);
  }

  // =========================================================================
  // SELECT OPTION GROUP BUILDERS (FOR TEMPLATES)
  // =========================================================================

  /**
   * Generates precomputed select options for Race and Class dropdowns.
   *
   * @param {Actor} actor
   * @returns {object} { raceOptions, classOptions, hasCustomRace, hasCustomClass, currentRace, currentClass,
   *   currentRaceLabel, currentClassLabel } (option values and current* are references; *Label are names)
   */
  static getRaceClassContext(actor) {
    // `details.race` / `details.class` hold a reference (the item identifier) or, for an uncataloged
    // write-in, the text itself. A race or class item embedded directly (dropped, imported, scripted)
    // never wrote the detail, so its own reference stands in; otherwise the Core selects read "None" beside real items.
    const embeddedRef = (type) => String(actor?.items?.find((i) => i.type === type)?.system?.identifier ?? '');
    const currentRace = String(actor?.system?.details?.race || '').trim() || embeddedRef('race');
    const currentClass = String(actor?.system?.details?.class || '').trim() || embeddedRef('class');
    const option = (def, label = def.name) => {
      const value = this.definitionRef(def);
      return { value, label, selected: Boolean(value) && value === currentRace };
    };

    // 1. Race Options: one group per registered heritage; a `companion.pet` race joins the companion group
    const groupOptions = new Map(heritageGroups().map(g => [g.id, []]));
    let raceFound = false;

    const companionId = companionHeritageId();
    const raceCatalog = catalogEntries('races');
    for (const r of raceCatalog) {
      const opt = option(r);
      if (opt.selected) raceFound = true;
      const tags = r.system?.tags || [];
      const heritageId = tags.includes('companion.pet') ? companionId : sanitizeHeritageId(r.system?.heritage);
      if (!groupOptions.has(heritageId)) groupOptions.set(heritageId, []);
      groupOptions.get(heritageId).push(opt);
    }

    const worldRaces = [];
    for (const item of globalThis.game?.items ?? []) {
      if (item.type !== 'race') continue;
      const opt = option({ name: item.name, uuid: item.uuid, system: item.system }, `${item.name} (Custom)`);
      if (opt.selected) raceFound = true;
      worldRaces.push(opt);
    }

    // Registered groups always show (empty or not); an unregistered id gets its own group after them
    const groups = heritageGroups({ companionFirst: actor?.type === 'pet' });
    const known = new Set(groups.map(g => g.id));
    for (const id of groupOptions.keys()) if (!known.has(id)) groups.push({ id, label: heritageLabel(id) });
    const raceOptions = groups.map(g => ({ label: g.label, options: groupOptions.get(g.id) ?? [] }));
    if (worldRaces.length > 0) {
      raceOptions.push({ label: 'Custom / World Races', options: worldRaces });
    }

    const hasCustomRace = Boolean(currentRace && !raceFound);

    // 2. Class Options
    const archetypes = [
      'Arcanist', 'Barbarian', 'Bard', 'Cleric', 'Druid',
      'Fighter', 'Mage', 'Monk', 'Paladin', 'Rogue'
    ];
    const archetypeMap = {};
    for (const arch of archetypes) archetypeMap[arch] = [];
    const multiclassClasses = [];
    let classFound = false;

    const classCatalog = catalogEntries('classes');
    const classOption = (def, label = def.name) => {
      const value = this.definitionRef(def);
      return { value, label, selected: Boolean(value) && value === currentClass };
    };
    for (const c of classCatalog) {
      const opt = classOption(c);
      if (opt.selected) classFound = true;

      // One archetype tag groups the class under it; none, several or an unlisted one puts it with the special classes.
      const tags = Array.isArray(c.system?.archetypes) ? c.system.archetypes : [];
      const matchArch = tags.length === 1 ? archetypes.find(a => ARCHETYPE_TO_TAG[a.toLowerCase()] === tags[0]) : null;
      if (matchArch) archetypeMap[matchArch].push(opt);
      else multiclassClasses.push(opt);
    }

    const worldClasses = [];
    for (const item of globalThis.game?.items ?? []) {
      if (item.type !== 'class') continue;
      const opt = classOption({ name: item.name, uuid: item.uuid, system: item.system }, `${item.name} (Custom)`);
      if (opt.selected) classFound = true;
      worldClasses.push(opt);
    }

    const classOptions = [];
    for (const arch of archetypes) {
      if (archetypeMap[arch].length > 0) {
        classOptions.push({ label: `${arch} Classes`, options: archetypeMap[arch] });
      }
    }
    if (multiclassClasses.length > 0) {
      classOptions.push({ label: 'Multiclass & Special Classes', options: multiclassClasses });
    }
    if (worldClasses.length > 0) {
      classOptions.push({ label: 'Custom / World Classes', options: worldClasses });
    }

    const hasCustomClass = Boolean(currentClass && !classFound);

    return {
      raceOptions,
      classOptions,
      hasCustomRace,
      hasCustomClass,
      currentRace,
      currentClass,
      currentRaceLabel: this.definitionLabel('race', currentRace, { actor }),
      currentClassLabel: this.definitionLabel('class', currentClass, { actor })
    };
  }

  // =========================================================================
  // RACE MUTATORS (APPLY & REVERSE)
  // =========================================================================

  /**
   * Reverses and removes the actor's current race benefits.
   *
   * @param {Actor} actor
   * @returns {Promise<boolean>}
   */
  static async removeRace(actor) {
    return whileApplying(actor, () => this._removeRaceUnguarded(actor));
  }

  static async _removeRaceUnguarded(actor) {
    if (!actor) return false;

    // 1. Revert only what the applier recorded. With no flag there is nothing to revert: the
    // string and any stray race items are cleared, but a race name is never looked up and subtracted.
    const applied = actor.getFlag?.(SYSTEM_ID, 'appliedRace');
    const currentRaceName = (actor.system?.details?.race || '').trim();
    const hasRaceItem = Boolean(actor.items?.some(i => i.type === 'race'));

    if (!applied && !currentRaceName && !hasRaceItem) return false;

    const updates = {};
    updates['system.details.race'] = '';

    // 2. Revert Ability Stats
    if (applied?.stats) addAbilityDeltas(actor, updates, applied.stats, -1);

    // 3. Revert Creature Size
    if (applied?.size) {
      const orig = applied.originalSize || DEFAULT_SIZE;
      updates['system.attributes.size'] = orig;
    }

    // 4-5. Revert DR and Movement
    revertDrAndMovementBonuses(actor, updates, applied);

    // 6. Delete the buffs and debuffs this race granted (its `system.grantedEffects`, flagged grantedBy: race)
    const condIdsToDelete = [];
    if (actor.items) {
      for (const item of actor.items) {
        if (['buff', 'debuff'].includes(item.type) && item.getFlag?.(SYSTEM_ID, 'grantedBy') === 'race') {
          if (!condIdsToDelete.includes(item.id)) condIdsToDelete.push(item.id);
        }
      }
    }
    if (condIdsToDelete.length > 0 && typeof actor.deleteEmbeddedDocuments === 'function') {
      await actor.deleteEmbeddedDocuments('Item', condIdsToDelete);
    }

    // 7. Revert Skills
    if (Array.isArray(applied?.skills)) {
      const itemsToDelete = [];
      for (const s of applied.skills) {
        const skillItem = findAppliedItem(actor, 'skill', s);
        if (skillItem) {
          const curRank = Number(skillItem.system?.rank) || 0;
          const remainingRank = curRank - (Number(s.rank) || 0);

          if (remainingRank > 0) {
            // Keep the skill with remaining non-item ranks!
            if (typeof skillItem.update === 'function') {
              await skillItem.update({ 'system.rank': remainingRank });
            }
          } else {
            // No non-item ranks remain: delete if granted by race or 0
            const wasCreated = s.createdByRace || grantedByRaceOrClass(skillItem);
            if (wasCreated && typeof actor.deleteEmbeddedDocuments === 'function') {
              itemsToDelete.push(skillItem.id);
            } else if (typeof skillItem.update === 'function') {
              await skillItem.update({ 'system.rank': Math.max(0, remainingRank) });
            }
          }
        }
      }
      if (itemsToDelete.length > 0 && typeof actor.deleteEmbeddedDocuments === 'function') {
        await actor.deleteEmbeddedDocuments('Item', itemsToDelete);
      }
    }

    // 8. Revert Spells
    if (Array.isArray(applied?.spells)) {
      const spellsToDelete = [];
      for (const sp of applied.spells) {
        const spellItem = findAppliedItem(actor, 'spell', sp);
        if (spellItem) {
          const curRank = Number(spellItem.system?.rank) || 0;
          const remainingRank = curRank - (Number(sp.rank) || 0);
          if (remainingRank > 0) {
            if (typeof spellItem.update === 'function') {
              await spellItem.update({ 'system.rank': remainingRank });
            }
          } else {
            const wasCreated = sp.createdByRace || grantedByRaceOrClass(spellItem);
            if (wasCreated && typeof actor.deleteEmbeddedDocuments === 'function') {
              spellsToDelete.push(spellItem.id);
            } else if (typeof spellItem.update === 'function') {
              await spellItem.update({ 'system.rank': Math.max(0, remainingRank) });
            }
          }
        }
      }
      if (spellsToDelete.length > 0 && typeof actor.deleteEmbeddedDocuments === 'function') {
        await actor.deleteEmbeddedDocuments('Item', spellsToDelete);
      }
    }

    // 9. Delete embedded Race Item documents
    const raceItems = actor.items?.filter(i => i.type === 'race') || [];
    if (raceItems.length > 0 && typeof actor.deleteEmbeddedDocuments === 'function') {
      await actor.deleteEmbeddedDocuments('Item', raceItems.map(i => i.id));
    }

    // 10. Clear flag
    if (typeof actor.unsetFlag === 'function') {
      await actor.unsetFlag(SYSTEM_ID, 'appliedRace');
    }

    // 11. Commit actor updates
    if (Object.keys(updates).length > 0 && typeof actor.update === 'function') {
      await actor.update(updates);
    }

    return true;
  }

  /**
   * Applies a race or class to the actor, reverting the previous one first: the one path behind `applyRace` and
   * `applyClass`. The stages and what differs per kind live in `race-class-grants.mjs`.
   *
   * @param {Actor} actor
   * @param {'race'|'class'} kind
   * @param {string|object} identifier
   * @param {object} [options]
   * @returns {Promise<boolean>}
   */
  static async applyKind(actor, kind, identifier, options = {}) {
    return whileApplying(actor, () => this._applyKindUnguarded(actor, kind, identifier, options));
  }

  static async _applyKindUnguarded(actor, kind, identifier, options = {}) {
    if (!actor) return false;
    const profile = RACE_CLASS_KINDS[kind];

    // Clearing
    if (!identifier) {
      await profile.remove(this, actor);
      return true;
    }

    const def = profile.find(this, identifier, actor, options);

    // Race and Class are chosen on the Third Floor: below it a crawler confirms a Rule Break
    const floorGate = await confirmRaceClassFloor(actor, kind, def || { name: String(identifier) }, options);
    if (!floorGate.proceed) return false;

    if (!def) {
      // An uncataloged write-in: stored as text (it resolves to nothing; the label shows the text)
      await profile.remove(this, actor);
      await actor.update?.({ [`system.details.${profile.detailsKey}`]: identifier });
      return true;
    }

    // Prerequisites and exclusions: unmet ones need a Rule Break confirmation (recorded on the embedded item)
    const requirement = await confirmRequires(actor, { ...def, type: kind }, options);
    if (!requirement.proceed) return false;

    const resolvedChoices = await resolveKindChoices(this, def, options);
    if (!resolvedChoices) return false; // User cancelled

    // Choice and pool grants become fixed rows on the embedded copy (create-once)
    const grantRows = await this.resolveGrantRows(def, resolvedChoices, options);
    if (!grantRows) return false; // User cancelled
    const grantDef = grantRows.def;

    // Revert the previous one first: the first write
    await profile.remove(this, actor);

    const bonuses = profile.parse(this, grantDef);
    const updates = { [`system.details.${profile.detailsKey}`]: this.definitionRef(def) };
    const originalSize = actor.system?.attributes?.size || DEFAULT_SIZE;
    if (profile.hasSize && bonuses.size) updates['system.attributes.size'] = bonuses.size;
    addAbilityDeltas(actor, updates, bonuses.stats, 1);
    addDrAndMovementBonuses(actor, updates, bonuses);

    const appliedSkills = await grantKindItems(actor, kind, 'skill', [...bonuses.skills, ...(resolvedChoices.chosenSkills || [])]);
    const appliedSpells = await grantKindItems(actor, kind, 'spell', [...bonuses.spells, ...(resolvedChoices.chosenSpells || [])]);

    await grantKindEffects(actor, kind, grantDef);

    const ruleBreak = Boolean(grantRows.ruleBreak || requirement.ruleBreak || floorGate.ruleBreak || def.flags?.[SYSTEM_ID]?.ruleBreak === true);
    const embeddedId = await embedKindItem(actor, kind, { def, grantDef, bonuses, resolvedChoices, ruleBreak });

    if (typeof actor.setFlag === 'function') {
      await actor.setFlag(SYSTEM_ID, profile.flagKey, appliedKindRecord(kind, { def, bonuses, appliedSkills, appliedSpells, resolvedChoices, embeddedId, originalSize }));
    }

    // Commit actor updates
    if (Object.keys(updates).length > 0 && typeof actor.update === 'function') {
      await actor.update(updates);
    }

    if (globalThis.ui?.notifications) {
      globalThis.ui.notifications.info(`Applied ${profile.label} "${def.name}" to ${actor.name}.`);
    }

    // Starting items are given once per source (a repeat needs a Rule Break confirmation)
    await grantStartingItems(actor, { type: kind, def: grantDef }, options);

    return true;
  }

  /**
   * Applies a new race to the actor, automatically reverting previous race benefits.
   *
   * @param {Actor} actor
   * @param {string} raceIdentifier
   * @returns {Promise<boolean>}
   */
  static async applyRace(actor, raceIdentifier, options = {}) {
    return this.applyKind(actor, 'race', raceIdentifier, options);
  }

  // =========================================================================
  // CLASS MUTATORS (APPLY & REVERSE)
  // =========================================================================

  /**
   * Reverses and removes the actor's current class benefits.
   *
   * @param {Actor} actor
   * @returns {Promise<boolean>}
   */
  static async removeClass(actor) {
    return whileApplying(actor, () => this._removeClassUnguarded(actor));
  }

  static async _removeClassUnguarded(actor) {
    if (!actor) return false;

    // 1. Revert only what the applier recorded; with no flag only the string and stray class items go.
    const applied = actor.getFlag?.(SYSTEM_ID, 'appliedClass');
    const currentClassName = (actor.system?.details?.class || '').trim();
    const hasClassItem = Boolean(actor.items?.some(i => i.type === 'class'));

    if (!applied && !currentClassName && !hasClassItem) return false;

    const updates = {};
    updates['system.details.class'] = '';

    // 2. Revert Ability Stats
    if (applied?.stats) addAbilityDeltas(actor, updates, applied.stats, -1);

    // 3-4. Revert DR and Movement
    revertDrAndMovementBonuses(actor, updates, applied);

    // 5. Delete the buffs and debuffs this class granted (its `system.grantedEffects`, flagged grantedBy: class)
    const condIdsToDelete = [];
    if (actor.items) {
      for (const item of actor.items) {
        if (['buff', 'debuff'].includes(item.type) && item.getFlag?.(SYSTEM_ID, 'grantedBy') === 'class') {
          if (!condIdsToDelete.includes(item.id)) condIdsToDelete.push(item.id);
        }
      }
    }
    if (condIdsToDelete.length > 0 && typeof actor.deleteEmbeddedDocuments === 'function') {
      await actor.deleteEmbeddedDocuments('Item', condIdsToDelete);
    }

    // 6. Revert Skills
    if (Array.isArray(applied?.skills)) {
      const itemsToDelete = [];
      for (const s of applied.skills) {
        const skillItem = findAppliedItem(actor, 'skill', s);
        if (skillItem) {
          const curRank = Number(skillItem.system?.rank) || 0;
          const remainingRank = curRank - (Number(s.rank) || 0);

          if (remainingRank > 0) {
            // Keep skill with non-item ranks intact!
            if (typeof skillItem.update === 'function') {
              await skillItem.update({ 'system.rank': remainingRank });
            }
          } else {
            // No non-item ranks remain: delete if granted by class or 0
            const wasCreated = s.createdByClass || grantedByRaceOrClass(skillItem);
            if (wasCreated && typeof actor.deleteEmbeddedDocuments === 'function') {
              itemsToDelete.push(skillItem.id);
            } else if (typeof skillItem.update === 'function') {
              await skillItem.update({ 'system.rank': Math.max(0, remainingRank) });
            }
          }
        }
      }
      if (itemsToDelete.length > 0 && typeof actor.deleteEmbeddedDocuments === 'function') {
        await actor.deleteEmbeddedDocuments('Item', itemsToDelete);
      }
    }

    // 7. Revert Spells
    if (Array.isArray(applied?.spells)) {
      const spellsToDelete = [];
      for (const sp of applied.spells) {
        const spellItem = findAppliedItem(actor, 'spell', sp);
        if (spellItem) {
          const curRank = Number(spellItem.system?.rank) || 0;
          const remainingRank = curRank - (Number(sp.rank) || 0);
          if (remainingRank > 0) {
            if (typeof spellItem.update === 'function') {
              await spellItem.update({ 'system.rank': remainingRank });
            }
          } else {
            const wasCreated = sp.createdByClass || grantedByRaceOrClass(spellItem);
            if (wasCreated && typeof actor.deleteEmbeddedDocuments === 'function') {
              spellsToDelete.push(spellItem.id);
            } else if (typeof spellItem.update === 'function') {
              await spellItem.update({ 'system.rank': Math.max(0, remainingRank) });
            }
          }
        }
      }
      if (spellsToDelete.length > 0 && typeof actor.deleteEmbeddedDocuments === 'function') {
        await actor.deleteEmbeddedDocuments('Item', spellsToDelete);
      }
    }

    // 8. Delete embedded Class Item documents
    const classItems = actor.items?.filter(i => i.type === 'class') || [];
    if (classItems.length > 0 && typeof actor.deleteEmbeddedDocuments === 'function') {
      await actor.deleteEmbeddedDocuments('Item', classItems.map(i => i.id));
    }

    // 9. Clear flag
    if (typeof actor.unsetFlag === 'function') {
      await actor.unsetFlag(SYSTEM_ID, 'appliedClass');
    }

    // 10. Commit actor updates
    if (Object.keys(updates).length > 0 && typeof actor.update === 'function') {
      await actor.update(updates);
    }

    return true;
  }

  /**
   * Applies a new class to the actor, automatically reverting previous class benefits.
   *
   * @param {Actor} actor
   * @param {string} classIdentifier
   * @returns {Promise<boolean>}
   */
  static async applyClass(actor, classIdentifier, options = {}) {
    return this.applyKind(actor, 'class', classIdentifier, options);
  }

  /**
   * Universal applicator for race or class definitions.
   *
   * @param {Actor} actor
   * @param {'race'|'class'} type
   * @param {string} identifier
   * @param {object} [options={}]
   * @returns {Promise<boolean>}
   */
  static async applyRaceOrClass(actor, type, identifier, options = {}) {
    if (type === 'race') return this.applyRace(actor, identifier, options);
    return this.applyClass(actor, identifier, options);
  }
}

/** What the not-applied warning calls a choice: the race or class definition's name when the reference resolves, else the reference as given. */
function notAppliedName(kind, choice) {
  try {
    const def = kind === 'race' ? COGRaceClassApplier.findRace(choice) : COGRaceClassApplier.findClass(choice);
    return def?.name || String(choice);
  } catch { return String(choice); }
}

/**
 * Apply a chosen Race and then Class to an actor through the applier, the one code path that writes race and
 * class stats, items and flags (moved here by 3.25c S2). A refusal, cancel or failure keeps the
 * actor, warns that the choice was not applied, and carries on with the Class.
 * @param {Actor} actor
 * @param {{race?: string, class?: string}} [choices] Catalog / world references; empty skips that step
 * @param {object} [options] `interactive: false` is passed on to the applier
 * @returns {Promise<{race: boolean|null, class: boolean|null}>} true applied, false not applied, null skipped
 */
export async function applyRaceClassChoices(actor, choices = {}, options = {}) {
  const result = { race: null, class: null };
  for (const kind of ['race', 'class']) {
    const choice = choices?.[kind];
    if (!choice) continue;
    const applyOptions = options?.interactive === false ? { interactive: false } : {};
    let applied = false;
    try {
      applied = kind === 'race'
        ? await actor.applyRace?.(choice, applyOptions)
        : await actor.applyClass?.(choice, applyOptions);
    } catch (err) {
      console.error(`Sprinter RPG | Failed to apply ${kind} "${choice}" to the new crawler:`, err);
    }
    // A cancel, a refusal and a failure each warn once, naming what was not applied, so the player can drop it on the sheet.
    // (the applier already warned with the reason on a Floor refusal or an incomplete stat pool: `warned`)
    if (applied === false && !applyOptions.warned) globalThis.ui?.notifications?.warn(raceClassText('COG.RaceClass.NotApplied', { name: notAppliedName(kind, choice) }));
    result[kind] = applied === undefined ? null : Boolean(applied);
  }
  return result;
}
