// Re-export all shared constants and helper functions
export * from './actor/actor-constants.mjs';
import {
  getCOGStatModifier,
  getRequiredXPForLevel
} from './actor/actor-constants.mjs';

// Import the domain modules the class delegates to
import * as env from './actor/actor-environment.mjs';
import * as spells from './actor/actor-spells.mjs';
import * as interrupts from './actor/actor-interrupts.mjs';
import * as spellDamageRoll from './actor/spell-damage-roll.mjs';
import * as spellAttackRoll from './actor/spell-attack-roll.mjs';
import * as spaces from './actor/actor-spaces.mjs';
import * as crafting from './actor/actor-crafting.mjs';
import { SYSTEM_ID } from '../constants.mjs';
import { resolveHpPerBar } from '../utils/damage/hp-per-bar.mjs';
import { isSameOwnedEntry } from '../utils/character/owned-entry.mjs';
import { camerasOffered, sanitizeCameraChoice, armedCamera, CAMERA_ARMED_FLAG } from '../utils/roll/cameras.mjs';
import { MOB_BOSS_TAG } from '../data/tag-vocabulary.mjs';
import { tokenDefaultUpdates } from '../data/token-defaults.mjs';
import * as popularity from './actor/actor-popularity.mjs';
import * as health from './actor/actor-health.mjs';
import * as achievements from './actor/actor-achievements.mjs';
import * as inventory from './actor/actor-inventory.mjs';
import * as companions from './actor/actor-companions.mjs';
import * as lootBoxes from './actor/loot-box-open.mjs';
import * as statRoll from './actor/stat-roll.mjs';
import * as weaponSkills from './actor/weapon-skills.mjs';
import * as advancement from './actor/actor-advancement.mjs';
import * as conditions from './actor/actor-conditions.mjs';
import * as combatDamage from './actor/combat-damage.mjs';
import * as attackProfiles from './actor/combat-attack-profiles.mjs';
import * as skillDamage from './actor/combat-skill-damage.mjs';
import * as techniques from './actor/actor-techniques.mjs';
import * as attackTargets from './actor/attack-targets.mjs';
import './actor/actor-move.mjs';
import * as skills from './actor/actor-skills.mjs';
import { rollContestResponse } from './actor/contest-response.mjs';
import * as combatRolls from './actor/combat-rolls.mjs';
import * as evade from './actor/combat-targeting.mjs';
import { syncZeroHealth } from './actor/dying.mjs';
import { lockEmbeddedOnActorCreate, stampLockOwnerOnActorCreated } from './actor/percent-lock.mjs';
import { LINKED_ACTOR_TYPES } from '../utils/document-types.mjs';

const BaseActor = globalThis.foundry?.documents?.Actor
  ?? globalThis.foundry?.documents?.BaseActor
  ?? globalThis.Actor
  ?? class {};

export class COGActor extends BaseActor {

  // Floor clock and Crawler count: the module functions, reachable as `COGActor.x()`
  static getCurrentFloor() { return env.getCurrentFloor(); }
  static setCurrentFloor(floor) { return env.setCurrentFloor(floor); }
  static getFloorTimer() { return env.getFloorTimer(); }
  static setFloorTimer(hours) { return env.setFloorTimer(hours); }
  static decrementFloorTimer(hours, opts) { return env.decrementFloorTimer(hours, opts); }
  static getCrawlerCount() { return env.getCrawlerCount(); }
  static setCrawlerCount(count) { return env.setCrawlerCount(count); }
  static decrementCrawlerCount(amount) { return env.decrementCrawlerCount(amount); }
  static incrementCrawlerCount(amount) { return env.incrementCrawlerCount(amount); }
  static executePartyGrindSession(partyActors, options) { return skills.executePartyGrindSession(partyActors, options); }
  /**
   * Check if this actor carries an active tag (explicit, derived, or active item).
   * @param {string} tagId
   * @returns {boolean}
   */
  hasTag(tagId) {
    if (!tagId) return false;
    if (this.system?.tagSet) return Boolean(this.system.tagSet.has(tagId));
    if (Array.isArray(this.system?.tags)) return this.system.tags.includes(tagId);
    return false;
  }

  /**
   * Cached set of all active tags on this actor.
   * @type {Set<string>}
   */
  get tagSet() {
    return this.system?.tagSet || new Set();
  }

