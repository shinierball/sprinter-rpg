/**
 * Sprinter RPG — Spell Library & Manager Application
 * Centralized interface for browsing, filtering, and learning spells.
 */
import { COGToolApp } from './tool-app.mjs';
import { SYSTEM_PATH } from '../constants.mjs';
import { catalogEntries } from '../content/catalog-lookup.mjs';
import { itemIdentifier } from '../utils/identifier.mjs';
import { normalizeBaseDamage, baseDamageText } from '../utils/base-damage.mjs';
import { describeHealing } from '../utils/item-describer/blocks-spell-skill.mjs';
import { getTagDefinition } from '../data/tags.mjs';
import { spellRole, spellRoleLabel } from '../utils/tag-mechanics.mjs';
import { htmlSnippet } from './item-manager.mjs';
import { resolveFullItemData, resolveManagerSource, getCompendiumEntries } from './manager-source.mjs';

const TPL = `${SYSTEM_PATH}/templates/apps/spell-manager`;

/** The filter pill a spell role belongs to; the interrupt roles appear only under "all" (null). */
export function spellRoleFilter(role) {
  return { attack: 'attack', heal: 'heal', passive: 'passive', none: 'utility' }[role] ?? null;
}

/**
 * Index fields the spell list reads: `spellRow` (identifier for de-duplication and the known mark, the display fields) plus
 * the stat, spell type and damage type filters. A pack index returns only what is requested.
 */
export const SPELL_MANAGER_INDEX_FIELDS = Object.freeze([
  'system.identifier', 'system.manaCost', 'system.range', 'system.duration', 'system.checkType',
  'system.stat', 'system.baseDamage', 'system.healing', 'system.tags', 'system.description',
  'system.limitations', 'system.quote', 'system.aiFavor', 'img'
]);

/** The healing line the item describer writes ("Heals 2 Health Bar slot(s) (allies)"), for a spell with no damage dice. */
function healingText(src, stat) {
  try {
    const lines = describeHealing({ type: 'spell', system: { ...(src.system || {}), stat } }, {});
    return lines.map(l => l.text).filter(Boolean).join(' • ');
  } catch {
    return '';
  }
}

/** A manager list row from a pack index entry, catalog definition, or world item. */
function spellRow(src, id, source) {
  const isWorld = source === 'world';
  const baseDamage = normalizeBaseDamage(src.system?.baseDamage);
  const stat = src.system?.stat || 'int';
  const tags = Array.isArray(src.system?.tags) ? src.system.tags.filter(t => typeof t === 'string') : [];
  const role = spellRole({ type: 'spell', system: { checkType: src.system?.checkType || 'attack', healing: src.system?.healing, tags } });
  return {
    id,
    _id: id,
    identifier: itemIdentifier(src),
    name: src.name,
    img: src.img || 'icons/svg/aura.svg',
    source,
    isCompendium: !isWorld,
    isWorld,
    role,
    roleLabel: spellRoleLabel(role),
    isHeal: role === 'heal',
    isAttack: role === 'attack',
    system: {
      manaCost: src.system?.manaCost ?? 0,
      range: src.system?.range || '30 feet',
      duration: src.system?.duration || 'Instantaneous',
      checkType: src.system?.checkType || 'attack',
      stat,
      baseDamage,
      tags,
      damageText: baseDamage.dice ? baseDamageText(baseDamage, stat) : healingText(src, stat),
      description: src.system?.description || '',
      descriptionText: htmlSnippet(src.system?.description),
      limitations: src.system?.limitations || '',
      quote: src.system?.quote || '',
      aiFavor: src.system?.aiFavor || 0
    }
  };
}

export class COGSpellManager extends COGToolApp {
  static DEFAULT_OPTIONS = {
    id: 'cog-spell-manager',
    classes: ['cog-sheet-window', 'cog-spell-manager-window'],
    position: { width: 820, height: 760 },
    window: { title: 'Sprinter RPG — Spell Library & Compendium', icon: 'fa-solid fa-wand-magic-sparkles', resizable: true },
    actions: {
      setSearch: COGSpellManager.#onSetSearch,
      clearSearch: COGSpellManager.#onClearSearch,
      setSpellType: COGSpellManager.#onSetSpellType,
      setStat: COGSpellManager.#onSetStat,
      setDamageType: COGSpellManager.#onSetDamageType,
      learnSpell: COGSpellManager.#onLearnSpell,
      castSpell: COGSpellManager.#onCastSpell,
      createCustomSpell: COGSpellManager.#onCreateCustomSpell
    }
  };

  // The search box lives in `controls`; typing re-renders only `list`, so the input keeps focus and caret.
  static PARTS = {
    controls: { template: `${TPL}/controls.hbs` },
    list: { template: `${TPL}/list.hbs`, scrollable: [''] }
  };

