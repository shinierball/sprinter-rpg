/**
 * Item summary blocks owned by step S2c: buffs, debuffs, achievements, space upgrades, and the shared interrupt and
 * light blocks. Heal/damage per round, severity, limb modifiers, durations; achievement reward, XP, Favor; space
 * upgrade tier, cost, bonuses, training, crafting table; a deity's rivals, signature, offering and tier effects; a patron's skills, advice channel, linked actor, availability and venues. A
 * sponsor carries only HTML prose beyond the shared rows and tags, so it has no block here (its `gifts` is exempt in the
 * coverage fixture).
 *
 * Text goes under `COG.ItemSummary.Effects` in lang/en.json and is registered with `defineItemSummaryTemplates`.
 * Nothing here reads names, descriptions or notes.
 */
import { itemLine, t, conditionName, defineItemSummaryTemplates, str, num, signed, integer, humanizeId } from './shared.mjs';
import { findCatalogEntry } from '../../content/catalog-lookup.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { typeIn, isEffectItem } from '../document-types.mjs';
import { normalizeTransform, TRANSFORM_CUES, CURE_WINDOWS } from '../character/transform-rules.mjs';
import { durationConfigText } from '../time/durations.mjs';
import { interruptEffectsText } from '../combat/interrupts.mjs';
import { cleanTagQuery, normalizeTagList } from '../tag/tag-query.mjs';
import { getTagDefinition } from '../../data/tag-definitions.mjs';
import { COG_ACHIEVEMENT_TIERS } from '../../data/rules/achievement-tiers.mjs';
import { BONUS_NUMBERS } from './space-upgrade-fields.mjs';
import { tableTierParts, tableTierText } from './blocks-crafting.mjs';
import { deityName, skillOrSpellName } from '../deity/deity-names.mjs';
import { patronProfileOf } from '../patron/patron-profile.mjs';
import { activationOf } from '../effects/activation-window.mjs';
import { activationWindowPhrase } from '../effects/activation-text.mjs';
import { formatTiming, normalizeTiming } from '../time/timing.mjs';

const K = 'COG.ItemSummary.Effects.';

defineItemSummaryTemplates({
  [`${K}HealPerRound`]: 'Heals {amount} HP each round',
  [`${K}DamageType`]: 'Damage type: {type}',
  [`${K}DamagePerRound`]: '{amount} damage each round',
  [`${K}DamagePerRoundTyped`]: '{amount} {type} damage each round',
  [`${K}Activated`]: '{cooldown}: {window}',
  [`${K}ActivatedNoCooldown`]: 'Activated: {window}',
  [`${K}WindowCombat`]: 'until the end of combat',
  [`${K}WindowOneUse`]: 'for one use',
  [`${K}WindowUses`]: 'for {n} uses',
  [`${K}WindowOneHit`]: 'until the next hit',
  [`${K}WindowHits`]: 'for {n} hits',
  [`${K}WindowTimed`]: 'for {n} {unit}',
  [`${K}Severity`]: '{severity} severity',
  [`${K}RepeatStack`]: 'Stacks when applied again',
  [`${K}RepeatPromote`]: 'A second application becomes {into}',
  [`${K}AlsoApplies`]: 'Also lands: {list}',
  [`${K}Limbs`]: 'Limbs: {parts}',
  [`${K}LimbArms`]: 'Arms {delta}',
  [`${K}LimbLegs`]: 'Legs {delta}',
  [`${K}LimbHands`]: 'Hands {delta}',
  [`${K}Duration`]: 'Duration: {duration}',
  [`${K}TransformForms`]: 'Changes into: {forms}',
  [`${K}TransformEffects`]: 'Adds: {effects}',
  [`${K}TransformCue`]: 'Reminder: {cue}',
  [`${K}TransformCure`]: 'Cure after the change: {window}',
  [`${K}Secret`]: 'Asks the GM to hide it from players when it lands',
  [`${K}Paused`]: 'Paused',
  [`${K}Suppresses`]: 'Suppresses {parts}',
  [`${K}SuppressesBuffs`]: 'buffs: {tags}',
  [`${K}SuppressesSkills`]: 'skills: {tags}',
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
  [`${K}CraftingUpgrade`]: 'next tier costs {cost} gold',
  [`${K}Studio`]: 'Studio for {type}',
  [`${K}StudioAny`]: 'Studio',
  [`${K}DeityRivals`]: 'Rivals: {names}',
  [`${K}DeitySignature`]: 'Signature: {parts}',
  [`${K}DeitySignatureEffects`]: 'Signature gifts: {names}',
  [`${K}DeityOfferingNone`]: 'Offering: none',
  [`${K}DeityOffering`]: 'Offering: {parts}',
  [`${K}DeityGold`]: '+{gold} gold',
  [`${K}DeityConsumes`]: 'consumes {quantity} × {tags}',
  [`${K}DeityTier1`]: 'Acolyte: {names}',
  [`${K}DeityTier2`]: 'Devotee: {names}',
  [`${K}DeityTier3`]: 'Zealot: {names}',
  [`${K}DeityPatron`]: 'May be a patron',
  [`${K}PatronPerformance`]: 'Performance: {names}',
  [`${K}PatronSkills`]: 'Also knows: {names}',
  [`${K}PatronAdviceHud`]: 'Advice: HUD chat',
  [`${K}PatronAdviceFairy`]: 'Advice: messenger fairy',
  [`${K}PatronLinked`]: 'Linked to {name}',
  [`${K}PatronLinkBroken`]: 'Linked actor: link broken',
  [`${K}PatronAvailability`]: 'Available: {text}',
  [`${K}PatronVenues`]: 'Venues: {text}'
});

