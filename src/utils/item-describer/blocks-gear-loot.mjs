/**
 * Item summary blocks owned by step S2b: gear (armor, accessories, weapons), loot and attack items. Reads only
 * structured fields; referenced documents are named through their identifiers (never a name or a description).
 *
 * Owned item (`ctx.actor`): the actor's own methods give the owner-dependent numbers (to-hit, damage). Unowned: the
 * item's base fields. No combat math lives here. The `onHit`, `area`, `cooldown` and `contest` sentences of gear come
 * from the `attack-mechanics` block (index.mjs), which also applies to gear.
 *
 * Strings live under `COG.ItemSummary.GearLoot` in lang/en.json; the defaults below are identical (a test checks it).
 */
import { rollsNoDamage, baseDamageText as structuredDamageText } from '../base-damage.mjs';
import { itemLine, t, conditionName, documentName, humanizeId, defineItemSummaryTemplates, str, token, num, signed, healBarsText, tempBarsText } from './shared.mjs';
import { isWeaponGear, getWieldMode, isNaturalWeapon } from '../wielding.mjs';
import { getDamageParts, formatDamagePart, primaryDamagePart, attackDamageDisplay } from '../damage-parts.mjs';
import { resolveAttackToHit, attackToHitStat } from '../to-hit-display.mjs';
import { abilityModifierEntries } from '../ability-modifiers.mjs';
import { statName, applyRowLabels, choiceLabel } from '../feature-describer.mjs';
import { outcomeWeightTotal, outcomeChancePercent } from '../outcome-weights.mjs';
import { outcomeHealBars, outcomeRounds, outcomeRankBonus, outcomeLearnRank, outcomeStatValue, outcomeRestore } from '../outcome-defaults.mjs';
import { cooldownLabel, hasCooldown } from '../cooldowns.mjs';
import { resolveReachedRankBreaks } from '../rank-breaks.mjs';
import { rankBreakLine } from './rank-break-text.mjs';
import { asTriggerLines } from '../amazing-success.mjs';
import { resolveGrantName } from '../../data/race-class-grants.mjs';
import { isScratchLootType, lootTypeLabel } from '../../models/items/loot-model.mjs';
import { itemUsage, USAGE_KINDS, isAuraItem } from '../tag-mechanics.mjs';
import { describeAreaEffects } from './blocks-spell-skill.mjs';
import { getUsedForm } from '../../data/rules/used-forms.mjs';

const K = 'COG.ItemSummary.GearLoot.';

