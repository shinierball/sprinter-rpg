import { SYSTEM_ID, SYSTEM_PATH } from '../constants.mjs';
import { HIDEABLE_HUD_CLASS } from '../utils/effects/hud-visibility.mjs';
import { isAuraItem } from '../utils/tag/tag-mechanics.mjs';
import { COGToolApp } from './tool-app.mjs';
import { durationRounds, durationRemainingLabel, durationConfigText } from '../utils/time/durations.mjs';
import { getSingleton } from './singleton.mjs';
import { activeDispels, isBuffDispelled, removeDispelEntry } from '../utils/effects/dispel.mjs';
/**
 * Sprinter RPG — Pathfinder 2e-Style Active Effects & Auras Panel
 *
 * Displays a docked vertical column of active status badges immediately to the left
 * of Foundry's right navigation sidebar (#sidebar).
 * Dynamically binds to the controlled token (or assigned crawler if unselected).
 * Displays active auras (emitters and receivers), buffs, and debuffs with remaining
 * round countdown pills, expandable detail flyout cards, and 1-click dismissal controls.
 *
 * A frameless ApplicationV2 overlay: open it with `COGEffectsPanel.get().render({ force: true })`.
 * With no active effects it renders an empty, zero-size column.
 */

export class COGEffectsPanel extends COGToolApp {
  static instance = null;

  static DEFAULT_OPTIONS = {
    id: 'cog-effects-panel',
    classes: ['cog-hud-overlay', HIDEABLE_HUD_CLASS, 'cog-effects-panel'],
    window: { frame: false, positioned: false, resizable: false, minimizable: false },
    actions: {
      toggleFlyout: COGEffectsPanel.#onToggleFlyout,
      dismissEffect: COGEffectsPanel.#onDismissEffect,
      restoreDispel: COGEffectsPanel.#onRestoreDispel
    }
  };

  static PARTS = {
    content: { template: `${SYSTEM_PATH}/templates/apps/effects-panel.hbs` }
  };

  constructor(options = {}) {
    super(options);
    this.activeFlyoutId = null;
    this._onDocumentClick = this._onDocumentClick.bind(this);
  }

  /**
   * Retrieve or initialize singleton instance.
   * @returns {COGEffectsPanel}
   */
  static get() {
    return getSingleton(COGEffectsPanel);
  }

  /**
   * Re-render the singleton when an embedded Item changed: an aura switched off (`system.active`), a buff
   * added or removed. Auras reach other actors, so any actor-owned item counts, not only the controlled one.
   * @param {Item} item
   * @returns {boolean} true when a render was requested
   */
  static onItemChange(item) {
    if (!item?.parent?.items) return false;
    COGEffectsPanel.get().render({ force: true });
    return true;
  }

  /**
   * Get the active actor to display effects for.
   * Prioritizes canvas controlled token, falling back to game.user.character.
   * @returns {{ actor: COGActor|null, token: Token|null }}
   */
  getControlledActor() {
    const controlledToken = globalThis.canvas?.tokens?.controlled?.[0] || null;
    if (controlledToken?.actor) {
      return { actor: controlledToken.actor, token: controlledToken };
    }
    const userCharacter = globalThis.game?.user?.character || null;
    return { actor: userCharacter, token: null };
  }

