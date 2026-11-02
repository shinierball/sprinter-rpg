/**
 * Sprinter RPG Tag Manager & Taxonomy Application
 *
 * Provides GMs and players with an interactive browser to explore registered tags,
 * view usage frequency across world and compendium items, and register custom tags.
 */

import { COGToolApp } from './tool-app.mjs';
import { COG_TAGS, TAG_NAMESPACES, registerCustomTag, isDescriptiveTag, isIdentityNamespace } from '../data/tags.mjs';
import { tagIndex } from './tag-index.mjs';
import { openTagSystemJournal } from '../data/journal-tag-system.mjs';
import { SYSTEM_ID, SYSTEM_PATH } from '../constants.mjs';
import { getTagBehaviour } from '../utils/tag-behaviour.mjs';
import {
  TAG_ROWS_ROOT, TAG_ROW_DELEGATES, applyRowsForm, buildTagEditorContext, hostForTag, resetTagOverride, setTagFlag
} from './tag-rows-editor.mjs';

const TPL = `${SYSTEM_PATH}/templates/apps/tag-manager`;

export class COGTagManager extends COGToolApp {
  static DEFAULT_OPTIONS = {
    id: 'cog-tag-manager',
    // cog-tag-manager-container scopes the checkbox and apply-label rules in cog.css
    classes: ['cog-sheet-window', 'cog-tag-manager-window', 'cog-tag-manager-container'],
    position: { width: 780, height: 680 },
    window: { title: 'Sprinter RPG — Tag Manager & Taxonomy', icon: 'fa-solid fa-tags', resizable: true },
    actions: {
      setNamespace: COGTagManager.#onSetNamespace,
      setSearch: COGTagManager.#onSetSearch,
      clearSearch: COGTagManager.#onClearSearch,
      toggleAssign: COGTagManager.#onToggleAssign,
      registerTag: COGTagManager.#onRegisterTag,
      deleteTag: COGTagManager.#onDeleteTag,
      openGuide: COGTagManager.#onOpenGuide,
      selectTag: COGTagManager.#onSelectTag,
      toggleFlag: COGTagManager.#onToggleFlag,
      resetOverride: COGTagManager.#onResetOverride,
      // The item sheet's row and query actions, run against the selected tag's rows (E7.5).
      ...TAG_ROW_DELEGATES
    }
  };

  // The search box lives in `controls`; typing re-renders only `list`, so the input keeps focus and caret.
  static PARTS = {
    header: { template: `${TPL}/header.hbs` },
    controls: { template: `${TPL}/controls.hbs` },
    list: { template: `${TPL}/list.hbs`, scrollable: [''] },
    rules: { template: `${TPL}/rules.hbs`, scrollable: [''] },
    create: { template: `${TPL}/create.hbs` }
  };

  constructor(options = {}) {
    super(options);
    this.activeNamespace = options.activeNamespace || 'all';
    this.searchQuery = '';
    /** The tag whose rows and flags the rules part shows. */
    this.selectedTagId = options.selectedTagId || null;
    this.item = options.item || options.document || null;
  }

