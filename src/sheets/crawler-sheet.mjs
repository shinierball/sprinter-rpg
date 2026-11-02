/**
 * Sprinter RPG character sheet (crawlers, NPCs and mobs; pets, vehicles and mercenaries subclass it).
 *
 * ApplicationV2 sheet on the shared base. One PART per tab;
 * context builders live in `./crawler/context-*.mjs`, action tables in `./crawler/actions-*.mjs`,
 * drop handling in `./crawler/drop.mjs`.
 */
import { COGActorSheetV2 } from './base/actor-sheet-v2.mjs';
import { COGSkillManager } from '../apps/skill-manager.mjs';
import { COGSpellManager } from '../apps/spell-manager.mjs';
import { COGItemManager } from '../apps/item-manager.mjs';
import { COGBuffDebuffManager } from '../apps/buff-manager.mjs';
import { COGAchievementManagerApp } from '../apps/achievement-manager.mjs';
import { COGGrindApp } from '../apps/grind-app.mjs';
import { SYSTEM_ID, SYSTEM_PATH } from '../constants.mjs';
import { prepareItemLists, prepareItemSummaries, prepareGrantedSummaries } from './crawler/context-items.mjs';
import { prepareCoreContext } from './crawler/context-core.mjs';
import { prepareSkillsAndSpells } from './crawler/context-skills.mjs';
import { prepareInventory } from './crawler/context-inventory.mjs';
import { prepareCombat } from './crawler/context-combat.mjs';
import { prepareHotlist, prepareExternalBuffs } from './crawler/context-slots.mjs';
import { prepareAchievements } from './crawler/context-achievements.mjs';
import { prepareStory } from './crawler/context-story.mjs';
import { coreActions, GM_ONLY_LIMB_FIELDS } from './crawler/actions-core.mjs';
import { combatActions } from './crawler/actions-combat.mjs';
import { itemActions } from './crawler/actions-items.mjs';
import { slotActions } from './crawler/actions-slots.mjs';
import { grindActions } from './crawler/actions-grind.mjs';
import { storyActions } from './crawler/actions-story.mjs';
import { tagActions, addActorTag } from './crawler/actions-tags.mjs';
import { achievementActions, applyAchievementFilter } from './crawler/actions-achievements.mjs';
import { dropItem, dropActor } from './crawler/drop.mjs';
import { completeItemTransfer } from './base/item-transfer.mjs';
import { MOB_BOSS_TAG, MOB_TIER_PREFIX } from '../utils/tag-mechanics.mjs';

export { prepareAttackDisplay } from './crawler/attack-display.mjs';
export { isWeaponGear } from '../documents/actor.mjs';

const PARTS_PATH = `${SYSTEM_PATH}/templates/actors/parts`;

/**
 * A mob's boss tier lives in its `mob.tier.<id>` tag (`mob.boss` is derived from the registry, never
 * stored). The page 1 select is named `bossTier` and is translated here; `none` (or empty) clears the tier tag.
 * @param {string[]|undefined} currentTags
 * @param {*} rawTier
 * @returns {string[]}
 */
export function bossTierTags(currentTags, rawTier) {
  let tier = rawTier ?? '';
  if (Array.isArray(tier)) tier = tier[0] ?? '';
  tier = String(tier).trim();
  const tags = (Array.isArray(currentTags) ? currentTags : [])
    .filter(t => typeof t === 'string' && !t.startsWith(MOB_TIER_PREFIX) && t !== MOB_BOSS_TAG);
  if (tier && tier !== 'none') tags.push(`${MOB_TIER_PREFIX}${tier}`);
  return tags;
}

/** Rest lengths offered by the page 1 rest buttons (`data-rest-type`). */
const REST_LABELS = {
  '1hour': '1-Hour Non-Combat Rest',
  'short': '2-Hour Short Rest',
  'long': '8-Hour Safe Room Long Rest',
  'fullDay': '30-Hour Full Day Rest'
};
/** A checkbox's state: the live `checked` property, or the static attribute where the DOM has no property. */
const isChecked = (el) => (typeof el?.checked === 'boolean' ? el.checked : Boolean(el?.hasAttribute?.('checked')));
/** Hours each rest takes. */
const REST_HOURS = { '1hour': 1, 'short': 2, 'long': 8, 'fullDay': 30 };
const REST_DESCRIPTIONS = {
  '1hour': 'Recovers 1 Health Bar slot and 5 Mana.',
  'short': 'Recovers 5 Health Bar slots and half Mana regeneration (round down). Clears short rest conditions.',
  'long': 'Fully restores all 10 Health Bars, refills all Mana, and clears all stacked Fatigued debuffs.',
  'fullDay': 'Complete 30-hour biological rest. Fully restores Health and Mana, clears fatigue, and recovers from all Injuries.'
};

export class COGCrawlerSheet extends COGActorSheetV2 {
  static DEFAULT_OPTIONS = {
    classes: ['actor', 'crawler'],
    position: { width: 860, height: 900 },
    window: {
      controls: [{ icon: 'fa-solid fa-file-pdf', label: 'Save to PDF', action: 'exportPdf' }]
    },
    actions: {
      ...coreActions,
      ...combatActions,
      ...itemActions,
      ...slotActions,
      ...grindActions,
      ...storyActions,
      ...achievementActions,
      ...tagActions
    }
  };