  /**
   * Collect all active effects affecting the given actor.
   * @param {COGActor} actor
   * @param {Token} [token=null]
   * @returns {Array<object>}
   */
  collectEffects(actor, token = null) {
    if (!actor) return [];

    const effects = [];
    const worldTime = Number(globalThis.game?.time?.worldTime) || 0;
    const itemsList = Array.from(actor.items ?? []);

    // 1. Active Auras Emitted by this Actor
    for (const item of itemsList) {
      const sys = item.system || {};
      const isEmitterType = item.type === 'spell' || item.type === 'skill' || item.type === 'gear';
      if (!isEmitterType || !sys.active) continue;

      const isAura = isAuraItem(item);

      if (isAura) {
        const remainingRounds = Number(sys.durationConfig?.remainingRounds ?? durationRounds(sys.durationConfig));
        const durationLabel = remainingRounds > 0 ? `${remainingRounds}r` : (sys.durationConfig?.type === 'permanent' || !durationRounds(sys.durationConfig) ? '∞' : `${durationRounds(sys.durationConfig)}r`);
        const fullDurationText = remainingRounds > 0 ? `${remainingRounds} Combat Rounds (${remainingRounds * 10}s remaining)` : 'Permanent / Sustained';

        let detailsText = `${sys.area?.radius || 5}ft radius. Protects allies within burst.`;
        if (item.uuid && actor.system?.attributes?.hp?.tempBars?.sourceUuid === item.uuid) {
          detailsText += ` Active: +${actor.system.attributes.hp.tempBars.count} Temp Bars (${actor.system.attributes.hp.tempBars.hpPerSlot} HP/bar).`;
        }

        effects.push({
          id: item.id || item._id,
          itemId: item.id || item._id,
          uuid: item.uuid || '',
          actorId: actor.id,
          name: item.name,
          img: item.img || 'icons/svg/fire-shield.svg',
          type: 'aura-emitter',
          typeClass: 'is-aura-emitter',
          typeBadge: '[AURA EMITTER]',
          isAuraEmitter: true,
          isAuraReceiver: false,
          isBuff: false,
          isDebuff: false,
          sourceName: 'Self',
          remainingRounds,
          remainingText: durationRemainingLabel(sys.durationConfig, worldTime),
          durationLabel,
          fullDurationText,
          detailsText,
          canDismiss: true,
          sortPriority: 2
        });
      }
    }

    // 2. Active Auras Protecting this Actor as an Ally (Receiver)
    const tempBars = actor.system?.attributes?.hp?.tempBars;
    if (tempBars && Number(tempBars.count) > 0 && tempBars.sourceUuid) {
      const isSelfEmitter = effects.some(e => e.isAuraEmitter && e.uuid === tempBars.sourceUuid);
      if (!isSelfEmitter) {
        let sourceName = 'Ally';
        let remainingRounds = 0;

        // Resolve the aura item by UUID: embedded _ids are not unique and unlinked-token casters are not in game.actors.
        const spellItem = typeof fromUuidSync === 'function' ? fromUuidSync(tempBars.sourceUuid) : null;
        const caster = spellItem?.parent;
        if (caster) {
          sourceName = caster.name;
          remainingRounds = Number(spellItem.system?.durationConfig?.remainingRounds || 0);
        }

        const durationLabel = remainingRounds > 0 ? `${remainingRounds}r` : '∞';
        const fullDurationText = remainingRounds > 0 ? `${remainingRounds} Combat Rounds (${remainingRounds * 10}s remaining)` : 'Active while in aura burst radius';

        effects.push({
          id: `aura-receiver-${tempBars.sourceUuid}`,
          sourceUuid: tempBars.sourceUuid,
          name: tempBars.source,
          img: 'icons/svg/fire-shield.svg',
          type: 'aura-receiver',
          typeClass: 'is-aura-receiver',
          typeBadge: '[AURA PROTECTED]',
          isAuraEmitter: false,
          isAuraReceiver: true,
          isBuff: false,
          isDebuff: false,
          sourceName,
          remainingRounds,
          remainingText: durationRemainingLabel(spellItem?.system?.durationConfig, worldTime),
          durationLabel,
          fullDurationText,
          detailsText: `+${tempBars.count} Bonus Health Bars (${tempBars.hpPerSlot} HP/bar) from ${sourceName}'s aura. Absorbs damage first.`,
          canDismiss: false,
          sortPriority: 3
        });
      }
    }

    // 3. Active Debuffs
    for (const item of itemsList) {
      if (item.type !== 'debuff') continue;
      const sys = item.system || {};
      effects.push({
        id: item.id || item._id,
        itemId: item.id || item._id,
        actorId: actor.id,
        name: item.name,
        img: item.img || 'icons/magic/unholy/strike-body-explode-disintegrate.webp',
        type: 'debuff',
        typeClass: 'is-debuff',
        typeBadge: '[DEBUFF]',
        isAuraEmitter: false,
        isAuraReceiver: false,
        isBuff: false,
        isDebuff: true,
        sourceName: 'Hostile',
        remainingRounds: 0,
        remainingText: durationRemainingLabel(sys.durationConfig, worldTime),
        durationLabel: sys.duration || 'Combat',
        fullDurationText: durationConfigText(sys.durationConfig) || sys.duration || 'Until Cleansed',
        detailsText: sys.description || 'Inflicts penalty or damage.',
        canDismiss: Boolean(globalThis.game?.user?.isGM) && !item.flags?.[SYSTEM_ID]?.auraSourceUuid,
        sortPriority: 1
      });
    }

    // 4. Active Buffs (Non-Aura)
    for (const item of itemsList) {
      if (item.type !== 'buff') continue;
      const sys = item.system || {};
      if (!sys.active) continue;
      if (effects.some(e => e.itemId === (item.id || item._id))) continue;
      if (isBuffDispelled(actor, item)) continue; // listed by its dispel row below

      const remainingRounds = Number(sys.durationConfig?.remainingRounds ?? durationRounds(sys.durationConfig));
      const durationLabel = remainingRounds > 0 ? `${remainingRounds}r` : (sys.duration || '∞');

      effects.push({
        id: item.id || item._id,
        itemId: item.id || item._id,
        actorId: actor.id,
        name: item.name,
        img: item.img || 'icons/svg/sword.svg',
        type: 'buff',
        typeClass: 'is-buff',
        typeBadge: '[BUFF]',
        isAuraEmitter: false,
        isAuraReceiver: false,
        isBuff: true,
        isDebuff: false,
        sourceName: item.flags?.[SYSTEM_ID]?.sourceAura || 'Self',
        remainingRounds,
        remainingText: durationRemainingLabel(sys.durationConfig, worldTime),
        durationLabel,
        fullDurationText: sys.duration || 'Active',
        detailsText: sys.description || 'Grants enhancement.',
        // An effect received from an aura ends with the aura (its holder dismisses that), not by itself (3.40 m).
        canDismiss: !item.flags?.[SYSTEM_ID]?.auraSourceUuid,
        sortPriority: 4
      });
    }

    // 5. Dispels in force (3.13-2): the target's Buffs are suspended until the combat ends; the GM may restore them.
    for (const entry of activeDispels(actor)) {
      const taken = entry.count > 0 ? `${entry.buffKeys.length} Buff${entry.buffKeys.length === 1 ? '' : 's'}` : 'Buffs';
      effects.push({
        id: `dispel-${entry.id}`,
        dispelId: entry.id,
        actorId: actor.id,
        name: `Dispelled by ${entry.source || 'a hit'}`,
        img: 'icons/svg/aura.svg',
        type: 'dispel',
        typeClass: 'is-debuff',
        typeBadge: '[DISPELLED]',
        isAuraEmitter: false,
        isAuraReceiver: false,
        isBuff: false,
        isDebuff: false,
        sourceName: entry.source || 'Hostile',
        remainingRounds: 0,
        durationLabel: entry.combatId ? 'Combat' : '∞',
        fullDurationText: entry.combatId ? 'Until the combat ends' : 'Until the GM restores them',
        detailsText: `${taken} suspended. Nothing is deleted; they return when this ends.`,
        canDismiss: false,
        canRestore: Boolean(globalThis.game?.user?.isGM),
        sortPriority: 1
      });
    }

    // Sort: Debuffs (1) -> Aura Emitters (2) -> Aura Receivers (3) -> Buffs (4)
    effects.sort((a, b) => (a.sortPriority || 99) - (b.sortPriority || 99));

    return effects;
  }

