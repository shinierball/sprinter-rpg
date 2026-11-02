/**
 * Item summary blocks owned by step S2c: buffs, debuffs, achievements, space upgrades, and the shared interrupt and
 * light blocks. Heal/damage per round, severity, limb modifiers, durations; achievement reward, XP, Favor; space
 * upgrade tier, cost, bonuses, training, crafting table. Deity and sponsor carry only HTML prose beyond the shared
 * rows and tags, so they have no block here (their `boons`/`gifts` are exempt in the coverage fixture).
 *
 * Text goes under `COG.ItemSummary.Effects` in lang/en.json and is registered with `defineItemSummaryTemplates`.
 * Nothing here reads names, descriptions or notes.
 */
import { itemLine, t, conditionName, defineItemSummaryTemplates, str, num, signed, integer } from './shared.mjs';
import { durationConfigText } from '../durations.mjs';
import { interruptEffectsText } from '../interrupts.mjs';
import { normalizeTagList } from '../tag-query.mjs';
import { getTagDefinition } from '../../data/tags.mjs';
import { COG_ACHIEVEMENT_TIERS } from '../../data/rules/achievement-tiers.mjs';
import { BONUS_NUMBERS } from '../space-upgrade-fields.mjs';

const K = 'COG.ItemSummary.Effects.';

defineItemSummaryTemplates({
  [`${K}HealPerRound`]: 'Heals {amount} HP each round',
  [`${K}DamageType`]: 'Damage type: {type}',
  [`${K}DamagePerRound`]: '{amount} damage each round',
  [`${K}DamagePerRoundTyped`]: '{amount} {type} damage each round',
  [`${K}Severity`]: '{severity} severity',
  [`${K}Limbs`]: 'Limbs: {parts}',
  [`${K}LimbArms`]: 'Arms {delta}',
  [`${K}LimbLegs`]: 'Legs {delta}',
  [`${K}LimbHands`]: 'Hands {delta}',
  [`${K}Duration`]: 'Duration: {duration}',
  [`${K}EndsWithCombat`]: 'Ends when combat ends',
  [`${K}InterruptTouch`]: 'Interrupt at touch range of the {origin}',
  [`${K}InterruptRange`]: 'Interrupt within {feet} ft of the {origin}',
  [`${K}InterruptUnlimited`]: 'Interrupt at any range from the {origin}',
  [`${K}InterruptWithEffects`]: '{reach}: {effects}',
  [`${K}OriginDefender`]: 'defender',
  [`${K}OriginAttacker`]: 'attacker',
  [`${K}Light`]: 'Emits light: {parts}',
  [`${K}LightBright`]: '{feet} ft bright',
  [`${K}LightDim`]: '{feet} ft dim',
  [`${K}LightCarried`]: 'follows its owner',
  [`${K}LightFree`]: 'stays where it is put',
  [`${K}LightLeash`]: 'at most {feet} ft from its owner',
  [`${K}LightDuration`]: 'burns for {duration}',
  [`${K}Reward`]: 'Reward: {reward}',
  [`${K}Xp`]: '{amount} XP',
  [`${K}Favor`]: '{amount} Favor',
  [`${K}Tier`]: 'Tier: {tier}',
  [`${K}Category`]: 'Category: {category}',
  [`${K}Floor`]: 'Floor: {floor}',
  [`${K}SpaceTier`]: 'Tier {tier}',
  [`${K}SpaceCost`]: 'Cost: {cost}',
  [`${K}SpaceBonus`]: '{label} {amount}',
  [`${K}SpaceBonusPct`]: '{label} {amount}%',
  [`${K}SpaceInjuries`]: 'Removes injuries on rest',
  [`${K}SpaceBuffs`]: 'Grants buffs: {buffs}',
  [`${K}Training`]: 'Training room: {parts}',
  [`${K}TrainingSessions`]: '{sessions} {sessionUnit} per {hours} {hourUnit}',
  [`${K}TrainingHourCost`]: '{hours} {hourUnit} per session',
  [`${K}UnitHour`]: 'hour',
  [`${K}UnitHours`]: 'hours',
  [`${K}UnitSession`]: 'session',
  [`${K}UnitSessions`]: 'sessions',
  [`${K}TrainingRoll`]: '{amount} to the roll',
  [`${K}TrainingDc`]: '{amount} to the DC',
  [`${K}TrainingAdvantage`]: 'advantage',
  [`${K}TrainingSkills`]: 'skills: {query}',
  [`${K}TrainingAny`]: 'any of {tags}',
  [`${K}Crafting`]: 'Crafting table: {parts}',
  [`${K}CraftingType`]: '{type}',
  [`${K}CraftingTier`]: 'tier {tier}',
  [`${K}CraftingUpgrade`]: 'next tier costs {cost} gold'
});