  constructor(options = {}) {
    super(options);
    this.actor = options.actor || null;
    this.onSelect = options.onSelect || null;
    this.activeSpellType = 'all';
    this.activeStat = 'all';
    this.activeDamageType = 'all';
    this.searchQuery = '';
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    // Spell cards are drag sources; the root persists across part re-renders, so delegate once.
    this.element.addEventListener('dragstart', (event) => {
      if (event.target?.closest?.('.cog-spell-card-draggable')) this._onDragStart(event);
    });
  }

  /**
   * Retrieve all spells from official CONFIG, compendium pack, and world items.
   * @returns {Promise<Array<object>>}
   */
  async getUnifiedSpells() {
    // Rows are keyed by document id, never by name. Compendium and catalog entries share one
    // de-duplication rule: the same `system.identifier` is one row (compendium wins). World documents
    // are always their own rows, even when they share a name or identifier with another source.
    const spellsMap = new Map();

    // 1. From the registered spell packs
    const index = await getCompendiumEntries('spells', { fields: SPELL_MANAGER_INDEX_FIELDS });
    for (const entry of index) {
      const row = spellRow(entry, entry._id, 'compendium');
      spellsMap.set(`ref:${row.identifier}`, row);
    }

    // 2. From the registered spell definitions
    for (const s of catalogEntries('spells')) {
      const row = spellRow(s, s._id || itemIdentifier(s), 'compendium');
      const key = `ref:${row.identifier}`;
      if (!spellsMap.has(key)) spellsMap.set(key, row);
    }

    // 3. From world items (custom/user-created spells)
    if (typeof game !== 'undefined' && game.items) {
      for (const item of game.items) {
        if (item.type === 'spell') spellsMap.set(`world:${item.id}`, spellRow(item, item.id, 'world'));
      }
    }

    // Determine 'isKnown' state if actor is bound: an owned spell with the same identifier
    const ownedIdentifiers = new Set(
      this.actor?.items?.filter(i => i.type === 'spell').map(i => itemIdentifier(i)) ?? []
    );

    const spells = Array.from(spellsMap.values()).map(spell => ({
      ...spell,
      isKnown: ownedIdentifiers.has(spell.identifier),
      statUpper: (spell.system.stat || 'int').toUpperCase()
    }));

    return spells.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const allSpells = await this.getUnifiedSpells();

    // Compute type counts
    const inFilter = (s, filter) => spellRoleFilter(s.role) === filter;
    const counts = {
      all: allSpells.length,
      attack: allSpells.filter(s => inFilter(s, 'attack')).length,
      heal: allSpells.filter(s => inFilter(s, 'heal')).length,
      utility: allSpells.filter(s => inFilter(s, 'utility')).length,
      passive: allSpells.filter(s => inFilter(s, 'passive')).length,
      world: allSpells.filter(s => s.isWorld).length
    };

    // Filter spells based on state
    const filteredSpells = allSpells.filter(s => {
      // Spell Type Filter
      if (this.activeSpellType !== 'all') {
        if (this.activeSpellType === 'world') {
          if (!s.isWorld) return false;
        } else {
          if (!inFilter(s, this.activeSpellType)) return false;
        }
      }

      // Stat Filter
      if (this.activeStat !== 'all') {
        if ((s.system.stat || '').toLowerCase() !== this.activeStat) return false;
      }

      // Damage Type Filter
      if (this.activeDamageType !== 'all') {
        const rowType = s.system.baseDamage?.damageType || '';
        if (rowType.toLowerCase() !== this.activeDamageType.toLowerCase()) return false;
      }

      // Search Query Filter
      const q = (this.searchQuery || '').toLowerCase().trim();
      if (q) {
        const nameMatch = s.name.toLowerCase().includes(q);
        const descMatch = (s.system.descriptionText || '').toLowerCase().includes(q);
        const rowType = s.system.baseDamage?.damageType || '';
        const dmgMatch = rowType.toLowerCase().includes(q) || (s.system.damageText || '').toLowerCase().includes(q);
        // Tags match by id or label, so a tag label such as "mind control" still finds its spells.
        const tagMatch = (s.system.tags || []).some(t => t.toLowerCase().includes(q) || String(getTagDefinition(t)?.label ?? '').toLowerCase().includes(q));
        const quoteMatch = (s.system.quote || '').toLowerCase().includes(q);
        if (!nameMatch && !descMatch && !dmgMatch && !quoteMatch && !tagMatch) return false;
      }

      return true;
    });

    const damageTypes = CONFIG.COG?.damageTypes || [
      'Acid', 'Bludgeoning', 'Electric', 'Fire', 'Force',
      'Holy', 'Ice', 'Necrotic', 'Piercing', 'Poison',
      'Psychic', 'Slashing', 'Sonic'
    ];

    return Object.assign(context, {
      spells: filteredSpells,
      counts,
      activeSpellType: this.activeSpellType,
      activeStat: this.activeStat,
      activeDamageType: this.activeDamageType,
      searchQuery: this.rawSearchQuery !== undefined ? this.rawSearchQuery : this.searchQuery,
      damageTypes,
      isActorPicker: Boolean(this.actor),
      actor: this.actor,
      isGM: typeof game !== 'undefined' ? Boolean(game.user?.isGM) : true,
      canCreate: typeof game !== 'undefined' ? (game.user?.isGM || game.user?.can?.('ITEM_CREATE')) : true
    });
  }

