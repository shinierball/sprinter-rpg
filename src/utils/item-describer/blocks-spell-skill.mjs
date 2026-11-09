/**
 * Item summary blocks for spells and skills: what it costs, what it
 * does, how long it lasts, and what the next Rank breaks add.
 *
 * Every block reads structured fields only (never a name, description or note to decide anything) and builds its text
 * from the helpers the roll and cast paths already use, so the summary never disagrees with the roll:
 *  - an owned item (`ctx.actor`) is described at the owner's Rank through `getSpellDamageData`, `getSkillDamageData`,
 *    `resolveSpellCost` (Mana after `manaCostModifiers` rows) and `healingBarsFor`; the NEXT Rank breaks follow;
 *  - an unowned item is described at its own `rank` and lists every Rank break;
 *  - `ctx.rank` overrides the Rank in both cases.
 * The describer does no Rank math of its own: which breaks are reached comes from `resolveReachedRankBreaks`.
 * Text lives under `COG.ItemSummary.SpellSkill` in lang/en.json (identical defaults are registered below).
 */
import { normalizeBaseDamage, baseDamageText } from '../damage/base-damage.mjs';
import {
  itemLine, t, conditionRefName, conditionName, documentName, defineItemSummaryTemplates, str, token, whole, signed, humanizeId, healBarsText, tempBarsText
} from './shared.mjs';
import { describeAttackLines } from './attack-lines.mjs';
import { hotRoundsOf } from '../time/hot-rounds.mjs';
import { specialtyLabel } from '../skill/skill-specialty-options.mjs';
import { rankBreakLine } from './rank-break-text.mjs';
import { getItemAllTags } from '../../documents/active-tags.mjs';
import { getTagDefinition } from '../../data/tag-definitions.mjs';
import { RANK_BREAK_THRESHOLDS } from '../../data/tag-vocabulary.mjs';
import { resolveReachedRankBreaks, getItemRank } from '../skill/rank-breaks.mjs';
import { collectOnHitEffects } from '../attack/on-hit.mjs';
import { effectiveDuration, durationConfigText } from '../time/durations.mjs';
import { cooldownLabel, hasCooldown } from '../time/cooldowns.mjs';
import { checkTypeLabel } from '../../data/rules/check-types.mjs';
import { techniqueBandSummary, effectIdentifiers } from '../../documents/actor/actor-techniques.mjs';
import { resolveSpellCost } from '../../documents/actor/spell-cast.mjs';
import { healingBarsFor, cleanseListFor } from '../../documents/actor/use-card-parts.mjs';
import { hasRuleFlag, RULE_FLAGS } from '../tag/tag-behaviour.mjs';
import { skillGroupLabel, spellRole, spellRoleLabel, PRIMARY_ATTACK_TAGS } from '../tag/tag-mechanics.mjs';

const KEY = 'COG.ItemSummary.SpellSkill';