const sysOf = (item) => (item?.system && typeof item.system === 'object' ? item.system : {});
const isType = (...types) => (item) => types.includes(item?.type);
const tagLabels = (list) => normalizeTagList(list).map((id) => getTagDefinition(id)?.label || id).join(', ');

const buffHeal = {
  id: 'buff-heal',
  group: 'effect',
  applies: isType('buff'),
  describe(item) {
    const lines = [];
    const amount = str(sysOf(item).healingPerRound);
    if (amount) lines.push(itemLine('heal', t(`${K}HealPerRound`, { amount }), 'system.healingPerRound'));
    const type = str(sysOf(item).damageType);
    if (type) lines.push(itemLine('damage', t(`${K}DamageType`, { type }), 'system.damageType'));
    return lines;
  }
};

const debuffDamage = {
  id: 'debuff-damage',
  group: 'effect',
  applies: isType('debuff'),
  describe(item) {
    const sys = sysOf(item);
    const amount = str(sys.damagePerRound);
    if (!amount) return [];
    const type = str(sys.damageType);
    const line = type
      ? t(`${K}DamagePerRoundTyped`, { amount, type })
      : t(`${K}DamagePerRound`, { amount });
    return [itemLine('damage', line, 'system.damagePerRound')];
  }
};

const debuffSeverity = {
  id: 'debuff-severity',
  group: 'effect',
  applies: isType('debuff'),
  describe(item) {
    const severity = str(sysOf(item).severity);
    return severity ? [itemLine('mod', t(`${K}Severity`, { severity }), 'system.severity')] : [];
  }
};

const limbModifiers = {
  id: 'limb-modifiers',
  group: 'other',
  applies: isType('buff', 'debuff'),
  describe(item) {
    const limbs = sysOf(item).limbModifiers;
    if (!limbs || typeof limbs !== 'object') return [];
    const parts = [['arms', 'LimbArms'], ['legs', 'LimbLegs'], ['hands', 'LimbHands']]
      .filter(([key]) => integer(limbs[key]) !== 0)
      .map(([key, tpl]) => t(`${K}${tpl}`, { delta: signed(integer(limbs[key])) }));
    return parts.length ? [itemLine('mod', t(`${K}Limbs`, { parts: parts.join(', ') }), 'system.limbModifiers')] : [];
  }
};

const effectDuration = {
  id: 'effect-duration',
  group: 'timing',
  applies: isType('buff', 'debuff'),
  describe(item) {
    const cfg = sysOf(item).durationConfig;
    if (!cfg || typeof cfg !== 'object') return [];
    const lines = [];
    const duration = durationConfigText(cfg);
    if (duration) lines.push(itemLine('timing', t(`${K}Duration`, { duration }), 'system.durationConfig'));
    if (cfg.endsWithCombat === true) lines.push(itemLine('timing', t(`${K}EndsWithCombat`), 'system.durationConfig.endsWithCombat'));
    return lines;
  }
};

