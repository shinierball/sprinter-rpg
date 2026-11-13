import { getItemAllTags } from '../active-tags.mjs';
import { identityTag, subjectTag, healthFractionTag, isTargetSensitiveTag, ENGINE_SITUATIONS } from '../../data/tag-vocabulary.mjs';
import { evaluateRows } from '../../utils/roll/damage-modifiers.mjs';
import { buildRollContext, extendContext } from '../../utils/roll/roll-context.mjs';
import { AI_FAVOR_ROWS, bestAiFavorEntry } from '../../utils/character/ai-favor.mjs';
import { snapshotTargetRow } from '../../utils/damage/per-target-damage.mjs';
import { matchesTagQuery, expandTagReferences, queryReferences } from '../../utils/tag/tag-query.mjs';
import { hasRuleFlag, RULE_FLAGS } from '../../utils/tag/tag-behaviour.mjs';
import { isTechniqueSkill, isAttackSkill } from '../../utils/tag/tag-mechanics.mjs';
import { evaluateModifier } from './actor-constants.mjs';
import { findCatalogEntry } from '../../content/catalog-lookup.mjs';
import { effectiveCooldown } from '../../utils/time/cooldowns.mjs';
import { conditionRefName } from '../../utils/item-describer/shared.mjs';
import { conditionRefTag } from './condition-data.mjs';
import { resolveWeaponSkills } from './weapon-skills.mjs';

/** Damage effect identifiers from an `optionalEffects` value (array of identifiers, or a comma list typed at authoring). */
export function effectIdentifiers(raw) {
  const list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split(',') : []);
  return list.map(e => (typeof e === 'string' ? e : String(e?.identifier ?? ''))).map(e => e.trim()).filter(Boolean);
}

/** The summary of the highest `summaryBands` band the Rank reaches, or '' when there are none. */
export function techniqueBandSummary(bands, rank) {
  let best = null;
  for (const b of (Array.isArray(bands) ? bands : [])) {
    const min = Number(b?.minRank) || 0;
    if (b?.text && rank >= min && (!best || min >= best.min)) best = { min, text: String(b.text) };
  }
  return best ? best.text : '';
}

/**
 * A technique's `baseResultMultiplier` at a Rank: a number, `@rank`, or `A * B` / `A + B` / `A - B` of those. No parsing of
 * names or prose: it is a formula field. Rank 0 stays 0 (an untrained Passive multiplies by nothing; the Rule Break asked
 * for it). Unusable or empty text gives `null` (no multiplier).
 * @param {string} formula
 * @param {number} rank
 * @returns {number|null}
 */
export function evaluateRankFormula(formula, rank) {
  const text = String(formula ?? '').trim().split('@rank').join(String(Number(rank) || 0));
  if (!text) return null;
  const term = '(\\d+(?:\\.\\d+)?)';
  const m = text.match(new RegExp(`^${term}(?:\\s*([*+-])\\s*${term})?$`));
  if (!m) return null;
  const a = parseFloat(m[1]);
  if (!m[2]) return a;
  const b = parseFloat(m[3]);
  return m[2] === '*' ? a * b : (m[2] === '+' ? a + b : a - b);
}

/** A non-empty `{ all, any, none }` tag query. */
function hasQuery(q) {
  return Boolean(q && typeof q === 'object' && ['all', 'any', 'none'].some(k => Array.isArray(q[k]) && q[k].length > 0));
}

/**
 * Whether a technique's `techniqueConfig.condition` (a tag query) holds for a roll's tags. A technique with no
 * condition always holds. Read from structured data only.
 * @param {{ condition?: object }|null} effect a `resolveDamageEffect` result
 * @param {Iterable<string>} tags the damage roll context's tags
 * @returns {boolean}
 */
export function techniqueConditionMet(effect, tags) {
  if (!hasQuery(effect?.condition)) return true;
  return matchesTagQuery(tags instanceof Set ? tags : new Set(tags ?? []), effect.condition);
}