  /**
   * Array of all active tags on this actor.
   * @type {string[]}
   */
  get allTags() {
    return this.system?.allTags || Array.from(this.tagSet);
  }

  /**
   * Is this actor a Boss mob?
   * @type {boolean}
   */
  get isBoss() {
    return Boolean(this.system?.isBoss || this.hasTag(MOB_BOSS_TAG));
  }

  /**
   * Boss tier identifier (e.g. 'neighborhood', 'city') or 'none'.
   * @type {string}
   */
  get bossTier() {
    return this.system?.bossTier || 'none';
  }

  /**
   * Helper getter returning the actor's limbs state.
   * @type {object}
   */
  get limbs() {
    return this.system?.attributes?.limbs || {
      arms: 2,
      legs: 2,
      hands: 2,
      maxArms: 2,
      maxLegs: 2,
      maxHands: 2,
      usedHands: 0,
      exceededHands: false,
      handsWarning: ''
    };
  }

  /** @override Items that came in with the actor were filed under it in `_preCreate` only if its id was known then. */
  async _onCreate(data, options, userId) {
    super._onCreate?.(data, options, userId);
    if (userId === globalThis.game?.user?.id) {
      await stampLockOwnerOnActorCreated(this).catch((err) => console.error('COG | filing percent locks failed', err));
    }
  }

  /** @override */
  async _preCreate(data, options, user) {
    await super._preCreate(data, options, user);
    lockEmbeddedOnActorCreate(this);
    this.updateSource(tokenDefaultUpdates(this.type, data, globalThis.CONFIG?.COG?.tokenDefaults));
    if (LINKED_ACTOR_TYPES.includes(this.type)) {
      const updates = {
        'prototypeToken.actorLink': true,
        'prototypeToken.disposition': 1
      };

      if (this.type !== 'mount_vehicle') {
        const conVal = data?.system?.abilities?.con?.unenhanced ?? data?.system?.abilities?.con?.value ?? this.system?.abilities?.con?.unenhanced ?? this.system?.abilities?.con?.value;
        if (conVal !== undefined) {
          const conMod = getCOGStatModifier(conVal);
          const computedMaxHp = 10 * conMod;
          const rawHp = data?.system?.attributes?.hp?.value;
          if (rawHp === undefined) {
            updates['system.attributes.hp.value'] = computedMaxHp;
            updates['system.attributes.hp.max'] = computedMaxHp;
            updates['system.attributes.hp.pct'] = 100;
          }
        }
      }

      const intVal = data?.system?.abilities?.int?.unenhanced ?? data?.system?.abilities?.int?.value ?? this.system?.abilities?.int?.unenhanced ?? this.system?.abilities?.int?.value;
      if (intVal !== undefined) {
        const computedMaxMana = Number(intVal) || 0;
        const rawMana = data?.system?.attributes?.mana?.value;
        if (rawMana === undefined) {
          updates['system.attributes.mana.value'] = computedMaxMana;
          updates['system.attributes.mana.max'] = computedMaxMana;
          updates['system.attributes.mana.pct'] = 100;
        }
      }

      this.updateSource(updates);
    } else if (this.type === 'mob') {
      const updates = {
        'prototypeToken.actorLink': false,
        'prototypeToken.disposition': -1
      };

      const conVal = data?.system?.abilities?.con?.value ?? this.system?.abilities?.con?.value ?? 10;
      const conMod = getCOGStatModifier(conVal);
      const explicitBars = data?.system?.attributes?.hp?.bars ?? this.system?.attributes?.hp?.bars;
      const hpPerBar = resolveHpPerBar(data?.system?.attributes?.hp?.hpPerBar ?? this.system?.attributes?.hp?.hpPerBar, conMod);

      if (explicitBars !== null && explicitBars !== undefined) {
        const bars = Math.max(1, Number(explicitBars) || 1);
        const computedMaxHp = bars * hpPerBar;
        const rawHp = data?.system?.attributes?.hp?.value;
        if (rawHp === undefined) {
          updates['system.attributes.hp.value'] = computedMaxHp;
          updates['system.attributes.hp.max'] = computedMaxHp;
          updates['system.attributes.hp.pct'] = 100;
          updates['system.attributes.hp.bars'] = bars;
          updates['system.attributes.hp.hpPerBar'] = hpPerBar;
        }
      }

      this.updateSource(updates);
    }
  }