const sysOf = (item) => (item?.system && typeof item.system === 'object' ? item.system : {});
const tagLabels = (list) => normalizeTagList(list).map((id) => getTagDefinition(id)?.label || id).join(', ');

const buffHeal = {
  id: 'buff-heal',
  group: 'effect',
  applies: typeIn('buff'),
  describe(item) {
    const lines = [];
    const amount = str(sysOf(item).healingPerRound);
    if (amount) lines.push(itemLine('heal', t(`${K}HealPerRound`, { amount }), 'system.healingPerRound'));
    const type = str(sysOf(item).damageType);
    if (type) lines.push(itemLine('damage', t(`${K}DamageType`, { type }), 'system.damageType'));
    return lines;
  }
};

/** "Once per day: for 10 minutes": an activated buff's cooldown and the window its Use opens. */
const buffActivation = {
  id: 'buff-activation',
  group: 'timing',
  applies: (item) => item?.type === 'buff' && activationOf(item).enabled,
  describe(item) {
    const activation = activationOf(item);
    const window = activationWindowPhrase(activation, (key, _fallback, data) => t(key, data), K);
    const cooldown = normalizeTiming(activation.cooldown);
    const text = cooldown.unit
      ? t(`${K}Activated`, { cooldown: formatTiming(cooldown), window })
      : t(`${K}ActivatedNoCooldown`, { window });
    return [itemLine('timing', text, 'system.activation')];
  }
};

const debuffDamage = {
  id: 'debuff-damage',
  group: 'effect',
  applies: typeIn('debuff'),
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
  applies: typeIn('debuff'),
  describe(item) {
    const severity = str(sysOf(item).severity);
    return severity ? [itemLine('mod', t(`${K}Severity`, { severity }), 'system.severity')] : [];
  }
};

/** "Stacks when applied again" / "Becomes X when applied again", and the debuffs that land with this one. */
const debuffRepeat = {
  id: 'debuff-repeat',
  group: 'effect',
  applies: typeIn('debuff'),
  describe(item, ctx) {
    const sys = sysOf(item);
    const lines = [];
    const mode = str(sys.repeat?.mode);
    if (mode === 'stack') lines.push(itemLine('mod', t(`${K}RepeatStack`), 'system.repeat.mode'));
    if (mode === 'promote' && str(sys.repeat?.into)) {
      lines.push(itemLine('mod', t(`${K}RepeatPromote`, { into: conditionName('debuffs', sys.repeat.into, ctx) }), 'system.repeat.into'));
    }
    const also = (Array.isArray(sys.alsoApplies) ? sys.alsoApplies : []).filter((id) => typeof id === 'string' && id.trim());
    if (also.length) lines.push(itemLine('mod', t(`${K}AlsoApplies`, { list: also.map((id) => conditionName('debuffs', id, ctx)).join(', ') }), 'system.alsoApplies'));
    return lines;
  }
};