  static TABS = {
    primary: {
      initial: 'page1',
      tabs: [
        { id: 'page1', label: '1: Core & Combat', icon: 'fa-solid fa-address-card', cssClass: 'page1' },
        { id: 'page4', label: '2: Equipment & Inventory', icon: 'fa-solid fa-shield-halved', cssClass: 'page4' },
        { id: 'page3', label: '3: Skills & Spells', icon: 'fa-solid fa-bolt', cssClass: 'page3' },
        { id: 'conditions', label: '4: Conditions & Effects', icon: 'fa-solid fa-shield-virus', cssClass: 'conditions' },
        { id: 'story', label: '5: Story & Sponsors', icon: 'fa-solid fa-book-open', cssClass: 'story' },
        { id: 'achievements', label: '6: Achievements', icon: 'fa-solid fa-trophy', cssClass: 'achievements' }
      ]
    }
  };

  static PARTS = {
    tabs: { template: `${SYSTEM_PATH}/templates/shared/tab-nav.hbs` },
    page1: {
      template: `${PARTS_PATH}/page1-core.hbs`,
      templates: [
        `${PARTS_PATH}/identity-pet.hbs`,
        `${PARTS_PATH}/identity-mercenary.hbs`,
        `${PARTS_PATH}/identity-vehicle.hbs`,
        `${PARTS_PATH}/vehicle-role-select.hbs`,
        `${PARTS_PATH}/hotlist.hbs`
      ],
      scrollable: ['']
    },
    page4: { template: `${PARTS_PATH}/page4-inventory.hbs`, scrollable: [''] },
    page3: { template: `${PARTS_PATH}/page3-skills.hbs`, templates: [`${PARTS_PATH}/spells.hbs`], scrollable: [''] },
    conditions: { template: `${PARTS_PATH}/conditions.hbs`, scrollable: [''] },
    story: { template: `${PARTS_PATH}/story-extras.hbs`, templates: [`${PARTS_PATH}/companions.hbs`, `${PARTS_PATH}/vehicle-role-select.hbs`], scrollable: [''] },
    achievements: { template: `${PARTS_PATH}/achievements.hbs`, scrollable: [''] }
  };

  /** Gear-granted skills and spells from the last context build, by synthetic id (roll actions read these). */
  _grantedSkills = new Map();
  _grantedSpells = new Map();

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;

