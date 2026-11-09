/**
 * Sprinter RPG — Crawler Token Action HUDs
 *
 * 1. Hotbar HUD: Displays 10 hotbar action slots directly above Foundry's macro bar (#hotbar).
 * 2. Left Action HUD: Displays all attacks and non-passive skills on the left of the screen,
 *    positioned directly below the scene list (#navigation / #scene-list).
 */

import { HIDEABLE_HUD_CLASS } from '../utils/effects/hud-visibility.mjs';
import { nextCameraChoice, armedCamera, camerasOffered, cameraArmView } from '../utils/roll/cameras.mjs';
import { isWeaponGear } from '../documents/actor.mjs';
import { SYSTEM_PATH, SYSTEM_ID } from '../constants.mjs';
import { COGToolApp } from './tool-app.mjs';
import { primaryDamagePart, formatDamagePart } from '../utils/damage/damage-parts.mjs';
import { isPassiveSkill, isAttackSkill, spellRole, spellRoleLabel } from '../utils/tag/tag-mechanics.mjs';
import { hotlistSlotId, resolveHotlistItem, isActivatableGear } from '../utils/ui/hotlist.mjs';
import { offersSpellAttack } from '../utils/attack/spell-cast-link.mjs';
import { attackText } from '../utils/attack/attack-text.mjs';
import { skipOptions } from '../utils/attack/attack-options.mjs';
import { setItemEquipped } from '../documents/item/enchantments.mjs';
import { setDebuffPaused, canSwitchDebuff } from '../documents/actor/debuff-switch.mjs';
import { rollDamageFromHitCard } from '../utils/damage/hit-card-damage.mjs';

/** Client-scoped setting holding the dragged position of the action HUD. */
export const ACTION_HUD_POSITION_SETTING = 'actionHudPosition';

/**
 * Finds an owned item by id on an actor, from its item collection.
 * @param {object} actor
 * @param {string} itemId
 * @returns {object|undefined}
 */
function findActorItem(actor, itemId) {
  return actor?.items?.get(itemId);
}

/** Mount a frameless HUD next to a host element, falling back to the interface layer, then the body. */
function replaceOrAppend(element, parentFor) {
  const doc = globalThis.document;
  if (!doc) return;
  const existing = doc.getElementById(element.id);
  if (existing) {
    existing.replaceWith(element);
    return;
  }
  parentFor(doc)?.appendChild(element);
}

/**
 * =========================================================================
 * COGCrawlerHotbarHUD
 * Frameless AppV2 overlay with the 10 hotbar action slots directly above Foundry's macro bar.
 * Open with `new COGCrawlerHotbarHUD(actor, token).render({ force: true })`.
 * =========================================================================
 */
export class COGCrawlerHotbarHUD extends COGToolApp {
  static DEFAULT_OPTIONS = {
    id: 'cog-crawler-hotbar-hud',
    classes: ['cog-hud-overlay', HIDEABLE_HUD_CLASS, 'cog-crawler-hotbar-hud'],
    window: { frame: false, positioned: false, resizable: false, minimizable: false },
    actions: {
      toggleCollapsed: COGCrawlerHotbarHUD.#onToggleCollapsed,
      attackHit: COGCrawlerHotbarHUD.#onAttackHit,
      attackDamage: COGCrawlerHotbarHUD.#onAttackDamage,
      castSpell: COGCrawlerHotbarHUD.#onCastSpell,
      spellDamage: COGCrawlerHotbarHUD.#onSpellDamage,
      spellAttack: COGCrawlerHotbarHUD.#onSpellAttack,
      toggleEquip: COGCrawlerHotbarHUD.#onToggleEquip,
      useItem: COGCrawlerHotbarHUD.#onUseItem,
      clearSlot: COGCrawlerHotbarHUD.#onClearSlot
    }
  };

  static PARTS = {
    content: { template: `${SYSTEM_PATH}/templates/apps/crawler-hotbar-hud.hbs` }
  };