/**
 * The bonus dice of a resolved damage effect as plain dice strings: the config `damageBonus`, then each reached rank
 * break's `damageDice`. The one list the roll (`effectBonusDiceParts`) and the profile display both read.
 * @param {{ damageBonus?: string, breakDamageDice?: string[] }} effectData a `resolveDamageEffect` result
 * @returns {string[]}
 */
export function techniqueBonusDiceList(effectData) {
  const out = [];
  const config = String(effectData?.damageBonus ?? '').replace(/^\+/, '').trim();
  if (config) out.push(config);
  for (const bd of effectData?.breakDamageDice || []) {
    const dice = String(bd).replace(/^\+/, '').trim();
    if (dice) out.push(dice);
  }
  return out;
}

/**
 * The health multiplier a technique's Rank reaches (`techniqueConfig.healthMultipliers`, the entry with the highest
 * `minRank` not above the Rank), or null.
 * @param {Array<{ minRank?: number, percent?: number, multiplier?: number }>|undefined} entries
 * @param {number} rank
 * @returns {{ minRank: number, percent: number, multiplier: number }|null}
 */
export function reachedHealthMultiplier(entries, rank) {
  let best = null;
  for (const e of Array.isArray(entries) ? entries : []) {
    const minRank = Number(e?.minRank) || 0;
    const percent = Number(e?.percent);
    const multiplier = Number(e?.multiplier);
    if (!(percent > 0) || !(multiplier > 0) || minRank > rank) continue;
    if (!best || minRank >= best.minRank) best = { minRank, percent, multiplier };
  }
  return best;
}

/**
 * Per-target damage rows (card snapshots) for the techniques in play whose Rank reaches a health multiplier: a
 * `multiply` row conditioned on `subject.resource.health_<percent>`, so the apply judges it for each target hit.
 * @param {Array<{ identifier?: string, name?: string, healthMultiplier?: object|null }>} effects `resolveDamageEffect` results
 * @returns {object[]}
 */
export function techniqueHealthRows(effects) {
  const rows = [];
  const seen = new Set();
  for (const eff of effects) {
    const hm = eff?.healthMultiplier;
    if (!hm || seen.has(eff.identifier)) continue;
    seen.add(eff.identifier);
    const snap = snapshotTargetRow({
      source: { name: eff.name },
      key: `technique:${eff.identifier}:health`,
      row: {
        label: `${eff.name} (x${hm.multiplier} at ${hm.percent}% Health Bar or less)`,
        mode: 'multiply',
        multiplier: hm.multiplier,
        damageType: '',
        condition: { all: [subjectTag(healthFractionTag(hm.percent))], any: [], none: [] }
      }
    });
    if (snap) rows.push(snap);
  }
  return rows;
}

/**
 * Whether a technique's own `techniqueConfig.condition` names a tag that depends on the target (`subject.*`,
 * `situation.same_size`, ...). Such a technique's bonus dice are judged per target at the apply, not once at the roll.
 * @param {{ condition?: object }|null} effect a `resolveDamageEffect` result
 * @returns {boolean}
 */
export function techniqueConditionPerTarget(effect) {
  return hasQuery(effect?.condition) && queryReferences(effect.condition, isTargetSensitiveTag);
}

/** The `rowKey` shared by a technique's standby parts and its condition row. */
export function techniqueConditionRowKey(eff) {
  return `technique:${eff?.identifier}:condition`;
}

/**
 * The per-target snapshot row of one technique whose own condition is target-sensitive: an `add` row carrying the
 * technique's condition. Its bonus dice ride as standby parts keyed by it (`rowKey`), so the apply gives them only
 * to the targets the condition holds for. Null when the row cannot be snapshotted.
 * @param {{ identifier?: string, name?: string, condition?: object }} eff a `resolveDamageEffect` result
 * @returns {object|null}
 */
