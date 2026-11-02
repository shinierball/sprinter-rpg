import { COGRaceClassApplier } from '../../data/race-class-applier.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { ruleSkillRank } from '../../utils/rule-skills.mjs';

/** Item appraisal (Determine Value): any Rank sorts the inventory by value; Rank 15 shows the gold value. */
export const APPRAISAL_SORT_RANK = 1;
export const APPRAISAL_VALUE_RANK = 15;

export const actorInventoryMixin = {

  /**
   * Get the actor's effective rank in the "Determine Value" skill.
   * @returns {number}
   */
  getDetermineValueRank() {
    return ruleSkillRank(this, 'appraisal');
  },


  /**
   * Whether the actor has reached the appraisal value Rank (15) in Determine Value to see item/gear gold values.
   * @returns {boolean}
   */
  canDetermineValue() {
    return this.getDetermineValueRank() >= APPRAISAL_VALUE_RANK;
  },


  /**
   * Alias for canDetermineValue.
   * @returns {boolean}
   */
  canSeeItemValue() {
    return this.canDetermineValue();
  },


  /**
   * Whether the actor owns Determine Value (any Rank) to sort inventory items by gold value.
   * @returns {boolean}
   */
  canSortInventoryByValue() {
    return this.getDetermineValueRank() >= APPRAISAL_SORT_RANK;
  },


  /**
   * Sort an array of items by gold value.
   * @param {Array<Item>} items
   * @param {object} [options={}]
   * @param {boolean} [options.descending=true]
   * @returns {Array<Item>}
   */
  sortInventoryByValue(items, { descending = true } = {}) {
    if (!Array.isArray(items)) return [];
    return [...items].sort((a, b) => {
      const valA = Number(a.system?.value ?? 0);
      const valB = Number(b.system?.value ?? 0);
      const diff = descending ? valB - valA : valA - valB;
      if (diff !== 0) return diff;
      return (a.name || '').localeCompare(b.name || '');
    });
  },


  /**
   * Retrieve inventory items (gear and/or loot) optionally sorted by value or default sort.
   * @param {object} [options={}]
   * @param {string} [options.type='all'] 'all' | 'gear' | 'loot'
   * @param {string} [options.sortBy='default'] 'default' | 'value' | 'name'
   * @param {boolean} [options.descending=true]
   * @returns {Array<Item>}
   */
  getInventory({ type = 'all', sortBy = 'default', descending = true } = {}) {
    const all = this.items ? this.items.filter(i => i.type === 'gear' || i.type === 'loot') : [];
    let filtered = all;
    if (type === 'gear') filtered = all.filter(i => i.type === 'gear');
    else if (type === 'loot') filtered = all.filter(i => i.type === 'loot');

    if (sortBy === 'value' && this.canSortInventoryByValue()) {
      return this.sortInventoryByValue(filtered, { descending });
    } else if (sortBy === 'name') {
      return [...filtered].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else if (sortBy === 'value') {
      // Cannot sort by value without the skill; return default order
      return [...filtered].sort((a, b) => (a.sort || 0) - (b.sort || 0) || (a.name || '').localeCompare(b.name || ''));
    }
    return [...filtered].sort((a, b) => (a.sort || 0) - (b.sort || 0) || (a.name || '').localeCompare(b.name || ''));
  },


  /**
   * Apply a race to this character, automatically reverting previous race benefits.
   * @param {string} raceIdentifier - Race name or ID
   * @param {object} [options={}] - Options such as { choices, interactive }
   * @returns {Promise<boolean>}
   */
  async applyRace(raceIdentifier, options = {}) {
    return COGRaceClassApplier.applyRace(this, raceIdentifier, options);
  },


  /**
   * Remove any applied race benefits from this character.
   * @returns {Promise<boolean>}
   */
  async removeRace() {
    return COGRaceClassApplier.removeRace(this);
  },


  /**
   * Apply a class to this character, automatically reverting previous class benefits.
   * @param {string} classIdentifier - Class name or ID
   * @param {object} [options={}] - Options such as { choices, interactive }
   * @returns {Promise<boolean>}
   */
  async applyClass(classIdentifier, options = {}) {
    return COGRaceClassApplier.applyClass(this, classIdentifier, options);
  },


  /**
   * Remove any applied class benefits from this character.
   * @returns {Promise<boolean>}
   */
  async removeClass() {
    return COGRaceClassApplier.removeClass(this);
  },

  /**
   * Craft an item from a recipe or blueprint specification, adjudicating permissive rule breaks
   * if workstation level is insufficient or required materials are missing.
   *
   * @param {object} recipe - Recipe or blueprint specification
   * @param {string} recipe.name - Name of the item to craft
   * @param {string} [recipe.type='gear'] - Item type ('gear', 'loot', etc.)
   * @param {number} [recipe.requiredLevel=1] - Required crafting table/workstation level
   * @param {Array<{ identifier: string, name?: string, quantity: number }>} [recipe.requiredMaterials=[]] - Required materials,
   *   matched against owned items by `system.identifier` (`name` is display text only)
   * @param {object} [recipe.system={}] - Base system data for the crafted item
   * @param {object} [recipe.flags={}] - Flags for the crafted item
   * @param {string} [recipe.img] - Icon image path
   * @param {object} [options={}]
   * @param {number} [options.workstationLevel] - Override workstation level (defaults to actor's table or 1)
   * @param {boolean} [options.ruleBreak] - Force rule break confirmation without dialog
   * @param {boolean} [options.interactive] - Pass false when no user can be asked (the world's Rule Break setting then refuses)
   * @returns {Promise<{ success: boolean, ruleBreak: boolean, item?: object, createdItem?: object, reason?: string, missingMaterials?: Array }>}
   */
  async craftItem(recipe, options = {}) {
    if (!recipe) {
      return { success: false, ruleBreak: false, reason: 'No recipe or blueprint provided.' };
    }

    const requiredLevel = Number(recipe.requiredLevel ?? recipe.workstationLevel ?? 1);
    const workstationLevel = Number(
      options.workstationLevel ??
      this.system?.crafting?.workstationLevel ??
      this.system?.workstationLevel ??
      1
    );

    const isWorkstationInsufficient = workstationLevel < requiredLevel;

    // Check material requirements against actor inventory
    const reqMaterials = Array.isArray(recipe.requiredMaterials)
      ? recipe.requiredMaterials
      : (Array.isArray(recipe.materials) ? recipe.materials : []);

    const missingMaterials = [];
    const actorItems = Array.from(this.items ?? []);

    for (const req of reqMaterials) {
      const reqIdentifier = String(req.identifier ?? '').trim();
      const reqQty = Number(req.quantity) || 1;

      const matchingItems = reqIdentifier ? actorItems.filter(i => String(i.system?.identifier ?? '').trim() === reqIdentifier) : [];
      const totalAvailable = matchingItems.reduce((sum, i) => sum + (Number(i.system?.quantity) || 1), 0);

      if (totalAvailable < reqQty) {
        missingMaterials.push({
          name: req.name || reqIdentifier,
          required: reqQty,
          available: totalAvailable,
          missing: reqQty - totalAvailable
        });
      }
    }

    const hasViolations = isWorkstationInsufficient || missingMaterials.length > 0;
    let isRuleBreak = false;

    if (hasViolations) {
      const reasons = [];
      if (isWorkstationInsufficient) {
        reasons.push(`Workstation level insufficient (${workstationLevel}/${requiredLevel})`);
      }
      if (missingMaterials.length > 0) {
        const missStr = missingMaterials.map(m => `${m.name} (${m.available}/${m.required})`).join(', ');
        reasons.push(`Missing materials: ${missStr}`);
      }
      const reasonText = reasons.join('; ');

      const confirmRes = await confirmRuleBreak({
        title: 'Crafting Rule Break',
        message: `${reasonText}. Proceed with crafting anyway as a Rule Break?`,
        options
      });

      if (!confirmRes.confirmed) {
        return {
          success: false,
          ruleBreak: false,
          reason: reasonText,
          isWorkstationInsufficient,
          missingMaterials
        };
      }

      isRuleBreak = true;
    }

    // Material consumption: consume whatever available matching materials exist without going negative
    for (const req of reqMaterials) {
      const reqIdentifier = String(req.identifier ?? '').trim();
      let needed = Number(req.quantity) || 1;

      const matchingItems = reqIdentifier ? actorItems.filter(i => String(i.system?.identifier ?? '').trim() === reqIdentifier) : [];
      for (const item of matchingItems) {
        if (needed <= 0) break;
        const currentQty = Number(item.system?.quantity) || 1;
        const consumeAmount = Math.min(currentQty, needed);
        const newQty = Math.max(0, currentQty - consumeAmount);
        needed -= consumeAmount;

        if (typeof item.update === 'function') {
          if (newQty <= 0 && typeof item.delete === 'function') {
            await item.delete();
          } else {
            await item.update({ 'system.quantity': newQty });
          }
        } else if (item.system) {
          item.system.quantity = newQty;
        }
      }
    }

    // Create the crafted item document
    const systemData = {
      ...(recipe.system || {}),
      ...(isRuleBreak ? { ruleBreak: true } : {})
    };

    const flagData = {
      ...(recipe.flags || {}),
      [SYSTEM_ID]: {
        ...(recipe.flags?.[SYSTEM_ID] || {}),
        ...(isRuleBreak ? { ruleBreak: true } : {})
      }
    };

    const itemPayload = {
      name: recipe.name || 'Crafted Item',
      type: recipe.type || 'gear',
      img: recipe.img || 'icons/svg/item-bag.svg',
      system: systemData,
      flags: flagData
    };

    let created;
    if (typeof this.createEmbeddedDocuments === 'function') {
      const [res] = await this.createEmbeddedDocuments('Item', [itemPayload]);
      created = res || null;
    } else if (globalThis.Item?.create) {
      created = await globalThis.Item.create(itemPayload);
    } else {
      created = itemPayload;
    }

    return {
      success: true,
      ruleBreak: isRuleBreak,
      item: created,
      createdItem: created,
      missingMaterials: isRuleBreak ? missingMaterials : []
    };
  }
};

export async function craftItem(actor, recipe, options = {}) {
  if (actor && typeof actor.craftItem === 'function') {
    return actor.craftItem(recipe, options);
  }
  return actorInventoryMixin.craftItem.call(actor || {}, recipe, options);
}

