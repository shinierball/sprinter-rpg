/**
 * Sprinter RPG — Skill Library & Manager Application
 * Centralized interface for browsing, creating, and maintaining skills.
 */
import { COGToolApp } from './tool-app.mjs';
import { SYSTEM_ID, SYSTEM_PATH } from '../constants.mjs';
import { checkTypeLabel } from '../data/rules/check-types.mjs';
import { catalogEntries } from '../content/catalog-lookup.mjs';
import { resolveFullItemData, getCompendiumEntries } from './manager-source.mjs';
import { itemIdentifier } from '../utils/identifier.mjs';
import { isCombatSkill, isPassiveSkill, skillGroupLabel } from '../utils/tag-mechanics.mjs';
import { addGearGrant, isGearBonusGrant } from '../sheets/item/gear-grants.mjs';


/** `flags.sprinter-rpg.folderKey` of the world folder the skill manager files created skills in. */
const SKILLS_FOLDER_KEY = 'skills';
const TPL = `${SYSTEM_PATH}/templates/apps/skill-manager`;

/**
 * Index fields the skill list reads: the row and its search (stat, group tags, notes, checkNote), the "Select for item"
 * button and the added-to-item mark (identifier), and the data a skill copies when added. A pack index returns only what is
 * requested, so none of these may rely on another caller having fetched them first.
 */
export const SKILL_MANAGER_INDEX_FIELDS = Object.freeze([
  'system.identifier', 'system.checkNote',
  'system.stat', 'system.checkType', 'system.tags', 'system.notes', 'img',
  'system.isAttack', 'system.isTechnique', 'system.hasDamage', 'system.baseDamage',
  'system.optionalEffects', 'system.techniqueConfig', 'system.upgrades', 'system.rankBreaks'
]);

/** Whether a list row belongs under a pill: combat and passive by tag, utility when it is neither. */
function skillMatchesPill(skill, pill) {
  if (pill === 'combat') return skill.isCombat;
  if (pill === 'passive') return skill.isPassive;
  if (pill === 'utility') return !skill.isCombat && !skill.isPassive;
  return false;
}

export class COGSkillManager extends COGToolApp {
  static DEFAULT_OPTIONS = {
    id: 'cog-skill-manager',
    classes: ['cog-sheet-window', 'cog-skill-manager-window'],
    position: { width: 800, height: 740 },
    window: { title: 'Sprinter RPG — Skill Library & Manager', icon: 'fa-solid fa-book-bookmark', resizable: true },
    actions: {
      setSearch: COGSkillManager.#onSetSearch,
      clearSearch: COGSkillManager.#onClearSearch,
      setCategory: COGSkillManager.#onSetCategory,
      setStat: COGSkillManager.#onSetStat,
      createSkill: COGSkillManager.#onCreateSkill,
      editSkill: COGSkillManager.#onEditSkill,
      deleteSkill: COGSkillManager.#onDeleteSkill,
      toggleSkill: COGSkillManager.#onToggleSkill,
      addToActor: COGSkillManager.#onAddToActor,
      selectForItem: COGSkillManager.#onSelectForItem
    }
  };

  // The search box lives in `controls`; typing re-renders only `list`, so the input keeps focus and caret.
  static PARTS = {
    banner: { template: `${TPL}/banner.hbs` },
    controls: { template: `${TPL}/controls.hbs` },
    list: { template: `${TPL}/list.hbs`, scrollable: [''] }
  };

  constructor(options = {}) {
    super(options);
    this.actor = options.actor || null;
    this.item = options.item || null;
    this.onSelect = options.onSelect || null;
    this.activeCategory = options.activeCategory || 'all';
    this.activeStat = 'all';
    this.searchQuery = '';
    /** @type {Set<string>} skill names ticked for "Add Selected"; survives list re-renders */
    this.selectedSkills = new Set();
  }

  /**
   * Ensure a dedicated 'Skills' folder exists in the Foundry Items directory.
   * @returns {Promise<Folder|null>}
   */
  async getOrCreateSkillsFolder() {
    if (typeof game === 'undefined' || !game.folders) return null;
    let folder = game.folders.find(f => f.type === 'Item' && f.flags?.[SYSTEM_ID]?.folderKey === SKILLS_FOLDER_KEY);
    if (!folder && (game.user?.isGM || game.user?.can?.('FOLDER_CREATE'))) {
      try {
        folder = await Folder.create({
          name: 'Skills',
          type: 'Item',
          color: '#c0392b',
          flags: { [SYSTEM_ID]: { folderKey: SKILLS_FOLDER_KEY } }
        });
      } catch (err) {
        console.warn('Sprinter RPG | Could not create Skills folder:', err);
      }
    }
    return folder;
  }