  constructor(actor, token = null, options = {}) {
    super(options);
    this.actor = actor;
    this.token = token;
    this.isCollapsed = Boolean(options.isCollapsed);
  }

  /** Nothing to show without a crawler. @override */
  _canRender(options) {
    if (!this.actor) return false;
    return super._canRender?.(options);
  }

  /**
   * Prepares the 10 slots data structure identically to the character sheet.
   * @override
   */
  async _prepareContext(options = {}) {
    const context = await super._prepareContext(options);
    const hotlistData = this.actor?.system?.hotlist || {};
    const slots = [];

    for (let i = 1; i <= 10; i++) {
      const slotKey = `slot${i}`;
      const valStr = hotlistSlotId(hotlistData[slotKey]);
      const resolvedItem = resolveHotlistItem(this.actor, valStr);
      let displayName = resolvedItem?.name || valStr;
      let slotType = resolvedItem?.type || '';
      let badge = '';
      let detail = '';
      let isSpell = false;
      let isGear = false;
      let isLoot = false;
      let isAttack = false;
      let isSkill = false;
      let isEquipped = false;
      let canActivate = false;
      let hasDamage = false;
      let isAttackSpell = false;
      let attackTitle = '';
      let damageTitle = '';

      if (resolvedItem) {
        if (slotType === 'spell') {
          isSpell = true;
          badge = 'SPELL';
          detail = `${resolvedItem.system?.manaCost ?? 0} MP`;
          const role = spellRole(resolvedItem);
          if (role !== 'none') detail += ` • ${spellRoleLabel(role)}`;
          const dmg = typeof this.actor?.getSpellDamageData === 'function'
            ? this.actor.getSpellDamageData(resolvedItem)
            : null;
          hasDamage = Boolean(dmg?.hasDamage);
          isAttackSpell = offersSpellAttack(resolvedItem);
          // The icon-only Dmg/Atk buttons carry their formula in the tooltip, as the sheet's attack tooltip does
          if (hasDamage) {
            damageTitle = attackText('COG.SpellCast.HudDamage', { name: displayName, formula: dmg.formulaWithStat || dmg.formula });
          }
          if (isAttackSpell) {
            attackTitle = attackText('COG.SpellCast.HudAttack', {
              name: displayName, rank: resolvedItem.system?.rank ?? 0, stat: String(resolvedItem.system?.stat || 'int').toUpperCase()
            });
          }
        } else if (slotType === 'gear') {
          isGear = true;
          const slotName = resolvedItem.system?.slot || 'gear';
          isEquipped = Boolean(resolvedItem.system?.equipped);
          badge = slotName.toUpperCase();
          detail = isEquipped ? 'Equipped' : 'Unequipped';
          canActivate = isActivatableGear(resolvedItem);
        } else if (slotType === 'loot') {
          isLoot = true;
          badge = 'ITEM';
          detail = `x${resolvedItem.system?.quantity ?? 1}`;
        } else if (slotType === 'attack') {
          isAttack = true;
          badge = 'ATTACK';
          detail = formatDamagePart(primaryDamagePart(resolvedItem.system));
          hasDamage = true;
        } else if (slotType === 'skill') {
          isSkill = true;
          const dmg = typeof this.actor?.getSkillDamageData === 'function'
            ? this.actor.getSkillDamageData(resolvedItem)
            : { hasDamage: false };
          hasDamage = Boolean(dmg?.hasDamage);
          isAttack = resolvedItem.system?.isAttack === true;
          badge = isAttack ? 'ATTACK' : 'SKILL';
          const rk = resolvedItem.system?.modifiedRank ?? resolvedItem.system?.rank ?? 1;
          detail = `Rank ${rk}`;
          if (hasDamage && dmg.formulaWithStat) {
            detail += ` • ${dmg.formulaWithStat}`;
          }
        } else {
          badge = slotType.toUpperCase();
        }
      }

      slots.push({
        index: i,
        key: slotKey,
        value: valStr,
        isEmpty: !valStr || !resolvedItem,
        item: resolvedItem,
        itemId: resolvedItem?.id || '',
        name: displayName,
        img: resolvedItem ? (resolvedItem.img || 'icons/svg/item-bag.svg') : '',
        type: slotType,
        badge,
        detail,
        isSpell,
        isAttackSpell,
        attackTitle,
        damageTitle,
        isGear,
        isLoot,
        isAttack,
        isSkill,
        isEquipped,
        canActivate,
        hasDamage
      });
    }

    return Object.assign(context, {
      actor: this.actor,
      token: this.token,
      crawlerName: this.actor?.name || 'Crawler',
      isCollapsed: this.isCollapsed,
      slots
    });
  }