  /**
   * Application context preparation
   * @override
   */
  async _prepareContext(options = {}) {
    const context = await super._prepareContext(options);

    // 1. Gather all registered tags (core + custom)
    const allTags = [...COG_TAGS];

    // Load any custom tags persisted in game settings
    let savedCustomTags = [];
    if (globalThis.game?.settings) {
      try {
        savedCustomTags = globalThis.game.settings.get(SYSTEM_ID, 'customTags') || [];
      } catch {
        savedCustomTags = [];
      }
    }
    for (const ct of savedCustomTags) {
      if (!allTags.some(t => t.id === ct.id)) {
        allTags.push(ct);
        registerCustomTag(ct);
      }
    }

    // 2. Compute usage counts via tagIndex
    const tagCounts = tagIndex.getTagCounts ? tagIndex.getTagCounts() : {};

    // Identify tags assigned to the target item (if opened in item context)
    const targetItem = this.item ? {
      id: this.item.id,
      name: this.item.name,
      type: this.item.type,
      tags: Array.isArray(this.item.system?.tags) ? [...this.item.system.tags] : []
    } : null;
    const itemTagsSet = new Set(targetItem?.tags || []);

    const enrichedTags = allTags.map(t => {
      const count = tagCounts[t.id] ?? (tagIndex.find ? tagIndex.find(t.id).length : 0);
      return {
        ...t,
        count,
        isCustom: Boolean(t.isCustom || t.namespace === 'custom'),
        isAssigned: itemTagsSet.has(t.id),
        isRule: Boolean(getTagBehaviour(t.id)),
        isDescriptive: isDescriptiveTag(t.id),
        isIdentityNamespace: isIdentityNamespace(t.namespace),
        isSelected: t.id === this.selectedTagId
      };
    });

    // 3. Build namespace tabs with counts
    const namespaces = [
      { id: 'all', label: 'All' },
      ...Object.entries(TAG_NAMESPACES).map(([ns, def]) => ({ id: ns, label: def.label || (ns.charAt(0).toUpperCase() + ns.slice(1)) })),
      { id: 'custom', label: 'Custom' }
    ];

    const namespaceTabs = namespaces.map(ns => {
      let count;
      if (ns.id === 'all') {
        count = enrichedTags.length;
      } else if (ns.id === 'custom') {
        count = enrichedTags.filter(t => t.isCustom).length;
      } else {
        count = enrichedTags.filter(t => t.namespace === ns.id).length;
      }
      return {
        id: ns.id,
        label: ns.label,
        count,
        active: this.activeNamespace === ns.id
      };
    });

    // 4. Filter tags by activeNamespace and searchQuery
    let filteredTags = enrichedTags;
    if (this.activeNamespace !== 'all') {
      if (this.activeNamespace === 'custom') {
        filteredTags = filteredTags.filter(t => t.isCustom);
      } else {
        filteredTags = filteredTags.filter(t => t.namespace === this.activeNamespace);
      }
    }

    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase().trim();
      filteredTags = filteredTags.filter(t =>
        t.id.toLowerCase().includes(q) ||
        (t.label && t.label.toLowerCase().includes(q)) ||
        (t.description && t.description.toLowerCase().includes(q))
      );
    }

    filteredTags.sort((a, b) => a.id.localeCompare(b.id));

    context.targetItem = targetItem;
    context.totalTagsCount = enrichedTags.length;
    context.searchQuery = this.searchQuery;
    context.namespaceTabs = namespaceTabs;
    context.tagsList = filteredTags;
    context.tagEditor = this.selectedTagId ? buildTagEditorContext(this.selectedTagId, { isGM: context.isGM }) : null;

