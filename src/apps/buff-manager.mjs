/**
 * Sprinter RPG — Buff & Debuff Condition Manager Application
 * Centralized interface for browsing, inspecting, and applying status effects, buffs, and debuffs.
 */
import { COGToolApp } from './tool-app.mjs';
import { CatalogBrowserMixin } from './catalog-browser.mjs';
import { SYSTEM_PATH } from '../constants.mjs';
import { searchRows } from '../content/unified-catalog.mjs';
import { classifyBuff } from '../utils/effects/buff-classify.mjs';
import { describeItem, summaryText } from '../utils/item-describer/index.mjs';
import { htmlSnippet } from '../utils/ui/html-snippet.mjs';

/** Whether an entry belongs on the Stat or Defense tab, by its structured kinds (`classifyBuff`). */
const TAB_KINDS = { stat: ['stat'], defense: ['resistance', 'immunity', 'tempHp'] };
function inTab(entry, tab) {
  return (entry.kinds ?? classifyBuff(entry.system)).some(k => TAB_KINDS[tab].includes(k));
}

export class COGBuffDebuffManager extends CatalogBrowserMixin(COGToolApp) {
  static CATALOG = {
    kind: 'condition',
    collection: 'buffs',
    list: 'getUnifiedConditions',
    search: { input: '.condition-search-input', clear: '.condition-search-clear', parts: ['list'] }
  };

  static DEFAULT_OPTIONS = {
    id: 'cog-buff-manager',
    classes: ['cog-sheet-window', 'cog-buff-manager-window'],
    position: { width: 780, height: 720 },
    window: { title: 'Sprinter RPG — Buff & Condition Library', icon: 'fa-solid fa-shield-virus', resizable: true },
    actions: {
      setTab: COGBuffDebuffManager.#onSetTab,
      applyCondition: COGBuffDebuffManager.#onApplyCondition
    }
  };

  // The search box lives in `controls`; typing re-renders only `list`, so the input keeps focus and caret.
  static PARTS = {
    controls: { template: `${SYSTEM_PATH}/templates/apps/buff-manager/controls.hbs` },
    list: { template: `${SYSTEM_PATH}/templates/apps/buff-manager/list.hbs`, scrollable: [''] }
  };

  constructor(options = {}) {
    super(options);
    this.targetSlot = options.targetSlot ?? null;
    this.activeTab = options.activeTab || 'all';
  }

  /** Buffs and debuffs from the registered definitions, world items and the bound actor's own, sorted by type then name. */
  getUnifiedConditions() {
    return this.catalogRows();
  }

  /** @override */
  async decorateRow(row) {
    // Active on the bound actor: an owned item of the entry's type (by id, compendium id or identifier; a rename changes none
    // of them), or a buff slot holding its id or identifier. Names are never compared.
    const rawExternal = this.actor?.system?.attributes?.externalBuffs || {};
    const slotRefs = new Set(Object.values(rawExternal).map(v => String(v ?? '').trim()).filter(Boolean));
    const isBuff = row.type === 'buff';
    const isDebuff = row.type === 'debuff';
    const isAssignedSlot = isBuff && (slotRefs.has(String(row.id)) || Boolean(row.identifier) && slotRefs.has(row.identifier));
    const sys = row.system || {};
    return {
      ...row,
      kinds: classifyBuff(sys),
      isBuff,
      isDebuff,
      isActive: row.isOwned || isAssignedSlot,
      // What the entry does, from the shared describer (these are catalog and world entries, so no owner)
      summary: summaryText(await describeItem(row)),
      severityBadge: isDebuff ? (sys.severity === 'Major' ? 'cog-badge-attack' : 'cog-badge-item') : 'cog-badge-gear'
    };
  }

  /** The strings the search box matches against (the description is HTML; the row shows its plain text). */
  searchText(c) {
    return [c.name, htmlSnippet(c.system?.description), c.summary];
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const allConditions = await this.getUnifiedConditions();

    const counts = {
      all: allConditions.length,
      buffs: allConditions.filter(c => c.isBuff).length,
      debuffs: allConditions.filter(c => c.isDebuff).length,
      stat: allConditions.filter(c => inTab(c, 'stat')).length,
      defense: allConditions.filter(c => inTab(c, 'defense')).length
    };

    const filtered = searchRows(allConditions, this.searchQuery, (c) => this.searchText(c)).filter(c => {
      if (this.activeTab === 'buffs' && !c.isBuff) return false;
      if (this.activeTab === 'debuffs' && !c.isDebuff) return false;
      return !((this.activeTab === 'stat' || this.activeTab === 'defense') && !inTab(c, this.activeTab));
    });

    return Object.assign(context, {
      // The description is HTML; the row shows its plain text on one line
      conditions: filtered.map(c => ({ ...c, descriptionText: htmlSnippet(c.system?.description) })),
      counts,
      activeTab: this.activeTab,
      targetSlot: this.targetSlot
    });
  }

  /**
   * Apply selected condition to the actor.
   * @param {object} itemData
   */
  async applyConditionToActor(itemData) {
    if (!this.actor) {
      globalThis.ui?.notifications?.warn('No character sheet open to apply this condition.');
      return;
    }

    if (itemData.type === 'buff') {
      // If targeting a specific external buff slot
      const buffId = itemData.id || itemData._id || itemData.name;
      if (this.targetSlot) {
        await this.actor.update({ [`system.attributes.externalBuffs.${this.targetSlot}`]: buffId });
        globalThis.ui?.notifications?.info(`Assigned "${itemData.name}" to slot ${this.targetSlot} on ${this.actor.name}.`);
        if (typeof this.close === 'function') this.close();
        return;
      }

      // Check for an empty external buff slot first
      const rawExternal = this.actor.system?.attributes?.externalBuffs || {};
      let emptySlot = null;
      for (const slot of ['buff1', 'buff2', 'buff3']) {
        if (!rawExternal[slot]) {
          emptySlot = slot;
          break;
        }
      }

      if (emptySlot) {
        await this.actor.update({ [`system.attributes.externalBuffs.${emptySlot}`]: buffId });
        globalThis.ui?.notifications?.info(`Activated "${itemData.name}" in external buff slot on ${this.actor.name}.`);
      } else {
        // Embed item on actor inventory
        await this.#embed(itemData, `Added "${itemData.name}" to ${this.actor.name} buffs.`);
        return;
      }
    } else if (itemData.type === 'debuff') {
      await this.#embed(itemData, `Inflicted "${itemData.name}" condition on ${this.actor.name}.`);
      return;
    }

    if (typeof this.render === 'function') this.render();
  }

  /** Embed the condition on the actor: the full source document with its compendium link, then render. */
  #embed(row, message) {
    // A debuff is found in the `debuffs` catalog but packed with the buffs.
    return this.addRowToActor(row, {
      mutate: (payload) => ({ ...payload, type: row.type }),
      message,
      collection: row.type === 'debuff' ? 'debuffs' : 'buffs',
      category: 'buffs'
    });
  }

  static async #onSetTab(event, target) {
    this.activeTab = target.dataset.tab || 'all';
    await this.render();
  }

  static async #onApplyCondition(event, target) {
    const condId = target.dataset.id;
    const condType = target.dataset.type;
    if (!condId) return;
    const match = await this.rowById(condId, condType);
    if (match) {
      await this.applyConditionToActor(match);
    }
  }
}