  /** Insert above Foundry's macro bar. @override */
  async _insertElement(element, options = {}) {
    replaceOrAppend(element, (doc) => {
      const hotbar = doc.getElementById('hotbar');
      if (hotbar?.parentElement) {
        hotbar.parentElement.insertBefore(element, hotbar);
        return null;
      }
      return doc.getElementById('ui-bottom') || doc.body;
    });
  }

  /** Slot drag and drop is delegated at the root so it survives every re-render. @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.element.addEventListener('dragover', (event) => {
      const slot = event.target?.closest?.('.cog-hotbar-hud-slot');
      if (!slot) return;
      event.preventDefault();
      slot.classList.add('drag-over');
    });
    this.element.addEventListener('dragleave', (event) => {
      event.target?.closest?.('.cog-hotbar-hud-slot')?.classList.remove('drag-over');
    });
    this.element.addEventListener('drop', (event) => {
      const slot = event.target?.closest?.('.cog-hotbar-hud-slot');
      if (!slot) return;
      event.preventDefault();
      slot.classList.remove('drag-over');
      return this._onDropOnSlot(event, slot.dataset.slot);
    });
  }

  /**
   * Store a dropped item in a hotlist slot.
   * @param {DragEvent} event
   * @param {string} slot hotlist slot key, e.g. `slot3`
   */
  async _onDropOnSlot(event, slot) {
    if (!slot) return;
    let data;
    try {
      data = JSON.parse(event.dataTransfer?.getData('text/plain'));
    } catch (_) {
      return;
    }

    if (data?.type === 'Item') {
      let item = null;
      if (typeof globalThis.Item?.fromDropData === 'function') {
        item = await globalThis.Item.fromDropData(data);
      } else if (data.uuid) {
        item = this.actor.items?.get(data.uuid);
      }
      if (item) {
        await this.actor.update({ [`system.hotlist.${slot}`]: item.id });
      }
    }
  }