export function techniqueConditionRow(eff) {
  return snapshotTargetRow({
    source: { name: eff.name },
    key: techniqueConditionRowKey(eff),
    row: { label: String(eff.name || 'Technique'), mode: 'add', damageType: '', condition: eff.condition }
  });
}

/**
 * The identity tags (`id.skill.<identifier>`) of the techniques in play on an attack: the chosen damage effect and the
 * primed techniques. Added to the attack roll's context so a technique's own rows (a Popularity loss, ...) can name
 * the technique in their condition and fire only while it is used.
 * @param {string|object|null} chosenEffect an identifier, a technique skill or null/'none'
 * @param {Array<object>} techniques primed techniques (`{ identifier }` or a skill item)
 * @returns {string[]}
 */
export function techniqueInPlayTags(chosenEffect, techniques = []) {
  const ids = [];
  const add = (v) => {
    const raw = v && typeof v === 'object' ? (v.system?.identifier ?? v.item?.system?.identifier ?? v.identifier) : v;
    const id = String(raw ?? '').trim();
    if (id && id !== 'none') ids.push(id);
  };
  add(chosenEffect);
  for (const t of techniques) add(t);
  return [...new Set(ids.map(id => identityTag('skill', id)).filter(Boolean))];
}

/**
 * Whether a combat technique (a damage effect skill) applies to a weapon or attack item: the technique's
 * `appliesToQuery` ({ all, any, none } tag IDs) must match the attack's tags plus the tags of its matched weapon
 * skill (references expanded, so `technique.pugilism` reaches `id.skill.pugilism`). A technique with no query applies
 * to nothing; an attack carrying the no-damage-effects flag takes none. Names are never matched.
 * @param {object|Item} tech
 * @param {object|Item} attackItem
 * @param {{ chosen?: string }} [opts] `chosen`: the identifier of the Skill picked for this attack; its tags, not the default Skill's, are read
 * @returns {boolean}
 */
export function isTechniqueApplicable(actor, tech, attackItem, { chosen = '' } = {}) {
  if (!tech || !attackItem) return false;
  const query = (tech.system || tech.item?.system || {}).appliesToQuery;
  if (!hasQuery(query)) return false;

  const attackItemTags = new Set(attackItem.allTags instanceof Set ? attackItem.allTags : getItemAllTags(attackItem));
  // Only the Skill the attack uses (chosen, else the default matched one) contributes its tags: a weapon listing several Skills
  // does not let a technique keyed to one of them apply under another.
  // Tags of the structurally matched weapon skill (synthesized profile, or resolved from the item's own tags/references)
  const matchedSkill = chosen ? resolveWeaponSkills(actor, attackItem, null, { chosen }).matchingSkill : (attackItem.matchingSkill || resolveWeaponSkills(actor, attackItem).matchingSkill);
  if (matchedSkill) {
    for (const t of (matchedSkill.allTags instanceof Set ? matchedSkill.allTags : getItemAllTags(matchedSkill))) attackItemTags.add(t);
  }

  const expandedAttackTags = expandTagReferences(attackItemTags);
  // Rule: an entity carrying the no-damage-effects flag cannot choose or receive any Damage Effect.
  if (hasRuleFlag(expandedAttackTags, RULE_FLAGS.noDamageEffects)) return false;
  return matchesTagQuery(expandedAttackTags, query);
}


/**
 * The damage effects an attack item or skill offers, as technique skill identifiers: the item's own
 * `optionalEffects`, else its matched weapon skill's `optionalEffects` plus every owned technique whose
 * `appliesToQuery` matches it.
 * @param {Item} attackItem
 * @param {{ chosen?: string }} [opts] `chosen`: the identifier of the Skill picked for this attack, read instead of the default Skill
 * @returns {string[]} damage effect identifiers
 */