defineItemSummaryTemplates({
  [`${K}Slot`]: '{slot} slot (only while equipped)',
  [`${K}WieldOne`]: 'One-handed',
  [`${K}WieldTwo`]: 'Two-handed',
  [`${K}WieldTwoOrOne`]: 'Two-handed; can be used one-handed at Disadvantage',
  [`${K}WeaponFlag`]: 'Counts as a weapon',
  [`${K}WeaponClass`]: 'Weapon: {text}',
  [`${K}WeaponSkills`]: 'Uses the skill: {skills}',
  [`${K}WeaponSkillsHighest`]: 'Uses the highest of: {skills}',
  [`${K}WeaponSkillsManual`]: 'Uses the chosen skill of: {skills}',
  [`${K}ToHitOwned`]: 'To hit: {formula} ({stat})',
  [`${K}ToHitBase`]: 'To hit: {stat} + Rank {rank}',
  [`${K}ToHitBaseNoRank`]: 'To hit: {stat}',
  [`${K}Damage`]: 'Damage: {text}',
  [`${K}Crit`]: 'Critical hits multiply damage by {n}',
  [`${K}IgnoreDR`]: 'Ignores DR',
  [`${K}AbilityMod`]: '{value} {stat}',
  [`${K}PersistentBuffs`]: 'While equipped, grants: {list}',
  [`${K}PersistentDebuffs`]: 'While equipped, inflicts: {list}',
  [`${K}Heal`]: 'Heals {bars} each round',
  [`${K}Cleanse`]: 'Cleanses: {list}',
  [`${K}Activated`]: 'Has an activated ability',
  [`${K}ModeAll`]: 'Using it applies every outcome',
  [`${K}ModeRandom`]: 'Using it rolls one outcome at random',
  [`${K}Charges`]: '{value}/{max} charges',
  [`${K}LootType`]: '{type}',
  [`${K}UsageReusable`]: 'Reusable: using it spends nothing',
  [`${K}UsageRechargeable`]: 'Rechargeable: each use spends a charge; at 0 it still works as a Rule Break',
  [`${K}UsageConsumable`]: 'Consumable: each use spends one and leaves junk',
  [`${K}UsedInto`]: 'Leaves {name} when used up',
  [`${K}Cooldown`]: 'Cooldown: {text}',
  [`${K}CastsSpell`]: 'Casts {name}',
  [`${K}OptionalEffects`]: 'Can add techniques: {list}',
  [`${K}OutcomeChance`]: '{text} ({percent}%)',
  [`${K}OutcomeHeal`]: 'Heals {bars}',
  [`${K}OutcomeHot`]: 'Heals {bars} each round for {rounds} rounds',
  [`${K}OutcomeRestoreAll`]: 'Restores all {resource}',
  [`${K}OutcomeRestore`]: 'Restores {amount} {resource}',
  [`${K}OutcomeBuff`]: 'Grants {name}',
  [`${K}OutcomeDebuff`]: 'Inflicts {name}',
  [`${K}OutcomeCureAll`]: 'Cures all debuffs',
  [`${K}OutcomeCure`]: 'Cures {name}',
  [`${K}OutcomeMend`]: 'Mends a {severity} injury',
  [`${K}OutcomeSkillRank`]: '+{n} Rank in {name}',
  [`${K}OutcomeStat`]: 'Permanently {value} {stat}',
  [`${K}OutcomeLearn`]: 'Teaches {name} at Rank {rank}',
  [`${K}OutcomeSpell`]: 'Casts {name}',
  [`${K}OutcomeDamage`]: 'Deals {damage} {type} damage',
  [`${K}OutcomeDamageNoRoll`]: 'Rolls no damage: enter dice as NdM',
  [`${K}OutcomeTable`]: 'Rolls on {name}',
  [`${K}OutcomeTableUnnamed`]: 'Rolls on a table'
});

/* -------------------------------------------- */
/*  Small helpers                               */
/* -------------------------------------------- */

const sysOf = (item) => (item?.system && typeof item.system === 'object' ? item.system : {});
const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : []);
const isGear = (item) => item?.type === 'gear';
const isLoot = (item) => item?.type === 'loot';
const isWeapon = (item) => (item?.type === 'gear' || item?.type === 'attack') && isWeaponGear(item);
const ownerOf = (ctx) => (ctx?.actor && typeof ctx.actor === 'object' ? ctx.actor : null);

const joinNames = (names) => names.filter(Boolean).join(', ');

/* -------------------------------------------- */
/*  Gear: slot, wield, weapon traits            */
/* -------------------------------------------- */

const gearSlot = {
  id: 'gear-slot',
  group: 'wield',
  applies: (item) => isGear(item),
  describe: (item) => {
    const slot = token(sysOf(item).slot);
    return slot ? [itemLine('wield', t(`${K}Slot`, { slot: humanizeId(slot) }), 'system.slot')] : [];
  }
};

const wieldMode = {
  id: 'wield-mode',
  group: 'wield',
  applies: (item) => isWeapon(item),
  describe: (item) => {
    const sys = sysOf(item);
    let handless = false;
    try { handless = isNaturalWeapon(item); } catch { /* a bare object has no tags */ }
    // A bare attack item (no category or type) is a natural attack: no hands, as `calculateItemHandsRequired` has it
    if (handless || (item.type === 'attack' && !str(sys.weaponCategory) && !str(sys.weaponType))) return [];
    if (!getWieldMode(sys, { itemType: item.type, handless })) return [];
    const key = { two_handed: 'WieldTwo', two_handed_disadv_1h: 'WieldTwoOrOne' }[sys.wieldMode] ?? 'WieldOne';
    return [itemLine('wield', t(`${K}${key}`), 'system.wieldMode')];
  }
};

/** The explicit weapon flag: equipped, the gear becomes an attack profile (`isWeaponGear`), whatever else it has. */
const weaponFlag = {
  id: 'weapon-flag',
  group: 'wield',
  applies: (item) => isGear(item) && sysOf(item).isWeapon === true,
  describe: () => [itemLine('wield', t(`${K}WeaponFlag`), 'system.isWeapon')]
};