  static async #onToggleCollapsed() {
    this.isCollapsed = !this.isCollapsed;
    await this.render();
  }

  static async #onAttackHit(event, target) {
    const item = findActorItem(this.actor, target.dataset.itemId);
    if (item && typeof this.actor.rollAttack === 'function') {
      await this.actor.rollAttack(item, 'hit', skipOptions(event));
    } else if (item && typeof item.roll === 'function') {
      await item.roll();
    }
  }

  static async #onAttackDamage(event, target) {
    const item = findActorItem(this.actor, target.dataset.itemId);
    if (item && (await rollDamageFromHitCard(this.actor, item)).found) return;
    if (item && typeof this.actor.rollAttack === 'function') {
      await this.actor.rollAttack(item, 'damage', skipOptions(event));
    } else if (item && typeof item.roll === 'function') {
      await item.roll('damage');
    }
  }

  static async #onCastSpell(event, target) {
    const itemId = target.dataset.itemId;
    const item = findActorItem(this.actor, itemId);
    if (item && typeof this.actor.rollSpell === 'function') {
      await this.actor.rollSpell(item);
    } else if (item && typeof item.roll === 'function') {
      await item.roll();
    }
  }

  static async #onSpellDamage(event, target) {
    const item = findActorItem(this.actor, target.dataset.itemId);
    if (item && (await rollDamageFromHitCard(this.actor, item)).found) return;
    if (item && typeof this.actor.rollSpellDamage === 'function') {
      await this.actor.rollSpellDamage(item, skipOptions(event));
    } else if (item && typeof item.roll === 'function') {
      await item.roll('damage');
    }
  }

  /** Roll the spell attack for the latest cast; shift-click skips the pop-up. */
  static async #onSpellAttack(event, target) {
    const item = findActorItem(this.actor, target.dataset.itemId);
    if (item && typeof this.actor.rollSpellAttack === 'function') {
      await this.actor.rollSpellAttack(item, skipOptions(event));
    }
  }

  static async #onToggleEquip(event, target) {
    const item = findActorItem(this.actor, target.dataset.itemId);
    if (item) {
      await setItemEquipped(item, !item.system?.equipped);
    }
  }

  /** Use a loot item, or roll a hotlisted skill. */
  static async #onUseItem(event, target) {
    const item = findActorItem(this.actor, target.dataset.itemId);
    if (!item) return;

    if (item.type === 'skill') {
      if (typeof this.actor.rollSkill === 'function') {
        return this.actor.rollSkill(item);
      }
      return;
    }
    if (typeof item.useLoot === 'function') {
      await item.useLoot();
    } else if (typeof item.roll === 'function') {
      await item.roll();
    }
  }

  static async #onClearSlot(event, target) {
    const slot = target.dataset.slot;
    if (slot) {
      await this.actor.update({ [`system.hotlist.${slot}`]: '' });
    }
  }
}

/**
 * =========================================================================
 * COGCrawlerActionHUD
 * Frameless AppV2 overlay listing all attacks and non-passive skills on the left of the screen,
 * positioned directly below v14's scene navigation (#scene-navigation); the user can drag it
 * (position kept per client) and reset it back to the anchor.
 * Open with `new COGCrawlerActionHUD(actor, token).render({ force: true })`.
 * =========================================================================
 */
export class COGCrawlerActionHUD extends COGToolApp {
  static DEFAULT_OPTIONS = {
    id: 'cog-crawler-action-hud',
    classes: ['cog-hud-overlay', HIDEABLE_HUD_CLASS, 'cog-crawler-action-hud'],
    window: { frame: false, positioned: false, resizable: false, minimizable: false },
    actions: {
      toggleCollapsed: COGCrawlerActionHUD.#onToggleCollapsed,
      resetPosition: COGCrawlerActionHUD.#onResetPosition,
      cycleCameras: COGCrawlerActionHUD.#onCycleCameras,
      attackHit: COGCrawlerActionHUD.#onAttackHit,
      attackDamage: COGCrawlerActionHUD.#onAttackDamage,
      rollSkill: COGCrawlerActionHUD.#onRollSkill,
      toggleDebuffPaused: COGCrawlerActionHUD.#onToggleDebuffPaused,
      skillDamage: COGCrawlerActionHUD.#onSkillDamage
    }
  };

  static PARTS = {
    content: { template: `${SYSTEM_PATH}/templates/apps/crawler-action-hud.hbs` }
  };

  constructor(actor, token = null, options = {}) {
    super(options);
    this.actor = actor;
    this.token = token;
    this.isCollapsed = Boolean(options.isCollapsed);
  }

  /** Nothing to show without a crawler. @override */
  _canRender(options) {
    if (!this.actor) return false;
    return super._canRender?.(options);
  }