/** One line each for the affliction's forms, added effects, reminder and cure window; a hidden debuff's lines are GM-only. */
const debuffTransform = {
  id: 'debuff-transform',
  group: 'effect',
  applies: typeIn('debuff'),
  describe(item, ctx) {
    const sys = sysOf(item);
    const lines = [];
    const block = normalizeTransform(sys.transform);
    if (block) {
      if (block.forms.length) {
        const forms = block.forms.map((f) => f.label || findCatalogEntry('races', f.race)?.name || humanizeId(f.race)).join(', ');
        lines.push(itemLine('mod', t(`${K}TransformForms`, { forms }), 'system.transform.forms'));
      }
      if (block.effects.length) {
        const effects = block.effects.map((id) => conditionName('debuffs', id, ctx)).join(', ');
        lines.push(itemLine('mod', t(`${K}TransformEffects`, { effects }), 'system.transform.effects'));
      }
      if (block.cue) lines.push(itemLine('timing', t(`${K}TransformCue`, { cue: TRANSFORM_CUES[block.cue]?.label || block.cue }), 'system.transform.cue'));
      if (block.forms.length || block.effects.length) {
        lines.push(itemLine('timing', t(`${K}TransformCure`, { window: CURE_WINDOWS[block.curable]?.label || block.curable }), 'system.transform.curable'));
      }
    }
    // The secret and switched-off lines carry no hidden data of their own, but `secret` is a GM note: GM-only.
    if (sys.secret === true) lines.push({ ...itemLine('mod', t(`${K}Secret`), 'system.secret'), gmOnly: true });
    if (sys.paused === true) lines.push(itemLine('mod', t(`${K}Paused`), 'system.paused'));
    if (item?.flags?.[SYSTEM_ID]?.hidden === true) for (const line of lines) line.gmOnly = true;
    return lines;
  }
};

/** The tags a suppression query names, labelled; `none` tags read as "not X". Empty for a null or empty query. */
function suppressionTags(raw) {
  const q = cleanTagQuery(raw);
  const label = (id) => getTagDefinition(id)?.label || id;
  return [...q.all.map(label), ...q.any.map(label), ...q.none.map((id) => `not ${label(id)}`)];
}

/** What a debuff in force switches off: "Suppresses buffs: <tags>; skills: <tags>". */
const debuffSuppresses = {
  id: 'debuff-suppresses',
  group: 'effect',
  applies: typeIn('debuff'),
  describe(item) {
    const sys = sysOf(item);
    const parts = [];
    const buffs = suppressionTags(sys.suppresses?.buffs);
    const skills = suppressionTags(sys.suppresses?.skills);
    if (buffs.length) parts.push(t(`${K}SuppressesBuffs`, { tags: buffs.join(', ') }));
    if (skills.length) parts.push(t(`${K}SuppressesSkills`, { tags: skills.join(', ') }));
    return parts.length ? [itemLine('mod', t(`${K}Suppresses`, { parts: parts.join('; ') }), 'system.suppresses')] : [];
  }
};

const limbModifiers = {
  id: 'limb-modifiers',
  group: 'other',
  applies: isEffectItem,
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
  applies: isEffectItem,
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
  applies: typeIn('achievement'),
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
  applies: typeIn('space_upgrade'),
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
  applies: typeIn('space_upgrade'),
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
    if (tableTierParts(ct).tier > 0) parts.push(tableTierText(ct));
    if (num(ct.upgradeCostGold) > 0) parts.push(t(`${K}CraftingUpgrade`, { cost: num(ct.upgradeCostGold) }));
    return parts.length ? [itemLine('reward', t(`${K}Crafting`, { parts: parts.join(', ') }), 'system.craftingTable')] : [];
  }
};

const spaceStudio = {
  id: 'space-upgrade-studio',
  group: 'reward',
  applies: (item) => item?.type === 'space_upgrade' && sysOf(item).studio?.enabled === true,
  describe(item) {
    const type = str(sysOf(item).studio.tableTypeTag);
    const label = type ? t(`${K}Studio`, { type: getTagDefinition(type)?.label || type }) : t(`${K}StudioAny`);
    return [itemLine('reward', label, 'system.studio')];
  }
};

const DEITY_TIERS = Object.freeze([1, 2, 3]);

