import { COGSessionEngine } from '../apps/session-manager.mjs';

// Re-export all shared constants and helper functions
export * from './actor/actor-constants.mjs';
import {
  getCOGStatModifier,
  getRequiredXPForLevel
} from './actor/actor-constants.mjs';

// Import domain mixins
import { actorEnvironmentMixin, actorEnvironmentStaticMixin, getCurrentFloor } from './actor/actor-environment.mjs';
import { actorHealthMixin } from './actor/actor-health.mjs';
import { actorTechniquesMixin } from './actor/actor-techniques.mjs';
import { actorCombatMixin } from './actor/actor-combat.mjs';
import { actorSpellsMixin } from './actor/actor-spells.mjs';
import { actorSkillsMixin, actorSkillsStaticMixin } from './actor/actor-skills.mjs';
import { actorAdvancementMixin } from './actor/actor-advancement.mjs';
import { actorConditionsMixin } from './actor/actor-conditions.mjs';
import { actorAchievementsMixin } from './actor/actor-achievements.mjs';
import { actorInventoryMixin } from './actor/actor-inventory.mjs';
import { actorCompanionsMixin } from './actor/actor-companions.mjs';
import { actorSpacesMixin } from './actor/actor-spaces.mjs';
import { actorActionsMixin } from './actor/actor-actions.mjs';
import { actorPopularityMixin } from './actor/actor-popularity.mjs';
import { SYSTEM_ID } from '../constants.mjs';
import { sanitizeContestRef, moveLine } from '../utils/contest/contest-roll.mjs';
import { buildCheckRecord, combatRefFor, rollerTokenIdOf, CHECK_RECORD_FLAG } from '../utils/check-assists.mjs';
import { collectCheckToHit, rollCheckTargets } from '../utils/per-target-to-hit.mjs';
import { itemIdentifier } from '../utils/identifier.mjs';
import { buildRollContext, extendContext, resolveRollToggles } from '../utils/roll-context.mjs';
import { cameraParts, consumeArmedCamera, camerasOffered, sanitizeCameraChoice, armedCamera, CAMERA_ARMED_FLAG } from '../utils/cameras.mjs';
import { MOB_BOSS_TAG } from '../utils/tag-mechanics.mjs';

const BaseActor = globalThis.foundry?.documents?.Actor
  ?? globalThis.foundry?.documents?.BaseActor
  ?? globalThis.Actor
  ?? class {};

/** The compendium entry a document or creation data came from (`_stats.compendiumSource`, else the managers' flag). */
function compendiumSourceOf(doc) {
  return String(doc?._stats?.compendiumSource || doc?.flags?.[SYSTEM_ID]?.sourceUuid || '');
}

/**
 * Whether an owned skill/spell is the same entry as incoming creation data: the same compendium source,
 * else the same `system.identifier` (data without one gets the slug `_preCreate` would give it). Names never match.
 */
export function isSameOwnedEntry(owned, data) {
  const source = compendiumSourceOf(data);
  if (source && compendiumSourceOf(owned) === source) return true;
  const ownedId = String(owned?.system?.identifier ?? '').trim();
  return Boolean(ownedId) && ownedId === itemIdentifier(data);
}

export class COGActor extends BaseActor {
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

