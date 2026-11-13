/**
 * Sprinter RPG — Item & Equipment Library / Manager Application
 * Centralized interface for browsing, selecting, creating, and managing
 * physical gear (weapons, armor, accessories), consumables, potions, wands, and scrolls.
 */
import { COGToolApp } from './tool-app.mjs';
import { CatalogBrowserMixin } from './catalog-browser.mjs';
import { SYSTEM_PATH } from '../constants.mjs';
import { searchRows } from '../content/unified-catalog.mjs';
import { SOURCE_INDEX_FIELD } from '../utils/content-source.mjs';
import { describeItem, summaryText } from '../utils/item-describer/index.mjs';
import { isScratchLootType, lootTypeLabel } from '../models/items/loot-model.mjs';
import { cooldownBadge } from '../utils/time/cooldown-badge.mjs';
import { currentTimeContext } from '../documents/actor/dungeon-time.mjs';
import { GEAR_SLOTS } from '../utils/gear/gear-slots.mjs';
import { ITEM_CATEGORIES, itemCategoryOf } from '../utils/gear/item-category.mjs';
import { htmlSnippet } from '../utils/ui/html-snippet.mjs';
import { INVENTORY_ITEM_TYPES } from '../utils/document-types.mjs';


const TPL = `${SYSTEM_PATH}/templates/apps/item-manager`;

/**
 * Index fields the item cards read (badge, mechanics summary, cooldown and spell labels, snippet). A pack index returns only
 * what is requested, so every `system.*` field the card or its filters read belongs here.
 */
export const ITEM_MANAGER_INDEX_FIELDS = Object.freeze([
  'type', 'img', 'system.value', 'system.quantity', 'system.slot', 'system.lootType',
  'system.equipped', 'system.isWeapon', 'system.drBonus',
  'system.damageModifiers', 'system.defenseModifiers', 'system.attackModifiers', 'system.checkModifiers',
  'system.baseDamage', 'system.charges', 'system.outcomes', 'system.notes', 'system.description',
  'system.cooldown', 'system.rankBreaks', 'system.spellName', 'system.spellIdentifier', 'system.identifier', SOURCE_INDEX_FIELD
]);

export class COGItemManager extends CatalogBrowserMixin(COGToolApp) {
  static CATALOG = {
    kind: 'item',
    fields: ITEM_MANAGER_INDEX_FIELDS,
    collection: 'items',
    list: 'getUnifiedItems',
    search: { input: '.item-search-input', clear: '.item-search-clear', parts: ['list', 'footer'] }
  };

  static DEFAULT_OPTIONS = {
    id: 'cog-item-manager',
    classes: ['cog-sheet-window', 'cog-item-manager-window'],
    position: { width: 860, height: 780 },
    window: { title: 'Sprinter RPG — Item & Equipment Library', icon: 'fa-solid fa-shield-halved', resizable: true },
    actions: {
      setCategory: COGItemManager.#onSetCategory,
      setSlot: COGItemManager.#onSetSlot,
      addItem: COGItemManager.#onAddItem,
      previewItem: COGItemManager.#onPreviewItem,
      createCustomGear: COGItemManager.#onCreateCustomGear,
      createCustomLoot: COGItemManager.#onCreateCustomLoot
    }
  };

  // The search box lives in `controls`; typing re-renders only `list` and `footer`, so the input keeps focus and caret.
  static PARTS = {
    controls: { template: `${TPL}/controls.hbs` },
    list: { template: `${TPL}/list.hbs`, scrollable: [''] },
    footer: { template: `${TPL}/footer.hbs` }
  };

  constructor(options = {}) {
    super(options);
    this.onSelect = options.onSelect || null;
    this.activeCategory = options.activeCategory || options.activeType || 'all';
    this.activeSlot = options.activeSlot || 'all';
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    // Item cards are drag sources; the root persists across part re-renders, so delegate once.
    this.element.addEventListener('dragstart', (event) => {
      if (event.target?.closest?.('.cog-item-card-draggable')) this._onDragStart(event);
    });
  }

  /** Gear and loot from the packs, the registered definitions and the world; a world copy merges into its source by link. */
  getUnifiedItems() {
    return this.catalogRows();
  }