defineItemSummaryTemplates({
  [`${KEY}.Stat`]: 'Stat: {stat}',
  [`${KEY}.Rank`]: 'Rank {n}',
  [`${KEY}.RankCeiling`]: 'Rank {n} (ceiling {max})',
  [`${KEY}.CeilingOnly`]: 'Rank ceiling {max}',
  [`${KEY}.BoonBonus`]: '{n} Rank from boons',
  [`${KEY}.NoRankGain`]: 'Cannot gain Ranks by training',
  [`${KEY}.SpellRole`]: '{type} spell',
  [`${KEY}.SkillGroup`]: 'Group: {group}',
  [`${KEY}.Specialty`]: 'Specialty: {label}',
  [`${KEY}.CheckTypeNoStat`]: 'Check: {type}',
  [`${KEY}.AiFavor`]: 'AI Favor {n}',
  [`${KEY}.ManaCost`]: '{n} Mana',
  [`${KEY}.ManaCostModified`]: '{n} Mana (base {base})',
  [`${KEY}.Damage`]: 'Damage {formula}',
  [`${KEY}.DamageTyped`]: 'Damage {formula} {type}',
  [`${KEY}.DamageParts`]: 'Plus {parts} damage',
  [`${KEY}.IgnoresDr`]: 'Ignores DR',
  [`${KEY}.CritFromRank`]: 'Critical hits x{n} from Rank {rank}',
  [`${KEY}.Heal`]: 'Heals {bars} ({targets})',
  [`${KEY}.HealOverTime`]: 'Heals {bars} each round for {rounds} rounds ({targets})',
  [`${KEY}.Cleanse`]: 'Cleanses {list}',
  [`${KEY}.Delivery`]: 'Delivery: {label}',
  [`${KEY}.AreaAffects`]: 'Affects {filter}',
  [`${KEY}.AreaPeriodic`]: 'Each round: {formula} damage',
  [`${KEY}.AreaPeriodicTyped`]: 'Each round: {formula} {type} damage',
  [`${KEY}.AreaInflicts`]: 'Inflicts {list}',
  [`${KEY}.AreaPulse`]: 'Each pulse inflicts {list}',
  [`${KEY}.AreaHeal`]: 'Heals {bars}',
  [`${KEY}.AreaHealOverTime`]: 'Heals {bars} each round for {rounds} rounds',
  [`${KEY}.AreaGrants`]: 'Grants {list}',
  [`${KEY}.AreaResist`]: 'Grants resistance to {list}',
  [`${KEY}.AreaImmune`]: 'Grants immunity to {list}',
  [`${KEY}.AreaAbsorb`]: 'Absorbs {element}',
  [`${KEY}.AreaEvade`]: '{n} to Evade',
  [`${KEY}.AreaAttack`]: '{n} to attacks',
  [`${KEY}.AreaDamageBonus`]: '{n} damage',
  [`${KEY}.Lifesteal`]: 'Heals the attacker {heal} after the hit takes {min}+ slot(s)',
  [`${KEY}.DispelAll`]: 'Dispels the target\'s Buffs until combat ends',
  [`${KEY}.DispelCount`]: 'Dispels {n} of the target\'s Buff(s) until combat ends',
  [`${KEY}.DispelMatching`]: '{text} matching {query}',
  [`${KEY}.FumbleDebuff`]: 'On a fumble: {debuff}',
  [`${KEY}.OptionalEffects`]: 'Damage effects: {list}',
  [`${KEY}.Duration`]: 'Duration: {text}',
  [`${KEY}.DurationBonus`]: 'Duration: {text} (+{n} from Rank)',
  [`${KEY}.EndsWithCombat`]: '{text}, ends when combat ends',
  [`${KEY}.Cooldown`]: 'Cooldown: {text}',
  [`${KEY}.Technique`]: 'Technique',
  [`${KEY}.TechniqueDamage`]: 'Damage effect technique',
  [`${KEY}.AppliesTo`]: 'Applies to attacks matching {query}',
  [`${KEY}.Condition`]: 'Takes effect when {query}',
  [`${KEY}.BaseDice`]: 'Base dice count {mod}',
  [`${KEY}.BaseMultiplier`]: 'Base damage result x {formula}',
  [`${KEY}.FlatDamage`]: 'Flat damage {formula}',
  [`${KEY}.DamageBonus`]: '+{formula} damage',
  [`${KEY}.TechniqueType`]: 'Damage type {type}',
  [`${KEY}.TechniqueDebuff`]: 'Inflicts {label}',
  [`${KEY}.HealthMultiplier`]: 'Total damage x{n} against targets at or below {percent}% Health (from Rank {rank})',
  [`${KEY}.Variant`]: 'From Rank {rank}: {label}',
  [`${KEY}.VariantReplaces`]: 'From Rank {rank}: {label} instead of damage',
  [`${KEY}.VariantDebuffs`]: '{text} ({list})',
  [`${KEY}.Assist`]: 'Assist: adds {formula} to an ally\'s check',
  [`${KEY}.AssistWhen`]: 'Assist: adds {formula} to an ally\'s check when {query}',
  [`${KEY}.QueryAll`]: 'all of {tags}',
  [`${KEY}.QueryAny`]: 'any of {tags}',
  [`${KEY}.QueryNone`]: 'none of {tags}',
  [`${KEY}.AtRankBand`]: 'At Rank {rank}: {text}',
  [`${KEY}.Upgrades`]: 'Upgrades: {text}'
});

// ---- small, defensive readers (CONTRIBUTING §4) ----------------------------------------------------------------

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const sysOf = (item) => (isObj(item?.system) ? item.system : {});
const list = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const tagLabel = (id) => str(getTagDefinition(id)?.label) || str(id);
const isSpell = (item) => item?.type === 'spell';
const isSkill = (item) => item?.type === 'skill';
const L = (key, data) => t(`${KEY}.${key}`, data);