const interrupt = {
  id: 'interrupt',
  group: 'interrupt',
  applies(item) {
    const i = sysOf(item).interrupt;
    return Boolean(i && typeof i === 'object' && (num(i.range) > 0 || i.unlimited === true || num(i.drBonus) > 0 || i.ignoreDebuffs === true));
  },
  describe(item) {
    const i = sysOf(item).interrupt;
    const origin = t(i.rangeFrom === 'attacker' ? `${K}OriginAttacker` : `${K}OriginDefender`);
    const feet = Math.max(0, integer(i.range));
    let reach;
    if (i.unlimited === true) reach = t(`${K}InterruptUnlimited`, { origin });
    else if (feet > 0) reach = t(`${K}InterruptRange`, { feet, origin });
    else reach = t(`${K}InterruptTouch`, { origin });
    const effects = interruptEffectsText(i);
    return [itemLine('interrupt', effects ? t(`${K}InterruptWithEffects`, { reach, effects }) : reach, 'system.interrupt')];
  }
};

const light = {
  id: 'light',
  group: 'interrupt',
  applies(item) {
    const l = sysOf(item).light;
    return Boolean(l && typeof l === 'object' && (num(l.bright) > 0 || num(l.dim) > 0));
  },
  describe(item) {
    const l = sysOf(item).light;
    const parts = [];
    if (num(l.bright) > 0) parts.push(t(`${K}LightBright`, { feet: num(l.bright) }));
    if (num(l.dim) > 0) parts.push(t(`${K}LightDim`, { feet: num(l.dim) }));
    parts.push(t(l.mode === 'free' ? `${K}LightFree` : `${K}LightCarried`));
    if (num(l.leash) > 0) parts.push(t(`${K}LightLeash`, { feet: num(l.leash) }));
    const duration = l.duration && typeof l.duration === 'object' ? durationConfigText(l.duration) : '';
    if (duration) parts.push(t(`${K}LightDuration`, { duration }));
    return [itemLine('light', t(`${K}Light`, { parts: parts.join(', ') }), 'system.light')];
  }
};

const achievementReward = {
  id: 'achievement-reward',
  group: 'reward',
  applies: isType('achievement'),
  describe(item) {
    const sys = sysOf(item);
    const lines = [];
    const tier = str(sys.tier).toLowerCase();
    if (tier) lines.push(itemLine('reward', t(`${K}Tier`, { tier: COG_ACHIEVEMENT_TIERS?.[tier]?.label || tier }), 'system.tier'));
    const category = str(sys.category);
    if (category) lines.push(itemLine('reward', t(`${K}Category`, { category }), 'system.category'));
    const floor = str(sys.floor);
    if (floor) lines.push(itemLine('reward', t(`${K}Floor`, { floor }), 'system.floor'));
    const reward = str(sys.reward);
    if (reward) lines.push(itemLine('reward', t(`${K}Reward`, { reward }), 'system.reward'));
    const xp = integer(sys.xp);
    if (xp) lines.push(itemLine('reward', t(`${K}Xp`, { amount: signed(xp) }), 'system.xp'));
    const favor = integer(sys.favor);
    if (favor) lines.push(itemLine('reward', t(`${K}Favor`, { amount: signed(favor) }), 'system.favor'));
    return lines;
  }
};

const spaceCost = {
  id: 'space-upgrade-cost',
  group: 'reward',
  applies: isType('space_upgrade'),
  describe(item) {
    const sys = sysOf(item);
    const lines = [];
    const tier = integer(sys.tier);
    if (tier > 0) lines.push(itemLine('reward', t(`${K}SpaceTier`, { tier }), 'system.tier'));
    const cost = num(sys.cost);
    if (cost > 0) lines.push(itemLine('reward', t(`${K}SpaceCost`, { cost }), 'system.cost'));
    return lines;
  }
};