  /**
   * Retrieve all skills from official CONFIG, compendium pack, and world items.
   * @returns {Promise<Array<object>>}
   */
  async getUnifiedSkills() {
    // Rows are keyed by document id, never by name (the Spell Manager's rule): catalog and compendium
    // entries share one row per `system.identifier`, and each world skill is its own row even when names match.
    const skillsMap = new Map();
    const catalogKey = (entry) => `ref:${itemIdentifier(entry) || entry._id || entry.id}`;

    // 1. From the registered skill packs
    const index = await getCompendiumEntries('skills', { fields: SKILL_MANAGER_INDEX_FIELDS });
    for (const entry of index) {
      skillsMap.set(catalogKey(entry), {
        id: entry._id,
        _id: entry._id,
        name: entry.name,
        img: entry.img || 'icons/svg/book.svg',
        source: 'compendium',
        isCompendium: true,
        isWorld: false,
        system: {
          stat: entry.system?.stat || 'str',
          checkType: entry.system?.checkType || 'stat',
          notes: entry.system?.notes || '',
          ...entry.system
        }
      });
    }

    // 2. From the registered skill definitions
    for (const s of catalogEntries('skills')) {
      const key = catalogKey(s);
      if (!skillsMap.has(key)) {
        skillsMap.set(key, {
          id: s._id || key,
          _id: s._id || key,
          name: s.name,
          img: s.img || 'icons/svg/book.svg',
          source: 'compendium',
          isCompendium: true,
          isWorld: false,
          system: {
            stat: s.system?.stat || 'str',
            checkType: s.system?.checkType || 'stat',
            notes: s.system?.notes || '',
            ...s.system
          }
        });
      }
    }

    // 3. From world items (custom/user created skills in Foundry items section)
    if (typeof game !== 'undefined' && game.items) {
      for (const item of game.items) {
        if (item.type === 'skill') {
          skillsMap.set(`world:${item.id}`, {
            id: item.id,
            _id: item.id,
            name: item.name,
            img: item.img || 'icons/svg/book.svg',
            source: 'world',
            isCompendium: false,
            isWorld: true,
            system: {
              stat: item.system?.stat || 'str',
              checkType: item.system?.checkType || 'stat',
              notes: item.system?.notes || '',
              ...(item.system || {})
            }
          });
        }
      }
    }

    // Determine 'isAdded' state if actor or item is present
    const ownedIdentifiers = new Set(
      this.actor?.items?.filter(i => i.type === 'skill').map(i => itemIdentifier(i)) ?? []
    );

    const gearSkillIds = new Set(
      (Array.isArray(this.item?.system?.grants) ? this.item.system.grants : [])
        .filter(g => isGearBonusGrant(g) && g.kind === 'skill').map(g => g.identifier)
    );

    const skills = Array.from(skillsMap.values()).map(skill => {
      return {
        ...skill,
        isAddedToActor: ownedIdentifiers.has(itemIdentifier(skill)),
        isAddedToItem: Boolean(skill.system?.identifier) && gearSkillIds.has(skill.system.identifier),
        statUpper: (skill.system.stat || 'str').toUpperCase(),
        checkTypeLabel: checkTypeLabel(skill.system.checkType),
        // Pills and the group chip read tags: the stored skillGroup.* / weaponGroup.* tags, and `action.passive` from the check type.
        isCombat: isCombatSkill({ type: 'skill', system: skill.system }),
        isPassive: isPassiveSkill({ type: 'skill', system: skill.system }),
        groupLabel: skillGroupLabel(skill)
      };
    });

    return skills.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const allSkills = await this.getUnifiedSkills();
    for (const skill of allSkills) skill.isSelected = this.selectedSkills.has(skill.id);

    // Compute category counts
    const counts = {
      all: allSkills.length,
      utility: allSkills.filter(s => !s.isCombat && !s.isPassive).length,
      combat: allSkills.filter(s => s.isCombat).length,
      passive: allSkills.filter(s => s.isPassive).length,
      world: allSkills.filter(s => s.isWorld).length
    };

    // Filter skills based on state
    const filteredSkills = allSkills.filter(s => {
      // Category filter
      if (this.activeCategory !== 'all') {
        if (this.activeCategory === 'world') {
          if (!s.isWorld) return false;
        } else {
          if (!skillMatchesPill(s, this.activeCategory)) return false;
        }
      }

      // Stat filter
      if (this.activeStat !== 'all') {
        if ((s.system.stat || '').toLowerCase() !== this.activeStat) return false;
      }

      // Text search query
      const q = (this.searchQuery || '').toLowerCase().trim();
      if (q) {
        const nameMatch = s.name.toLowerCase().includes(q);
        const statMatch = (s.system.stat || '').toLowerCase().includes(q);
        const notesMatch = (s.system.notes || '').toLowerCase().includes(q);
        const typeMatch = checkTypeLabel(s.system.checkType).toLowerCase().includes(q) || (s.system.checkNote || '').toLowerCase().includes(q);
        const groupMatch = (s.groupLabel || '').toLowerCase().includes(q);
        if (!nameMatch && !statMatch && !notesMatch && !typeMatch && !groupMatch) return false;
      }

      return true;
    });

    return Object.assign(context, {
      skills: filteredSkills,
      counts,
      activeCategory: this.activeCategory,
      activeStat: this.activeStat,
      searchQuery: this.rawSearchQuery !== undefined ? this.rawSearchQuery : this.searchQuery,
      isPicker: Boolean(this.actor || this.item || this.onSelect),
      isActorPicker: Boolean(this.actor),
      isItemPicker: Boolean(this.item),
      actor: this.actor,
      item: this.item,
      isGM: typeof game !== 'undefined' ? Boolean(game.user?.isGM) : true,
      canCreate: typeof game !== 'undefined' ? (game.user?.isGM || game.user?.can?.('ITEM_CREATE')) : true
    });
  }