export function getValidDamageEffects(actor, attackItem, { chosen = '' } = {}) {
  if (!attackItem) return [];
  const attackTags = attackItem.allTags instanceof Set ? attackItem.allTags : getItemAllTags(attackItem);
  // Rule: entities carrying the no-damage-effects flag cannot choose any damage effect.
  if (hasRuleFlag(attackTags, RULE_FLAGS.noDamageEffects)) return [];

  // 1. Explicitly configured optionalEffects on the item itself (e.g. artifact weapons)
  const intrinsic = effectIdentifiers(attackItem.system?.optionalEffects);
  if (intrinsic.length > 0) return [...new Set(intrinsic)];

  const skills = actor.items ? actor.items.filter(i => i.type === 'skill') : [];
  const candidates = [];
  // 2. The matched weapon skill's optionalEffects
  const matchingSkill = resolveWeaponSkills(actor, attackItem, skills, { chosen }).matchingSkill;
  if (matchingSkill && hasRuleFlag(matchingSkill.allTags instanceof Set ? matchingSkill.allTags : getItemAllTags(matchingSkill), RULE_FLAGS.noDamageEffects)) return [];
  if (matchingSkill) candidates.push(...effectIdentifiers(matchingSkill.system?.optionalEffects));

  // 3. Owned skills configured as techniques / damage effects whose query matches
  for (const s of skills) {
    const sSys = s.system || {};
    if (!isTechniqueSkill(s)) continue;
    if (sSys.identifier && isTechniqueApplicable(actor, s, attackItem, { chosen })) candidates.push(sSys.identifier);
  }
  return [...new Set(candidates)];
}


/**
 * Determine the selectable damage effects for an attack item or skill,
 * filtered strictly to those the actor actually knows or possesses via gear.
 * @param {Item|object} attackItem
 * @param {{ chosen?: string }} [opts] `chosen`: the identifier of the Skill picked for this attack
 * @returns {string[]} damage effect identifiers the actor can select
 */
export function getSelectableDamageEffects(actor, attackItem, { chosen = '' } = {}) {
  if (!attackItem) return [];
  const validEffects = getValidDamageEffects(actor, attackItem, { chosen });
  if (!validEffects || validEffects.length === 0) return [];

  // Known: an owned skill with that identifier, or a gear grant of it.
  const knowsEffect = (identifier) => Boolean(actor.getSkillByIdentifier(identifier)) || actor.getSkillRank(identifier) > 0;

  return [...new Set(validEffects.filter(knowsEffect))];
}


/**
 * Resolve a Damage Effect: its technique skill (the owned skill with the identifier, else the catalog skill with it,
 * whose data a gear grant uses), its rank, technique configuration, reached rank breaks and computed bonuses.
 * The technique skill is the only data source: an effect with no skill resolves to null.
 *
 * @param {string|object} chosenEffectRaw technique identifier, or the technique skill item
 * @param {Item} [baseItem=null] The weapon/skill receiving the damage effect
 * @param {object} [options={}] `effectRank` / `rank` override the effect's rank
 * @returns {object|null}
 */
