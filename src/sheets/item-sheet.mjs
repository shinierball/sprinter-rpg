/**
 * Sprinter RPG item sheet (ApplicationV2).
 *
 * One PART per area: `header`, one body part chosen by the item's type (`TYPE_PART`), `modifiers`
 * (the generic row editor, when the schema has modifier arrays), `interrupt` and `tags`. Context builders, actions, catalogs and submit transforms live in `src/sheets/item/`.
 */
import { COGItemSheetV2 } from './base/item-sheet-v2.mjs';
import { SYSTEM_PATH } from '../constants.mjs';
import { getAvailableBuffs, getAvailableDebuffs, getAvailableRollTables, getAvailableSpells, getCompendiumSkills } from './item/catalogs.mjs';
import { buildCommonContext, cloneSystem } from './item/context-common.mjs';
import { buildRowEditorContext } from './item/context-rows.mjs';
import { buildSkillContext } from './item/context-skill.mjs';
import { buildSpellContext } from './item/context-spell.mjs';
import { buildAttackContext } from './item/context-attack.mjs';
import { buildGearContext } from './item/context-gear.mjs';
import { TIMING_ACTIONS } from './item/actions-timing.mjs';
import { buildTimingContext } from './item/context-timing.mjs';
import { buildLootContext } from './item/context-outcomes.mjs';
import { buildSpaceUpgradeContext } from './item/context-space-upgrade.mjs';
import { buildClassContext, buildRaceContext } from './item/context-race-class.mjs';
import { describeItem, emptyLine } from '../utils/item-describer/index.mjs';
import { t as summaryLabel } from '../utils/item-describer/shared.mjs';
import { processItemFormData } from './item/form-data.mjs';
import { TAG_ACTIONS, addTagFromInput } from './item/actions-tags.mjs';
import { LIST_ACTIONS } from './item/actions-lists.mjs';
import { TRANSFORM_ACTIONS } from './item/actions-transform.mjs';
import { buildTransformContext } from './item/context-transform.mjs';
import { ROW_ACTIONS } from './item/actions-rows.mjs';
import { OUTCOME_ACTIONS } from './item/actions-outcomes.mjs';
import { SPECIALTY_ACTIONS } from './item/actions-specialty.mjs';
import { AS_TRIGGER_ACTIONS } from './item/actions-as-triggers.mjs';
import { BLUEPRINT_ACTIONS, canManageTable } from './item/actions-blueprint.mjs';
import { isBlueprintLootType, isLootBoxType } from '../models/items/loot-model.mjs';
import { buildAchievementTierContext, buildLootBoxContext, buildRewardBoxesContext } from './item/context-loot-box.mjs';
import { LOOT_BOX_ACTIONS, dropBoxItem, dropBoxTable, dropRewardBoxTemplate } from './item/actions-loot-box.mjs';
import { COPY_BLUEPRINT_ACTIONS } from './item/actions-copy-blueprint.mjs';
import { POOP_ACTIONS } from './item/actions-poop.mjs';
import { addGearGrant, GEAR_GRANT_KINDS } from './item/gear-grants.mjs';
import { itemIdentifier } from '../utils/identifier.mjs';
import { modifierArrayKeys } from './item/util.mjs';
import { startRepair } from '../documents/item/enchantments.mjs';

// `scrollable` keeps each part's scroll position across a re-render (a pick or any field change), so the form does not jump to the top.
const part = (name) => ({ template: `${SYSTEM_PATH}/templates/items/parts/${name}.hbs`, scrollable: [''] });

/**
 * The read-only "what this does" block: the lines, the heading ("What this
 * grants" for races and classes, "What this does" for the rest) and the muted empty line, built from an empty result only.
 */
async function buildSummaryContext(context, item) {
  const lines = await describeItem(item);
  const grants = item.type === 'race' || item.type === 'class';
  context.summaryTitle = summaryLabel(grants ? 'COG.ItemSummary.HeadingGrants' : 'COG.ItemSummary.Heading');
  context.summaryLines = lines;
  context.summaryEmpty = lines.length === 0;
  context.summaryEmptyText = emptyLine().text;
}