  /**
   * Prepares attacks and non-passive skills.
   * @override
   */
  async _prepareContext(options = {}) {
    const context = await super._prepareContext(options);
    const allItems = Array.from(this.actor?.items ?? []);

    const attacks = [];
    const skills = [];

    for (const item of allItems) {
      const isAttack = item.type === 'attack' && item.system?.equipped !== false;
      const isWeapon = item.type === 'gear' && item.system?.equipped && isWeaponGear(item);
      if (isAttack || isWeapon) {
        const formula = formatDamagePart(primaryDamagePart(item.system), { withType: true });

        attacks.push({
          id: item.id,
          name: item.name,
          img: item.img || 'icons/svg/sword.svg',
          formula: formula.trim(),
          item
        });
      } else if (item.type === 'skill') {
        if (isPassiveSkill(item)) continue; // Filter out passive skills!

        const rank = item.system?.modifiedRank ?? item.system?.rank ?? 1;
        const stat = (item.system?.stat || 'str').toLowerCase();
        const statMod = this.actor?.system?.abilities?.[stat]?.mod ?? 0;
        const totalSkill = rank + statMod;

        const dmgData = typeof this.actor?.getSkillDamageData === 'function'
          ? this.actor.getSkillDamageData(item)
          : { hasDamage: false };

        let isAttack;
        if (item.system?.isAttack === true) {
          isAttack = true;
        } else if (item.system?.isAttack === false) {
          isAttack = false;
        } else {
          isAttack = isAttackSkill(item) || dmgData.hasDamage;
        }

        skills.push({
          id: item.id,
          name: item.name,
          img: item.img || 'icons/svg/aura.svg',
          rank,
          stat: stat.toUpperCase(),
          statMod,
          statModStr: statMod >= 0 ? `+${statMod}` : `${statMod}`,
          totalSkill,
          totalSkillStr: totalSkill >= 0 ? `+${totalSkill}` : `${totalSkill}`,
          hasDamage: dmgData.hasDamage,
          damageFormula: dmgData.formulaWithStat || '',
          isAttack,
          item
        });
      }
    }

    const debuffs = allItems.filter(i => i.type === 'debuff' && canSwitchDebuff(i)).map(i => ({
      id: i.id, name: i.name, img: i.img || 'icons/svg/skull.svg', paused: i.system?.paused === true
    }));
    debuffs.sort((a, b) => a.name.localeCompare(b.name));

    // Sort alphabetically by name
    attacks.sort((a, b) => a.name.localeCompare(b.name));
    skills.sort((a, b) => a.name.localeCompare(b.name));

    return Object.assign(context, {
      actor: this.actor,
      token: this.token,
      crawlerName: this.actor?.name || 'Crawler',
      isCollapsed: this.isCollapsed,
      cameraArm: camerasOffered(this.actor) ? cameraArmView(this.actor) : null,
      attacks,
      skills,
      debuffs,
      attackCount: attacks.length,
      skillCount: skills.length
    });
  }

  /** The user's dragged position for this client, or null to use the scene-navigation anchor. */
  static get savedPosition() {
    let saved;
    try { saved = globalThis.game?.settings?.get(SYSTEM_ID, ACTION_HUD_POSITION_SETTING); } catch { saved = null; }
    if (saved?.left == null || saved?.top == null) return null;
    const left = Number(saved.left);
    const top = Number(saved.top);
    return Number.isFinite(left) && Number.isFinite(top) ? { left, top } : null;
  }