export function resolveDamageEffect(actor, chosenEffectRaw, baseItem = null, options = {}) {
  if (!chosenEffectRaw) return null;
  const isItem = typeof chosenEffectRaw === 'object';
  const identifier = isItem ? String(chosenEffectRaw.system?.identifier ?? '').trim() : String(chosenEffectRaw).trim();
  if (!isItem && (!identifier || identifier === 'none')) return null;

  // 1. The effect's skill: passed in, owned, or (for a gear-granted effect) the catalog definition.
  const ownedItem = isItem ? chosenEffectRaw : actor.getSkillByIdentifier(identifier);
  const effectItem = ownedItem || findCatalogEntry('skills', identifier);
  if (!effectItem) return null;

  const sys = effectItem.system || {};
  const tConfig = sys.techniqueConfig || {};

  // 3. Determine effective rank of the damage effect
  // An owned skill's own rank; a gear-granted effect's rank is the grant's value.
  const rank = options.effectRank !== undefined
    ? Number(options.effectRank)
    : (options.rank !== undefined
      ? Number(options.rank)
      : (ownedItem
        ? Number(ownedItem.modifiedRank ?? sys.modifiedRank ?? ownedItem.effectiveRank ?? sys.rank) || 0
        : actor.getSkillRank(identifier)));

  // 4. Gather active rank breaks
  const activeBreaks = [];
  const sourceBreaks = sys.rankBreaks && Object.keys(sys.rankBreaks).length > 0 ? sys.rankBreaks : null;

  if (sourceBreaks) {
    const thresholds = [
      { thresh: 5, data: sourceBreaks.rank5, label: 'Rank 5' },
      { thresh: 10, data: sourceBreaks.rank10, label: 'Rank 10' },
      { thresh: 15, data: sourceBreaks.rank15, label: 'Rank 15' },
      { thresh: 20, data: sourceBreaks.rank20, label: 'Rank 20' }
    ];
    for (const b of thresholds) {
      if (rank >= b.thresh && b.data) {
        activeBreaks.push(b);
      }
    }
  }

  // 5. Consolidate modifiers
  const baseCountMod = tConfig.baseDiceCountMod || '';
  const breakCountMods = activeBreaks.map(b => b.data.baseDiceCountMod).filter(Boolean);
  const breakDamageDice = activeBreaks.map(b => b.data.damageDice).filter(Boolean);
  const extraRankDice = activeBreaks.reduce((sum, b) => sum + (Number(b.data.rankDamageDice) || 0), 0);
  // A named grant ('self') is sized by this effect's own rank; an unnamed one by the Attack Skill's rank.
  const selfRankDice = activeBreaks.reduce((sum, b) => sum + (b.data.rankDiceSource === 'self' ? (Number(b.data.rankDamageDice) || 0) : 0), 0);
  const attackRankDice = extraRankDice - selfRankDice;
  const debuffs = [];
  if (tConfig.debuffId) debuffs.push(tConfig.debuffId);
  for (const b of activeBreaks) {
    if (b.data.debuff && !debuffs.some(d => conditionRefTag(d) === conditionRefTag(b.data.debuff))) {
      debuffs.push(b.data.debuff);
    }
  }

  // The chosen variant (`options.effectVariant`, by id): its debuffs join the effect's, `replacesDamage` rolls no damage.
  // A variant below its Rank is still honoured here (the Rule Break reason was asked by the caller).
  const variantId = String(options.effectVariant ?? '').trim();
  const variantDef = variantId && Array.isArray(tConfig.variants) ? tConfig.variants.find(v => v?.id === variantId) : null;
  const variant = variantDef
    ? { id: variantDef.id, label: variantDef.label || '', minRank: Number(variantDef.minRank) || 0, replacesDamage: variantDef.replacesDamage === true, debuffs: (variantDef.debuffs || []).filter(Boolean) }
    : null;
  for (const d of variant?.debuffs ?? []) {
    if (!debuffs.includes(d)) debuffs.push(d);
  }
  const resultMultiplier = evaluateRankFormula(tConfig.baseResultMultiplier, rank);

  const damageBonus = tConfig.damageBonus || '';
  const damageType = tConfig.damageType || '';
  const stat = (tConfig.stat || '').toLowerCase();
  // The technique's cooldown is the skill's own (3.12: techniqueConfig.cooldown is gone), at this rank.
  const cooldown = effectiveCooldown(effectItem, { rank });
  const flatMod = evaluateModifier(0, tConfig.flatDamageMod || '', rank);
  const totalBaseCountMod = evaluateModifier(0, baseCountMod, rank) + breakCountMods.reduce((sum, mod) => sum + evaluateModifier(0, mod, rank), 0);

  const bonusParts = [];
  if (damageBonus) {
    const dm = damageBonus.match(/(\d+)d(\d+)/i);
    if (dm) {
      bonusParts.push({ count: parseInt(dm[1], 10), sides: parseInt(dm[2], 10), type: damageType });
    }
  }
  for (const bDice of breakDamageDice) {
    const dm = bDice.replace(/^\+/, '').trim().match(/(\d+)d(\d+)/i);
    if (dm) {
      bonusParts.push({ count: parseInt(dm[1], 10), sides: parseInt(dm[2], 10), type: damageType });
    }
  }

  return {
    identifier: sys.identifier || identifier,
    name: effectItem.name || identifier,
    item: ownedItem || null,
    rank,
    effectiveRank: rank,
    isDamageEffect: tConfig.isDamageEffect !== false,
    baseCountMod,
    resultMultiplier,
    variant,
    replacesDamage: variant?.replacesDamage === true,
    totalBaseCountMod,
    breakCountMods,
    breakDamageDice,
    extraRankDice,
    attackRankDice,
    selfRankDice,
    damageBonus,
    damageType,
    stat,
    flatMod,
    bonusParts,
    debuff: debuffs[debuffs.length - 1] || '',
    debuffs,
    condition: tConfig.condition || null,
    healthMultiplier: reachedHealthMultiplier(tConfig.healthMultipliers, rank),
    cooldown,
    activeBreaks
  };
}