  /**
   * Add a spell to the bound actor.
   * @param {object} spellData
   */
  async addSpellToActor(spellData) {
    if (!this.actor) {
      globalThis.ui?.notifications?.warn('No character open to learn this spell.');
      return;
    }

    const identifier = spellData.identifier ?? itemIdentifier(spellData);
    const existing = this.actor.items.find(i => i.type === 'spell' && itemIdentifier(i) === identifier);
    if (existing) {
      globalThis.ui?.notifications?.info(`${this.actor.name} already knows "${spellData.name}".`);
      return;
    }

    const full = await resolveFullItemData(spellData, 'spells');
    const itemPayload = { ...full, type: 'spell', img: full.img || 'icons/svg/aura.svg' };

    await this.actor.createEmbeddedDocuments('Item', [itemPayload]);
    globalThis.ui?.notifications?.info(`Added spell "${spellData.name}" to ${this.actor.name}.`);
    if (typeof this.render === 'function') this.render();
  }

  static async #onSetSearch(event, target) {
    const val = target.value ?? '';
    this.rawSearchQuery = val;
    this.searchQuery = String(val).toLowerCase().trim();
    // The clear control sits in the (not re-rendered) controls part: toggle it in place.
    this.element?.querySelector?.('.spell-search-clear')?.toggleAttribute('hidden', !val);
    await this.render({ parts: ['list'] });
  }

  static async #onClearSearch() {
    this.rawSearchQuery = '';
    this.searchQuery = '';
    await this.render();
    this.element?.querySelector?.('.spell-search-input')?.focus?.();
  }

  static async #onSetSpellType(event, target) {
    this.activeSpellType = target.dataset.type || 'all';
    await this.render();
  }

  static async #onSetStat(event, target) {
    this.activeStat = target.value || 'all';
    await this.render();
  }

  static async #onSetDamageType(event, target) {
    this.activeDamageType = target.value || 'all';
    await this.render();
  }

  /** The listed spell a row button belongs to, found by the row's spell id (never by its display name). */
  async #spellForRow(target) {
    const id = String(target?.dataset?.spellId ?? '').trim();
    if (!id) return null;
    const allSpells = await this.getUnifiedSpells();
    return allSpells.find(s => String(s.id) === id) ?? null;
  }

  /** Add Spell to Crawler */
  static async #onLearnSpell(event, target) {
    const match = await this.#spellForRow(target);
    if (match) {
      await this.addSpellToActor(match);
    }
  }

  /** Cast / Post to Chat preview */
  static async #onCastSpell(event, target) {
    const match = await this.#spellForRow(target);
    if (match) {
      if (CONFIG.Item?.documentClass?.rollSpellCard) {
        await CONFIG.Item.documentClass.rollSpellCard(match);
      } else {
        globalThis.ui?.notifications?.info(`Spell: ${match.name}`);
      }
    }
  }

  /** Create Custom Spell using Unified Item Builder (COGItemSheet) */
  static async #onCreateCustomSpell() {
    const spellData = {
      name: 'New Custom Spell',
      type: 'spell',
      img: 'icons/svg/aura.svg',
      system: {
        checkType: 'attack',
        manaCost: 1,
        rank: 1,
        critMultiplierR5: 1,
        critMultiplierR15: 1
      }
    };

    if (this.actor) {
      const created = await this.actor.createEmbeddedDocuments('Item', [spellData]);
      const spell = created?.[0];
      if (spell && typeof spell.sheet?.render === 'function') {
        spell.sheet.render({ force: true });
      }
    } else {
      const ItemClass = CONFIG.Item?.documentClass
        ?? globalThis.foundry?.documents?.Item
        ?? globalThis.Item;
      const created = await ItemClass.create(spellData);
      if (created && typeof created.sheet?.render === 'function') {
        created.sheet.render({ force: true });
      }
    }
  }

  /** Fill the drag payload for the spell card under the pointer. */
  _onDragStart(event) {
    const el = event.target?.closest?.('.cog-spell-card-draggable') ?? event.currentTarget;
    const spellName = el.dataset.spellName;
    if (!spellName) return;

    // The card carries the spell's id: resolve by id (world item, else registered definition), never by name.
    const { data: spellData, uuid } = resolveManagerSource('spells', el.dataset.spellId);
    const dragData = {
      type: 'Item',
      name: spellName,
      uuid: uuid,
      data: {
        name: spellName,
        type: 'spell',
        img: spellData?.img || 'icons/svg/aura.svg',
        system: spellData?.system ? structuredClone(spellData.system) : {}
      }
    };
    event.dataTransfer?.setData('text/plain', JSON.stringify(dragData));
  }
}