/** The aura effects of a gear item's area (the aura engine runs them only for gear with an aura tag and the flag). */
const gearAreaEffects = {
  id: 'gear-area-effects',
  group: 'effect',
  applies: (item) => isGear(item) && isAuraItem(item),
  describe: (item) => describeAreaEffects(item)
};

const weaponClass = {
  id: 'weapon-class',
  group: 'wield',
  applies: (item) => isWeapon(item),
  describe: (item) => {
    const sys = sysOf(item);
    const parts = [token(sys.weaponCategory), token(sys.weaponType)].filter(Boolean);
    return parts.length ? [itemLine('wield', t(`${K}WeaponClass`, { text: parts.map(humanizeId).join(' / ') }), 'system.weaponCategory')] : [];
  }
};

const weaponSkills = {
  id: 'weapon-skills',
  group: 'wield',
  applies: (item) => isWeapon(item) && strings(sysOf(item).associatedSkills).length > 0,
  describe: async (item) => {
    const sys = sysOf(item);
    const skills = joinNames(await Promise.all(strings(sys.associatedSkills).map((s) => documentName(s, 'skill'))));
    const key = sys.proficiencyMode === 'manual' ? 'WeaponSkillsManual' : (strings(sys.associatedSkills).length > 1 ? 'WeaponSkillsHighest' : 'WeaponSkills');
    return [itemLine('skill', t(`${K}${key}`, { skills }), 'system.associatedSkills')];
  }
};

const optionalEffects = {
  id: 'optional-effects',
  group: 'wield',
  applies: (item) => (isGear(item) || item?.type === 'attack') && strings(sysOf(item).optionalEffects).length > 0,
  describe: async (item) => {
    const list = joinNames(await Promise.all(strings(sysOf(item).optionalEffects).map((s) => documentName(s, 'skill'))));
    return [itemLine('skill', t(`${K}OptionalEffects`, { list }), 'system.optionalEffects')];
  }
};

/* -------------------------------------------- */
/*  Weapon: to-hit, damage, crit, ignore DR     */
/* -------------------------------------------- */

const weaponToHit = {
  id: 'weapon-to-hit',
  group: 'effect',
  applies: (item) => isWeapon(item),
  describe: (item, ctx) => {
    const sys = sysOf(item);
    const actor = ownerOf(ctx);
    if (actor) {
      try {
        const { toHitStat, hit } = resolveAttackToHit(item, actor);
        if (hit?.formula) return [itemLine('attack', t(`${K}ToHitOwned`, { formula: hit.formula, stat: toHitStat.toUpperCase() }), 'system.toHitStat')];
      } catch { /* fall back to the item's own fields */ }
    }
    const rank = Math.max(0, Math.floor(num(sys.toHitRank)));
    // A bare natural attack (default DEX, Rank 0) has nothing to say about its own to-hit
    if (!rank && !str(sys.weaponCategory) && !str(sys.weaponType) && !(isGear(item) && str(sys.toHitStat))) return [];
    const stat = attackToHitStat(item, null, primaryDamagePart(sys)).toUpperCase();
    const out = rank ? t(`${K}ToHitBase`, { stat, rank }) : t(`${K}ToHitBaseNoRank`, { stat });
    return [itemLine('attack', out, 'system.toHitStat')];
  }
};

/** The item's own damage parts as text: every part with dice, stat modifier, flat bonus and type. */
function baseDamageText(sys) {
  const parts = [];
  for (const part of getDamageParts(sys)) {
    const base = formatDamagePart(part);
    const flat = num(part.value);
    let out = base;
    if (flat) out = base ? `${base} ${flat > 0 ? '+' : '-'} ${Math.abs(flat)}` : signed(flat);
    if (!out) continue;
    const type = str(part.type);
    parts.push(type ? `${out} (${type})` : out);
  }
  return parts.join(', ');
}

const weaponDamage = {
  id: 'weapon-damage',
  group: 'effect',
  applies: (item) => isWeapon(item),
  describe: (item, ctx) => {
    const sys = sysOf(item);
    const actor = ownerOf(ctx);
    let out = '';
    if (actor && typeof actor.getAttackDamageParts === 'function') {
      try { out = attackDamageDisplay(item, actor); } catch { out = ''; }
    }
    if (!out) out = baseDamageText(sys);
    return out ? [itemLine('damage', t(`${K}Damage`, { text: out }), 'system.damageParts')] : [];
  }
};