/**
 * The owned skill that backs a Damage Effect (its identifier), for the dialog's rank badge and the use mark.
 * @param {string} identifier
 * @returns {Item|null}
 */
export function findDamageEffectSkill(actor, identifier) {
  const id = String(identifier ?? '').trim();
  if (!id || id === 'none') return null;
  return actor.getSkillByIdentifier(id);
}

/**
 * Display name of a Damage Effect identifier: the owned skill's name, else the catalog skill's, else the identifier.
 * @param {string} identifier
 * @returns {string}
 */
export function getDamageEffectLabel(actor, identifier) {
  const id = String(identifier ?? '').trim();
  if (!id || id === 'none') return id;
  return actor.getSkillByIdentifier(id)?.name || findCatalogEntry('skills', id)?.name || id;
}

/**
 * Dialog description of a Damage Effect: its technique config `description`, else the skill's notes, else a generic line.
 * @param {string} identifier
 * @returns {string}
 */
export function getDamageEffectDescription(actor, identifier) {
  const id = String(identifier ?? '').trim();
  const skill = actor.getSkillByIdentifier(id) || findCatalogEntry('skills', id);
  return skill?.system?.techniqueConfig?.description || skill?.system?.notes || 'Optional damage effect for this attack.';
}

/**
 * The AI Favor rating of an attack: the largest matched `aiFavorRatings` row on the attack item, its
 * matched weapon skill (or the skill itself) and, for a gear weapon, the gear. `evaluateRows` is the one row filter
 * (disabled, Rank band, condition); the rows are kept to those sources, so a spare equipped weapon lends nothing.
 * Ratings do not stack.
 * @param {Item|object} attackItem
 * @param {object} [options]
 * @param {object|null} [options.context] the roll's RollContext; absent, a no-target `toHit` context is built
 * @param {string} [options.damageEffect='none'] a chosen Damage Effect adds `situation.damage_effect`
 * @param {Item|null} [options.skill] the matched weapon skill when the caller already resolved it
 * @returns {{ value: number, entry: object|null, conditional: Array<{ value: number, condition: object, label: string, sourceId: string }> }}
 *   `conditional`: rows that failed only on target tags (a Boss target), for "+2 vs Boss" displays
 */
