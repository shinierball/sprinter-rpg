import { getItemAllTags } from './active-tags.mjs';
import { baseRankOf } from '../utils/skill/rank-source.mjs';
import { slugifyIdentifier } from '../utils/identifier.mjs';
import { stampTableOnCreate } from './actor/crafting-tables.mjs';
import { stampOnCreate, stampOnUpdate } from './actor/duration-expiry.mjs';
import { lockItemOnCreate } from './actor/percent-lock.mjs';
import { useItem } from './item/use-item.mjs';
import { rollSpellCard } from './item/spell-card.mjs';

const BaseItem = globalThis.foundry?.documents?.Item
  ?? globalThis.foundry?.documents?.BaseItem
  ?? globalThis.Item
  ?? class {};

/**
 * Sprinter RPG Item Document
 */
export class COGItem extends BaseItem {
  /**
   * @override An item created without `system.identifier` gets its name's slug, once. Every runtime
   * lookup keys on the identifier, so renaming the item later changes nothing.
   */
  async _preCreate(data, options, user) {
    const allowed = await super._preCreate?.(data, options, user);
    if (allowed === false) return false;
    if (this.system && typeof this.system === 'object') {
      if ('identifier' in this.system && !String(this.system.identifier ?? '').trim()) {
        const identifier = slugifyIdentifier(data?.name ?? this.name);
        if (identifier) this.updateSource({ 'system.identifier': identifier });
      }
      stampOnCreate(this);
      stampTableOnCreate(this);
      lockItemOnCreate(this);
    }
    return allowed;
  }

  /** @override A timed effect that comes into force (`system.active` turning on) gets its expiry stamped (3.12d). */
  async _preUpdate(changed, options, user) {
    const allowed = await super._preUpdate?.(changed, options, user);
    if (allowed === false) return false;
    stampOnUpdate(this, changed);
    return allowed;
  }

  /**
   * Get the complete set of tags for this item (explicit + derived + identity).
   * @type {Set<string>}
   */
  get allTags() {
    return getItemAllTags(this);
  }

  /** @override */
  prepareData() {
    if (super.prepareData) {
      super.prepareData();
    } else {
      this.prepareBaseData();
      this.prepareDerivedData();
    }
  }

  /** @override */
  prepareDerivedData() {
    if (super.prepareDerivedData) super.prepareDerivedData();
    if (this.type === 'skill' && this.system) {
      // Unowned skills have no bonuses; an owning actor's derivation overwrites these.
      const baseRank = baseRankOf(this);
      const boonBonus = Number(this.system.boonBonus) || 0;
      const modifiedRank = Math.max(0, baseRank + boonBonus);
      this.system.itemBonus = 0;
      this.system.modifiedRank = modifiedRank;
      this.modifiedRank = modifiedRank;
      this.effectiveRank = modifiedRank;
    }
    if (this.type === 'spell' && this.system) {
      this.system.modifiedRank = Math.max(1, Number(this.system.rank) || 1);
      this.modifiedRank = this.system.modifiedRank;
    }
  }

  // A compendium edit reaches the world through the `updateItem` hook in compendium-sync.mjs, the one sync path (gated on
  // the registry's pack list).

  async roll(action = 'cast') {
    if (this.type === 'spell') {
      if (this.actor) return this.actor.rollSpell(this, action);
      return COGItem.rollSpellCard(this);
    }
    if (this.type === 'loot') {
      return this.useLoot();
    }
    if (this.type === 'gear' && (this.system?.hasActivatedAbility || this.system?.outcomes?.length > 0)) {
      return this.useLoot();
    }
    if (!this.actor) return;
    if (this.type === 'attack') {
      return this.actor.rollAttack(this, action === 'damage' ? 'damage' : 'hit');
    }
    if (this.type === 'skill') {
      return action === 'damage' ? this.actor.rollSkillDamage(this) : this.actor.rollSkill(this);
    }
  }

  /**
   * Alias to activate gear with on-use effects or scratch-off tables.
   * @returns {Promise<ChatMessage|object>}
   */
  async useGear() {
    return this.useLoot();
  }

  /**
   * Use a loot / consumable item (e.g. Normal Mana Potion, healing items, scratch-off lottery tickets, wands, scrolls)
   * or activate gear with on-use effects.
   * Refills resources, decrements uses/charges, checks scene limits, resolves outcome tables, and outputs rich chat cards.
   * @param {object} options
   * @returns {Promise<ChatMessage|object>}
   */
  async useLoot(options = {}) {
    return useItem(this, options);
  }

  /**
   * Alias for useLoot to support standard item usage.
   * @param {object} options
   * @returns {Promise<ChatMessage|object>}
   */
  async useItem(options = {}) {
    return this.useLoot(options);
  }

  static async rollSpellCard(spellItem, options = {}) {
    return rollSpellCard(spellItem, options);
  }

  /**
   * Broadcast achievement to chat if this item is an achievement.
   */
  async announce() {
    if (this.type === 'achievement' && this.actor && typeof this.actor.announceAchievement === 'function') {
      return this.actor.announceAchievement(this);
    }
    return null;
  }
}