const weaponCrit = {
  id: 'weapon-crit',
  group: 'effect',
  applies: (item) => isWeapon(item) && num(sysOf(item).critMultiplier) > 1,
  describe: (item) => [itemLine('damage', t(`${K}Crit`, { n: Math.floor(num(sysOf(item).critMultiplier)) }), 'system.critMultiplier')]
};

const ignoreDR = {
  id: 'ignore-dr',
  group: 'effect',
  applies: (item) => (isGear(item) || item?.type === 'attack') && sysOf(item).ignoreDR === true,
  describe: () => [itemLine('damage', t(`${K}IgnoreDR`), 'system.ignoreDR')]
};

const asTriggers = {
  id: 'as-triggers',
  group: 'effect',
  applies: (item) => (isGear(item) || item?.type === 'attack') && Array.isArray(sysOf(item).asTriggers) && sysOf(item).asTriggers.length > 0,
  describe: (item, ctx) => {
    const triggers = sysOf(item).asTriggers.filter((x) => x && typeof x === 'object'
      && ((x.type === 'debuff' && str(x.identifier)) || (x.type === 'narrative' && str(x.text))));
    const found = new Map();
    for (const trig of triggers) {
      if (trig.type === 'debuff' && trig.identifier) found.set(trig.identifier, conditionName('debuffs', trig.identifier, ctx));
    }
    return asTriggerLines(triggers, { found }).map((l) => itemLine('on-hit', l.text, 'system.asTriggers'));
  }
};

/* -------------------------------------------- */
/*  Weapon rank breaks                          */
/* -------------------------------------------- */

const DEFAULT_THRESHOLDS = { rank5: 5, rank10: 10, rank15: 15, rank20: 20 };

/** The rank the owner's weapon skill gives this item (the roll's rank), else the context's rank, else none. */
function ownerRank(item, ctx) {
  const actor = ownerOf(ctx);
  if (Number.isFinite(ctx?.rank)) return Number(ctx.rank);
  if (actor && typeof actor._resolveWeaponSkills === 'function') {
    try { return num(actor._resolveWeaponSkills(item).skillRank); } catch { return null; }
  }
  return null;
}

const weaponRankBreaks = {
  id: 'weapon-rank-breaks',
  group: 'effect',
  applies: (item) => (isGear(item) || item?.type === 'attack') && sysOf(item).rankBreaks && typeof sysOf(item).rankBreaks === 'object' && Object.keys(sysOf(item).rankBreaks).length > 0,
  describe: (item, ctx) => {
    const breaks = sysOf(item).rankBreaks;
    const rank = ownerRank(item, ctx);
    const reached = rank === null ? new Set() : new Set(resolveReachedRankBreaks(item, rank).reachedTiers.map((r) => r.key));
    const tiers = Object.entries(breaks)
      .filter(([, tier]) => tier && typeof tier === 'object')
      .map(([key, tier]) => ({ key, tier, at: num(tier.rank) || DEFAULT_THRESHOLDS[key] || 0 }))
      .filter((x) => x.at > 0)
      .sort((a, b) => a.at - b.at);
    const ownDamageType = str(primaryDamagePart(sysOf(item))?.type);
    const out = []; // ascending Rank; kind 'attack' (a weapon's break changes the attack)
    for (const { key, tier, at } of tiers) {
      // A reached break leaves out its damage: the Damage line (the actor's own damage parts) already carries it. Armor piercing stays, the weapon's Ignores DR line reads only its own field.
      const entry = rankBreakLine('attack', { rank: at, tier, reached: reached.has(key), ignoresDrShown: false, ownDamageType, rowPath: `system.rankBreaks.${key}` });
      if (entry) out.push(entry.line);
    }
    return out;
  }
};

/* -------------------------------------------- */
/*  Gear: stats, persistent effects, healing    */
/* -------------------------------------------- */

const abilityMods = {
  id: 'ability-modifiers',
  group: 'stat',
  applies: (item) => isGear(item) && abilityModifierEntries(sysOf(item).abilityModifiers).length > 0,
  describe: (item) => abilityModifierEntries(sysOf(item).abilityModifiers).map(({ stat, value, pct }) => itemLine(
    'stat',
    t(`${K}AbilityMod`, { value: `${signed(value)}${pct ? '%' : ''}`, stat: statName(stat) }),
    `system.abilityModifiers.${stat}`
  ))
};

