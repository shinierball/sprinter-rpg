/**
 * Sprinter RPG — Spell Library & Manager Application
 * Centralized interface for browsing, filtering, and learning spells.
 */
import { COGToolApp } from './tool-app.mjs';
import { CatalogBrowserMixin, createBlankDocument } from './catalog-browser.mjs';
import { SYSTEM_PATH } from '../constants.mjs';
import { searchRows } from '../content/unified-catalog.mjs';
import { SOURCE_INDEX_FIELD } from '../utils/content-source.mjs';
import { itemIdentifier } from '../utils/identifier.mjs';
import { normalizeBaseDamage, baseDamageText } from '../utils/damage/base-damage.mjs';
import { describeHealing } from '../utils/item-describer/blocks-spell-skill.mjs';
import { getTagDefinition } from '../data/tag-definitions.mjs';
import { spellRole, spellRoleLabel } from '../utils/tag/tag-mechanics.mjs';
import { htmlSnippet } from '../utils/ui/html-snippet.mjs';

const TPL = `${SYSTEM_PATH}/templates/apps/spell-manager`;

/** The filter pill a spell role belongs to; the interrupt roles appear only under "all" (null). */
export function spellRoleFilter(role) {
  return { attack: 'attack', heal: 'heal', passive: 'passive', none: 'utility' }[role] ?? null;
}

/**
 * Index fields the spell list reads: `spellRow` (identifier for de-duplication and the known mark, the display fields) plus
 * the stat, spell type and damage type filters. A pack index returns only what is requested.
 */
const SPELL_MANAGER_INDEX_FIELDS = Object.freeze([
  'system.identifier', 'system.manaCost', 'system.range', 'system.duration', 'system.checkType',
  'system.stat', 'system.baseDamage', 'system.healing', 'system.tags', 'system.description',
  'system.limitations', 'system.quote', 'system.aiFavor', 'img', SOURCE_INDEX_FIELD
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

/** The spell columns of a merged row: the role, the normalised display fields and the damage / healing text. */
function spellColumns(row) {
  const baseDamage = normalizeBaseDamage(row.system?.baseDamage);
  const stat = row.system?.stat || 'int';
  const tags = Array.isArray(row.system?.tags) ? row.system.tags.filter(t => typeof t === 'string') : [];
  const role = spellRole({ type: 'spell', system: { checkType: row.system?.checkType || 'attack', healing: row.system?.healing, tags } });
  return {
    role,
    roleLabel: spellRoleLabel(role),
    isHeal: role === 'heal',
    isAttack: role === 'attack',
    system: {
      manaCost: row.system?.manaCost ?? 0,
      range: row.system?.range || '30 feet',
      duration: row.system?.duration || 'Instantaneous',
      checkType: row.system?.checkType || 'attack',
      stat,
      baseDamage,
      tags,
      damageText: baseDamage.dice ? baseDamageText(baseDamage, stat) : healingText(row, stat),
      description: row.system?.description || '',
      descriptionText: htmlSnippet(row.system?.description),
      limitations: row.system?.limitations || '',
      quote: row.system?.quote || '',
      aiFavor: row.system?.aiFavor || 0
    }
  };
}

export class COGSpellManager extends CatalogBrowserMixin(COGToolApp) {
  static CATALOG = {
    kind: 'spell',
    fields: SPELL_MANAGER_INDEX_FIELDS,
    collection: 'spells',
    list: 'getUnifiedSpells',
    search: { input: '.spell-search-input', clear: '.spell-search-clear', parts: ['list'] }
  };

  static DEFAULT_OPTIONS = {
    id: 'cog-spell-manager',
    classes: ['cog-sheet-window', 'cog-spell-manager-window'],
    position: { width: 820, height: 760 },
    window: { title: 'Sprinter RPG — Spell Library & Compendium', icon: 'fa-solid fa-wand-magic-sparkles', resizable: true },
    actions: {
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
    this.onSelect = options.onSelect || null;
    this.activeSpellType = 'all';
    this.activeStat = 'all';
    this.activeDamageType = 'all';
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    // Spell cards are drag sources; the root persists across part re-renders, so delegate once.
    this.element.addEventListener('dragstart', (event) => {
      if (event.target?.closest?.('.cog-spell-card-draggable')) this._onDragStart(event);
    });
  }

  /** The spells of every source (pack, registered, world): one row per reference identifier, every world spell its own row. */
  getUnifiedSpells() {
    return this.catalogRows();
  }

  /** @override */
  decorateRow(row) {
    const columns = spellColumns(row);
    return { ...row, ...columns, isKnown: row.isOwned, statUpper: columns.system.stat.toUpperCase() };
  }

  /** The strings the search box matches against; a tag matches by id or label, so "mind control" still finds its spells. */
  searchText(s) {
    const tags = (s.system.tags || []).flatMap(t => [t, getTagDefinition(t)?.label]);
    return [s.name, s.system.descriptionText, s.system.baseDamage?.damageType, s.system.damageText, s.system.quote, ...tags];
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
    const filteredSpells = searchRows(allSpells, this.searchQuery, (s) => this.searchText(s)).filter(s => {
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
      damageTypes
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

    await this.addRowToActor(spellData, {
      mutate: (full) => ({ ...full, type: 'spell', img: full.img || 'icons/svg/aura.svg' }),
      message: `Added spell "${spellData.name}" to ${this.actor.name}.`
    });
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
  #spellForRow(target) {
    return this.rowById(target?.dataset?.spellId);
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
    await createBlankDocument(this, {
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
    });
  }

  /** Fill the drag payload for the spell card under the pointer. */
  _onDragStart(event) {
    const el = event.target?.closest?.('.cog-spell-card-draggable') ?? event.currentTarget;
    const spellName = el.dataset.spellName;
    if (!spellName) return;

    // The card carries the spell's id: resolve by id (world item, else registered definition), never by name.
    const dragData = this.dragPayload(el.dataset.spellId, spellName, { type: 'spell', img: 'icons/svg/aura.svg' });
    event.dataTransfer?.setData('text/plain', JSON.stringify(dragData));
  }
}