/** Whether the item belongs to a character (`ctx.actor`): described at the owner's Rank, with the owner's numbers. */
const owner = (ctx) => (ctx?.actor && typeof ctx.actor === 'object' ? ctx.actor : null);

/**
 * The Rank to describe at: `ctx.rank` when given, else the item's resolved Rank (the owner's modified Rank for an owned
 * item, its own `rank` otherwise). A spell is at least Rank 1, as the cast path treats it.
 */
function rankOf(item, ctx) {
  const given = ctx?.rank;
  if (given !== undefined && given !== null && given !== '' && Number.isFinite(Number(given))) return Math.max(0, Math.floor(Number(given)));
  const sys = sysOf(item);
  const rank = Math.max(Number(getItemRank(item)) || 0, Number(sys.modifiedRank) || 0, Number(sys.rank) || 0, 0);
  return isSpell(item) ? Math.max(1, Math.floor(rank)) : Math.floor(rank);
}

/**
 * The item as the owner's damage code reads it at `rank`: the item itself unless the caller overrode the Rank, then a
 * plain stand-in with the same data at that Rank (the damage methods only read `system`).
 */
function atRank(item, rank, ctx) {
  const given = ctx?.rank;
  if (given === undefined || given === null || given === '' || !Number.isFinite(Number(given))) return item;
  const sys = sysOf(item);
  const plain = typeof sys.toObject === 'function' ? sys.toObject() : { ...sys };
  return { type: item.type, name: item.name, uuid: item.uuid, system: { ...plain, rank, modifiedRank: rank } };
}

/** A tag query `{ all, any, none }` as text, or ''. */
function queryText(q) {
  if (!isObj(q)) return '';
  const names = (tags) => list(tags).map(tagLabel).join(', ');
  return [
    names(q.all) && L('QueryAll', { tags: names(q.all) }),
    names(q.any) && L('QueryAny', { tags: names(q.any) }),
    names(q.none) && L('QueryNone', { tags: names(q.none) })
  ].filter(Boolean).join('; ');
}

const spellOrSkill = (item) => isSpell(item) || isSkill(item);

// ---- cast: stat, rank, kind, check ------------------------------------------------------------------------------

function describeCast(item, ctx) {
  const sys = sysOf(item);
  const kind = isSpell(item) ? 'spell' : 'skill';
  const out = [];
  const stat = token(sys.stat).toUpperCase();
  if (stat) out.push(itemLine(kind, L('Stat', { stat }), 'system.stat'));

  const rank = rankOf(item, ctx);
  const ceiling = sys.rankCeiling === null || sys.rankCeiling === undefined || sys.rankCeiling === '' ? null : whole(sys.rankCeiling);
  if (rank > 0 && ceiling !== null) out.push(itemLine(kind, L('RankCeiling', { n: rank, max: ceiling }), 'system.rank'));
  else if (rank > 0) out.push(itemLine(kind, L('Rank', { n: rank }), 'system.rank'));
  else if (ceiling !== null) out.push(itemLine(kind, L('CeilingOnly', { max: ceiling }), 'system.rankCeiling'));

  const boon = Math.trunc(Number(sys.boonBonus) || 0);
  if (isSkill(item) && boon) out.push(itemLine('mod', L('BoonBonus', { n: signed(boon) }), 'system.boonBonus'));
  if (isSkill(item) && sys.canGainRanks === false) out.push(itemLine('skill', L('NoRankGain'), 'system.canGainRanks'));

  if (isSpell(item)) {
    const role = spellRole(item);
    if (role !== 'none') out.push(itemLine('spell', L('SpellRole', { type: spellRoleLabel(role) }), 'system.checkType'));
  } else {
    const group = str(skillGroupLabel(item));
    if (group) out.push(itemLine('skill', L('SkillGroup', { group }), 'system.tags'));
    const specialty = specialtyLabel(sys.specialty);
    if (specialty) out.push(itemLine('skill', L('Specialty', { label: specialty }), 'system.specialty'));
    const checkType = str(sys.checkType);
    if (checkType) {
      const label = str(checkTypeLabel(checkType)) || checkType;
      out.push(itemLine('skill', L('CheckTypeNoStat', { type: label }), 'system.checkType'));
    }
  }
  const favor = Math.trunc(Number(sys.aiFavor) || 0);
  if (isSpell(item) && favor) out.push(itemLine('mod', L('AiFavor', { n: signed(favor) }), 'system.aiFavor'));
  return out;
}