const persistentBuffs = {
  id: 'persistent-buffs',
  group: 'other',
  applies: (item) => isGear(item) && strings(sysOf(item).persistentBuffs).length > 0,
  describe: (item, ctx) => [itemLine('mod', t(`${K}PersistentBuffs`, { list: joinNames(strings(sysOf(item).persistentBuffs).map((r) => conditionName('buffs', r, ctx))) }), 'system.persistentBuffs')]
};

const persistentDebuffs = {
  id: 'persistent-debuffs',
  group: 'other',
  applies: (item) => isGear(item) && strings(sysOf(item).persistentDebuffs).length > 0,
  describe: (item, ctx) => [itemLine('mod', t(`${K}PersistentDebuffs`, { list: joinNames(strings(sysOf(item).persistentDebuffs).map((r) => conditionName('debuffs', r, ctx))) }), 'system.persistentDebuffs')]
};

const gearHealing = {
  id: 'gear-healing',
  group: 'effect',
  applies: (item) => isGear(item) && sysOf(item).healing?.hasHealing === true,
  describe: (item, ctx) => {
    const healing = sysOf(item).healing;
    const out = [];
    const bars = Math.floor(num(healing.barsPerRound));
    if (bars > 0) out.push(itemLine('heal', t(`${K}Heal`, { bars: healBarsText(bars) }), 'system.healing.barsPerRound'));
    const cleanse = strings(healing.cleanseDebuffs);
    if (cleanse.length) out.push(itemLine('heal', t(`${K}Cleanse`, { list: joinNames(cleanse.map((r) => conditionName('debuffs', r, ctx))) }), 'system.healing.cleanseDebuffs'));
    return out;
  }
};

const gearTempBars = {
  id: 'gear-temp-bars',
  group: 'effect',
  applies: (item) => isGear(item) && sysOf(item).tempBars?.hasTempBars === true && num(sysOf(item).tempBars.hpPerSlot) > 0,
  describe: (item, ctx) => {
    const tb = sysOf(item).tempBars;
    return [itemLine('heal', tempBarsText(tb, num(tb.hpPerSlot), { actor: ctx?.actor }), 'system.tempBars')];
  }
};

/* -------------------------------------------- */
/*  Gear and loot: use, charges, spell, outcomes */
/* -------------------------------------------- */

const modeKey = (sys, scratch) => (scratch || String(sys.executionMode ?? '').toLowerCase().trim() === 'random' ? 'ModeRandom' : 'ModeAll');

const activatedAbility = {
  id: 'activated-ability',
  group: 'cast',
  applies: (item) => isGear(item) && sysOf(item).hasActivatedAbility === true,
  describe: (item) => {
    const sys = sysOf(item);
    const out = [itemLine('use', t(`${K}Activated`), 'system.hasActivatedAbility')];
    if (Array.isArray(sys.outcomes) && sys.outcomes.length) out.push(itemLine('use', t(`${K}${modeKey(sys, false)}`), 'system.executionMode'));
    return out;
  }
};

const lootType = {
  id: 'loot-type',
  group: 'cast',
  applies: (item) => isLoot(item),
  describe: (item) => {
    const sys = sysOf(item);
    const out = [itemLine('use', t(`${K}LootType`, { type: lootTypeLabel(sys.lootType) }), 'system.lootType')];
    if (Array.isArray(sys.outcomes) && sys.outcomes.length) out.push(itemLine('use', t(`${K}${modeKey(sys, isScratchLootType(sys.lootType))}`), 'system.executionMode'));
    return out;
  }
};