  /**
   * Create a new custom world skill using the Unified Item Builder (COGItemSheet).
   */
  async openCreateSkillDialog() {
    const folder = await this.getOrCreateSkillsFolder();
    const ItemClass = CONFIG.Item?.documentClass
      ?? globalThis.foundry?.documents?.Item
      ?? globalThis.Item;
    const created = await ItemClass.create({
      name: 'New Custom Skill',
      type: 'skill',
      img: 'icons/svg/book.svg',
      folder: folder?.id || null,
      system: {
        rank: 0,
        stat: 'str',
        checkType: 'stat',
        critMultiplierR5: 1,
        critMultiplierR15: 1,
        notes: ''
      }
    });

    if (created && typeof created.sheet?.render === 'function') {
      created.sheet.render({ force: true });
    }
    this.render();
    return created;
  }

  static async #onSetSearch(event, target) {
    const val = target.value ?? '';
    this.rawSearchQuery = val;
    this.searchQuery = String(val).toLowerCase().trim();
    // The clear control sits in the (not re-rendered) controls part: toggle it in place.
    this.element?.querySelector?.('.cog-sm-search-clear')?.toggleAttribute('hidden', !val);
    await this.render({ parts: ['list'] });
  }

  static async #onClearSearch() {
    this.rawSearchQuery = '';
    this.searchQuery = '';
    await this.render();
    this.element?.querySelector?.('.cog-sm-search')?.focus?.();
  }

  static async #onSetCategory(event, target) {
    this.activeCategory = target.dataset.category;
    await this.render();
  }

  static async #onSetStat(event, target) {
    this.activeStat = target.dataset.stat;
    await this.render();
  }

  static async #onCreateSkill() {
    await this.openCreateSkillDialog();
  }

  static #onEditSkill(event, target) {
    const item = game.items?.get(target.dataset.id);
    if (item) item.sheet?.render({ force: true });
  }

  static async #onDeleteSkill(event, target) {
    const item = game.items?.get(target.dataset.id);
    if (!item) return;

    await foundry.applications.api.DialogV2.confirm({
      window: { title: `Delete Skill: ${item.name}` },
      content: `<p>Are you sure you want to permanently delete the custom skill <strong>${item.name}</strong> from the world skills library?</p>`,
      yes: {
        callback: async () => {
          await item.delete();
          ui.notifications?.info(`Deleted skill "${item.name}".`);
          this.render();
        }
      },
      rejectClose: false
    });
  }

  static #onToggleSkill(event, target) {
    const id = target.dataset.skillId;
    if (!id) return;
    if (target.checked) this.selectedSkills.add(id);
    else this.selectedSkills.delete(id);
  }

  /** Add selected skills to Actor */
  static async #onAddToActor() {
    if (!this.actor) return;

    const checkedIds = [...this.selectedSkills];
    if (!checkedIds.length) {
      ui.notifications?.info('No skills selected.');
      return;
    }

    const allSkills = await this.getUnifiedSkills();
    const toCreate = [];
    for (const id of checkedIds) {
      const def = allSkills.find(s => String(s.id) === id);
      if (def) {
        const full = await resolveFullItemData(def, 'skills');
        toCreate.push({ ...full, type: 'skill', system: { ...full.system, rank: 0 } });
      }
    }

    if (toCreate.length) {
      await this.actor.createEmbeddedDocuments('Item', toCreate);
      ui.notifications?.info(`Added ${toCreate.length} skill(s) to ${this.actor.name}.`);
      this.close();
    }
  }

  /**
   * Select a skill for the gear item: adds a `grants` skill row by identifier (through `onSelect` when the item sheet
   * supplied one, else directly on the item).
   */
  static async #onSelectForItem(event, target) {
    if (!this.item) return;
    const identifier = String(target.dataset.identifier ?? '').trim();
    const label = String(target.dataset.name ?? '').trim();
    if (!identifier) return;
    const value = Number(this.element.querySelector('#cog-sm-gear-bonus')?.value) || 1;
    const row = this.onSelect
      ? await this.onSelect({ identifier, label, value })
      : await COGSkillManager.addSkillToGear(this.item, { identifier, label, value });
    if (!row) return;
    if (this.item.actor?.sheet?.rendered) this.item.actor.render(false);
    ui.notifications?.info(`Added "${label || identifier}" bonus to ${this.item.name}.`);
    this.close();
  }

  /**
   * Add (or raise) a gear skill bonus row for the skill with `identifier`.
   * @returns {Promise<object|null>} the row added or changed
   */
  static async addSkillToGear(item, { identifier, label = '', value = 1 }) {
    const { rows, row } = addGearGrant(item.system?.grants, { kind: 'skill', identifier, label }, { value });
    if (row) await item.update({ 'system.grants': rows });
    return row;
  }
}
