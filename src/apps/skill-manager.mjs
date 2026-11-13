/**
 * Sprinter RPG — Skill Library & Manager Application
 * Centralized interface for browsing, creating, and maintaining skills.
 */
import { COGToolApp } from './tool-app.mjs';
import { CatalogBrowserMixin } from './catalog-browser.mjs';
import { SYSTEM_PATH } from '../constants.mjs';
import { checkTypeLabel } from '../data/rules/check-types.mjs';
import { searchRows } from '../content/unified-catalog.mjs';
import { SOURCE_INDEX_FIELD } from '../utils/content-source.mjs';
import { getOrCreateItemFolder } from '../utils/ui/world-folder.mjs';
import { isCombatSkill, isPassiveSkill, skillGroupLabel } from '../utils/tag/tag-mechanics.mjs';
import { addGearGrant, isGearBonusGrant } from '../sheets/item/gear-grants.mjs';


/** `flags.sprinter-rpg.folderKey` of the world folder the skill manager files created skills in. */
const SKILLS_FOLDER_KEY = 'skills';
const TPL = `${SYSTEM_PATH}/templates/apps/skill-manager`;

/** The picker mode that chooses a Skill a weapon attacks with (`options.mode`): the gear sheet's "Add a Skill" and the weapon builder. */
export const ATTACK_SKILL_MODE = 'attackSkill';

/**
 * Index fields the skill list reads: the row and its search (stat, group tags, notes, checkNote), the "Select for item"
 * button and the added-to-item mark (identifier), and the data a skill copies when added. A pack index returns only what is
 * requested, so none of these may rely on another caller having fetched them first.
 */
export const SKILL_MANAGER_INDEX_FIELDS = Object.freeze([
  'system.identifier', 'system.checkNote',
  'system.stat', 'system.checkType', 'system.tags', 'system.notes', 'img',
  'system.isAttack', 'system.isTechnique', 'system.hasDamage', 'system.baseDamage',
  'system.optionalEffects', 'system.techniqueConfig', 'system.upgrades', 'system.rankBreaks', SOURCE_INDEX_FIELD
]);

/** Whether a list row belongs under a pill: combat and passive by tag, utility when it is neither. */
function skillMatchesPill(skill, pill) {
  if (pill === 'combat') return skill.isCombat;
  if (pill === 'passive') return skill.isPassive;
  if (pill === 'utility') return !skill.isCombat && !skill.isPassive;
  return false;
}

export class COGSkillManager extends CatalogBrowserMixin(COGToolApp) {
  static CATALOG = {
    kind: 'skill',
    fields: SKILL_MANAGER_INDEX_FIELDS,
    collection: 'skills',
    list: 'getUnifiedSkills',
    search: { input: '.cog-sm-search', clear: '.cog-sm-search-clear', parts: ['list'] }
  };

  static DEFAULT_OPTIONS = {
    id: 'cog-skill-manager',
    classes: ['cog-sheet-window', 'cog-skill-manager-window'],
    position: { width: 800, height: 740 },
    window: { title: 'Sprinter RPG — Skill Library & Manager', icon: 'fa-solid fa-book-bookmark', resizable: true },
    actions: {
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
    this.item = options.item || null;
    this.onSelect = options.onSelect || null;
    /** 'attackSkill': picking a Skill a weapon attacks with (no bonus box, nothing marked granted); else a gear bonus Skill. */
    this.mode = options.mode === ATTACK_SKILL_MODE ? ATTACK_SKILL_MODE : null;
    this.activeCategory = options.activeCategory || 'all';
    this.activeStat = 'all';
    /** @type {Set<string>} skill names ticked for "Add Selected"; survives list re-renders */
    this.selectedSkills = new Set();
  }

  /**
   * Ensure a dedicated 'Skills' folder exists in the Foundry Items directory.
   * @returns {Promise<Folder|null>}
   */
  async getOrCreateSkillsFolder() {
    return getOrCreateItemFolder(SKILLS_FOLDER_KEY, 'Skills', { color: '#c0392b' });
  }

  /** The skills of every source (pack, registered, world), one row per reference and one per world skill. */
  getUnifiedSkills() {
    return this.catalogRows();
  }

  /** @override */
  decorateRow(row) {
    const system = { stat: 'str', checkType: 'stat', notes: '', ...row.system };
    const granted = this.mode === ATTACK_SKILL_MODE ? [] : (Array.isArray(this.item?.system?.grants) ? this.item.system.grants : []);
    const gearSkillIds = new Set(granted.filter(g => isGearBonusGrant(g) && g.kind === 'skill').map(g => g.identifier));
    const skill = { ...row, system };
    return {
      ...skill,
      isAddedToActor: row.isOwned,
      isAddedToItem: Boolean(system.identifier) && gearSkillIds.has(system.identifier),
      statUpper: (system.stat || 'str').toUpperCase(),
      checkTypeLabel: checkTypeLabel(system.checkType),
      // Pills and the group chip read tags: the stored skillGroup.* / weaponGroup.* tags, and `action.passive` from the check type.
      isCombat: isCombatSkill({ type: 'skill', system }),
      isPassive: isPassiveSkill({ type: 'skill', system }),
      groupLabel: skillGroupLabel(skill)
    };
  }

  /** The strings the search box matches against. */
  searchText(skill) {
    return [skill.name, skill.system.stat, skill.system.notes, checkTypeLabel(skill.system.checkType), skill.system.checkNote, skill.groupLabel];
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
    const filteredSkills = searchRows(allSkills, this.searchQuery, (s) => this.searchText(s)).filter(s => {
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

      return true;
    });

    return Object.assign(context, {
      skills: filteredSkills,
      counts,
      activeCategory: this.activeCategory,
      activeStat: this.activeStat,
      isPicker: Boolean(this.actor || this.item || this.onSelect),
      isItemPicker: Boolean(this.item),
      isAttackSkillPicker: this.mode === ATTACK_SKILL_MODE,
      attackSkillBanner: globalThis.game?.i18n?.format?.('COG.SkillManager.AttackPicker.Banner', { item: this.item?.name ?? '' }),
      item: this.item
    });
  }

  /**
   * Create a new custom world skill using the Unified Item Builder (COGItemSheet).
   */
  async openCreateSkillDialog() {
    const folder = await this.getOrCreateSkillsFolder();
    return this.createBlankDocument({
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
    }, { onActor: false });
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

    const rows = await this.getUnifiedSkills();
    let added = 0;
    for (const row of rows.filter(r => checkedIds.includes(String(r.id)))) {
      const created = await this.addRowToActor(row, {
        mutate: (p) => ({ ...p, type: 'skill', system: { ...p.system, rank: 0 } }),
        notify: false,
        render: false
      });
      if (created) added += 1;
    }
    if (added) {
      ui.notifications?.info(`Added ${added} skill(s) to ${this.actor.name}.`);
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
    if (this.mode === ATTACK_SKILL_MODE) {
      const added = await this.onSelect?.({ identifier, label });
      if (!added) return;
      ui.notifications?.info(globalThis.game?.i18n?.format?.('COG.SkillManager.AttackPicker.Added', { skill: label || identifier }) ?? label);
      this.close();
      return;
    }
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
