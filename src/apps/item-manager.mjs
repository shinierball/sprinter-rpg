/**
 * Sprinter RPG — Item & Equipment Library / Manager Application
 * Centralized interface for browsing, selecting, creating, and managing
 * physical gear (weapons, armor, accessories), consumables, potions, wands, and scrolls.
 */
import { COGToolApp } from './tool-app.mjs';
import { catalogEntries } from '../content/catalog-lookup.mjs';
import { SYSTEM_ID, SYSTEM_PATH } from '../constants.mjs';
import { resolveFullItemData, resolveManagerSource, getCompendiumEntries } from './manager-source.mjs';
import { describeItem, summaryText } from '../utils/item-describer/index.mjs';
import { isScratchLootType, lootTypeLabel } from '../models/items/loot-model.mjs';
import { cooldownBadge } from '../utils/cooldown-badge.mjs';
import { currentTimeContext } from '../documents/actor/dungeon-time.mjs';


const TPL = `${SYSTEM_PATH}/templates/apps/item-manager`;

/**
 * Index fields the item cards read (badge, mechanics summary, cooldown and spell labels, snippet). A pack index returns only
 * what is requested, so every `system.*` field the card or its filters read belongs here.
 */
export const ITEM_MANAGER_INDEX_FIELDS = Object.freeze([
  'type', 'img', 'system.value', 'system.quantity', 'system.slot', 'system.lootType',
  'system.equipped', 'system.isWeapon', 'system.drBonus',
  'system.damageModifiers', 'system.defenseModifiers', 'system.attackModifiers', 'system.checkModifiers',
  'system.damageParts', 'system.charges', 'system.outcomes', 'system.notes', 'system.description',
  'system.cooldown', 'system.rankBreaks', 'system.spellName', 'system.spellIdentifier'
]);