  /** @override */
  async _preUpdate(changes, options, user) {
    if (typeof super._preUpdate === 'function') {
      await super._preUpdate(changes, options, user);
    }
    this._preventDuplicateExternalBuffs(changes);
    this._absorbDamageIntoTempBars(changes, options);
  }

  /**
   * Absorbs incoming damage into temporary health bars before permanent health bars
   * if damage was applied via direct actor update rather than COGDamage.applyDamageToTarget.
   * @param {object} changes
   * @param {object} options
   */
  _absorbDamageIntoTempBars(changes, options) {
    if (!changes || typeof changes !== 'object') return;
    if (options?.cogDamageHandled) return;

    let newHpVal = undefined;
    if ('system.attributes.hp.value' in changes) {
      newHpVal = Number(changes['system.attributes.hp.value']);
    } else if (changes.system?.attributes?.hp?.value !== undefined) {
      newHpVal = Number(changes.system.attributes.hp.value);
    }
    if (newHpVal === undefined || !Number.isFinite(newHpVal)) return;

    const currentHp = Number(this.system?.attributes?.hp?.value) || 0;
    if (newHpVal >= currentHp) return; // Healing or unchanged

    const dmg = currentHp - newHpVal;
    const tb = this.system?.attributes?.hp?.tempBars;
    let tbCount = Number(tb?.count) || 0;
    const tbHpPerSlot = Number(tb?.hpPerSlot) || 0;
    let tbCurrentSlotHp = Number(tb?.currentSlotHp) || (tbCount > 0 ? tbHpPerSlot : 0);

    if (tbCount <= 0 || tbHpPerSlot <= 0) return; // No active temp bars
    if (tb?.element) return; // An element-limited pool takes typed damage only (COGDamage.applyDamageToTarget); a bare HP edit has no type

    let tempBarsRemainingHp = (tbCount - 1) * tbHpPerSlot + tbCurrentSlotHp;
    let penetratingDmg = dmg;
    if (penetratingDmg <= tempBarsRemainingHp) {
      tempBarsRemainingHp -= penetratingDmg;
      penetratingDmg = 0;
    } else {
      penetratingDmg -= tempBarsRemainingHp;
      tempBarsRemainingHp = 0;
    }

    let newTbCount = 0;
    let newCurrentSlotHp = 0;
    if (tempBarsRemainingHp > 0) {
      newTbCount = Math.ceil(tempBarsRemainingHp / tbHpPerSlot);
      const rem = tempBarsRemainingHp % tbHpPerSlot;
      newCurrentSlotHp = rem === 0 ? tbHpPerSlot : rem;
    }

    changes['system.attributes.hp.tempBars.count'] = newTbCount;
    changes['system.attributes.hp.tempBars.currentSlotHp'] = newCurrentSlotHp;
    if (newTbCount === 0) {
      changes['system.attributes.hp.tempBars.source'] = '';
      changes['system.attributes.hp.tempBars.sourceUuid'] = '';
    }
    changes['system.attributes.hp.temp'] = tempBarsRemainingHp;

    const hpPerBar = resolveHpPerBar(this.system?.attributes?.hp?.hpPerBar, this.system?.abilities?.con?.mod);
    const barsRemoved = Math.floor(penetratingDmg / hpPerBar);
    const dmgToHp = barsRemoved * hpPerBar;
    const adjustedNewHp = Math.max(0, currentHp - dmgToHp);

    if ('system.attributes.hp.value' in changes) {
      changes['system.attributes.hp.value'] = adjustedNewHp;
    } else if (changes.system?.attributes?.hp) {
      changes.system.attributes.hp.value = adjustedNewHp;
    }
  }

  /**
   * Override modifyTokenAttribute to route negative HP adjustments through applyDamage
   * so temporary health bars, full damage bars, and DR are respected.
   * @override
   */
  async modifyTokenAttribute(attribute, value, isDelta = false, isBar = true) {
    if ((attribute === 'attributes.hp' || attribute === 'hp' || attribute === 'attributes.hp.value') && isDelta && value < 0) {
      return this.applyDamage(-value);
    }
    if (typeof super.modifyTokenAttribute === 'function') {
      return super.modifyTokenAttribute(attribute, value, isDelta, isBar);
    }
    return this;
  }