  /** @override */
  async _preCreate(data, options, user) {
    await super._preCreate(data, options, user);
    if (this.type === 'crawler' || this.type === 'pet' || this.type === 'mercenary' || this.type === 'mount_vehicle') {
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
          if (rawHp === undefined || (rawHp === 40 && computedMaxHp !== 40)) {
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
        if (rawMana === undefined || (rawMana === 10 && computedMaxMana !== 10)) {
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
      const explicitHpPerBar = Number(data?.system?.attributes?.hp?.hpPerBar ?? this.system?.attributes?.hp?.hpPerBar) || 0;
      const hpPerBar = explicitHpPerBar > 0 ? explicitHpPerBar : (conMod > 0 ? conMod : 1);

      if (explicitBars !== null && explicitBars !== undefined) {
        const bars = Math.max(1, Number(explicitBars) || 1);
        const computedMaxHp = bars * hpPerBar;
        const rawHp = data?.system?.attributes?.hp?.value;
        if (rawHp === undefined || rawHp === 40 || rawHp === 4) {
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

    const hpPerBar = (Number(this.system?.abilities?.con?.mod) > 0 ? Number(this.system.abilities.con.mod) : 1);
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
      const found = this.resolveBuff?.(strVal);
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
   * Also enforces that any update made to a crawler or pet on a scene persists
   * to the base world actor, ensuring scene-independent persistence.
   * @override
   */
  async update(data, options = {}) {
    if (typeof this._preUpdate === 'function') {
      await this._preUpdate(data, options, globalThis.game?.user?.id || 'test-user');
    }
    // If this is a crawler, pet, or mercenary token actor on a scene, persist changes to the base world actor!
    if (this.isToken && (this.type === 'crawler' || this.type === 'pet' || this.type === 'mercenary')) {
      const baseActor = this.token?.baseActor || globalThis.game?.actors?.get?.(this.token?.actorId || this.id);
      if (baseActor && baseActor !== this) {
        await baseActor.update(data, options);
      }
    }
    return super.update ? super.update(data, options) : this;
  }

  /**
   * Enforces spell idempotence (a spell is globally unique on an actor) and
   * forwards embedded document creations on crawler/pet scene tokens to the base actor.
   * @override
   */
  async createEmbeddedDocuments(embeddedType, dataArray, options = {}) {
    // Forward embedded creations on scene tokens to the base actor
    if (this.isToken && (this.type === 'crawler' || this.type === 'pet' || this.type === 'mercenary')) {
      const baseActor = this.token?.baseActor || globalThis.game?.actors?.get?.(this.token?.actorId || this.id);
      if (baseActor && baseActor !== this) {
        return baseActor.createEmbeddedDocuments(embeddedType, dataArray, options);
      }
    }

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

  /**
   * Forwards embedded updates on crawler/pet scene tokens to the base actor.
   * @override
   */
  async updateEmbeddedDocuments(embeddedType, updates = [], options = {}) {
    if (this.isToken && (this.type === 'crawler' || this.type === 'pet' || this.type === 'mercenary')) {
      const baseActor = this.token?.baseActor || globalThis.game?.actors?.get?.(this.token?.actorId || this.id);
      if (baseActor && baseActor !== this) {
        await baseActor.updateEmbeddedDocuments(embeddedType, updates, options);
      }
    }
    return super.updateEmbeddedDocuments ? super.updateEmbeddedDocuments(embeddedType, updates, options) : [];
  }

  /**
   * Forwards embedded deletions on crawler/pet scene tokens to the base actor.
   * @override
   */
  async deleteEmbeddedDocuments(embeddedType, ids = [], options = {}) {
    if (this.isToken && (this.type === 'crawler' || this.type === 'pet' || this.type === 'mercenary')) {
      const baseActor = this.token?.baseActor || globalThis.game?.actors?.get?.(this.token?.actorId || this.id);
      if (baseActor && baseActor !== this) {
        await baseActor.deleteEmbeddedDocuments(embeddedType, ids, options);
        // The base actor already removed these; the synthetic delta no longer holds them, so the second delete
        // throws `undefined id [..] does not exist in the EmbeddedCollection` (3.40 e). The deletion has landed.
        try {
          return super.deleteEmbeddedDocuments ? await super.deleteEmbeddedDocuments(embeddedType, ids, options) : [];
        } catch (err) {
          console.warn('Sprinter RPG | Token delta delete skipped after the base actor delete:', err?.message ?? err);
          return [];
        }
      }
    }
    return super.deleteEmbeddedDocuments ? super.deleteEmbeddedDocuments(embeddedType, ids, options) : [];
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
      ? await this.gainLevels(newLevel - currentLevel, { source: 'xp' })
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
  async rollStat(statKey, options = {}) {
    const ability = this.system.abilities?.[statKey];
    if (!ability) return;

    const mod = ability.mod ?? 0;
    const statName = statKey.toUpperCase();

    // Context tags: `check.stat`, `stat.<stat>` and any ticked `situation.*` toggle
    // The roller's targets: the first is the check's subject, and the rest get a per-target total (E3.5c).
    const targetActors = this._attackTargetEntries(options).map(e => e.actor);
    // A check made for a leg of a race or chase (3.45): `contest.race` / `contest.chase` on the context, Move Rate as a flat line
    const contest = sanitizeContestRef(options.contest);
    const baseContext = buildRollContext({ actor: this, phase: 'check', check: 'stat', stat: statKey, other: targetActors[0], tags: contest ? [contest.tag] : [] });
    const toggles = await resolveRollToggles(this, baseContext, options, { cameras: true });
    const situationContext = extendContext(baseContext, { situations: toggles.situations });
    // Playing to the Cameras (E6.10): one extra Disadvantage reason, recorded on the card.
    const camera = cameraParts(this, toggles.cameras, getCurrentFloor());

    // Advantage rows read the context before `situation.disadvantaged` exists; flat and dice rows read it after.
    const advState = this.getRollAdvantageState({
      rollType: 'stat',
      stat: statKey,
      rollContext: situationContext,
      extraDisadvantages: camera.disadvantages,
      options
    });
    const rollContext = extendContext(situationContext, { disadvantaged: advState.mode === 'disadvantage' });
    const { mods: checkMods, targetRows } = collectCheckToHit(this, rollContext, { targetActors });

    const moveMod = contest?.moveMod ?? 0;
    const total = mod + checkMods.flatBonus + moveMod;
    const extraDice = checkMods.diceParts.map(d => ` + ${d}`).join('');
    const formula = `${advState.formula} + ${total}${extraDice}`;
    const roll = await new Roll(formula, { mod }).evaluate();

    COGSessionEngine.recordRoll({
      actor: this,
      roll,
      type: 'stat',
      name: `${statName} Check`,
      isUntrained: false
    }).catch(() => {});

    const modLines = moveLine(contest) ? [...checkMods.breakdown, moveLine(contest)] : checkMods.breakdown;
    const modDesc = modLines.length > 0 ? ` [${modLines.join(', ')}]` : '';
    const flavor = advState.label
      ? `<strong>${this.name}</strong>: ${statName} Check (<strong>${advState.label}</strong>: ${advState.formula} + ${statName} Mod ${mod >= 0 ? `+${mod}` : mod}${modDesc})`
      : `<strong>${this.name}</strong>: ${statName} Check${modDesc}`;

    const perTarget = await rollCheckTargets(roll, targetRows, rollContext, targetActors);
    const message = await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${flavor}${camera.noteHtml}`,
      ...(perTarget.html ? { content: `${typeof roll.render === 'function' ? await roll.render() : ''}${perTarget.html}` } : {}),
      flags: {
        [SYSTEM_ID]: {
          ...perTarget.flags,
          ...camera.flags,
          [CHECK_RECORD_FLAG]: buildCheckRecord({
            kind: 'stat',
            roller: this,
            rollerTokenId: rollerTokenIdOf(this),
            roll,
            combat: combatRefFor(this),
            tags: [...rollContext.tags],
            targets: perTarget.results.map((r, i) => ({ actorId: r.actorId, actorUuid: targetActors[i]?.uuid, name: r.actorName, dc: null, bonus: r.bonus })),
            contest
          })
        }
      }
    });
    await consumeArmedCamera(this);
    return message;
  }

}

// Attach static domain methods to COGActor class
Object.assign(
  COGActor,
  actorEnvironmentStaticMixin,
  actorSkillsStaticMixin
);

// Attach instance domain methods to COGActor prototype
Object.assign(
  COGActor.prototype,
  actorEnvironmentMixin,
  actorHealthMixin,
  actorTechniquesMixin,
  actorCombatMixin,
  actorSpellsMixin,
  actorSkillsMixin,
  actorAdvancementMixin,
  actorConditionsMixin,
  actorAchievementsMixin,
  actorInventoryMixin,
  actorCompanionsMixin,
  actorSpacesMixin,
  actorActionsMixin,
  actorPopularityMixin
);