  /** Keep the panel's top-left corner inside the viewport. */
  static #clamp({ left, top }) {
    const win = globalThis.window;
    const maxLeft = Math.max(0, (win?.innerWidth ?? Infinity) - 40);
    const maxTop = Math.max(0, (win?.innerHeight ?? Infinity) - 40);
    return { left: Math.min(Math.max(0, Math.round(left)), maxLeft), top: Math.min(Math.max(0, Math.round(top)), maxTop) };
  }

  /** The default dock: just below Foundry's scene navigation (v14 `#scene-navigation`). */
  static anchorPosition() {
    const doc = globalThis.document;
    const nav = doc?.getElementById?.('scene-navigation-active') || doc?.getElementById?.('scene-navigation') || doc?.getElementById?.('navigation') || doc?.getElementById?.('scene-list');
    let top = 65;
    let left = 120;
    if (nav && typeof nav.getBoundingClientRect === 'function') {
      const rect = nav.getBoundingClientRect();
      if (rect.bottom > 0) top = Math.round(rect.bottom + 6);
      if (rect.left > 0) left = Math.round(rect.left);
    }
    return { left, top };
  }

  /** Place the panel at the user's saved position, else at the scene-navigation anchor. */
  updatePosition() {
    if (!this.element?.style) return;
    const { left, top } = COGCrawlerActionHUD.#clamp(COGCrawlerActionHUD.savedPosition ?? COGCrawlerActionHUD.anchorPosition());
    this.#applyPosition(left, top);
  }

  #applyPosition(left, top) {
    // Core's position proxy re-measures the panel against its parent element (v14 `_updatePosition`), which is null
    // while the element is detached (closing during a scene switch): a redock then threw. Skip the proxy until it is
    // in the DOM; the inline styles below are enough for a detached panel.
    if (this.position && this.element?.parentElement) Object.assign(this.position, { left, top });
    this.element.style.setProperty('--cog-action-hud-top', `${top}px`);
    this.element.style.setProperty('--cog-action-hud-left', `${left}px`);
    this.element.style.top = `${top}px`;
    this.element.style.left = `${left}px`;
  }

  /** Called by core's Draggable while the user drags the header. @override */
  setPosition(position = {}) {
    if (!this.element?.style) return this.position;
    const { left, top } = COGCrawlerActionHUD.#clamp({
      left: position.left ?? this.position.left ?? 0,
      top: position.top ?? this.position.top ?? 0
    });
    this.#applyPosition(left, top);
    return this.position;
  }

  /** Remember the current (dragged) position for this client. */
  async savePosition() {
    const { left, top } = this.position;
    await globalThis.game?.settings?.set(SYSTEM_ID, ACTION_HUD_POSITION_SETTING, { left, top });
  }

  /** Forget the dragged position and return to the anchor. */
  async resetPosition() {
    await globalThis.game?.settings?.set(SYSTEM_ID, ACTION_HUD_POSITION_SETTING, null);
    this.updatePosition();
  }

  /** Make the header a drag handle with core's Draggable. */
  #activateDrag() {
    const Draggable = globalThis.foundry?.applications?.ux?.Draggable;
    const handle = this.element?.querySelector?.('.cog-action-hud-header');
    if (!Draggable || !handle) return;
    const hud = this;
    class SavingDraggable extends Draggable {
      _onDragMouseUp(event) {
        super._onDragMouseUp(event);
        hud.savePosition();
      }
    }
    this._draggable = new SavingDraggable(this, this.element, handle, false);
  }

  /** Mount in the interface layer. @override */
  async _insertElement(element, options = {}) {
    replaceOrAppend(element, (doc) => doc.getElementById('interface') || doc.body);
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.updatePosition();
    this.#activateDrag();
  }

  static async #onToggleCollapsed() {
    this.isCollapsed = !this.isCollapsed;
    await this.render();
  }

  /** Cycle the Playing to the Cameras choice armed for the next roll: None, Audience, AI, Sponsors (E6.10). */
  static async #onCycleCameras() {
    await this.actor.armCameras?.(nextCameraChoice(armedCamera(this.actor)));
    await this.render();
  }

  static async #onResetPosition() {
    await this.resetPosition();
  }

  static async #onAttackHit(event, target) {
    const item = findActorItem(this.actor, target.closest('[data-item-id]')?.dataset.itemId);
    if (item && typeof this.actor.rollAttack === 'function') {
      await this.actor.rollAttack(item, 'hit', skipOptions(event));
    } else if (item && typeof item.roll === 'function') {
      await item.roll();
    }
  }

  static async #onAttackDamage(event, target) {
    const item = findActorItem(this.actor, target.closest('[data-item-id]')?.dataset.itemId);
    if (item && (await rollDamageFromHitCard(this.actor, item)).found) return;
    if (item && typeof this.actor.rollAttack === 'function') {
      await this.actor.rollAttack(item, 'damage', skipOptions(event));
    } else if (item && typeof item.roll === 'function') {
      await item.roll('damage');
    }
  }

  /** Roll a skill's attack check when it is an attack skill, otherwise its skill check. */
  static async #onRollSkill(event, target) {
    const item = findActorItem(this.actor, target.closest('[data-item-id]')?.dataset.itemId);
    if (!item) return;

    const dmgData = typeof this.actor?.getSkillDamageData === 'function'
      ? this.actor.getSkillDamageData(item)
      : { hasDamage: false };
    let isAttack;
    if (item.system?.isAttack === true) {
      isAttack = true;
    } else if (item.system?.isAttack === false) {
      isAttack = false;
    } else {
      isAttack = isAttackSkill(item) || dmgData.hasDamage;
    }

    if (isAttack && typeof this.actor.rollAttack === 'function') {
      await this.actor.rollAttack(item, 'hit', skipOptions(event));
    } else if (typeof this.actor.rollSkill === 'function') {
      await this.actor.rollSkill(item);
    } else if (typeof item.roll === 'function') {
      await item.roll();
    }
  }

  /** Pause or resume a debuff (owner or GM). */
  static async #onToggleDebuffPaused(event, target) {
    const item = findActorItem(this.actor, target.closest('[data-item-id]')?.dataset.itemId);
    if (item) await setDebuffPaused(item);
  }

  static async #onSkillDamage(event, target) {
    const item = findActorItem(this.actor, target.closest('[data-item-id]')?.dataset.itemId);
    if (item && (await rollDamageFromHitCard(this.actor, item)).found) return;
    if (item && typeof this.actor.rollSkillDamage === 'function') {
      await this.actor.rollSkillDamage(item, skipOptions(event));
    } else if (item && typeof this.actor.rollAttack === 'function') {
      await this.actor.rollAttack(item, 'damage', skipOptions(event));
    }
  }
}

