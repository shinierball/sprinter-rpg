/**
 * Sprinter RPG - Race & Class Application & Reversal Engine. Manages selecting, applying, and cleanly reverting Race
 * and Class benefits, ability modifiers, skill ranks, spells, and sizes on Crawler characters.
 */

import { catalogEntries } from '../content/catalog-lookup.mjs';
import { itemIdentifier } from '../utils/identifier.mjs';
import { sanitizeSizeId } from './sizes.mjs';
import { sanitizeHeritageId } from './rules/heritages.mjs';
import { catalogNameFor } from '../models/actors/actor-derivation.mjs';
import { SYSTEM_ID } from '../constants.mjs';
import { confirmRequires } from '../utils/character/requires.mjs';
import { confirmRaceClassFloor } from '../utils/character/race-class-floor.mjs';
import { normalizeTiming } from '../utils/time/timing.mjs';
import { effectiveRace } from '../utils/character/overlay-state.mjs';
import { grantStartingItems } from './starting-items.mjs';
import { RACE_CLASS_KINDS, writeKindPlan } from './race-class-grants.mjs';
import { planRaceClassKind, raceClassView, raceClassBreakKey, prefetchKindDocuments } from './race-class-plan.mjs';
import { getCurrentFloor } from '../utils/floor/current-floor.mjs';
import { detectChoices, getCatalogOptions, resolveChoices, collectStatPools, collectSelections } from './race-class-choices.mjs';
import { promptChoicesDialog, promptStatPoolDialog } from './race-class-dialogs.mjs';
import { getRaceClassContext } from './race-class-context.mjs';
import { APPLIER_DELETE_OPTION, removeAppliedRace, removeAppliedClass } from './race-class-revert.mjs';

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
 * `deleteItem` handler: deleting a race or class item from a crawler reverts it the way `removeRace` /
 * `removeClass` does, so its effects, skills and stat pool points go with it. Not run for the applier's own deletes (they carry `APPLIER_DELETE_OPTION`).
 * The delete has already happened, so a revert that fails only warns (CONTRIBUTING rule 2: never block a delete).
 * @param {Item} item
 * @param {object} [options] the delete's options
 * @param {string} [userId]
 * @returns {Promise<boolean|null>} true reverted, null when the hook did not apply
 */
export async function onRaceClassItemDelete(item, options, userId) {
  const kind = item?.type;
  const actor = item?.parent;
  if (!actor || !Object.hasOwn(RACE_CLASS_KINDS, kind) || actor.type !== 'crawler') return null;
  if (userId && globalThis.game?.user?.id && userId !== globalThis.game.user.id) return null;
  if (options?.[APPLIER_DELETE_OPTION]) return null;
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
    const preferPet = Boolean(options?.preferPet || options?.actor?.type === 'pet');
    return findDefinition('races', 'race', identifier, preferPet ? (r) => COGRaceClassApplier.isPetRace(r) : null);
  }

  /** Whether a race definition is a companion's (a pet race), not a crawler's. */
  static isPetRace(def) {
    return (def?.system?.tags || []).includes('companion.pet');
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
    // A race reads the one in force, so a transformed actor shows its form (7.1 D4).
    const embedded = type === 'race' ? effectiveRace(actor?.items) : actor?.items?.find((i) => i.type === type);
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
        // A percent on a race or class row would be circular with the base score it is taken from.
        if (Number(g.percent)) console.warn(`COG | ${def?.name ?? 'race/class'}: percent on a ${st.toUpperCase()} stat row is ignored; race and class rows build the base score.`);
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
  // CHOICES, PROMPTS, SHEET OPTIONS AND REVERT (the bodies live in the race-class-* part modules; each takes this class
  // as its first argument and calls back through it, so a patched static here steers the whole flow)
  // =========================================================================

  /** Pending skill or spell choices of a definition's choice-mode grant rows. */
  static detectChoices(def) {
    return detectChoices(this, def);
  }

  /** The options of a choice descriptor as `{ value, label }`. */
  static getCatalogOptions(choice) {
    return getCatalogOptions(this, choice);
  }

  /** Prompts the user with the choices wizard; null when cancelled. */
  static async promptChoicesDialog(def, choices, options = {}) {
    return promptChoicesDialog(this, def, choices, options);
  }

  /** Resolves detected choices against user selections into skills, spells and rank caps. */
  static resolveChoices(def, choices, userSelections = {}) {
    return resolveChoices(this, def, choices, userSelections);
  }

  /** Asks for, or reads, the stat pool splits of a definition. */
  static async collectStatPools(def, options = {}) {
    return collectStatPools(this, def, options);
  }

  /** The answers to every prompt of a race or class apply. */
  static async collectSelections(def, options = {}) {
    return collectSelections(this, def, options);
  }

  /** Asks the player to split a stat pool across its options. */
  static async promptStatPoolDialog(def, pool) {
    return promptStatPoolDialog(this, def, pool);
  }

  /** Precomputed select options for the Race and Class dropdowns. */
  static getRaceClassContext(actor) {
    return getRaceClassContext(this, actor);
  }

  /**
   * Reverses and removes the actor's current race benefits.
   *
   * @param {Actor} actor
   * @returns {Promise<boolean>}
   */
  static async removeRace(actor) {
    return removeAppliedRace(actor);
  }

  /**
   * Reverses and removes the actor's current class benefits.
   *
   * @param {Actor} actor
   * @returns {Promise<boolean>}
   */
  static async removeClass(actor) {
    return removeAppliedClass(actor);
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
    return this._applyKindUnguarded(actor, kind, identifier, options);
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

    // The gates already confirmed, as the planner's Rule Break keys
    const confirmed = [];
    if (floorGate.ruleBreak) confirmed.push(raceClassBreakKey(kind, 'floor'));
    if (requirement.ruleBreak) confirmed.push(raceClassBreakKey(kind, 'requires'));

    // Every prompt, answered before anything is written
    const collected = await this.collectSelections(def, options);
    if (!collected) return false; // User cancelled
    const { selections } = collected;
    for (const grantIndex of collected.overBudget) confirmed.push(raceClassBreakKey(kind, 'pool', grantIndex));

    // Grant documents (packs are async), then the previous one is reverted: the first write
    const lookup = await prefetchKindDocuments(kind, def, selections);
    await profile.remove(this, actor);

    const plan = planRaceClassKind(raceClassView(actor), kind, def, selections, {
      lookup, worldFloor: getCurrentFloor(), confirmed, startingItems: false, strict: true
    });
    for (const warning of plan.warnings) console.warn(`Sprinter RPG | ${warning}`);
    await writeKindPlan(actor, plan, { allowOffTheme: options.allowOffTheme === true });

    if (globalThis.ui?.notifications) {
      globalThis.ui.notifications.info(`Applied ${profile.label} "${def.name}" to ${actor.name}.`);
    }

    // Starting items are given once per source (a repeat needs a Rule Break confirmation)
    await grantStartingItems(actor, { type: kind, def: plan.grantDef }, options);

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