  /**
   * Enforces that the same buff cannot be assigned to different external buff slots.
   * If a slot is updated to a buff that is already assigned elsewhere on this actor,
   * the other slot is cleared.
   * @param {object} changes
   */
  _preventDuplicateExternalBuffs(changes) {
    if (!changes || typeof changes !== 'object') return;

    const slots = ['buff1', 'buff2', 'buff3'];
    const incoming = {};

    // Check dot notation
    for (const s of slots) {
      const key = `system.attributes.externalBuffs.${s}`;
      if (key in changes) {
        incoming[s] = changes[key];
      }
    }

    // Check nested notation
    const nestedBuffs = changes.system?.attributes?.externalBuffs;
    if (nestedBuffs && typeof nestedBuffs === 'object') {
      for (const s of slots) {
        if (s in nestedBuffs) {
          incoming[s] = nestedBuffs[s];
        }
      }
    }

    if (Object.keys(incoming).length === 0) return;

    // A slot holds a buff reference (id or identifier), never a name.
    const resolveBuff = (val) => {
      if (!val) return null;
      const strVal = String(val).trim();
      const found = conditions.resolveBuff(this, strVal);
      return {
        id: String(found?.id ?? strVal).toLowerCase(),
        identifier: String(found?.system?.identifier ?? '').toLowerCase()
      };
    };

    const isSameBuff = (b1, b2) => {
      if (!b1 || !b2) return false;
      return b1.id === b2.id || (Boolean(b1.identifier) && b1.identifier === b2.identifier);
    };

    for (const [targetSlot, targetVal] of Object.entries(incoming)) {
      if (!targetVal) continue;
      const targetBuff = resolveBuff(targetVal);
      if (!targetBuff) continue;

      for (const otherSlot of slots) {
        if (otherSlot === targetSlot) continue;

        let otherVal;
        if (otherSlot in incoming) {
          otherVal = incoming[otherSlot];
        } else {
          otherVal = this.system?.attributes?.externalBuffs?.[otherSlot];
        }

        if (otherVal) {
          const otherBuff = resolveBuff(otherVal);
          if (isSameBuff(targetBuff, otherBuff)) {
            changes[`system.attributes.externalBuffs.${otherSlot}`] = '';
            if (nestedBuffs && typeof nestedBuffs === 'object') {
              nestedBuffs[otherSlot] = '';
            }
          }
        }
      }
    }
  }

  /**
   * Compatibility wrapper ensuring _preUpdate is invoked across environments.
   * @override
   */
  async update(data, options = {}) {
    if (typeof this._preUpdate === 'function') {
      await this._preUpdate(data, options, globalThis.game?.user?.id || 'test-user');
    }
    const hpBefore = Number(this.system?.attributes?.hp?.value);
    const result = super.update ? await super.update(data, options) : this;
    await syncZeroHealth(this, { hpBefore, options });
    return result;
  }

  /**
   * Enforces spell idempotence (a spell is globally unique on an actor).
   * @override
   */
  async createEmbeddedDocuments(embeddedType, dataArray, options = {}) {
    if (embeddedType === 'Item' && Array.isArray(dataArray)) {
      const filteredData = [];
      const existingReturns = [];

      for (const itemData of dataArray) {
        if (itemData.type === 'spell') {
          const existingSpell = this.items.find(i => i.type === 'spell' && isSameOwnedEntry(i, itemData));
          if (existingSpell) {
            // Already known: do not duplicate. Keep maximum rank.
            const incomingRank = Number(itemData.system?.rank) || 1;
            const currentRank = Number(existingSpell.system?.rank) || 1;
            if (incomingRank > currentRank) {
              await existingSpell.update({ 'system.rank': incomingRank });
            }
            existingReturns.push(existingSpell);
            continue;
          }
        } else if (itemData.type === 'skill') {
          const existingSkills = this.items.filter(i => i.type === 'skill' && isSameOwnedEntry(i, itemData));
          if (existingSkills.length > 0) {
            // Sort existing skills by rank descending
            existingSkills.sort((a, b) => (Number(b.system?.rank) || 0) - (Number(a.system?.rank) || 0));
            const bestExisting = existingSkills[0];
            const incomingRank = Number(itemData.system?.rank) || 0;
            const currentRank = Number(bestExisting.system?.rank) || 0;

            // Remove any redundant duplicate skill documents that may already exist
            if (existingSkills.length > 1) {
              const toDelete = existingSkills.slice(1).map(i => i.id || i._id).filter(Boolean);
              if (toDelete.length > 0 && typeof this.deleteEmbeddedDocuments === 'function') {
                await this.deleteEmbeddedDocuments('Item', toDelete);
              }
            }

            // Retain the higher rank between incoming and existing
            if (incomingRank > currentRank) {
              await bestExisting.update({ 'system.rank': incomingRank });
            }
            existingReturns.push(bestExisting);
            continue;
          }
        }
        filteredData.push(itemData);
      }

      let created = [];
      if (filteredData.length > 0) {
        created = super.createEmbeddedDocuments
          ? await super.createEmbeddedDocuments(embeddedType, filteredData, options)
          : [];
      }
      return [...existingReturns, ...created];
    }

    return super.createEmbeddedDocuments ? super.createEmbeddedDocuments(embeddedType, dataArray, options) : [];
  }