/** Mana: the owner's cost after `manaCostModifiers` rows and the non-favored penalty (the cast path), else the base cost. */
async function describeMana(item, ctx) {
  const base = whole(sysOf(item).manaCost);
  const actor = owner(ctx);
  let cost = base;
  if (actor) {
    try {
      const resolved = await resolveSpellCost(actor, item, { interactive: false, situations: [] }, { isGrantedSpell: false });
      cost = whole(resolved?.manaCost, 0);
    } catch {
      cost = base;
    }
  }
  if (!cost && !base) return [];
  return [itemLine('cost', cost !== base ? L('ManaCostModified', { n: cost, base }) : L('ManaCost', { n: cost }), 'system.manaCost')];
}

// ---- damage, healing, temp bars ---------------------------------------------------------------------------------

/** "1d6 Fire" or "+3": one rank damage part. */
const partText = (m) => [str(m?.dice) || (Number(m?.value) ? signed(Math.trunc(Number(m.value))) : ''), str(m?.type)].filter(Boolean).join(' ');

/** The rank damage parts split by whether the Rank has reached them. */
function splitParts(sys, rank) {
  const parts = (Array.isArray(sys.rankDamageParts) ? sys.rankDamageParts : []).filter((m) => isObj(m) && (str(m.dice) || Number(m.value)));
  return { active: parts.filter((m) => rank >= whole(m.minRank)), later: parts.filter((m) => rank < whole(m.minRank)) };
}

function describeDamage(item, ctx) {
  const sys = sysOf(item);
  const actor = owner(ctx);
  const rank = rankOf(item, ctx);
  const out = [];
  const damage = (formula, type, path) => {
    if (!formula) return;
    // A base damage text may already end with its type ("1d6 + Int Fire"): name the type once.
    if (type && formula.toLowerCase().endsWith(` ${type.toLowerCase()}`)) type = '';
    out.push(itemLine('damage', type ? L('DamageTyped', { formula, type }) : L('Damage', { formula }), path));
  };
  const { active } = splitParts(sys, rank);

  if (isSpell(item)) {
    let data = null;
    if (actor && typeof actor.getSpellDamageData === 'function') {
      try { data = actor.getSpellDamageData(atRank(item, rank, ctx)); } catch { data = null; }
    }
    if (data?.hasDamage) {
      damage(str(data.formula), str(data.damageType), 'system.baseDamage');
    } else if (!data) {
      // Unowned: the base damage text plus the parts the Rank has reached (no owner stat to add).
      const own = normalizeBaseDamage(sys.baseDamage);
      const pieces = [own.dice ? baseDamageText({ ...own, damageType: '' }) : '', ...active.map((m) => str(m.dice) || signed(Math.trunc(Number(m.value))))].filter(Boolean);
      const formula = pieces.reduce((acc, p) => (acc ? `${acc} ${/^[+-]/.test(p) ? p : `+ ${p}`}` : p), '');
      damage(formula, str(own.damageType) || str(active[0]?.type), 'system.baseDamage');
    }
  } else if (isSkill(item)) {
    const base = isObj(sys.baseDamage) ? sys.baseDamage : {};
    let data = null;
    if (actor && typeof actor.getSkillDamageData === 'function') {
      try { data = actor.getSkillDamageData(item, { rank }); } catch { data = null; }
    }
    if (data) {
      if (data.hasDamage) damage(str(data.formula), str(data.damageType), 'system.baseDamage');
    } else if (str(base.dice) && !(sys.hasDamage === false && !PRIMARY_ATTACK_TAGS.some((tag) => getItemAllTags(item).has(tag)))) {
      // Unowned: the roll's own rule (`getSkillDamageData`) says a skill with Has Damage off deals none, unless it is a primary attack
      const stat = token(base.stat).toLowerCase();
      const formula = stat && stat !== 'none' ? `${str(base.dice)} + ${stat.toUpperCase()}` : str(base.dice);
      damage(formula, str(base.damageType), 'system.baseDamage');
    }
    // A skill's own rank damage parts are added on top of its damage (not part of the formula above).
    if (active.length) out.push(itemLine('damage', L('DamageParts', { parts: active.map(partText).filter(Boolean).join(' + ') }), 'system.rankDamageParts'));
  }

  const reached = resolveReachedRankBreaks(item, rank);
  if (sys.ignoreDR === true || hasRuleFlag(getItemAllTags(item), RULE_FLAGS.ignoresDr) || reached.isArmorPiercing) {
    out.push(itemLine('damage', L('IgnoresDr'), 'system.ignoreDR'));
  }
  for (const [field, from] of [['critMultiplierR5', 5], ['critMultiplierR15', 15]]) {
    const n = whole(sys[field]);
    if (n > 1) out.push(itemLine('damage', L('CritFromRank', { n, rank: from }), `system.${field}`));
  }
  return out;
}

