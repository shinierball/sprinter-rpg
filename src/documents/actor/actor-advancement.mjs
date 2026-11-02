/**
 * Skill Advancement on the actor: the use mark, the check roller, the rank-gain choke point and the ad hoc
 * single-skill check. The Level writer (gainLevels), the grind Level tracker and Stat point spending.
 */
import { getRequiredGrindingHours } from '../../data/rules/grinding-rules.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { collectCheckModifiers, collectRollAdvantage } from '../../utils/damage-modifiers.mjs';
import { CHECK_TAGS, isPassiveSkill } from '../../utils/tag-mechanics.mjs';
import { hasRuleFlag, RULE_FLAGS } from '../../utils/tag-behaviour.mjs';
import { resolveFloorRows } from '../../utils/floor-limited-rows.mjs';
import { buildRollContext, resolveRowAdvantage } from '../../utils/roll-context.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { getRankCap } from '../../utils/rank-cap.mjs';
import { getStatCaps } from '../../utils/stat-caps.mjs';
import { isFloorRanked } from '../../utils/rank-source.mjs';
import { advancementTarget, grindLevelProgress } from '../../utils/skill-advancement.mjs';
import { openWindow, isWithinWindow, formatWindow } from '../../utils/time-window.mjs';
import { currentTimeContext } from './dungeon-time.mjs';
import { STAT_POINTS_PER_LEVEL } from './actor-constants.mjs';
import { buildAdvancementCard } from '../../chat/advancement-card.mjs';
import { DAY_HOURS } from '../../utils/timing.mjs';

/** A grind "day" in dungeon hours (this system's day; the book's 24 does not apply). */
export const GRIND_DAY_HOURS = DAY_HOURS;
/** Highest Level the book allows; going past it is a Rule Break. */
export const MAX_LEVEL = 250;
export { STAT_POINTS_PER_LEVEL };
const STAT_KEYS = ['str', 'int', 'con', 'dex', 'cha'];

const signed = (n) => (n > 0 ? ` + ${n}` : n < 0 ? ` - ${Math.abs(n)}` : '');