  /** @override */
  prepareBaseData() {
    super.prepareBaseData();
  }

  /** @override */
  prepareDerivedData() {
    super.prepareDerivedData();
  }

  /**
   * Award experience points to a crawler, automatically checking for level advancements.
   * @param {number} amount - XP amount to add
   * @param {object} [options={}]
   * @param {boolean} [options.notify=true] - Whether to post a ChatMessage on level up
   * @returns {Promise<object|null>}
   */
  async awardExperience(amount, { notify = true } = {}) {
    if (this.type !== 'crawler') return null;
    const add = Math.max(0, Number(amount) || 0);
    const currentXP = Number(this.system.details?.xp?.value) || 0;
    const newXP = currentXP + add;
    const currentLevel = Math.max(1, Number(this.system.details?.level) || 1);
    
    // Check if newXP crosses any level thresholds
    let newLevel = currentLevel;
    while (newXP >= getRequiredXPForLevel(newLevel)) {
      newLevel++;
    }

    await this.update({ 'system.details.xp.value': newXP });
    // The Level change goes through gainLevels so XP level-ups also bank Stat points.
    const gained = newLevel > currentLevel
      ? await advancement.gainLevels(this, newLevel - currentLevel, { source: 'xp' })
      : { newLevel: currentLevel };
    newLevel = gained.newLevel;
    const leveledUp = newLevel > currentLevel;

    if (leveledUp && notify && globalThis.ChatMessage?.create) {
      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this }),
        content: `
          <div class="cog-chat-card cog-level-up-card cog-bg-surface cog-text-strong" style="border: 2px solid var(--cog-warning); padding: 10px; border-radius: 4px; font-family: 'Oswald', sans-serif;">
            <h3 class="cog-text-gold" style="margin: 0 0 6px 0; font-size: 16px;">
              <i class="fa-solid fa-angles-up"></i> LEVEL UP!
            </h3>
            <p style="margin: 0 0 4px 0; font-size: 13px;"><strong>${this.name}</strong> advanced from Level <strong>${currentLevel}</strong> to Level <strong>${newLevel}</strong>!</p>
            <p class="cog-text-secondary" style="margin: 0; font-size: 11px;">Total Experience: <strong>${newXP} XP</strong></p>
          </div>
        `
      });
    }

    return {
      actor: this,
      oldXP: currentXP,
      newXP,
      oldLevel: currentLevel,
      newLevel,
      leveledUp,
      added: add
    };
  }

  /**
   * Arm a Playing to the Cameras choice for the next eligible roll (E6.10, D-C5 a). One-shot: the roll that uses it
   * clears it. '' or an unknown id disarms.
   * @param {string} [id] an audience id from `CONFIG.COG.cameraAudiences`
   * @returns {Promise<string>} the armed id, '' when disarmed
   */
  async armCameras(id = '') {
    const choice = camerasOffered(this) ? sanitizeCameraChoice(id) : '';
    if (choice) await this.setFlag(SYSTEM_ID, CAMERA_ARMED_FLAG, choice);
    else if (armedCamera(this)) await this.unsetFlag(SYSTEM_ID, CAMERA_ARMED_FLAG);
    return choice;
  }

  /**
   * Roll a stat check
   * @param {string} statKey - str, int, con, dex, cha
   */
  async rollStat(...args) { return statRoll.rollStat(this, ...args); }

  // health
  activateAura(...args) { return health.activateAura(this, ...args); }
  applyDamage(...args) { return health.applyDamage(this, ...args); }
  checkFatalDebuffProtection(...args) { return health.checkFatalDebuffProtection(this, ...args); }
  deactivateAura(...args) { return health.deactivateAura(this, ...args); }
  getDamageReduction(...args) { return health.getDamageReduction(this, ...args); }
  grantTempBars(...args) { return health.grantTempBars(this, ...args); }
  hasImmunity(...args) { return health.hasImmunity(this, ...args); }
  hasResistance(...args) { return health.hasResistance(this, ...args); }

  // popularity
  awardPopularity(...args) { return popularity.awardPopularity(this, ...args); }
  awardPopularityForRoll(...args) { return popularity.awardPopularityForRoll(this, ...args); }

  // achievements
  announceAchievement(...args) { return achievements.announceAchievement(this, ...args); }
  getBadgeSummary(...args) { return achievements.getBadgeSummary(this, ...args); }
  recordBossKill(...args) { return achievements.recordBossKill(this, ...args); }
  recordCrawlerKill(...args) { return achievements.recordCrawlerKill(this, ...args); }
  removeBossKill(...args) { return achievements.removeBossKill(this, ...args); }
  removeCrawlerKill(...args) { return achievements.removeCrawlerKill(this, ...args); }
  removeKillByApplication(...args) { return achievements.removeKillByApplication(this, ...args); }

  // inventory
  applyClass(...args) { return inventory.applyClass(this, ...args); }
  applyRace(...args) { return inventory.applyRace(this, ...args); }
  removeClass(...args) { return inventory.removeClass(this, ...args); }
  removeRace(...args) { return inventory.removeRace(this, ...args); }
  canSeeItemOrigin(...args) { return inventory.canSeeItemOrigin(this, ...args); }
  canSeeItemValue(...args) { return inventory.canSeeItemValue(this, ...args); }
  canSortInventoryByValue(...args) { return inventory.canSortInventoryByValue(this, ...args); }
  getDetermineValueRank(...args) { return inventory.getDetermineValueRank(this, ...args); }

  // companions
  assignRider(...args) { return companions.assignRider(this, ...args); }
  bondCompanion(...args) { return companions.bondCompanion(this, ...args); }
  canBeRiddenBy(...args) { return companions.canBeRiddenBy(this, ...args); }
  dismountRider(...args) { return companions.dismountRider(this, ...args); }
  getBondedPets(...args) { return companions.getBondedPets(this, ...args); }
  getBondedVehicles(...args) { return companions.getBondedVehicles(this, ...args); }
  getEmployerActors(...args) { return companions.getEmployerActors(this, ...args); }
  getOwnerActor(...args) { return companions.getOwnerActor(this, ...args); }
  getPilotActor(...args) { return companions.getPilotActor(this, ...args); }
  getRiderActor(...args) { return companions.getRiderActor(this, ...args); }
  unbondCompanion(...args) { return companions.unbondCompanion(this, ...args); }

  // loot boxes
  openLootBoxes(...args) { return lootBoxes.openLootBoxes(this, ...args); }

  // attack targets and evade
  getEvadeTargetDC(...args) { return attackTargets.getEvadeTargetDC(this, ...args); }
  rollEvade(...args) { return evade.rollEvade(this, ...args); }

  // skill damage
  getSkillDamageData(...args) { return skillDamage.getSkillDamageData(this, ...args); }

  // techniques
  findDamageEffectSkill(...args) { return techniques.findDamageEffectSkill(this, ...args); }
  getAiFavorRating(...args) { return techniques.getAiFavorRating(this, ...args); }
  getCombatTechniques(...args) { return techniques.getCombatTechniques(this, ...args); }
  getDamageEffectDescription(...args) { return techniques.getDamageEffectDescription(this, ...args); }
  getDamageEffectLabel(...args) { return techniques.getDamageEffectLabel(this, ...args); }
  getSelectableDamageEffects(...args) { return techniques.getSelectableDamageEffects(this, ...args); }
  isTechniqueApplicable(...args) { return techniques.isTechniqueApplicable(this, ...args); }

  // advancement
  applyRankGain(...args) { return advancement.applyRankGain(this, ...args); }
  gainLevels(...args) { return advancement.gainLevels(this, ...args); }
  markSkillUsed(...args) { return advancement.markSkillUsed(this, ...args); }
  resolveAdvancementCheck(...args) { return advancement.resolveAdvancementCheck(this, ...args); }
  runAdvancementCheck(...args) { return advancement.runAdvancementCheck(this, ...args); }
  spendStatPoint(...args) { return advancement.spendStatPoint(this, ...args); }

  // conditions
  applyCondition(...args) { return conditions.applyCondition(this, ...args); }
  applyDebuff(...args) { return conditions.applyDebuff(this, ...args); }
  applyHealingBars(...args) { return conditions.applyHealingBars(this, ...args); }
  applyHoT(...args) { return conditions.applyHoT(this, ...args); }
  cleanseDebuff(...args) { return conditions.cleanseDebuff(this, ...args); }
  cureDebuffs(...args) { return conditions.cureDebuffs(this, ...args); }
  getActiveBuffs(...args) { return conditions.getActiveBuffs(this, ...args); }
  getArchetypeTags(...args) { return conditions.getArchetypeTags(this, ...args); }
  mendInjury(...args) { return conditions.mendInjury(this, ...args); }
  resolveActionTargets(...args) { return conditions.resolveActionTargets(this, ...args); }
  resolveBuff(...args) { return conditions.resolveBuff(this, ...args); }

  // attack damage
  getAttackDamageParts(...args) { return combatDamage.getAttackDamageParts(this, ...args); }

  // attack profiles
  getSynthesizedAttacks(...args) { return attackProfiles.getSynthesizedAttacks(this, ...args); }

  // skills
  rollSkill(...args) { return skills.rollSkill(this, ...args); }
  rest(...args) { return skills.rest(this, ...args); }
  rollContestResponse(...args) { return rollContestResponse(this, ...args); }
  getSkillByIdentifier(...args) { return skills.getSkillByIdentifier(this, ...args); }
  getSkillRank(...args) { return skills.getSkillRank(this, ...args); }
  increaseSkillRank(...args) { return skills.increaseSkillRank(this, ...args); }
  increaseUnenhancedStat(...args) { return skills.increaseUnenhancedStat(this, ...args); }
  allocateGrindHours(...args) { return skills.allocateGrindHours(this, ...args); }
  attemptSkillAdvancement(...args) { return skills.attemptSkillAdvancement(this, ...args); }
  restSafeRoom(...args) { return skills.restSafeRoom(this, ...args); }
  executePartyGrindSession(partyActors, options) { return this.constructor.executePartyGrindSession(partyActors || [this], options); }

  // attack and damage rolls
  getRollAdvantageState(...args) { return combatRolls.getRollAdvantageState(this, ...args); }
  rollAttack(...args) { return combatRolls.rollAttack(this, ...args); }
  rollSkillDamage(...args) { return combatRolls.rollSkillDamage(this, ...args); }

  // weapon skills
  _resolveWeaponSkills(...args) { return weaponSkills.resolveWeaponSkills(this, ...args); }

  // spells and interrupts
  getAvailableInterrupts(...args) { return interrupts.getAvailableInterrupts(this, ...args); }
  triggerInterrupt(...args) { return interrupts.triggerInterrupt(this, ...args); }
  getSpellDamageData(...args) { return spells.getSpellDamageData(this, ...args); }
  getSpellDamageParts(...args) { return spells.getSpellDamageParts(this, ...args); }
  rollSpellDamage(...args) { return spellDamageRoll.rollSpellDamage(this, ...args); }
  rollSpellAttack(...args) { return spellAttackRoll.rollSpellAttack(this, ...args); }
  rollSpell(...args) { return spells.rollSpell(this, ...args); }

  // personal spaces
  getOwnedPersonalSpace(...args) { return spaces.getOwnedPersonalSpace(this, ...args); }
  getLinkedPersonalSpaces(...args) { return spaces.getLinkedPersonalSpaces(this, ...args); }
  getPersonalSpace(...args) { return spaces.getPersonalSpace(this, ...args); }
  linkPersonalSpace(...args) { return spaces.linkPersonalSpace(this, ...args); }
  unlinkPersonalSpace(...args) { return spaces.unlinkPersonalSpace(this, ...args); }
  acquirePersonalSpace(...args) { return spaces.acquirePersonalSpace(this, ...args); }
  restInPersonalSpace(...args) { return spaces.restInPersonalSpace(this, ...args); }
  depositToPersonalSpace(...args) { return spaces.depositToPersonalSpace(this, ...args); }
  withdrawFromPersonalSpace(...args) { return spaces.withdrawFromPersonalSpace(this, ...args); }
  trainSkillInPersonalSpace(...args) { return spaces.trainSkillInPersonalSpace(this, ...args); }

  // crafting
  craft(...args) { return crafting.craft(this, ...args); }

}