// How the item is used up (3.76): shown on loot and on gear with an activated ability.
const usedFormName = (item) => getUsedForm(sysOf(item).usedInto)?.name ?? '';
const usageLine = {
  id: 'usage',
  group: 'cast',
  // The plain default (activated gear reusable, loot consumable) needs no line; a stored tag, another kind or a named used form does.
  applies: (item) => {
    if (!(isLoot(item) || (isGear(item) && sysOf(item).hasActivatedAbility === true))) return false;
    const stored = Array.isArray(sysOf(item).tags) && sysOf(item).tags.some((tag) => Object.values(USAGE_KINDS).includes(tag));
    return stored || itemUsage(item) !== (isGear(item) ? 'reusable' : 'consumable') || usedFormName(item) !== '';
  },
  describe: (item) => {
    const kind = itemUsage(item);
    const out = [];
    const stored = Array.isArray(sysOf(item).tags) && sysOf(item).tags.some((tag) => Object.values(USAGE_KINDS).includes(tag));
    if (stored || kind !== (isGear(item) ? 'reusable' : 'consumable')) out.push(itemLine('use', t(`${K}Usage${kind[0].toUpperCase()}${kind.slice(1)}`), 'system.tags'));
    if (kind === 'consumable' && usedFormName(item)) out.push(itemLine('use', t(`${K}UsedInto`, { name: usedFormName(item) }), 'system.usedInto'));
    return out;
  }
};

const charges = {
  id: 'charges',
  group: 'timing',
  applies: (item) => (isGear(item) || isLoot(item)) && num(sysOf(item).charges?.max) > 0,
  describe: (item) => {
    const c = sysOf(item).charges;
    const max = Math.floor(num(c.max));
    const value = Math.max(0, Math.floor(c.value === undefined || c.value === null ? max : num(c.value)));
    return [itemLine('timing', t(`${K}Charges`, { value, max }), 'system.charges')];
  }
};

const lootCooldown = {
  id: 'loot-cooldown',
  group: 'timing',
  applies: (item) => isLoot(item) && hasCooldown(item),
  describe: (item) => [itemLine('timing', t(`${K}Cooldown`, { text: cooldownLabel(item) }), 'system.cooldown')]
};

const linkedSpell = {
  id: 'linked-spell',
  group: 'cast',
  applies: (item) => (isGear(item) || isLoot(item)) && Boolean(str(sysOf(item).spellIdentifier)),
  describe: async (item) => {
    const sys = sysOf(item);
    const name = (await resolveGrantName({ identifier: str(sys.spellIdentifier) }, 'spell')) || str(sys.spellName) || humanizeId(str(sys.spellIdentifier));
    return [itemLine('spell', t(`${K}CastsSpell`, { name }), 'system.spellIdentifier')];
  }
};

/** "Deals 2d6 + Int Fire damage", flagged when the dice are not plain NdM (the roll adds no damage then, 393 a). */
function outcomeDamageText(out, defaultType) {
  const dice = str(out.damage) || '1d6';
  const shown = structuredDamageText({ dice, stat: str(out.damageStat) || 'none' });
  const line = t(`${K}OutcomeDamage`, { damage: shown, type: str(out.damageType) || defaultType });
  return rollsNoDamage(dice) ? `${line} (${t(`${K}OutcomeDamageNoRoll`)})` : line;
}