export function getAiFavorRating(actor, attackItem, { context = null, damageEffect = 'none', skill } = {}) {
  const none = { value: 0, entry: null, conditional: [] };
  if (!attackItem) return none;
  // A spell's `aiFavor` is one unconditional rating.
  if (attackItem.type === 'spell') {
    const n = Math.trunc(Number(attackItem.system?.aiFavor));
    return { value: Number.isFinite(n) ? Math.max(0, n) : 0, entry: null, conditional: [] };
  }
  const matchingSkill = skill !== undefined
    ? skill
    : (attackItem.type === 'skill' ? attackItem : (attackItem.matchingSkill || resolveWeaponSkills(actor, attackItem).matchingSkill));
  let ctx = context ?? buildRollContext({
    actor, phase: 'toHit', item: attackItem, skill: matchingSkill ?? null, check: ['skill', 'attack'], other: null
  });
  const effect = typeof damageEffect === 'string' ? damageEffect.trim() : '';
  if (effect && effect !== 'none') ctx = extendContext(ctx, { tags: [ENGINE_SITUATIONS.damageEffect] });

  const same = (a, b) => a === b || Boolean(a?.id && a.id === b?.id);
  const owners = [attackItem, matchingSkill].filter(Boolean);
  const ownEntry = (e) => owners.some(o => same(e.source, o) || same(e.source?.carrier, o));
  const entries = evaluateRows(actor, AI_FAVOR_ROWS, ctx, { explain: true }).filter(ownEntry);

  const best = bestAiFavorEntry(entries.filter(e => e.matched));
  const conditional = entries
    .filter(e => !e.matched && e.reason === 'condition' && queryReferences(e.row.condition, isTargetSensitiveTag) && Math.trunc(Number(e.row.value)) > 0)
    .map(e => ({ value: Math.trunc(Number(e.row.value)), condition: e.row.condition, label: e.row.label ?? '', sourceId: String(e.source?.id ?? '') }));
  return { value: best ? Math.trunc(Number(best.row.value)) : 0, entry: best, conditional };
}

/**
 * Identifies all owned skills that function as combat techniques / maneuvers.
 * @returns {Array<object>}
 */
export function getCombatTechniques(actor) {
  const skills = actor.items ? actor.items.filter(i => i.type === 'skill') : [];
  const techniques = [];

  for (const s of skills) {
    const sys = s.system || {};
    const name = (s.name || '').trim();
    const ident = sys.identifier || '';

    // Explicit Rule: Primary attacks are strictly attacks, NEVER combat techniques
    if (isAttackSkill(s)) {
      continue;
    }

    if (isTechniqueSkill(s)) {
      const rank = Number(s.modifiedRank ?? sys.modifiedRank ?? sys.rank) || 0;
      const cfg = sys.techniqueConfig || {};
      const eff = resolveDamageEffect(actor, s) || {};
      const debuffs = [...(eff.debuffs || [])];
      const debuffName = conditionRefName(debuffs[debuffs.length - 1] || '');
      const damageBonus = cfg.damageBonus || '';
      const icon = cfg.icon || 'fa-burst';
      const banded = techniqueBandSummary(cfg.summaryBands, rank);
      let summary;

      if (banded) {
        summary = banded;
      } else if (cfg.damageBonus || cfg.baseDiceCountMod || cfg.baseResultMultiplier) {
        // Read from the technique's data at its current Rank: config bonus, reached break dice, rank dice, debuffs.
        const countMod = cfg.baseDiceCountMod ? `Dice: ${cfg.baseDiceCountMod}` : (cfg.baseResultMultiplier ? `Base result: x${cfg.baseResultMultiplier}` : '');
        const breakDice = (eff.breakDamageDice || []).map((d) => `+${String(d).replace(/^\+/, '').trim()} Dmg`);
        const rankDice = eff.extraRankDice > 0 ? [`+${eff.extraRankDice} Rank ${eff.extraRankDice === 1 ? 'die' : 'dice'}`] : [];
        summary = [damageBonus ? `+${damageBonus} Dmg` : '', ...breakDice, ...rankDice, countMod].filter(Boolean).join(' | ');
        if (debuffs.length) summary += ` + ${debuffs.map(conditionRefName).join(' + ')}`;
      } else if (sys.notes) {
        summary = sys.notes.split('.')[0].trim();
      } else {
        summary = `Rank ${rank} Maneuver`;
      }

      techniques.push({
        id: s.id,
        identifier: ident,
        name,
        rank,
        summary,
        icon,
        damageBonus,
        debuffName,
        notes: sys.notes || '',
        system: sys,
        item: s
      });
    }
  }

  return techniques;
}