/**
 * =========================================================================
 * COGCrawlerTokenHUD
 * Master manager orchestrating Hotbar HUD and Left Action Panel on token selection.
 * =========================================================================
 */
export class COGCrawlerTokenHUD {
  constructor() {
    this.hotbarHUD = null;
    this.actionHUD = null;
    this.activeActor = null;
    this.activeToken = null;
    this._initialized = false;
  }

  /**
   * Initializes hooks for token selection and actor updates.
   */
  init() {
    if (this._initialized) return;
    this._initialized = true;

    // Token control selection hook
    Hooks.on('controlToken', (token, controlled) => {
      this.onControlToken(token, controlled);
    });

    // Scene Navigation render hook to re-align left panel
    const redock = () => this.actionHUD?.updatePosition();
    Hooks.on('renderSceneNavigation', redock);
    // Collapsing the navigation animates its height: re-dock now and once it settles.
    Hooks.on('collapseSceneNavigation', () => {
      redock();
      globalThis.setTimeout?.(redock, 400);
    });

    // Actor update hook
    Hooks.on('updateActor', (actor) => {
      if (this.activeActor && actor && (actor.id === this.activeActor.id || actor._id === this.activeActor.id)) {
        this.render();
      }
    });

    // Item updates on active actor
    const onItemChange = (item) => {
      const actorId = item?.actor?.id || item?.parent?.id;
      if (this.activeActor && actorId && (actorId === this.activeActor.id || actorId === this.activeActor._id)) {
        this.render();
      }
    };
    Hooks.on('updateItem', onItemChange);
    Hooks.on('createItem', onItemChange);
    Hooks.on('deleteItem', onItemChange);

    // Token deletion hook
    Hooks.on('deleteToken', (token) => {
      if (this.activeToken && (token.id === this.activeToken.id || token._id === this.activeToken._id)) {
        this.close();
      }
    });

    // Canvas ready / reload
    Hooks.on('canvasReady', () => {
      this.syncControlledToken();
    });

    // Window resize
    if (globalThis.window?.addEventListener) {
      globalThis.window.addEventListener('resize', () => {
        redock();
      });
    }
  }