export function describeHealing(item, ctx) {
  const sys = sysOf(item);
  const h = isObj(sys.healing) ? sys.healing : {};
  const cleanse = list(h.cleanseDebuffs);
  if (!h.hasHealing && !h.isHoT && !cleanse.length) return [];
  const rank = rankOf(item, ctx);
  const actor = owner(ctx);
  const reached = resolveReachedRankBreaks(item, rank);
  const formula = str(h.barsFormula) || '1';
  let bars;
  if (actor) {
    try { bars = String(healingBarsFor(actor, formula, reached)); } catch { bars = ''; }
  }
  if (!bars) {
    const bonus = Number(reached.healing?.barsBonus) || 0;
    bars = bonus ? `${formula.toUpperCase()} ${bonus > 0 ? '+' : '-'} ${Math.abs(bonus)}` : formula.toUpperCase();
  }
  const targets = FILTERS[str(h.targetFilter)] || 'allies';
  const out = [];
  if (h.hasHealing || h.isHoT) {
    out.push(itemLine('heal', h.isHoT
      ? L('HealOverTime', { bars: healBarsText(bars), rounds: hotRoundsOf(h), targets })
      : L('Heal', { bars: healBarsText(bars), targets }), 'system.healing'));
  }
  const names = cleanseListFor(sys, reached).map(conditionRefName);
  if (names.length) out.push(itemLine('heal', L('Cleanse', { list: names.join(', ') }), 'system.healing.cleanseDebuffs'));
  return out;
}

function describeTempBars(item, ctx) {
  const tb = sysOf(item).tempBars;
  if (!isObj(tb) || !tb.hasTempBars) return [];
  const reached = resolveReachedRankBreaks(item, rankOf(item, ctx));
  const actor = owner(ctx);
  const hp = (whole(tb.hpPerSlot) || 2) + (Number(reached.tempBars?.hpPerSlot) || 0);
  const extra = Number(reached.tempBars?.barsGranted) || 0;
  return [itemLine('heal', tempBarsText(tb, hp, { actor, extra }), 'system.tempBars')];
}

// ---- delivery, area, attack mechanics, riders -------------------------------------------------------------------

const FILTERS = Object.freeze({ allies: 'allies', enemies: 'enemies', both: 'allies and enemies' });

function describeDelivery(item) {
  const sys = sysOf(item);
  const out = [];
  const delivery = str(sys.delivery).toLowerCase();
  if (delivery && delivery !== 'target') {
    out.push(itemLine('area', L('Delivery', { label: str(getTagDefinition(`delivery.${delivery}`)?.label) || humanizeId(delivery) }), 'system.delivery'));
  }
  return [...out, ...describeAreaEffects(item)];
}