const spaceBonuses = {
  id: 'space-upgrade-bonuses',
  group: 'reward',
  applies: isType('space_upgrade'),
  describe(item, ctx) {
    const bonuses = sysOf(item).bonuses;
    if (!bonuses || typeof bonuses !== 'object') return [];
    const lines = [];
    for (const [key, label, , flags] of BONUS_NUMBERS) {
      const n = num(bonuses[key]);
      if (!n) continue;
      // A percentage field carries a `pct` flag and its name; the template adds the percent sign after the number.
      const line = flags?.pct
        ? t(`${K}SpaceBonusPct`, { label: flags.name, amount: n })
        : t(`${K}SpaceBonus`, { label, amount: signed(n) });
      lines.push(itemLine('reward', line, `system.bonuses.${key}`));
    }
    if (bonuses.removesInjuriesOnRest === true) lines.push(itemLine('reward', t(`${K}SpaceInjuries`), 'system.bonuses.removesInjuriesOnRest'));
    const buffs = Array.isArray(bonuses.buffs) ? bonuses.buffs.filter((b) => typeof b === 'string' && b.trim()).map((b) => conditionName('buffs', b, ctx)) : [];
    if (buffs.length) lines.push(itemLine('reward', t(`${K}SpaceBuffs`, { buffs: buffs.join(', ') }), 'system.bonuses.buffs'));
    return lines;
  }
};

/** The singular or plural unit word for `n` (`Hour` or `Hours`, `Session` or `Sessions`). */
const unit = (word, n) => t(`${K}Unit${word}${n === 1 ? '' : 's'}`);

const spaceTraining = {
  id: 'space-upgrade-training',
  group: 'reward',
  applies: (item) => item?.type === 'space_upgrade' && sysOf(item).training?.enabled === true,
  describe(item) {
    const tr = sysOf(item).training;
    const parts = [];
    if (integer(tr.sessionsPerWindow) > 0 && num(tr.windowHours) > 0) {
      parts.push(t(`${K}TrainingSessions`, {
        sessions: integer(tr.sessionsPerWindow), sessionUnit: unit('Session', integer(tr.sessionsPerWindow)),
        hours: num(tr.windowHours), hourUnit: unit('Hour', num(tr.windowHours))
      }));
    }
    if (num(tr.hourCost) > 0) parts.push(t(`${K}TrainingHourCost`, { hours: num(tr.hourCost), hourUnit: unit('Hour', num(tr.hourCost)) }));
    if (integer(tr.rollBonus)) parts.push(t(`${K}TrainingRoll`, { amount: signed(integer(tr.rollBonus)) }));
    if (integer(tr.dcModifier)) parts.push(t(`${K}TrainingDc`, { amount: signed(integer(tr.dcModifier)) }));
    if (tr.advantage === true) parts.push(t(`${K}TrainingAdvantage`));
    const q = tr.allowedSkillTags && typeof tr.allowedSkillTags === 'object' ? tr.allowedSkillTags : {};
    const any = tagLabels(q.any);
    const query = [tagLabels(q.all), any && t(`${K}TrainingAny`, { tags: any })].filter(Boolean).join('; ');
    if (query) parts.push(t(`${K}TrainingSkills`, { query }));
    return parts.length ? [itemLine('reward', t(`${K}Training`, { parts: parts.join(', ') }), 'system.training')] : [];
  }
};

const spaceCrafting = {
  id: 'space-upgrade-crafting',
  group: 'reward',
  applies: (item) => item?.type === 'space_upgrade' && sysOf(item).craftingTable?.enabled === true,
  describe(item) {
    const ct = sysOf(item).craftingTable;
    const parts = [];
    const type = str(ct.tableTypeTag);
    if (type) parts.push(t(`${K}CraftingType`, { type: getTagDefinition(type)?.label || type }));
    const tier = [ct.baseTier, ct.purchasedTiers, ct.couponTiers].reduce((sum, n) => sum + Math.max(0, integer(n)), 0);
    if (tier > 0) parts.push(t(`${K}CraftingTier`, { tier }));
    if (num(ct.upgradeCostGold) > 0) parts.push(t(`${K}CraftingUpgrade`, { cost: num(ct.upgradeCostGold) }));
    return parts.length ? [itemLine('reward', t(`${K}Crafting`, { parts: parts.join(', ') }), 'system.craftingTable')] : [];
  }
};

/** @type {ReadonlyArray<import('./shared.mjs').ItemSummaryBlock>} */
export const BLOCKS = Object.freeze([
  buffHeal, debuffDamage, debuffSeverity, limbModifiers, effectDuration, interrupt, light,
  achievementReward, spaceCost, spaceBonuses, spaceTraining, spaceCrafting
]);