/** Plain text of an HTML description for a one-line card snippet. */
export function htmlSnippet(html) {
  const raw = String(html ?? '');
  if (!raw) return '';
  if (typeof DOMParser !== 'undefined') {
    return (new DOMParser().parseFromString(raw, 'text/html').body.textContent || '').replace(/\s+/g, ' ').trim();
  }
  return raw.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

export class COGItemManager extends COGToolApp {
  static DEFAULT_OPTIONS = {
    id: 'cog-item-manager',
    classes: ['cog-sheet-window', 'cog-item-manager-window'],
    position: { width: 860, height: 780 },
    window: { title: 'Sprinter RPG — Item & Equipment Library', icon: 'fa-solid fa-shield-halved', resizable: true },
    actions: {
      setSearch: COGItemManager.#onSetSearch,
      clearSearch: COGItemManager.#onClearSearch,
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
    this.actor = options.actor || null;
    this.onSelect = options.onSelect || null;
    this.activeCategory = options.activeCategory || options.activeType || 'all';
    this.activeSlot = options.activeSlot || 'all';
    this.searchQuery = '';
    this.rawSearchQuery = '';
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    // Item cards are drag sources; the root persists across part re-renders, so delegate once.
    this.element.addEventListener('dragstart', (event) => {
      if (event.target?.closest?.('.cog-item-card-draggable')) this._onDragStart(event);
    });
  }

  /**
   * Retrieve all items and gear from compendium packs, official CONFIG datasets, and world items.
   * @returns {Promise<Array<object>>}
   */
  async getUnifiedItems() {
    const itemsMap = new Map();

    // 1. From the registered item packs
    const index = await getCompendiumEntries('items', { fields: ITEM_MANAGER_INDEX_FIELDS });
    for (const entry of index) {
      const key = entry.name.toLowerCase().trim();
      itemsMap.set(key, {
        id: entry._id,
        _id: entry._id,
        name: entry.name,
        type: entry.type || 'gear',
        img: entry.img || (entry.type === 'gear' ? 'icons/svg/shield.svg' : 'icons/svg/item-bag.svg'),
        source: 'compendium',
        isCompendium: true,
        isWorld: false,
        system: structuredClone(entry.system || {})
      });
    }

    // 2. From the registered item definitions
    for (const it of catalogEntries('items')) {
      const key = it.name.toLowerCase().trim();
      if (!itemsMap.has(key)) {
        itemsMap.set(key, {
          id: it._id || it.id || key,
          _id: it._id || it.id || key,
          name: it.name,
          type: it.type || 'gear',
          img: it.img || (it.type === 'gear' ? 'icons/svg/shield.svg' : 'icons/svg/item-bag.svg'),
          source: 'canonical',
          isCompendium: true,
          isWorld: false,
          system: structuredClone(it.system || {})
        });
      }
    }

    // 3. World Items (User-created or imported gear/loot)
    if (typeof game !== 'undefined' && game.items) {
      for (const it of game.items) {
        if (it.type !== 'gear' && it.type !== 'loot') continue;
        const key = it.name.toLowerCase().trim();
        if (!itemsMap.has(key)) {
          itemsMap.set(key, {
            id: it.id || it._id,
            _id: it.id || it._id,
            name: it.name,
            type: it.type,
            img: it.img || (it.type === 'gear' ? 'icons/svg/shield.svg' : 'icons/svg/item-bag.svg'),
            source: 'world',
            isCompendium: false,
            isWorld: true,
            system: (typeof it.toObject === 'function') ? it.toObject().system : structuredClone(it.system || {})
          });
        }
      }
    }

    return Array.from(itemsMap.values());
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
      const isWeapon = Boolean(sys.isWeapon || slot === 'hands' || (sys.damageParts && sys.damageParts.length > 0));
      const goldVal = Number(sys.value) || 0;
      const displayValue = canSeeValue ? `${goldVal} GP` : '???';

      // Check ownership on current actor
      let isOwned = false;
      let ownedQty = 0;
      let cooldownBadgeView = null;
      const ownedItems = this.actor?.items ?? null;
      if (ownedItems) {
        const match = ownedItems.find(i => (i.id === item.id || i._id === item.id) || i.flags?.[SYSTEM_ID]?.compendiumId === item.id);
        if (match) {
          isOwned = true;
          ownedQty = Number(match.system?.quantity) || 1;
          cooldownBadgeView = cooldownBadge(this.actor, match, now);
        }
      }

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
        goldVal,
        displayValue,
        canSeeValue,
        isOwned,
        ownedQty,
        cooldownBadge: cooldownBadgeView,
        badgeLabel,
        badgeColor,
        mechanicsSummary: summaries[index],
        descriptionSnippet: htmlSnippet(sys.notes || sys.description || '')
      };
    });

    // Compute category counts
    const counts = {
      all: decoratedItems.length,
      gear: decoratedItems.filter(i => i.type === 'gear').length,
      weapons: decoratedItems.filter(i => i.type === 'gear' && i.isWeapon).length,
      armor: decoratedItems.filter(i => i.type === 'gear' && !i.isWeapon && i.slot !== 'accessory').length,
      accessories: decoratedItems.filter(i => i.type === 'gear' && i.slot === 'accessory').length,
      loot: decoratedItems.filter(i => i.type === 'loot').length,
      consumables: decoratedItems.filter(i => i.type === 'loot' && (i.lootType === 'consumable' || i.lootType === 'potion')).length,
      scrolls: decoratedItems.filter(i => i.type === 'loot' && i.lootType === 'scroll').length,
      wands: decoratedItems.filter(i => i.type === 'loot' && i.lootType === 'wand').length,
      lottery: decoratedItems.filter(i => i.type === 'loot' && isScratchLootType(i.lootType)).length
    };

    // Filter by category
    let filtered = decoratedItems;
    const cat = this.activeCategory;
    if (cat === 'gear') {
      filtered = filtered.filter(i => i.type === 'gear');
    } else if (cat === 'weapons') {
      filtered = filtered.filter(i => i.type === 'gear' && i.isWeapon);
    } else if (cat === 'armor') {
      filtered = filtered.filter(i => i.type === 'gear' && !i.isWeapon && i.slot !== 'accessory');
    } else if (cat === 'accessories') {
      filtered = filtered.filter(i => i.type === 'gear' && i.slot === 'accessory');
    } else if (cat === 'loot') {
      filtered = filtered.filter(i => i.type === 'loot');
    } else if (cat === 'consumables') {
      filtered = filtered.filter(i => i.type === 'loot' && (i.lootType === 'consumable' || i.lootType === 'potion'));
    } else if (cat === 'scrolls') {
      filtered = filtered.filter(i => i.type === 'loot' && i.lootType === 'scroll');
    } else if (cat === 'wands') {
      filtered = filtered.filter(i => i.type === 'loot' && i.lootType === 'wand');
    } else if (cat === 'lottery') {
      filtered = filtered.filter(i => i.type === 'loot' && isScratchLootType(i.lootType));
    }

    // Filter by specific gear slot if selected
    if (this.activeSlot !== 'all') {
      filtered = filtered.filter(i => i.type === 'gear' && i.slot === this.activeSlot);
    }

    // Filter by search query
    if (this.searchQuery) {
      const q = this.searchQuery;
      filtered = filtered.filter(i =>
        i.name.toLowerCase().includes(q) ||
        (i.descriptionSnippet && i.descriptionSnippet.toLowerCase().includes(q)) ||
        (i.mechanicsSummary && i.mechanicsSummary.toLowerCase().includes(q)) ||
        i.badgeLabel.toLowerCase().includes(q)
      );
    }

    // Sort alphabetically by name
    filtered.sort((a, b) => a.name.localeCompare(b.name));

    return Object.assign(context, {
      actor: this.actor,
      items: filtered,
      activeCategory: this.activeCategory,
      activeSlot: this.activeSlot,
      searchQuery: this.rawSearchQuery || this.searchQuery,
      counts,
      canSeeValue,
      slots: [
        { key: 'all', label: 'All Slots' },
        { key: 'head', label: 'Head' },
        { key: 'torso', label: 'Torso' },
        { key: 'arms', label: 'Arms' },
        { key: 'hands', label: 'Hands / Weapons' },
        { key: 'legs', label: 'Legs' },
        { key: 'feet', label: 'Feet' },
        { key: 'accessory', label: 'Accessories' }
      ]
    });
  }

  /**
   * Add a selected item to the current crawler's inventory.
   * @param {object} itemData
   * @returns {Promise<COGItem|null>}
   */
  async addItemToActor(itemData) {
    if (!this.actor) {
      globalThis.ui?.notifications?.warn?.('No actor bound to add this item to!');
      return null;
    }

    const itemPayload = await resolveFullItemData(itemData, 'items');

    const res = await this.actor.createEmbeddedDocuments('Item', [itemPayload]);
    const created = res?.[0] || null;

    globalThis.ui?.notifications?.info?.(`Added "${itemData.name}" to ${this.actor.name}'s inventory.`);
    if (typeof this.render === 'function') this.render();
    return created;
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

    if (this.actor) {
      const created = await this.addItemToActor(itemData);
      if (created && typeof created.sheet?.render === 'function') {
        created.sheet.render({ force: true });
      }
      return created;
    } else {
      const ItemClass = CONFIG.Item?.documentClass
        ?? globalThis.foundry?.documents?.Item
        ?? globalThis.Item;
      const created = await ItemClass.create(itemData);
      if (created && typeof created.sheet?.render === 'function') {
        created.sheet.render({ force: true });
      }
      this.render();
      return created;
    }
  }

  static async #onSetSearch(event, target) {
    const val = target.value ?? '';
    this.rawSearchQuery = val;
    this.searchQuery = String(val).toLowerCase().trim();
    // The clear control sits in the (not re-rendered) controls part: toggle it in place.
    this.element?.querySelector?.('.item-search-clear')?.toggleAttribute('hidden', !val);
    await this.render({ parts: ['list', 'footer'] });
  }

  static async #onClearSearch() {
    this.rawSearchQuery = '';
    this.searchQuery = '';
    await this.render();
    this.element?.querySelector?.('.item-search-input')?.focus?.();
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
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    const allItems = await this.getUnifiedItems();
    const match = itemId ? allItems.find(i => i.id === itemId || i._id === itemId) : null;
    if (match) {
      await this.addItemToActor(match);
    }
  }

  /** Preview Item / Open Sheet */
  static async #onPreviewItem(event, target) {
    // The card row carries the item's id; the buttons inside it resolve through the row, never by name.
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    const allItems = await this.getUnifiedItems();
    const match = itemId ? allItems.find(i => i.id === itemId || i._id === itemId) : null;
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
    const { data: itemData, uuid } = resolveManagerSource('items', el.dataset.itemId);
    const dragData = {
      type: 'Item',
      name: itemName,
      uuid,
      data: {
        name: itemName,
        type: itemData?.type || 'gear',
        img: itemData?.img || 'icons/svg/item-bag.svg',
        system: itemData?.system ? structuredClone(itemData.system) : {},
        flags: {
          core: { sourceId: uuid },
          [SYSTEM_ID]: {
            compendiumId: itemData?._id || itemData?.id,
            sourceUuid: uuid
          }
        }
      }
    };
    event.dataTransfer?.setData('text/plain', JSON.stringify(dragData));
  }
}