/** What an item with `area.hasArea` does to those inside it (the aura engine's effects). Empty without the flag. */
export function describeAreaEffects(item) {
  const out = [];
  const a = isObj(sysOf(item).area) ? sysOf(item).area : null;
  if (!a?.hasArea) return out;
  const filter = FILTERS[str(a.targetFilter)];
  if (filter) out.push(itemLine('area', L('AreaAffects', { filter }), 'system.area.targetFilter'));
  if (a.hasPeriodicDamage && str(a.periodicDamageFormula)) {
    const type = str(a.periodicDamageType);
    const formula = str(a.periodicDamageFormula);
    out.push(itemLine('area', type ? L('AreaPeriodicTyped', { formula, type }) : L('AreaPeriodic', { formula }), 'system.area.periodicDamageFormula'));
  }
  const names = (refs) => list(refs).map(conditionRefName).join(', ');
  if (list(a.inflictedDebuffs).length) out.push(itemLine('area', L('AreaInflicts', { list: names(a.inflictedDebuffs) }), 'system.area.inflictedDebuffs'));
  if (list(a.pulseConditions).length) out.push(itemLine('area', L('AreaPulse', { list: names(a.pulseConditions) }), 'system.area.pulseConditions'));
  const heal = whole(a.healingBars);
  if (heal || a.isHoT) {
    out.push(itemLine('heal', a.isHoT ? L('AreaHealOverTime', { bars: healBarsText(heal), rounds: hotRoundsOf(a) }) : L('AreaHeal', { bars: healBarsText(heal) }), 'system.area.healingBars'));
  }
  if (list(a.cleanseDebuffs).length) out.push(itemLine('heal', L('Cleanse', { list: names(a.cleanseDebuffs) }), 'system.area.cleanseDebuffs'));
  if (list(a.grantedBuffs).length) out.push(itemLine('mod', L('AreaGrants', { list: list(a.grantedBuffs).map((b) => conditionName('buffs', b)).join(', ') }), 'system.area.grantedBuffs'));
  if (list(a.grantedResistances).length) out.push(itemLine('mod', L('AreaResist', { list: list(a.grantedResistances).join(', ') }), 'system.area.grantedResistances'));
  if (list(a.grantedImmunities).length) out.push(itemLine('mod', L('AreaImmune', { list: list(a.grantedImmunities).join(', ') }), 'system.area.grantedImmunities'));
  if (str(a.absorbElement)) out.push(itemLine('mod', L('AreaAbsorb', { element: str(a.absorbElement) }), 'system.area.absorbElement'));
  for (const [field, key] of [['evadeBonus', 'AreaEvade'], ['attackBonus', 'AreaAttack'], ['damageBonus', 'AreaDamageBonus']]) {
    const n = Math.trunc(Number(a[field]) || 0);
    if (n) out.push(itemLine('mod', L(key, { n: signed(n) }), `system.area.${field}`));
  }
  return out;
}

/** Range, area size, save and the on-hit debuff riders: the attack sentences, from the same code attacks use. */
function describeAttackSentences(item) {
  const sys = sysOf(item);
  const stand = {
    rangeFeet: sys.rangeFeet,
    area: isObj(sys.area) && sys.area.hasArea ? sys.area : null,
    contest: sys.contest,
    onHit: sys.onHit
  };
  // The cooldown is described by the timing block (rank-aware), the to-hit number by attacks alone.
  return describeAttackLines({ system: stand }).filter((l) => l.rowPath !== 'system.cooldown');
}

/** Lifesteal and dispel riders at the described Rank (the same reader the damage card uses). */
function describeOnHitExtras(item, ctx) {
  const effects = collectOnHitEffects({ sources: [{ item, rank: rankOf(item, ctx) }] });
  const out = [];
  for (const steal of effects.lifesteal ?? []) {
    out.push(itemLine('on-hit', L('Lifesteal', { heal: healBarsText(whole(steal.heal)), min: whole(steal.minSlotsLost, 1) }), 'system.onHit.lifesteal'));
  }
  for (const purge of effects.dispel ?? []) {
    const count = whole(purge.count);
    const text = count ? L('DispelCount', { n: count }) : L('DispelAll');
    const query = queryText(purge.query);
    out.push(itemLine('on-hit', query ? L('DispelMatching', { text, query }) : text, 'system.onHit.dispel'));
  }
  return out;
}

async function describeRiders(item) {
  const sys = sysOf(item);
  const out = [];
  const fumble = str(sys.fumbleDebuff);
  if (fumble) out.push(itemLine('on-hit', L('FumbleDebuff', { debuff: conditionRefName(fumble) }), 'system.fumbleDebuff'));
  const effects = effectIdentifiers(sys.optionalEffects);
  if (effects.length) out.push(itemLine('mod', L('OptionalEffects', { list: (await Promise.all(effects.map((e) => documentName(e, 'skill')))).join(', ') }), 'system.optionalEffects'));
  return out;
}

// ---- timing -----------------------------------------------------------------------------------------------------

function describeDuration(item, ctx) {
  const eff = effectiveDuration(item, { rank: rankOf(item, ctx) });
  if (!eff.type || eff.type === 'instant') return [];
  let text = durationConfigText({ type: eff.type, value: eff.value, scaleBy: eff.scaleBy });
  if (!text) return [];
  if (eff.endsWithCombat) text = L('EndsWithCombat', { text });
  return [itemLine('timing', eff.bonus > 0 ? L('DurationBonus', { text, n: eff.bonus }) : L('Duration', { text }), 'system.durationConfig')];
}

function describeCooldown(item, ctx) {
  const rank = rankOf(item, ctx);
  if (!hasCooldown(item, { rank })) return [];
  return [itemLine('timing', L('Cooldown', { text: cooldownLabel(item, { rank }) }), 'system.cooldown')];
}