/** The effect an outcome row has, as `{ kind, effect, subject }`; `effect` is '' for a row type the describer does not know. `subject` is the resolved name of the buff, debuff, skill, spell or table the effect is about ('' when there is none). */
async function outcomeEffect(out, ctx) {
  const type = str(out.type).toLowerCase();
  const healBars = outcomeHealBars(out);
  const bars = healBarsText(healBars);
  switch (type) {
    case 'heal': case 'heal_bars':
      return { kind: 'heal', effect: t(`${K}OutcomeHeal`, { bars }) };
    case 'heal_over_time': case 'hot':
      return { kind: 'heal', effect: t(`${K}OutcomeHot`, { bars, rounds: outcomeRounds(out) }) };
    case 'restore_resource': case 'restore_mana': case 'mana': {
      const resource = choiceLabel('resource', str(out.resource) || 'mana');
      const restore = outcomeRestore(out);
      return { kind: 'heal', effect: restore.full ? t(`${K}OutcomeRestoreAll`, { resource }) : t(`${K}OutcomeRestore`, { amount: restore.amount, resource }) };
    }
    case 'buff': {
      const name = conditionName('buffs', out.buffIdentifier, ctx) || str(out.name);
      return { kind: 'buff', effect: t(`${K}OutcomeBuff`, { name }), subject: name };
    }
    case 'debuff': {
      const name = conditionName('debuffs', out.debuffIdentifier, ctx) || str(out.name);
      return { kind: 'debuff', effect: t(`${K}OutcomeDebuff`, { name }), subject: name };
    }
    case 'cure_debuff': {
      const filter = str(out.debuffTarget) || str(out.filter) || 'all';
      if (filter === 'all') return { kind: 'use', effect: t(`${K}OutcomeCureAll`) };
      const name = conditionName('debuffs', filter, ctx);
      return { kind: 'use', effect: t(`${K}OutcomeCure`, { name }), subject: name };
    }
    case 'mend_injury':
      return { kind: 'heal', effect: t(`${K}OutcomeMend`, { severity: str(out.injurySeverity) || str(out.severity) || 'minor' }) };
    case 'skill_rank': {
      const name = await documentName(out.skillIdentifier, 'skill') || str(out.skillName);
      return { kind: 'skill', effect: t(`${K}OutcomeSkillRank`, { n: outcomeRankBonus(out), name }), subject: name };
    }
    case 'stat_permanent':
      return { kind: 'stat', effect: t(`${K}OutcomeStat`, { value: signed(outcomeStatValue(out)), stat: statName(token(out.stat).toLowerCase() || 'str') }) };
    case 'learn_spell': {
      const name = await documentName(out.spellIdentifier, 'spell') || str(out.spellName);
      return { kind: 'spell', effect: t(`${K}OutcomeLearn`, { name, rank: outcomeLearnRank(out) }), subject: name };
    }
    case 'spell': {
      const linked = str(out.spellIdentifier);
      if (linked) {
        const name = await documentName(linked, 'spell') || str(out.spellName);
        return { kind: 'spell', effect: t(`${K}OutcomeSpell`, { name }), subject: name };
      }
      return out.damage ? { kind: 'damage', effect: outcomeDamageText(out, 'Fire') } : { kind: 'spell', effect: '' };
    }
    case 'damage':
      return { kind: 'damage', effect: outcomeDamageText(out, 'Physical') };
    case 'roll_table': {
      const uuid = str(out.tableUuid) || str(out.tableId);
      let name = str(out.tableName);
      if (!name && uuid && typeof globalThis.fromUuid === 'function') {
        try { name = (await globalThis.fromUuid(uuid))?.name || ''; } catch { name = ''; }
      }
      const shown = name || str(out.name);
      if (!shown) return { kind: 'use', effect: t(`${K}OutcomeTableUnnamed`) };
      return { kind: 'use', effect: t(`${K}OutcomeTable`, { name: shown }), subject: shown };
    }
    default:
      return { kind: 'use', effect: '' };
  }
}

const outcomes = {
  id: 'outcomes',
  group: 'effect',
  applies: (item) => (isGear(item) || isLoot(item)) && Array.isArray(sysOf(item).outcomes) && sysOf(item).outcomes.length > 0,
  describe: async (item, ctx) => {
    const sys = sysOf(item);
    const random = isLoot(item) && isScratchLootType(sys.lootType) ? true : String(sys.executionMode ?? '').toLowerCase().trim() === 'random';
    const lines = [];
    const rows = sys.outcomes;
    const table = rows.filter((o) => o && typeof o === 'object');
    for (let i = 0; i < rows.length; i++) {
      const out = rows[i];
      if (!out || typeof out !== 'object') continue;
      const { kind, effect, subject } = await outcomeEffect(out, ctx);
      const name = str(out.name);
      if (!effect && !name) continue;
      // Weights are relative (333 a): the chance printed is the share the roll itself uses.
      let generated = effect || name;
      if (random && outcomeWeightTotal(table) > 0) generated = t(`${K}OutcomeChance`, { text: generated, percent: outcomeChancePercent(out, table) });
      const row = itemLine(kind, generated, `system.outcomes.${i}`);
      if (effect && name) row.pendingLabel = name;
      if (subject) row.subject = subject;
      lines.push(row);
    }
    applyRowLabels(lines, item?.name);
    return lines;
  }
};

/** @type {ReadonlyArray<import('./shared.mjs').ItemSummaryBlock>} */
export const BLOCKS = Object.freeze([
  gearSlot, wieldMode, weaponFlag, gearAreaEffects, weaponClass, weaponSkills, optionalEffects,
  weaponToHit, weaponDamage, weaponCrit, ignoreDR, asTriggers, weaponRankBreaks,
  abilityMods, persistentBuffs, persistentDebuffs, gearHealing, gearTempBars,
  activatedAbility, lootType, usageLine, charges, lootCooldown, linkedSpell, outcomes
]);