/** Actions that use the item rather than edit it. */
const USE_ACTIONS = {
  async rollSpell() {
    await this.item.roll();
  },
  async rollSpellDamage() {
    await this.item.roll('damage');
  },
  async broadcastAchievement() {
    await this.item.announce();
  },
  /** Repair a broken or destroyed gear item held by an actor (3.15 G1). */
  async repairItem(event) {
    event?.preventDefault?.();
    if (!this.isEditable) return;
    const actor = this.item.parent;
    if (actor?.documentName === 'Actor') await startRepair(actor, this.item);
  }
};

export class COGItemSheet extends COGItemSheetV2 {
  static DEFAULT_OPTIONS = {
    classes: ['item'],
    position: { width: 580, height: 640 },
    actions: { ...TAG_ACTIONS, ...LIST_ACTIONS, ...ROW_ACTIONS, ...OUTCOME_ACTIONS, ...AS_TRIGGER_ACTIONS, ...SPECIALTY_ACTIONS, ...COPY_BLUEPRINT_ACTIONS, ...POOP_ACTIONS, ...TIMING_ACTIONS, ...USE_ACTIONS, ...BLUEPRINT_ACTIONS, ...LOOT_BOX_ACTIONS, ...TRANSFORM_ACTIONS }
  };

  /** Body part for each item type (the `item.type` enum; deity and sponsor share the traits part). */
  static TYPE_PART = Object.freeze({
    skill: 'skill',
    attack: 'attack',
    spell: 'spell',
    gear: 'gear',
    race: 'race',
    class: 'class',
    deity: 'traits',
    sponsor: 'traits',
    buff: 'buff',
    debuff: 'debuff',
    loot: 'loot',
    achievement: 'achievement',
    space_upgrade: 'spaceUpgrade'
  });

  /** Parts every item renders around its body part (`modifiers` only when the item's schema has a modifier row array). */
  static FRAME_PARTS = Object.freeze({ before: ['header', 'summary'], after: ['modifiers', 'interrupt', 'light', 'tags'] });

  static PARTS = {
    header: part('header'),
    summary: part('summary'),
    skill: part('skill'),
    attack: part('attack'),
    spell: part('spell'),
    gear: part('gear'),
    race: part('race'),
    class: part('class'),
    traits: part('traits'),
    buff: part('buff'),
    debuff: part('debuff'),
    loot: part('loot'),
    achievement: part('achievement'),
    spaceUpgrade: part('space-upgrade'),
    modifiers: part('modifiers'),
    interrupt: part('interrupt'),
    light: part('light'),
    tags: part('tags')
  };

  /** Type-specific context, keyed by `item.type`, run after the shared context. */
  static CONTEXT_BUILDERS = Object.freeze({
    skill: buildSkillContext,
    spell: buildSpellContext,
    attack: buildAttackContext,
    gear: buildGearContext,
    loot: (context, item) => { buildLootContext(context, item); buildLootBoxContext(context, item); },
    achievement: (context, item) => { buildRewardBoxesContext(context, item); buildAchievementTierContext(context); },
    race: buildRaceContext,
    class: buildClassContext,
    debuff: buildTransformContext,
    space_upgrade: buildSpaceUpgradeContext
  });

  /** The part ids this item renders, in order. */
  get itemParts() {
    const { before, after } = this.constructor.FRAME_PARTS;
    const body = this.constructor.TYPE_PART[this.item.type];
    const hasRows = modifierArrayKeys(this.item).length > 0;
    return [...before, ...(body ? [body] : []), ...after.filter((id) => id !== 'modifiers' || hasRows)];
  }

  /** @override Render only the frame parts and the body part for this item's type. */
  _configureRenderOptions(options) {
    super._configureRenderOptions(options);
    const allowed = this.itemParts;
    const requested = Array.isArray(options.parts) ? options.parts : allowed;
    options.parts = allowed.filter((id) => requested.includes(id));
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    // Builders normalise and decorate the system data; they work on a copy so nothing leaks into the document.
    context.system = cloneSystem(item.system);
    const [skills, buffs, debuffs, spells, tables] = await Promise.all([
      getCompendiumSkills(), getAvailableBuffs(), getAvailableDebuffs(), getAvailableSpells(), getAvailableRollTables()
    ]);
    buildCommonContext(context, item, { skills, buffs, debuffs, spells, tables });
    // An `enchant_item` outcome may roll any table, so its picker also lists the table packs.
    if ((Array.isArray(item.system?.outcomes) ? item.system.outcomes : []).some((o) => o?.type === 'enchant_item')) {
      context.availableEnchantTables = await getAvailableRollTables({ packs: true });
    }
    // A loot box's table pickers list the world's tables and the table packs; only the GM sees the rows.
    if (item.type === 'loot' && isLootBoxType(item.system?.lootType) && globalThis.game?.user?.isGM) {
      context.availableBoxTables = await getAvailableRollTables({ packs: true });
    }
    buildRowEditorContext(context, item, { preview: this._rowPreview });
    this.constructor.CONTEXT_BUILDERS[item.type]?.(context, item);
    // Descriptions are rich text: the editor helper takes the enriched HTML.
    if (typeof item.system?.description === 'string') {
      const TE = foundry.applications.ux.TextEditor.implementation;
      context.descriptionHtml = await TE.enrichHTML(item.system?.description ?? '', { relativeTo: item, secrets: item.isOwner });
    }
    buildTimingContext(context, item);
    await buildSummaryContext(context, item);
    return context;
  }