// ---- techniques, assists ----------------------------------------------------------------------------------------

function describeTechnique(item, ctx) {
  const sys = sysOf(item);
  const cfg = isObj(sys.techniqueConfig) ? sys.techniqueConfig : {};
  const rank = rankOf(item, ctx);
  const out = [];
  const line = (kind, text, path) => text && out.push(itemLine(kind, text, `system.techniqueConfig.${path}`));
  out.push(itemLine('skill', cfg.isDamageEffect ? L('TechniqueDamage') : L('Technique'), 'system.isTechnique'));
  const query = queryText(sys.appliesToQuery);
  if (query) out.push(itemLine('skill', L('AppliesTo', { query }), 'system.appliesToQuery'));
  const condition = queryText(cfg.condition);
  if (condition) line('skill', L('Condition', { query: condition }), 'condition');

  const structured = [];
  const add = (text, path) => text && structured.push(itemLine('damage', text, `system.techniqueConfig.${path}`));
  const mod = str(cfg.baseDiceCountMod);
  if (mod) add(L('BaseDice', { mod }), 'baseDiceCountMod');
  const mult = str(cfg.baseResultMultiplier);
  if (mult) add(L('BaseMultiplier', { formula: mult.split('@rank').join('Rank') }), 'baseResultMultiplier');
  if (str(cfg.flatDamageMod)) add(L('FlatDamage', { formula: str(cfg.flatDamageMod) }), 'flatDamageMod');
  if (str(cfg.damageBonus)) add(L('DamageBonus', { formula: str(cfg.damageBonus).replace(/^\+/, '') }), 'damageBonus');
  if (str(cfg.damageType)) add(L('TechniqueType', { type: str(cfg.damageType) }), 'damageType');
  if (cfg.isArmorPiercing) add(L('IgnoresDr'), 'isArmorPiercing');
  if (str(cfg.debuffId)) add(L('TechniqueDebuff', { label: conditionRefName(cfg.debuffId) }), 'debuffId');
  for (const m of Array.isArray(cfg.healthMultipliers) ? cfg.healthMultipliers : []) {
    if (!isObj(m) || !(Number(m.multiplier) > 1)) continue;
    add(L('HealthMultiplier', { n: Number(m.multiplier), percent: whole(m.percent), rank: whole(m.minRank) }), 'healthMultipliers');
  }
  for (const v of Array.isArray(cfg.variants) ? cfg.variants : []) {
    if (!isObj(v) || !str(v.id)) continue;
    const label = str(v.label) || humanizeId(v.id);
    const debuffs = list(v.debuffs).map(conditionRefName).join(', ');
    let text = L(v.replacesDamage ? 'VariantReplaces' : 'Variant', { rank: whole(v.minRank), label });
    if (debuffs) text = L('VariantDebuffs', { text, list: debuffs });
    add(text, 'variants');
  }
  out.push(...structured);

  const bands = (Array.isArray(cfg.summaryBands) ? cfg.summaryBands : []).filter((b) => isObj(b) && str(b.text));
  if (!structured.length) {
    const now = techniqueBandSummary(bands, rank);
    if (now) out.push(itemLine('skill', now, 'system.techniqueConfig.summaryBands'));
  }
  return out;
}

function describeAssist(item) {
  const sys = sysOf(item);
  const formula = str(sys.assist?.formula);
  if (!formula) return [];
  const query = queryText(sys.assist?.when);
  return [itemLine('skill', query ? L('AssistWhen', { formula, query }) : L('Assist', { formula }), 'system.assist')];
}

// ---- rank breaks ------------------------------------------------------------------------------------------------

/** The tiers of an item with their Rank thresholds, ascending. */
function tiersOf(sys) {
  const breaks = isObj(sys.rankBreaks) ? sys.rankBreaks : {};
  return Object.entries(breaks)
    .map(([key, tier]) => ({ key, tier, threshold: whole(tier?.rank) || RANK_BREAK_THRESHOLDS[key] || 0 }))
    .filter((e) => isObj(e.tier) && e.threshold > 0)
    .sort((a, b) => a.threshold - b.threshold);
}

/** The legacy `upgrades` text of one tier (a spell keeps one per tier; a skill keeps a single text). */
function legacyText(item, key) {
  const up = sysOf(item).upgrades;
  const text = isObj(up) ? str(up[key]) : '';
  return text && text !== 'None' ? text : '';
}

