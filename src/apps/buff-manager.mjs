/**
 * Sprinter RPG — Buff & Debuff Condition Manager Application
 * Centralized interface for browsing, inspecting, and applying status effects, buffs, and debuffs.
 */
import { catalogEntries } from '../content/catalog-lookup.mjs';
import { contentRegistry } from '../content/registry.mjs';
import { COGToolApp } from './tool-app.mjs';
import { SYSTEM_ID, SYSTEM_PATH } from '../constants.mjs';
import { classifyBuff } from '../utils/buff-classify.mjs';
import { describeItem, summaryText } from '../utils/item-describer/index.mjs';
import { htmlSnippet } from './item-manager.mjs';

/** Whether an entry belongs on the Stat or Defense tab, by its structured kinds (`classifyBuff`). */
const TAB_KINDS = { stat: ['stat'], defense: ['resistance', 'immunity', 'tempHp'] };
function inTab(entry, tab) {
  return (entry.kinds ?? classifyBuff(entry.system)).some(k => TAB_KINDS[tab].includes(k));
}

export class COGBuffDebuffManager extends COGToolApp {
  static DEFAULT_OPTIONS = {
    id: 'cog-buff-manager',
    classes: ['cog-sheet-window', 'cog-buff-manager-window'],
    position: { width: 780, height: 720 },
    window: { title: 'Sprinter RPG — Buff & Condition Library', icon: 'fa-solid fa-shield-virus', resizable: true },
    actions: {
      setSearch: COGBuffDebuffManager.#onSetSearch,
      clearSearch: COGBuffDebuffManager.#onClearSearch,
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
    this.actor = options.actor || null;
    this.targetSlot = options.targetSlot ?? null;
    this.activeTab = options.activeTab || 'all';
    this.searchQuery = '';
  }

  /**
   * Retrieve unified list of buffs and debuffs from CONFIG, compendiums, and world items.
   * @returns {Promise<Array<object>>}
   */
  async getUnifiedConditions() {
    const list = [];

    // 1. Buffs from CONFIG.COG.buffs
    const configBuffs = catalogEntries('buffs');
    for (const b of configBuffs) {
      list.push({
        id: b._id || b.name,
        name: b.name,
        type: 'buff',
        img: b.img || 'icons/svg/aura.svg',
        source: 'compendium',
        system: structuredClone(b.system || {})
      });
    }

    // 2. Debuffs from CONFIG.COG.debuffs
    const configDebuffs = catalogEntries('debuffs');
    for (const d of configDebuffs) {
      list.push({
        id: d._id || d.name,
        name: d.name,
        type: 'debuff',
        img: d.img || 'icons/svg/skull.svg',
        source: 'compendium',
        system: structuredClone(d.system || {})
      });
    }

    // 3. World Items (Buffs & Debuffs)
    if (typeof game !== 'undefined' && game.items) {
      for (const item of game.items) {
        if (item.type === 'buff' || item.type === 'debuff') {
          const norm = item.name.toLowerCase().trim();
          if (!list.some(c => c.name.toLowerCase().trim() === norm && c.type === item.type)) {
            list.push({
              id: item.id,
              name: item.name,
              type: item.type,
              img: item.img || (item.type === 'buff' ? 'icons/svg/aura.svg' : 'icons/svg/skull.svg'),
              source: 'world',
              system: structuredClone(item.system || {})
            });
          }
        }
      }
    }

    // 4. Actor-Specific Items (Buffs & Debuffs on Actor)
    if (this.actor?.items) {
      for (const item of this.actor.items) {
        if (item.type === 'buff' || item.type === 'debuff') {
          const norm = item.name?.toLowerCase().trim();
          if (!list.some(c => c.id === item.id || (c.name?.toLowerCase().trim() === norm && c.type === item.type))) {
            list.push({
              id: item.id,
              name: item.name,
              type: item.type,
              img: item.img || (item.type === 'buff' ? 'icons/svg/aura.svg' : 'icons/svg/skull.svg'),
              source: 'actor',
              system: structuredClone(item.system || {})
            });
          }
        }
      }
    }

    // Determine if active on bound actor
    const ownedItemNames = new Set(
      this.actor?.items?.map(i => `${i.type}:${i.name.toLowerCase().trim()}`) ?? []
    );

    // Also check externalBuffs slots for buffs
    const rawExternal = this.actor?.system?.attributes?.externalBuffs || {};
    const externalBuffVals = Object.values(rawExternal).map(v => String(v).toLowerCase().trim()).filter(Boolean);

    return (await Promise.all(list.map(async entry => {
      const norm = entry.name.toLowerCase().trim();
      const isOwned = ownedItemNames.has(`${entry.type}:${norm}`);
      const isAssignedSlot = entry.type === 'buff' && externalBuffVals.some(v => v === norm || v === entry.id.toLowerCase());
      const isBuff = entry.type === 'buff';
      const isDebuff = entry.type === 'debuff';

      // What the entry does, from the shared describer (these are catalog and world entries, so no owner)
      const sys = entry.system || {};
      const summary = summaryText(await describeItem(entry));

      return {
        ...entry,
        kinds: classifyBuff(sys),
        isBuff,
        isDebuff,
        isActive: isOwned || isAssignedSlot,
        summary,
        severityBadge: isDebuff ? (sys.severity === 'Major' ? 'cog-badge-attack' : 'cog-badge-item') : 'cog-badge-gear'
      };
    }))).sort((a, b) => {
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      return a.name.localeCompare(b.name);
    });
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

    const filtered = allConditions.filter(c => {
      if (this.activeTab === 'buffs' && !c.isBuff) return false;
      if (this.activeTab === 'debuffs' && !c.isDebuff) return false;
      if ((this.activeTab === 'stat' || this.activeTab === 'defense') && !inTab(c, this.activeTab)) return false;

      const q = (this.searchQuery || '').toLowerCase().trim();
      if (q) {
        const nameMatch = c.name.toLowerCase().includes(q);
        const descMatch = htmlSnippet(c.system?.description).toLowerCase().includes(q);
        const summMatch = (c.summary || '').toLowerCase().includes(q);
        if (!nameMatch && !descMatch && !summMatch) return false;
      }
      return true;
    });

    return Object.assign(context, {
      // The description is HTML; the row shows its plain text on one line
      conditions: filtered.map(c => ({ ...c, descriptionText: htmlSnippet(c.system?.description) })),
      counts,
      activeTab: this.activeTab,
      searchQuery: this.rawSearchQuery !== undefined ? this.rawSearchQuery : this.searchQuery,
      targetSlot: this.targetSlot,
      actor: this.actor,
      isActorPicker: Boolean(this.actor)
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
        const uuid = itemData.uuid || (itemData._id ? `Compendium.${contentRegistry.getPackId('buffs') ?? `${SYSTEM_ID}.buffs`}.${itemData._id}` : undefined);
        await this.actor.createEmbeddedDocuments('Item', [{
          name: itemData.name,
          type: 'buff',
          img: itemData.img,
          system: structuredClone(itemData.system || {}),
          flags: {
            core: { sourceId: uuid },
            [SYSTEM_ID]: {
              compendiumId: itemData._id || itemData.id,
              sourceUuid: uuid
            }
          }
        }]);
        globalThis.ui?.notifications?.info(`Added "${itemData.name}" to ${this.actor.name} buffs.`);
      }
    } else if (itemData.type === 'debuff') {
      // Embed debuff item directly on actor
      const uuid = itemData.uuid || (itemData._id ? `Compendium.${contentRegistry.getPackId('buffs') ?? `${SYSTEM_ID}.buffs`}.${itemData._id}` : undefined);
      await this.actor.createEmbeddedDocuments('Item', [{
        name: itemData.name,
        type: 'debuff',
        img: itemData.img,
        system: structuredClone(itemData.system || {}),
        flags: {
          core: { sourceId: uuid },
          [SYSTEM_ID]: {
            compendiumId: itemData._id || itemData.id,
            sourceUuid: uuid
          }
        }
      }]);
      globalThis.ui?.notifications?.info(`Inflicted "${itemData.name}" condition on ${this.actor.name}.`);
    }

    if (typeof this.render === 'function') this.render();
  }

  static async #onSetSearch(event, target) {
    const val = target.value ?? '';
    this.rawSearchQuery = val;
    this.searchQuery = String(val).toLowerCase().trim();
    // The clear control sits in the (not re-rendered) controls part: toggle it in place.
    this.element?.querySelector?.('.condition-search-clear')?.toggleAttribute('hidden', !val);
    await this.render({ parts: ['list'] });
  }

  static async #onClearSearch() {
    this.rawSearchQuery = '';
    this.searchQuery = '';
    await this.render();
    this.element?.querySelector?.('.condition-search-input')?.focus?.();
  }

  static async #onSetTab(event, target) {
    this.activeTab = target.dataset.tab || 'all';
    await this.render();
  }

  static async #onApplyCondition(event, target) {
    const condId = target.dataset.id;
    const condType = target.dataset.type;
    if (!condId) return;
    const all = await this.getUnifiedConditions();
    const match = all.find(c => String(c.id) === String(condId) && c.type === condType);
    if (match) {
      await this.applyConditionToActor(match);
    }
  }
}