/** A deity's structured fields, one line each. Identifiers print as the installed name, or as themselves when nothing has them. */
const deityFields = {
  id: 'deity-fields',
  group: 'other',
  applies: typeIn('deity'),
  describe(item) {
    const sys = sysOf(item);
    const lines = [];
    const rivals = (Array.isArray(sys.rivals) ? sys.rivals : []).map(str).filter(Boolean);
    if (rivals.length) lines.push(itemLine('mod', t(`${K}DeityRivals`, { names: rivals.map((id) => deityName(id) ?? id).join(', ') }), 'system.rivals'));

    const stat = str(sys.signature?.stat);
    const skills = (Array.isArray(sys.signature?.skills) ? sys.signature.skills : []).map(str).filter(Boolean);
    const signature = [...(stat ? [stat.toUpperCase()] : []), ...skills.map((id) => skillOrSpellName(id) ?? id)];
    if (signature.length) lines.push(itemLine('mod', t(`${K}DeitySignature`, { parts: signature.join('; ') }), 'system.signature'));

    const gifts = (Array.isArray(sys.signatureEffects) ? sys.signatureEffects : []).map((e) => str(e?.name)).filter(Boolean);
    if (gifts.length) lines.push(itemLine('buff', t(`${K}DeitySignatureEffects`, { names: gifts.join(', ') }), 'system.signatureEffects'));

    const offering = sys.offering ?? {};
    if (offering.required === false) {
      lines.push(itemLine('cost', t(`${K}DeityOfferingNone`), 'system.offering'));
    } else {
      const parts = [];
      const text = str(offering.text);
      if (text) parts.push(text);
      if (num(offering.gold) > 0) parts.push(t(`${K}DeityGold`, { gold: num(offering.gold) }));
      const quantity = num(offering.consume?.quantity);
      const tags = tagLabels([...(offering.consume?.query?.all ?? []), ...(offering.consume?.query?.any ?? [])]);
      if (quantity > 0 && tags) parts.push(t(`${K}DeityConsumes`, { quantity, tags }));
      if (parts.length) lines.push(itemLine('cost', t(`${K}DeityOffering`, { parts: parts.join(', ') }), 'system.offering'));
    }

    const tierEffects = Array.isArray(sys.tierEffects) ? sys.tierEffects : [];
    for (const tier of DEITY_TIERS) {
      const names = tierEffects.filter((e) => num(e?.tier) === tier).map((e) => str(e?.name)).filter(Boolean);
      if (names.length) lines.push(itemLine('buff', t(`${K}DeityTier${tier}`, { names: names.join(', ') }), 'system.tierEffects'));
    }
    if (sys.patronage === true) lines.push(itemLine('mod', t(`${K}DeityPatron`), 'system.patronage'));
    return lines;
  }
};

/** A patron's structured fields, one line each. Identifiers print as the installed name, or as themselves when nothing has them. */
const patronFields = {
  id: 'patron-fields',
  group: 'other',
  applies: typeIn('patron'),
  describe(item) {
    const sys = sysOf(item);
    const profile = patronProfileOf(item);
    const names = (ids) => ids.map((id) => skillOrSpellName(id) ?? id).join(', ');
    const lines = [];
    if (profile.performanceSkills.length) lines.push(itemLine('skill', t(`${K}PatronPerformance`, { names: names(profile.performanceSkills) }), 'system.performanceSkills'));
    if (profile.skills.length) lines.push(itemLine('skill', t(`${K}PatronSkills`, { names: names(profile.skills) }), 'system.skills'));
    lines.push(itemLine('mod', t(`${K}${profile.messaging === 'fairy' ? 'PatronAdviceFairy' : 'PatronAdviceHud'}`), 'system.messaging'));
    if (profile.actorUuid) {
      const actor = globalThis.fromUuidSync?.(profile.actorUuid) ?? null;
      lines.push(itemLine('mod', actor?.name ? t(`${K}PatronLinked`, { name: actor.name }) : t(`${K}PatronLinkBroken`), 'system.actorUuid'));
    }
    const availability = str(sys.availability);
    if (availability) lines.push(itemLine('timing', t(`${K}PatronAvailability`, { text: availability }), 'system.availability'));
    const venues = str(sys.venues);
    if (venues) lines.push(itemLine('mod', t(`${K}PatronVenues`, { text: venues }), 'system.venues'));
    return lines;
  }
};

/** @type {ReadonlyArray<import('./shared.mjs').ItemSummaryBlock>} */
export const BLOCKS = Object.freeze([
  buffHeal, buffActivation, debuffDamage, debuffSeverity, debuffRepeat, debuffTransform, debuffSuppresses, limbModifiers, effectDuration, interrupt, light,
  achievementReward, spaceCost, spaceBonuses, spaceTraining, spaceCrafting, spaceStudio, deityFields, patronFields
]);