    prepareCoreContext(context, actor);
    prepareItemLists(context, actor);
    await prepareItemSummaries(context, actor);
    const { grantedSkills, grantedSpells } = prepareSkillsAndSpells(context, actor);
    this._grantedSkills = grantedSkills;
    this._grantedSpells = grantedSpells;
    await prepareGrantedSummaries([...grantedSkills.values(), ...grantedSpells.values()], actor);
    prepareInventory(context, actor, this._inventorySort);
    prepareCombat(context, actor, { showStowedAttacks: this._showStowedAttacks });
    prepareHotlist(context, actor);
    await prepareExternalBuffs(context, actor);
    prepareAchievements(context, actor, this._achievementFilter);
    prepareStory(context, actor);
    return context;
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.querySelector?.('.cog-actor-tags-section [data-tag-entry] input')?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (this.isEditable) addActorTag(this, event.currentTarget ?? event.target);
    });
    if (this._achievementFilter) {
      applyAchievementFilter(this.element.querySelector('section.tab[data-tab="achievements"]'), this._achievementFilter);
    }
    if (this._scrollToAttacks) {
      this._scrollToAttacks = false;
      this._scrollToAttacksSection();
    }
  }

  /** Show page 1 and scroll its attacks section to the top of the tab. */
  _scrollToAttacksSection() {
    this.changeTab('page1', 'primary');
    const page = this.element?.querySelector?.('section.tab[data-tab="page1"]');
    const target = page?.querySelector('[data-section="attacks"]');
    if (!target) return;
    if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'start' });
    else if (typeof target.offsetTop === 'number') page.scrollTop = target.offsetTop;
  }

  /* -------------------------------------------- */
  /*  Form submission                             */
  /* -------------------------------------------- */

  /**
   * Limbs are GM-only: a player's submission never carries them.
   * @override
   */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    const limbs = data.system?.attributes?.limbs;
    if (limbs && !game.user?.isGM) {
      for (const path of GM_ONLY_LIMB_FIELDS) delete limbs[path.split('.').pop()];
    }
    if ('bossTier' in data) {
      const tier = data.bossTier;
      delete data.bossTier;
      if (this.actor.type === 'mob') {
        data.system ??= {};
        data.system.tags = bossTierTags(this.actor.system?.tags, tier);
      }
    }
    return data;
  }

  /**
   * A synthetic token actor of a crawler or pet also writes its base world actor.
   * @override
   */
  async _processSubmitData(event, form, submitData, ...rest) {
    const actor = this.actor;
    if (actor.isToken && (actor.type === 'crawler' || actor.type === 'pet')) {
      const base = actor.token?.baseActor ?? game.actors?.get?.(actor.token?.actorId ?? actor.id);
      if (base && base !== actor) await base.update(submitData);
    }
    return super._processSubmitData(event, form, submitData, ...rest);
  }

  /* -------------------------------------------- */
  /*  Drag and drop                               */
  /* -------------------------------------------- */

  /** @override */
  async _onDropItem(event, item) {
    if (!this.actor.isOwner) return null;
    const result = await dropItem(this, event, item);
    // Race / class drops apply the item rather than embedding a copy, so only embedded results transfer.
    if (result && !['race', 'class'].includes(item.type)) await completeItemTransfer(item, this.actor);
    return result;
  }

  /**
   * Record the source entry on created items (compendium id from the source `_id`).
   * @override
   */
  async _onDropItemCreate(itemData, event) {
    const list = [itemData].flat().filter(Boolean);
    for (const data of list) {
      data.flags ??= {};
      data.flags[SYSTEM_ID] ??= {};
      if (data._id && !data.flags[SYSTEM_ID].compendiumId) data.flags[SYSTEM_ID].compendiumId = data._id;
    }
    return super._onDropItemCreate(list, event);
  }

  /** @override */
  async _onDropActor(event, actor) {
    if (!this.actor.isOwner) return null;
    return dropActor(this, event, actor);
  }

  /**
   * Gear and loot share the inventory table, so they sort as one group.
   * @override
   */
  _isSortSibling(source, other) {
    if (other.id === source.id) return false;
    const inventory = ['gear', 'loot'];
    if (inventory.includes(source.type)) return inventory.includes(other.type);
    return other.type === source.type;
  }

  /* -------------------------------------------- */
  /*  Helpers used by actions                     */
  /* -------------------------------------------- */

  /** @param {string|null} selectedSkillId */
  _openGrindApp(selectedSkillId = null) {
    COGGrindApp.open({ actor: this.actor, selectedSkillId });
  }

  /**
   * Ask, then rest.
   * @param {'1hour'|'short'|'long'|'fullDay'} restType
   */
  async _onRest(restType = 'long') {
    const label = REST_LABELS[restType] || 'Rest';
    const desc = REST_DESCRIPTIONS[restType] || '';
    const hours = REST_HOURS[restType] ?? 8;
    const answer = await foundry.applications.api.DialogV2.wait({
      window: { title: label },
      content: `<p>Take a <strong>${label}</strong>?</p><p class="cog-text-muted" style="font-size: 13px;">${desc}</p>`
        + `<div class="form-group"><label><input type="checkbox" name="advanceClock" checked> Let the dungeon clock run (${hours} ${hours === 1 ? 'hour' : 'hours'} off the Collapse Clock). A party resting together unticks this for all but one crawler.</label></div>`,
      buttons: [
        { action: 'yes', icon: 'fa-solid fa-check', label: 'Rest', default: true, callback: (event, button) => ({ advanceClock: isChecked(button.form?.elements?.advanceClock) }) },
        { action: 'no', icon: 'fa-solid fa-xmark', label: 'Cancel' }
      ],
      rejectClose: false
    });
    if (!answer || typeof answer !== 'object') return;
    await this.actor.rest(restType, { advanceClock: answer.advanceClock });
  }

  /** @param {string} [activeCategory] */
  _openSkillPicker(activeCategory = 'all') {
    new COGSkillManager({ actor: this.actor, activeCategory }).render({ force: true });
  }

  _openSpellPicker() {
    new COGSpellManager({ actor: this.actor }).render({ force: true });
  }

  /**
   * @param {string} [activeCategory]
   * @param {string} [activeSlot]
   */
  _openItemPicker(activeCategory = 'all', activeSlot = 'all') {
    new COGItemManager({ actor: this.actor, activeCategory, activeSlot }).render({ force: true });
  }

  /**
   * @param {string|null} targetSlot
   * @param {string} initialTab
   */
  _openBuffPicker(targetSlot = null, initialTab = 'all') {
    new COGBuffDebuffManager({ actor: this.actor, targetSlot, activeTab: initialTab }).render({ force: true });
  }

  _openAchievementPicker() {
    new COGAchievementManagerApp({ actor: this.actor }).render({ force: true });
  }

  /** Export the crawler to the fillable PDF character sheet. */
  async _onExportPdf() {
    try {
      const { saveCrawlerPdf, resolveTemplateSource, notifyNoSheetPdf } = await import('../apps/pdf-exporter.mjs');
      if (!resolveTemplateSource()) {
        notifyNoSheetPdf();
        return;
      }
      ui.notifications?.info(`Exporting ${this.actor.name || 'crawler'} to fillable PDF...`);
      await saveCrawlerPdf(this.actor);
      ui.notifications?.info(`Successfully exported ${this.actor.name || 'crawler'} to character sheet PDF.`);
    } catch (err) {
      console.error('Failed to export crawler sheet to PDF:', err);
      ui.notifications?.error(`Failed to export PDF: ${err.message}`);
    }
  }
}