  /**
   * Dismiss an active effect (deactivates aura or buff).
   * @param {COGActor} actor
   * @param {string} effectId Item ID or effect identifier
   * @returns {Promise<boolean>}
   */
  async dismissEffect(actor, effectId) {
    if (!actor) return false;
    const item = actor.items?.get(effectId);
    if (!item) return false;

    if (typeof actor.deactivateAura === 'function') {
      await actor.deactivateAura(item);
    } else {
      await item.update({ 'system.active': false });
    }

    await this.render();
    return true;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const { actor, token } = this.getControlledActor();
    const effects = actor ? this.collectEffects(actor, token) : [];
    for (const eff of effects) {
      eff.expanded = (this.activeFlyoutId === eff.id);
    }
    context.actor = actor;
    context.actorName = actor?.name || '';
    context.hasActor = Boolean(actor);
    context.effects = effects;
    context.hasEffects = effects.length > 0;
    return context;
  }

  /** Mount into the interface host instead of the document body. @override */
  async _insertElement(element, options = {}) {
    const doc = globalThis.document;
    if (!doc) return;
    const existing = doc.getElementById(element.id);
    if (existing) {
      existing.replaceWith(element);
      return;
    }
    const parent = doc.getElementById('interface') || doc.getElementById('ui-right') || doc.body;
    parent?.appendChild(element);
  }

  /** Close an open flyout on any click outside the panel. @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    globalThis.document?.addEventListener('click', this._onDocumentClick);
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.updatePosition();
  }

  /** @override */
  _onClose(options) {
    globalThis.document?.removeEventListener('click', this._onDocumentClick);
    super._onClose(options);
  }

  _onDocumentClick(event) {
    if (!this.activeFlyoutId) return;
    // composedPath is fixed at dispatch time, so it still works when a re-render detaches the target.
    const path = event.composedPath?.() ?? [];
    const inside = path.length ? path.some((el) => el?.id === this.id) : Boolean(event.target?.closest?.('#cog-effects-panel'));
    if (!inside) {
      this.activeFlyoutId = null;
      this.render();
    }
  }

  /**
   * Dynamic position offset anchored immediately left of Foundry's right sidebar.
   */
  updatePosition() {
    if (!this.element?.style) return;
    const doc = globalThis.document;
    if (!doc) return;

    const sidebar = doc.getElementById('sidebar');
    let rightOffset = 312;

    if (sidebar) {
      const isCollapsed = sidebar.classList.contains('collapsed');
      if (isCollapsed) {
        rightOffset = 48;
      } else if (typeof sidebar.getBoundingClientRect === 'function') {
        const rect = sidebar.getBoundingClientRect();
        rightOffset = Math.round((rect.width || 300) + 12);
      }
    }

    this.element.style.right = `${rightOffset}px`;
  }

  static async #onToggleFlyout(event, target) {
    const effectId = target.dataset.effectId;
    this.activeFlyoutId = (this.activeFlyoutId === effectId) ? null : effectId;
    await this.render();
  }

  static async #onRestoreDispel(event, target) {
    const { dispelId, actorId } = target.dataset;
    const actor = globalThis.game?.actors?.get?.(actorId) || this.getControlledActor().actor;
    if (actor && dispelId) {
      await removeDispelEntry(actor, dispelId);
      await this.render();
    }
  }

  static async #onDismissEffect(event, target) {
    const { itemId, actorId } = target.dataset;
    const actor = globalThis.game?.actors?.get?.(actorId) || this.getControlledActor().actor;
    if (actor && itemId) {
      await this.dismissEffect(actor, itemId);
    }
  }
}