  /** @override A space's occupant cannot edit its table, but can still buy a tier or apply a coupon with their own crawler. */
  async _onRender(context, options) {
    await super._onRender(context, options);
    if (this.isEditable || !canManageTable(this.item)) return;
    for (const action of ['buyTableTier', 'applyTableCoupon']) {
      for (const button of this.element?.querySelectorAll?.(`[data-action="${action}"]`) ?? []) button.disabled = false;
    }
  }

  /** @override Pressing Enter in the new-tag input adds the tag. */
  async _attachPartListeners(partId, htmlElement, options) {
    await super._attachPartListeners(partId, htmlElement, options);
    if (partId !== 'tags') return;
    htmlElement.querySelector('[data-tag-entry] input')?.addEventListener('keydown', (event) => this._onTagInputKeydown(event));
  }

  /** Enter in the new-tag input adds its text as a tag instead of submitting the form. */
  async _onTagInputKeydown(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (!this.isEditable) return;
    await addTagFromInput(this.item, event.currentTarget ?? event.target);
  }

  /** @override Row tables, comma lists and rank breaks are normalised; players cannot set `system.value`. */
  _processFormData(event, form, formData, ...rest) {
    const data = super._processFormData(event, form, formData, ...rest);
    return processItemFormData(this.item, data, {
      isGM: Boolean(globalThis.game?.user?.isGM)
    });
  }

  /**
   * @override Dropping a skill or spell on gear adds a skill/spell bonus row (`grants`, by identifier): a new skill
   * row is +1, a new spell row grants the spell at Rank 1, and dropping one the gear already names adds +1 to it.
   */
  async _onDropItem(event, item) {
    if (this.isEditable && this.item?.type === 'loot' && isLootBoxType(this.item.system?.lootType)) return dropBoxItem(this.item, item);
    if (this.isEditable && this.item?.type === 'achievement') return dropRewardBoxTemplate(this.item, item);
    if (this.isEditable && this.item?.type === 'loot' && isBlueprintLootType(this.item.system?.lootType)) return this.#dropBlueprintOutput(item);
    if (!this.isEditable || this.item?.type !== 'gear' || !GEAR_GRANT_KINDS.includes(item?.type)) return null;
    const identifier = itemIdentifier(item);
    if (!identifier) return null;
    const label = String(item.name ?? '').trim();
    const { rows, row } = addGearGrant(this.item.system?.grants, { kind: item.type, identifier, label }, { value: 1 });
    if (!row) return null;
    await this.item.update({ 'system.grants': rows });
    globalThis.ui?.notifications?.info(`Added "${label || identifier}" ${item.type} bonus to ${this.item.name}.`);
    return rows;
  }

  /** @override A RollTable dropped on a loot box becomes a `table` row (7.3d); everything else keeps the base routing. */
  async _onDropDocument(event, doc) {
    if (doc?.documentName === 'RollTable') {
      if (this.isEditable && this.item?.type === 'loot' && isLootBoxType(this.item.system?.lootType)) return dropBoxTable(this.item, doc);
      return null;
    }
    return super._onDropDocument(event, doc);
  }

  /** Dropping an item on a blueprint names it as the item the blueprint makes (item mode). */
  async #dropBlueprintOutput(item) {
    if (!item?.name) return null;
    const output = { uuid: String(item.uuid ?? ''), identifier: itemIdentifier(item), name: String(item.name) };
    await this.item.update({ 'system.blueprint.output': output, 'system.blueprint.mode': 'item' });
    return output;
  }
}