  /**
   * Detects currently controlled crawler token on canvas.
   * @returns {object|null}
   */
  getControlledCrawler() {
    const controlled = globalThis.canvas?.tokens?.controlled || [];
    if (!Array.isArray(controlled) || controlled.length === 0) return null;
    return controlled.find(t => t.actor?.type === 'crawler') || null;
  }

  /**
   * Syncs HUD state with canvas controlled tokens.
   */
  syncControlledToken() {
    const crawlerToken = this.getControlledCrawler();
    if (crawlerToken) {
      this.updateForToken(crawlerToken);
    } else {
      this.close();
    }
  }

  /**
   * Handles controlToken hook event.
   */
  onControlToken(token, controlled) {
    if (controlled) {
      if (token?.actor?.type === 'crawler') {
        this.updateForToken(token);
        return;
      }
    }
    // Check if any other crawler remains controlled
    this.syncControlledToken();
  }

  /**
   * Updates and renders both HUDs for a given crawler token.
   */
  async updateForToken(token) {
    if (!token || token.actor?.type !== 'crawler') {
      return this.close();
    }
    const actor = token.actor;
    this.activeToken = token;
    this.activeActor = actor;
    // A close() or a newer control change during an awaited close() supersedes this update.
    const superseded = () => this.activeActor?.id !== actor.id || this.activeToken !== token;

    if (!this.hotbarHUD || this.hotbarHUD.actor?.id !== actor.id) {
      if (this.hotbarHUD) await this.hotbarHUD.close();
      if (superseded()) return;
      this.hotbarHUD = new COGCrawlerHotbarHUD(actor, token);
    } else {
      this.hotbarHUD.actor = actor;
      this.hotbarHUD.token = token;
    }

    if (!this.actionHUD || this.actionHUD.actor?.id !== actor.id) {
      if (this.actionHUD) await this.actionHUD.close();
      if (superseded()) return;
      this.actionHUD = new COGCrawlerActionHUD(actor, token);
    } else {
      this.actionHUD.actor = actor;
      this.actionHUD.token = token;
    }

    await Promise.all([
      this.hotbarHUD.render({ force: true }),
      this.actionHUD.render({ force: true })
    ]);
  }

  /**
   * Re-renders active HUDs with current data.
   */
  async render() {
    if (!this.activeActor) return;
    const promises = [];
    if (this.hotbarHUD) promises.push(this.hotbarHUD.render());
    if (this.actionHUD) promises.push(this.actionHUD.render());
    await Promise.all(promises);
  }

  /**
   * Closes both HUDs and clears references.
   */
  async close() {
    const promises = [];
    if (this.hotbarHUD) promises.push(this.hotbarHUD.close());
    if (this.actionHUD) promises.push(this.actionHUD.close());
    this.hotbarHUD = null;
    this.actionHUD = null;
    this.activeActor = null;
    this.activeToken = null;
    await Promise.all(promises);
  }
}

/**
 * Singleton instance and initialization function.
 */
let crawlerTokenHUDInstance = null;

export function getCrawlerTokenHUD() {
  if (!crawlerTokenHUDInstance) {
    crawlerTokenHUDInstance = new COGCrawlerTokenHUD();
  }
  return crawlerTokenHUDInstance;
}

export function initCrawlerTokenHUD() {
  const hud = getCrawlerTokenHUD();
  hud.init();
  return hud;
}