/**
 * Every line that starts at a Rank: rank breaks, later rank damage parts and (techniques) later summary bands, in one
 * ascending Rank order. All use the item's own kind (`spell` or `skill`), the thing a break improves.
 */
function describeRankBreaks(item, ctx) {
  const sys = sysOf(item);
  const rank = rankOf(item, ctx);
  const kind = isSpell(item) ? 'spell' : 'skill';
  const reachedKeys = new Set(resolveReachedRankBreaks(item, rank).reachedTiers.map((t) => t.key));
  const owned = Boolean(owner(ctx));
  const ownDamageType = normalizeBaseDamage(sys.baseDamage).damageType;
  const entries = [];
  for (const { key, tier, threshold } of tiersOf(sys)) {
    // An owner sees what is still to come ("At Rank") and what the reached breaks already give ("From Rank"); an
    // unowned item lists every break. A reached break leaves out its damage (the damage and Ignores DR lines above
    // already carry it), so each effect is described once.
    const isReached = owned && reachedKeys.has(key);
    const entry = rankBreakLine(kind, { rank: threshold, tier, reached: isReached, legacy: legacyText(item, key), ownDamageType, rowPath: `system.rankBreaks.${key}` });
    if (entry) entries.push(entry);
  }
  // Rank damage parts the Rank has not reached yet are rank breaks too.
  for (const m of splitParts(sys, rank).later) {
    const threshold = whole(m.minRank);
    entries.push({ threshold, line: itemLine(kind, L('AtRank', { rank: threshold, text: `+${partText(m).replace(/^\+/, '')} damage` }), 'system.rankDamageParts') });
  }
  // Technique bands the Rank has not reached.
  const cfg = isObj(sys.techniqueConfig) ? sys.techniqueConfig : {};
  for (const b of (Array.isArray(cfg.summaryBands) ? cfg.summaryBands : [])) {
    if (!isObj(b) || !str(b.text) || !(whole(b.minRank) > rank)) continue;
    entries.push({ threshold: whole(b.minRank), line: itemLine(kind, L('AtRankBand', { rank: whole(b.minRank), text: str(b.text) }), 'system.techniqueConfig.summaryBands') });
  }
  const out = entries.sort((a, b) => a.threshold - b.threshold).map((e) => e.line);
  if (!out.length && isSkill(item) && str(sys.upgrades)) out.push(itemLine(kind, L('Upgrades', { text: str(sys.upgrades) }), 'system.upgrades'));
  return out;
}

// ---- registry ---------------------------------------------------------------------------------------------------

const appliesTo = (pred) => (item) => spellOrSkill(item) && pred(item);

/** @type {ReadonlyArray<import('./shared.mjs').ItemSummaryBlock>} */
export const BLOCKS = Object.freeze([
  { id: 'spell-skill-cast', group: 'cast', applies: appliesTo(() => true), describe: describeCast },
  { id: 'spell-skill-mana', group: 'cast', applies: isSpell, describe: describeMana },
  { id: 'spell-skill-damage', group: 'effect', applies: appliesTo(() => true), describe: describeDamage },
  { id: 'spell-skill-healing', group: 'effect', applies: appliesTo(() => true), describe: describeHealing },
  { id: 'spell-skill-temp-bars', group: 'effect', applies: appliesTo(() => true), describe: describeTempBars },
  { id: 'spell-skill-attack-sentences', group: 'effect', applies: appliesTo(() => true), describe: describeAttackSentences },
  { id: 'spell-skill-delivery', group: 'effect', applies: appliesTo(() => true), describe: describeDelivery },
  { id: 'spell-skill-on-hit-extras', group: 'effect', applies: appliesTo(() => true), describe: describeOnHitExtras },
  { id: 'spell-skill-riders', group: 'effect', applies: appliesTo(() => true), describe: describeRiders },
  { id: 'spell-skill-technique', group: 'effect', applies: appliesTo((i) => i.type === 'skill' && sysOf(i).isTechnique === true), describe: describeTechnique },
  { id: 'spell-skill-assist', group: 'effect', applies: appliesTo((i) => i.type === 'skill'), describe: describeAssist },
  { id: 'spell-skill-duration', group: 'timing', applies: appliesTo(() => true), describe: describeDuration },
  { id: 'spell-skill-cooldown', group: 'timing', applies: appliesTo(() => true), describe: describeCooldown },
  { id: 'spell-skill-rank-breaks', group: 'effect', applies: appliesTo(() => true), describe: describeRankBreaks }
]);