  /** @override */
  async _prepareContext(options = {}) {
    const context = await super._prepareContext(options);
    const rawItems = await this.getUnifiedItems();
    const canSeeValue = this.actor ? (typeof this.actor.canSeeItemValue === 'function' ? this.actor.canSeeItemValue() : true) : true;

    const now = currentTimeContext(this.actor);

    // What each item does, from the shared describer (unowned: these are catalog and world entries)
    const summaries = await Promise.all(rawItems.map(async item => summaryText(await describeItem(item))));

    // Build decorated item list
    const decoratedItems = rawItems.map((item, index) => {
      const sys = item.system || {};
      const type = item.type || 'gear';
      const slot = String(sys.slot || 'torso').toLowerCase().trim();
      const lootType = String(sys.lootType || 'consumable').toLowerCase().trim();
      const category = itemCategoryOf(item);
      const isWeapon = category === 'weapons';
      const goldVal = Number(sys.value) || 0;
      const displayValue = canSeeValue ? `${goldVal} GP` : '???';

      // The owned copy on the current actor
      const match = item.ownedItem;
      const ownedQty = match ? Number(match.system?.quantity) || 1 : 0;
      const cooldownBadgeView = match ? cooldownBadge(this.actor, match, now) : null;

      // Format badges & summaries
      let badgeLabel;
      let badgeColor;
      if (type === 'gear') {
        if (isWeapon) {
          badgeLabel = 'WEAPON';
          badgeColor = 'var(--cog-warning-fill)';
        } else if (slot === 'accessory') {
          badgeLabel = 'ACCESSORY';
          badgeColor = 'var(--cog-magic-fill)';
        } else {
          badgeLabel = `ARMOR (${slot.toUpperCase()})`;
          badgeColor = 'var(--cog-info-fill)';
        }
      } else {
        badgeLabel = lootTypeLabel(lootType).toUpperCase();
        if (lootType === 'scroll') {
          badgeColor = 'var(--cog-header-fill)';
        } else if (lootType === 'wand') {
          badgeColor = 'var(--cog-magic-fill)';
        } else if (isScratchLootType(lootType)) {
          badgeColor = 'var(--cog-gold-fill)';
        } else {
          badgeColor = 'var(--cog-success-fill)';
        }
      }

      return {
        ...item,
        slot,
        lootType,
        isWeapon,
        category,
        goldVal,
        displayValue,
        canSeeValue,
        ownedQty,
        cooldownBadge: cooldownBadgeView,
        badgeLabel,
        badgeColor,
        mechanicsSummary: summaries[index],
        descriptionSnippet: sys.notes || htmlSnippet(sys.description)
      };
    });

    // Category counts and the active category's filter, from the shared classifier
    const counts = { all: decoratedItems.length, gear: 0, loot: 0 };
    for (const { id } of ITEM_CATEGORIES) counts[id] = 0;
    for (const i of decoratedItems) {
      if (i.type in counts) counts[i.type] += 1;
      if (i.category) counts[i.category] += 1;
    }

    const cat = this.activeCategory;
    let filtered = decoratedItems;
    if (INVENTORY_ITEM_TYPES.includes(cat)) filtered = filtered.filter(i => i.type === cat);
    else if (cat !== 'all') filtered = filtered.filter(i => i.category === cat);

    // Filter by specific gear slot if selected
    if (this.activeSlot !== 'all') {
      filtered = filtered.filter(i => i.type === 'gear' && i.slot === this.activeSlot);
    }

    // Filter by search query
    filtered = searchRows(filtered, this.searchQuery, (i) => [i.name, i.descriptionSnippet, i.mechanicsSummary, i.badgeLabel]);

    // Sort alphabetically by name
    filtered.sort((a, b) => a.name.localeCompare(b.name));

    return Object.assign(context, {
      actor: this.actor,
      items: filtered,
      activeCategory: this.activeCategory,
      activeSlot: this.activeSlot,
      counts,
      canSeeValue,
      slots: [{ key: 'all', label: 'All Slots' }, ...Object.values(GEAR_SLOTS).map((s) => ({ key: s.id, label: s.label }))]
    });
  }

  /**
   * Add a selected item to the current crawler's inventory.
   * @param {object} itemData
   * @returns {Promise<COGItem|null>}
   */
  addItemToActor(itemData) {
    return this.addRowToActor(itemData, {
      noActorMessage: 'No actor bound to add this item to!',
      message: this.actor ? `Added "${itemData.name}" to ${this.actor.name}'s inventory.` : undefined
    });
  }

  /**
   * Open modal dialog to create a custom Gear or Loot item.
   * @param {'gear'|'loot'} type
   */
  async createCustomItem(type = 'gear') {
    const isGear = type === 'gear';
    const defaultIcon = isGear ? 'icons/svg/shield.svg' : 'icons/svg/item-bag.svg';
    const name = isGear ? 'New Custom Gear' : 'New Custom Item';

    const itemData = {
      name,
      type: isGear ? 'gear' : 'loot',
      img: defaultIcon,
      system: isGear ? {
        slot: 'torso',
        drBonus: 0,
        isWeapon: false,
        quantity: 1,
        equipped: false,
        critMultiplier: 1
      } : {
        lootType: 'consumable',
        quantity: 1,
        cooldown: { value: 0, unit: '' },
        outcomes: []
      }
    };

    return this.createBlankDocument(itemData);
  }

  static async #onSetCategory(event, target) {
    this.activeCategory = target.dataset.category || 'all';
    await this.render();
  }

  static async #onSetSlot(event, target) {
    this.activeSlot = target.value || 'all';
    await this.render();
  }

  /** Add Item to Actor Inventory */
  static async #onAddItem(event, target) {
    // The card row carries the item's id; the buttons inside it resolve through the row, never by name.
    const match = await this.rowById(target.closest('[data-item-id]')?.dataset.itemId);
    if (match) {
      await this.addItemToActor(match);
    }
  }

  /** Preview Item / Open Sheet */
  static async #onPreviewItem(event, target) {
    // The card row carries the item's id; the buttons inside it resolve through the row, never by name.
    const match = await this.rowById(target.closest('[data-item-id]')?.dataset.itemId);
    if (match) {
      if (CONFIG.Item?.documentClass) {
        const tempDoc = new CONFIG.Item.documentClass(match);
        if (typeof tempDoc.sheet?.render === 'function') {
          tempDoc.sheet.render({ force: true });
          return;
        }
      }
      globalThis.ui?.notifications?.info?.(`Item: ${match.name} (${match.type})`);
    }
  }

  static async #onCreateCustomGear() {
    await this.createCustomItem('gear');
  }

  static async #onCreateCustomLoot() {
    await this.createCustomItem('loot');
  }

  /** Fill the drag payload for the item card under the pointer. */
  _onDragStart(event) {
    const el = event.target?.closest?.('.cog-item-card-draggable') ?? event.currentTarget;
    const itemName = el.dataset.itemName;
    if (!itemName) return;

    // The card carries the item's id: resolve by id (world item, else registered definition), never by name.
    const dragData = this.dragPayload(el.dataset.itemId, itemName, { type: 'gear', img: 'icons/svg/item-bag.svg', flags: true });
    event.dataTransfer?.setData('text/plain', JSON.stringify(dragData));
  }
}