    return context;
  }

  static async #onSetNamespace(event, target) {
    this.activeNamespace = target.dataset.namespace || 'all';
    await this.render();
  }

  static async #onSetSearch(event, target) {
    this.searchQuery = target.value;
    // The clear button sits in the (not re-rendered) controls part: toggle it in place.
    this.element?.querySelector?.('.cog-clear-search-btn')?.toggleAttribute('hidden', !this.searchQuery);
    await this.render({ parts: ['list'] });
  }

  static async #onClearSearch() {
    this.searchQuery = '';
    await this.render();
  }

  /** Show a tag's rows and flags in the rules part. */
  static async #onSelectTag(event, target) {
    this.selectedTagId = target.dataset.tagId || null;
    await this.render({ parts: ['list', 'rules'] });
  }

  /** Turn a rule flag on or off for the selected tag (GM; a registry tag gets a world override). */
  static async #onToggleFlag(event, target) {
    if (!this.selectedTagId || !target.dataset.flag) return;
    await setTagFlag(this.selectedTagId, target.dataset.flag, Boolean(target.checked));
    await this.render({ parts: ['list', 'rules'] });
  }

  /** Remove the selected tag's world override. */
  static async #onResetOverride() {
    if (!this.selectedTagId) return;
    await resetTagOverride(this.selectedTagId);
    await this.render({ parts: ['list', 'rules'] });
  }

  /**
   * A change inside the rules form (`rows.<array>.<i>.<field>` inputs) saves the whole form into the selected tag;
   * every other change keeps its `data-change-action` routing.
   * @override
   */
  _onChangeForm(formConfig, event) {
    const form = event?.target?.closest?.('.cog-tm-rules-form');
    if (!form || !this.selectedTagId || !event.target.name?.startsWith?.(`${TAG_ROWS_ROOT}.`)) return super._onChangeForm(formConfig, event);
    return this.#saveRulesForm(form);
  }

  async #saveRulesForm(form) {
    const data = new foundry.applications.ux.FormDataExtended(form).object;
    const submitted = foundry.utils.expandObject(data)[TAG_ROWS_ROOT] ?? {};
    await applyRowsForm(hostForTag(this.selectedTagId), submitted);
    await this.render({ parts: ['list', 'rules'] });
  }

  /** Toggle Tag Assignment on Target Item */
  static async #onToggleAssign(event, target) {
    if (!this.item) return;
    const tagId = target.dataset.tagId;
    if (!tagId) return;
    const checked = Boolean(target.checked);
    const curTags = Array.isArray(this.item.system?.tags) ? [...this.item.system.tags] : [];
    let updated = curTags;
    if (checked && !curTags.includes(tagId)) {
      updated = [...curTags, tagId];
    } else if (!checked && curTags.includes(tagId)) {
      updated = curTags.filter(t => t !== tagId);
    }
    await this.item.update({ 'system.tags': updated });
    if (this.item.sheet?.rendered) {
      this.item.sheet.render();
    }
    await this.render();
  }

  /** Register Custom Tag */
  static async #onRegisterTag() {
    const field = (name) => this.element?.querySelector?.(`[name="${name}"]`);
    const idInput = field('customTagId')?.value?.trim() || '';
    const labelInput = field('customTagLabel')?.value?.trim() || '';
    const nsSelect = field('customTagNamespace')?.value?.trim() || 'custom';
    const applyToItem = Boolean(field('customTagApply')?.checked);

    if (!idInput) {
      ui.notifications?.warn('Sprinter RPG | Please enter a Tag ID.');
      return;
    }

    // Format clean namespaced tag ID
    let cleanId = idInput.toLowerCase().replace(/[^a-z0-9_.-]/g, '-');
    if (!cleanId.includes('.')) {
      cleanId = `${nsSelect}.${cleanId}`;
    }

    const cleanLabel = labelInput || cleanId;
    const newTag = {
      id: cleanId,
      label: cleanLabel,
      namespace: nsSelect,
      isCustom: true
    };

    registerCustomTag(newTag);

    // Persist to game settings if available
    if (globalThis.game?.settings) {
      if (globalThis.game?.user && globalThis.game.user.isGM === false) {
        globalThis.ui?.notifications?.warn?.('Sprinter RPG | Only a GM can save world custom tags.');
      } else {
        try {
          const cur = globalThis.game.settings.get(SYSTEM_ID, 'customTags') || [];
          if (!cur.some(t => t.id === cleanId)) {
            await globalThis.game.settings.set(SYSTEM_ID, 'customTags', [...cur, newTag]);
          }
        } catch (err) {
          console.warn('Sprinter RPG | Could not save custom tag to settings', err);
        }
      }
    }

    // Auto-apply newly created tag to target item if requested
    if (applyToItem && this.item) {
      const curTags = Array.isArray(this.item.system?.tags) ? [...this.item.system.tags] : [];
      if (!curTags.includes(cleanId)) {
        await this.item.update({ 'system.tags': [...curTags, cleanId] });
        if (this.item.sheet?.rendered) {
          this.item.sheet.render();
        }
      }
    }

    ui.notifications?.info(`Sprinter RPG | Registered custom tag "${cleanId}".`);
    await this.render();
  }

  /** Delete Custom Tag */
  static async #onDeleteTag(event, target) {
    const tagId = target.dataset.tagId;
    if (!tagId) return;
    if (this.selectedTagId === tagId) this.selectedTagId = null;

    if (globalThis.game?.settings) {
      if (globalThis.game?.user && globalThis.game.user.isGM === false) {
        globalThis.ui?.notifications?.warn?.('Sprinter RPG | Only a GM can delete world custom tags.');
      } else {
        try {
          const cur = globalThis.game.settings.get(SYSTEM_ID, 'customTags') || [];
          const updated = cur.filter(t => t.id !== tagId);
          await globalThis.game.settings.set(SYSTEM_ID, 'customTags', updated);
        } catch (err) {
          console.warn('Sprinter RPG | Could not delete custom tag from settings', err);
        }
      }
    }

    await this.render();
  }

  /** Open Tag Guide Journal Entry */
  static async #onOpenGuide() {
    await openTagSystemJournal();
  }
}