export const actorAdvancementMixin = {

  /**
   * Mark a skill as used in play, so the next advancement check rolls it. The one writer of
   * `system.checked = true`.
   * No-op for passive skills, an already-marked skill, or something that cannot be updated.
   * @param {Item} skillItem
   * @param {object} [params]
   * @param {string} [params.reason] Why the skill is marked ('roll', 'attack', 'damage-effect'); informational
   * @param {boolean} [params.allowPassive=false] Mark even a passive skill. Only the Damage Effect mark
   *   choice sets this: the dataset's Damage Effects are passive skills the player may still advance.
   * @returns {Promise<boolean>} True when the mark was written
   */
  async markSkillUsed(skillItem, { reason, allowPassive = false } = {}) {
    if (!skillItem || typeof skillItem.update !== 'function') return false;
    if (skillItem.system?.checked) return false;
    if (hasRuleFlag(skillItem, RULE_FLAGS.noRanks)) return false;
    if (!allowPassive && isPassiveSkill(skillItem)) return false;
    try {
      await skillItem.update({ 'system.checked': true });
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Roll one Skill Advancement Check: d20 (2d20kh with advantage) plus the training bonus and every
   * matching `checkModifiers` row under the `check.advancement` tag. Passes on total >= the target (the
   * Rank plus any DC modifier); Rank 0 always passes. Rolls only; the caller applies the result.
   * @param {Item} skill
   * @param {object} [params]
   * @param {number} [params.bonus=0] Flat bonus (a training room's roll bonus)
   * @param {boolean} [params.advantage=false] Roll 2d20 keep highest (an `advantage` row on the actor adds to it; a disadvantage row cancels it)
   * @param {Array<string>} [params.situations] ticked `situation.*` tags (no dialog: batch checks run unattended)
   * @param {number} [params.dcModifier=0] Added to the target
   * @param {number} [params.rank] Rank to test against (defaults to the skill's Rank)
   * @param {number|{total: number}} [params.rollResult] Inject the d20 total (tests, headless callers)
   * @param {boolean} [params.floorEnd=false] Tag the roll `check.advancement.floor_end` (End-of-floor check)
   * @param {Set<string>} [params.floorRows] Keys of the `usesPer: 'floor'` rows that apply to this skill (see `resolveFloorRows`)
   * @returns {Promise<{total: number, target: number, passed: boolean, formula: string, breakdown: string[], rank: number}>}
   */
  async rollAdvancementCheck(skill, { bonus = 0, advantage = false, dcModifier = 0, rank, rollResult, situations = [], floorEnd = false, floorRows = null } = {}) {
    const currentRank = Number(rank ?? skill?.system?.rank ?? skill?.rank) || 0;
    const target = Math.max(0, advancementTarget(currentRank) + (Number(dcModifier) || 0));

    // The End-of-floor check also carries `check.advancement.floor_end`; `floorRows` are the once-per-floor rows chosen for this skill
    const context = buildRollContext({
      actor: this, phase: 'advancement', item: skill, check: 'advancement', situations, tags: floorEnd ? [CHECK_TAGS.advancementFloorEnd] : []
    });
    const mods = collectCheckModifiers(this, context, { floorRows });
    // Advantage rows on the actor (race, class, gear, buffs) join the caller's own advantage (a training room)
    const rowAdv = collectRollAdvantage(this, context, { floorRows });
    const found = { advantages: [...rowAdv.advantages, ...(advantage ? ['Advantage'] : [])], disadvantages: rowAdv.disadvantages };
    const die = resolveRowAdvantage(found).formula;
    const flat = (Number(bonus) || 0) + mods.flatBonus;
    const formula = `${die}${signed(flat)}${mods.diceParts.map(d => ` + ${d}`).join('')}`;

    let total;
    if (typeof rollResult === 'number') total = rollResult;
    else if (rollResult?.total !== undefined) total = rollResult.total;
    else {
      try {
        const roll = await new Roll(formula).evaluate();
        total = Number(roll?.total);
      } catch {
        total = NaN;
      }
      if (!Number.isFinite(total)) total = 10 + flat;
    }

    return {
      total,
      target,
      formula,
      breakdown: mods.breakdown,
      rollMode: resolveRowAdvantage(found).mode,
      rank: currentRank,
      passed: currentRank <= 0 || total >= target
    };
  },

  /**
   * The one choke point for gaining a Skill Rank, used by checks, grinding, training and untrained
   * training. Past the Rank cap (15) or on a skill with `canGainRanks: false` the gain needs a Rule Break
   * confirmation; declining leaves the Rank alone. Never hard-blocks.
   * @param {Item} skill
   * @param {object} [params]
   * @param {string} [params.source] 'check' | 'grind' | 'training' | 'untrained' (informational)
   * @param {object} [params.options] Passed to confirmRuleBreak (`ruleBreak: true` pre-confirms)
   * @returns {Promise<{gained: boolean, ruleBreak: boolean, newRank: number, reason?: 'declined'|'floor-ranked', limit?: 'cap'|'locked'}>}
   */
  async applyRankGain(skill, { source, options = {} } = {}) {
    const rank = Number(skill?.system?.rank ?? skill?.rank) || 0;
    if (isFloorRanked(skill)) {
      globalThis.ui?.notifications?.info?.(`${skill?.name ?? 'This skill'} has a Rank equal to the Floor number, so it does not advance.`);
      return { gained: false, ruleBreak: false, newRank: rank, reason: 'floor-ranked' };
    }
    const locked = skill?.system?.canGainRanks === false;
    const cap = getRankCap(this, skill);
    const capped = rank >= cap;
    let ruleBreak = false;

    if (locked || capped) {
      const limits = [];
      if (locked) limits.push('cannot gain Ranks');
      if (capped) limits.push(`is at its Rank cap (${cap})`);
      const confirm = await confirmRuleBreak({
        title: locked ? 'Skill Cannot Gain Ranks' : 'Rank Cap Reached',
        message: `${skill?.name ?? 'This skill'} ${limits.join(' and ')}. Advance anyway as a Rule Break?`,
        options
      });
      if (!confirm.confirmed) {
        return { gained: false, ruleBreak: false, newRank: rank, reason: 'declined', limit: locked ? 'locked' : 'cap' };
      }
      ruleBreak = true;
    }

    const newRank = rank + 1;
    if (typeof skill.update === 'function') {
      await skill.update({ 'system.rank': newRank });
    } else if (skill.system) {
      skill.system.rank = newRank;
    } else {
      skill.rank = newRank;
    }
    return { gained: true, ruleBreak, newRank };
  },

  /**
   * Roll a check for a skill and apply a gain through applyRankGain. Shared by the ad hoc check and the
   * grind paths. Does not touch the use mark or hours.
   * @returns {Promise<{check: object, outcome: 'gain'|'fail'|'capped'|'locked', gain: object|null, ruleBreak: boolean, newRank: number}>}
   */
  async resolveAdvancementCheck(skill, { rollOptions = {}, source, options = {} } = {}) {
    // An End-of-floor roll settles its once-per-floor rows first, unless the batch already did for the whole run
    let floorRuleBreak = Boolean(rollOptions.floorRuleBreak);
    let checkOptions = rollOptions;
    if (rollOptions.floorEnd && !rollOptions.floorRows) {
      const floor = await resolveFloorRows(this, [skill], options);
      checkOptions = { ...rollOptions, floorRows: floor.rows.get(skill.id) ?? new Set() };
      floorRuleBreak = floor.ruleBreaks.get(skill.id) === true;
    }
    const check = await this.rollAdvancementCheck(skill, checkOptions);
    let outcome = check.passed ? 'gain' : 'fail';
    let gain = null;
    if (check.passed) {
      gain = await this.applyRankGain(skill, { source, options });
      if (!gain.gained) outcome = gain.limit === 'locked' ? 'locked' : 'capped';
    }
    return { check, outcome, gain, ruleBreak: Boolean(gain?.ruleBreak) || floorRuleBreak, newRank: gain?.gained ? gain.newRank : check.rank };
  },

  /**
   * The check a skill earns once its invested grind hours reach its requirement. Rolls and applies the
   * gain, then empties the skill's invested hours; the hours beyond the requirement come back as
   * `surplusHours` for the caller to return to the pool (never kept on the same skill). Leaves the use
   * mark alone: grinding does not clear marks.
   * @param {Item} skill
   * @param {object} params
   * @param {number} params.invested Hours invested in the skill, this grind included
   * @param {object} [params.options] `rollResult`, `ruleBreak` and `interactive` pass through
   * @returns {Promise<object>} The `skillAdvancement` record the grind card and callers read
   */
  async runGrindAdvancement(skill, { invested, options = {} }) {
    const previousRank = Number(skill.system?.rank) || 0;
    const requiredHours = getRequiredGrindingHours(previousRank);

    // Once per grind day (30 dungeon hours of world time) per skill; a repeat is allowed as a Rule Break.
    let dayRuleBreak = false;
    const now = currentTimeContext();
    if (isWithinWindow(skill.system?.grindStamp, now)) {
      const confirm = await confirmRuleBreak({
        title: 'Already Ground Today',
        message: `${skill.name} was already ground within the last ${GRIND_DAY_HOURS} hours (${formatWindow(skill.system.grindStamp, now)}). Grind it again as a Rule Break?`,
        options
      });
      if (!confirm.confirmed) {
        if (Number(skill.system?.investedHours) !== Number(invested)) await skill.update({ 'system.investedHours': Number(invested) || 0 });
        return {
          skillName: skill.name,
          previousRank,
          newRank: previousRank,
          requiredHours,
          investedHours: Number(invested) || 0,
          surplusHours: 0,
          target: advancementTarget(previousRank),
          roll: null,
          passed: false,
          outcome: 'declined',
          declined: true,
          ruleBreak: false
        };
      }
      dayRuleBreak = true;
    }

    const { check, outcome, ruleBreak, newRank } = await this.resolveAdvancementCheck(skill, {
      rollOptions: { rollResult: options.rollResult },
      source: 'grind',
      options
    });
    await skill.update({ 'system.investedHours': 0, 'system.grindStamp': openWindow(GRIND_DAY_HOURS, now) });
    return {
      skillName: skill.name,
      previousRank,
      newRank,
      requiredHours,
      investedHours: 0,
      surplusHours: Math.max(0, (Number(invested) || 0) - requiredHours),
      target: check.target,
      roll: check.total,
      formula: check.formula,
      rollMode: check.rollMode,
      passed: outcome === 'gain',
      outcome,
      capped: outcome === 'capped',
      locked: outcome === 'locked',
      ruleBreak: ruleBreak || dayRuleBreak
    };
  },

  /**
   * The single Level writer (crawlers only). Adds Levels, resets the grind-hour Level tracker (any Level
   * gain erases it) and banks 3 pending Stat points per Level. Going past Level 250 needs a Rule Break
   * confirmation; declining leaves the Level alone.
   * @param {number} n Levels to add
   * @param {object} [params]
   * @param {string} [params.source] 'grind' | 'xp' | 'award' (informational)
   * @param {object} [params.options] Passed to confirmRuleBreak (`ruleBreak: true` pre-confirms)
   * @returns {Promise<{previousLevel: number, newLevel: number, levelsGained: number, pointsGained: number, ruleBreak: boolean}>}
   */
  async gainLevels(n, { source, options = {} } = {}) {
    const previousLevel = Math.max(1, Math.trunc(Number(this.system?.details?.level)) || 1);
    const none = { previousLevel, newLevel: previousLevel, levelsGained: 0, pointsGained: 0, ruleBreak: false };
    if (this.type !== 'crawler') return none;
    const levels = Math.max(0, Math.trunc(Number(n)) || 0);
    if (levels === 0) return none;

    let ruleBreak = false;
    if (previousLevel + levels > MAX_LEVEL) {
      const confirm = await confirmRuleBreak({
        title: 'Level Limit',
        message: `The Level limit is ${MAX_LEVEL}. ${this.name} would reach Level ${previousLevel + levels}. Award the Levels anyway as a Rule Break?`,
        options
      });
      if (!confirm.confirmed) return none;
      ruleBreak = true;
    }

    const newLevel = previousLevel + levels;
    const pointsGained = STAT_POINTS_PER_LEVEL * levels;
    const pending = Math.max(0, Math.trunc(Number(this.system?.details?.pendingStatPoints)) || 0);
    await this.update({
      'system.details.level': newLevel,
      'system.details.grindLevelHours': 0,
      'system.details.pendingStatPoints': pending + pointsGained
    });
    return { previousLevel, newLevel, levelsGained: levels, pointsGained, ruleBreak };
  },

  /**
   * Credit grind hours toward a Level. Reaching the current Level gains one (or 1d2 when the GM ticked the
   * lowest-Level box) through gainLevels; otherwise the hours accrue on the tracker.
   * @param {number} hours Hours credited to the pool this grind
   * @param {object} [params]
   * @param {boolean} [params.lowestLevelBonus=false] GM checkbox: roll 1d2 Levels instead of 1
   * @param {number} [params.d2] Inject the d2 result (tests)
   * @returns {Promise<{levelsGained: number, previousLevel: number, newLevel: number, tracker: number, bonusRolled: boolean, d2: number|null, pointsGained: number}|null>}
   */
  async creditGrindLevelHours(hours, { lowestLevelBonus = false, d2, options = {} } = {}) {
    if (this.type !== 'crawler') return null;
    const level = Math.max(1, Math.trunc(Number(this.system?.details?.level)) || 1);
    const progress = grindLevelProgress({ level, tracker: this.system?.details?.grindLevelHours, hours });
    if (!progress.levelsGained) {
      await this.update({ 'system.details.grindLevelHours': progress.tracker });
      return { levelsGained: 0, previousLevel: level, newLevel: level, tracker: progress.tracker, bonusRolled: false, d2: null, pointsGained: 0 };
    }
    let count = progress.levelsGained;
    let rolled = null;
    if (lowestLevelBonus) {
      if (Number.isFinite(Number(d2))) rolled = Math.min(2, Math.max(1, Math.trunc(Number(d2))));
      else {
        try {
          rolled = Number((await new Roll('1d2').evaluate())?.total);
        } catch {
          rolled = NaN;
        }
        if (!Number.isFinite(rolled)) rolled = 1;
      }
      count = rolled;
    }
    const res = await this.gainLevels(count, { source: 'grind', options });
    return {
      levelsGained: res.levelsGained,
      previousLevel: res.previousLevel,
      newLevel: res.newLevel,
      tracker: res.levelsGained ? 0 : progress.tracker,
      bonusRolled: lowestLevelBonus,
      d2: rolled,
      pointsGained: res.pointsGained
    };
  },

  /**
   * Spend one pending Stat point on a stat: raises the base (Unenhanced) and Enhanced score by 1. The
   * saferoom restriction is narrative, so nothing blocks it beyond having a point to spend.
   * @param {string} stat 'str' | 'int' | 'con' | 'dex' | 'cha'
   * @returns {Promise<{spent: boolean, stat?: string, remaining: number}>}
   */
  async spendStatPoint(stat) {
    const s = String(stat ?? '').toLowerCase().trim();
    const pending = Math.max(0, Math.trunc(Number(this.system?.details?.pendingStatPoints)) || 0);
    if (!STAT_KEYS.includes(s) || pending <= 0) return { spent: false, remaining: pending };
    const raised = await this.increaseUnenhancedStat(s, 1);
    if (raised?.declined) return { spent: false, stat: s, remaining: pending };
    await this.update({ 'system.details.pendingStatPoints': pending - 1 });
    return { spent: true, stat: s, remaining: pending - 1 };
  },

  /**
   * Spend several pending Stat points in one batch. Points go to Unenhanced scores only; the
   * Enhanced score follows by the same amount. Passing a stat cap or spending more than the pending pool is a
   * Rule Break: one confirmation covers the whole batch, and declining writes nothing. One actor update.
   * The allocation is sanitised: unknown stat keys, non-numeric and non-positive values are ignored and
   * fractions are truncated.
   * @param {Record<string, number>} allocation e.g. `{ str: 10, dex: 17 }`
   * @param {object} [options] Passed to confirmRuleBreak
   * @returns {Promise<{spent: number, remaining: number, ruleBreak: boolean, allocation: Record<string, number>}>}
   */
  async spendStatPoints(allocation, options = {}) {
    const pending = Math.max(0, Math.trunc(Number(this.system?.details?.pendingStatPoints)) || 0);
    const clean = {};
    const source = allocation && typeof allocation === 'object' && !Array.isArray(allocation) ? allocation : {};
    for (const key of STAT_KEYS) {
      const n = Math.trunc(Number(source[key]));
      if (Number.isFinite(n) && n > 0) clean[key] = n;
    }
    const total = Object.values(clean).reduce((a, b) => a + b, 0);
    const none = { spent: 0, remaining: pending, ruleBreak: false, allocation: {} };
    if (total === 0) return none;

    const reasons = [];
    const caps = getStatCaps(this);
    const updates = {};
    for (const [key, n] of Object.entries(clean)) {
      const abilities = this.system?.abilities?.[key] || {};
      const curUnenhanced = Number(abilities.unenhanced ?? abilities.value ?? 10);
      const curValue = Number(abilities.value ?? 10);
      const cap = caps?.[key];
      if (cap !== null && cap !== undefined && curUnenhanced + n > cap) {
        reasons.push(`${key.toUpperCase()} ${curUnenhanced + n} is above this character's cap (${cap})`);
      }
      updates[`system.abilities.${key}.unenhanced`] = curUnenhanced + n;
      updates[`system.abilities.${key}.value`] = curValue + n;
    }
    if (total > pending) reasons.push(`${total} points allocated but only ${pending} are pending`);

    let ruleBreak = false;
    if (reasons.length) {
      const confirm = await confirmRuleBreak({
        title: 'Stat Points',
        message: `${reasons.join('; ')}. Spend them anyway as a Rule Break?`,
        options
      });
      if (!confirm.confirmed) return none;
      ruleBreak = true;
    }

    const remaining = Math.max(0, pending - total);
    updates['system.details.pendingStatPoints'] = remaining;
    await this.update(updates);
    if (ruleBreak) await this.setFlag?.(SYSTEM_ID, 'ruleBreak', true);
    return { spent: total, remaining, ruleBreak, allocation: clean };
  },

  /**
   * Post the chat card for one Skill Advancement Check.
   * @param {object} d AdvancementCardData plus `skillId`
   */
  async postAdvancementCard(d) {
    const { skillId, ...cardData } = d;
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: buildAdvancementCard({ actorName: this.name, ...cardData }),
      flags: {
        [SYSTEM_ID]: {
          isSkillAdvancement: true,
          skillId,
          advancement: {
            mode: 'single',
            ruleBreak: Boolean(cardData.ruleBreak),
            results: [{
              skillId,
              skillName: cardData.skillName,
              previousRank: cardData.previousRank,
              newRank: cardData.newRank,
              rollTotal: cardData.rollTotal,
              target: cardData.target,
              outcome: cardData.outcome
            }]
          }
        }
      }
    });
  },

  /**
   * The ad hoc Skill Advancement Check: one skill, any time. An unmarked skill needs a Rule Break
   * confirmation. The check clears that skill's use mark.
   * @param {Item|string} skillOrId
   * @param {object} [options] `rollResult` injects the d20 total; `silent` skips the chat card;
   *   `ruleBreak: true` pre-confirms prompts
   * @returns {Promise<object|null>} null when the skill is not found
   */
  async runAdvancementCheck(skillOrId, options = {}) {
    const skill = typeof skillOrId === 'string'
      ? this.items?.get(skillOrId)
      : skillOrId;
    if (!skill || skill.type !== 'skill') return null;

    let ruleBreak = false;
    if (!skill.system?.checked) {
      const confirm = await confirmRuleBreak({
        title: 'Skill Not Marked',
        message: `${skill.name} has not been used since its last check. Roll a Skill Advancement Check anyway as a Rule Break?`,
        options
      });
      if (!confirm.confirmed) return { rolled: false, passed: false, ruleBreak: false, reason: 'declined' };
      ruleBreak = true;
    }

    const { check, outcome, ruleBreak: gainRuleBreak, newRank } = await this.resolveAdvancementCheck(skill, {
      rollOptions: { rollResult: options.rollResult, floorEnd: options.floorEnd === true },
      source: 'check',
      options
    });
    ruleBreak = ruleBreak || gainRuleBreak;

    if (skill.system?.checked) await skill.update({ 'system.checked': false });

    if (!options.silent) {
      await this.postAdvancementCard({
        skillId: skill.id,
        skillName: skill.name,
        previousRank: check.rank,
        newRank,
        target: check.target,
        rollTotal: check.total,
        formula: check.formula,
        rollMode: check.rollMode,
        outcome,
        ruleBreak
      });
    }
    return {
      rolled: true,
      passed: outcome === 'gain',
      outcome,
      ruleBreak,
      previousRank: check.rank,
      newRank,
      total: check.total,
      target: check.target,
      formula: check.formula
    };
  }
};
