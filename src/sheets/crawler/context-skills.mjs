/**
 * Page 3 (Skills & Spells) context: rank breakdowns, gear-granted skills and spells,
 * grinding progress and damage formulas.
 *
 * Owned skill and spell ranks are derived once, by `BaseActorDataModel.prepareDerivedItemRanks`;
 * this module only reads them and adds view fields. Gear `grants` rows reference skills and spells by
 * `system.identifier`; names are display text only.
 */
import { normalizeBaseDamage } from '../../utils/damage/base-damage.mjs';
import { HIGH_RANK_FLOOR } from '../../utils/skill/rank-limits.mjs';
import { ADVANCEMENT_ROUTE_DEFS, ADVANCEMENT_ROUTES, openRoutes, routeAllowsGain } from '../../utils/skill/advancement-routes.mjs';
import { isSkillUnusable } from '../../utils/skill/animal-skills.mjs';
import { getRequiredGrindingHours, getAdvancementTarget } from '../../data/rules/grinding-rules.mjs';
import { catalogEntries } from '../../content/catalog-lookup.mjs';
import { sortItems } from './context-items.mjs';
import { cooldownBadge, grantedSpellCooldownBadge } from '../../utils/time/cooldown-badge.mjs';
import { currentTimeContext } from '../../documents/actor/dungeon-time.mjs';
import { isAttackSkill, skillGroupLabel, spellRole, spellRoleLabel } from '../../utils/tag/tag-mechanics.mjs';
import { offersSpellAttack } from '../../utils/attack/spell-cast-link.mjs';
import { attackText } from '../../utils/attack/attack-text.mjs';
import { hasRuleFlag, RULE_FLAGS } from '../../utils/tag/tag-behaviour.mjs';
import { checkTypeLabel, checkTypeOptions } from '../../data/rules/check-types.mjs';
import { specialtyLabel } from '../../utils/skill/skill-specialty-options.mjs';
import { buildSkillStandIn } from '../../utils/skill/skill-stand-in.mjs';
import { rankGrantSources } from '../../utils/skill/rank-grant-sources.mjs';
import { collectGearSkillBonuses, collectRankRaiseGrants, gearGrantKey, raiseRowsFor, raisedRank } from '../../models/actors/actor-derivation.mjs';
import { sourceBadge } from '../../utils/content-source.mjs';
import { workingGear } from '../../utils/effects/gear-suppression.mjs';
import { offlineTip } from './gear-offline-display.mjs';

const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);

function asList(raw) {
  if (Array.isArray(raw)) return raw;
  return raw && typeof raw === 'object' ? Object.values(raw) : [];
}

const SKILL_TEXT = {
  'COG.Skill.HighRankBadge': 'Rank 16+ from the Sixth Floor',
  'COG.Skill.HighRankTip': 'Rank {rank} is kept, and acts as 15 until the crawler reaches Floor {floor}.'
};

/** Localized sheet text, with the English default when no i18n is loaded. */
function skillText(key, data) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.format === 'function') return i18n.format(key, data);
  return SKILL_TEXT[key].replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? ''));
}

/**
 * The lock badge of a skill whose Used mark is closed at its Rank (`system.rankLimits`): no mark box, and a note saying
 * which ways still raise it ("Advances by Training, Magic").
 */
function advanceView(skill, rank) {
  if (routeAllowsGain(skill, ADVANCEMENT_ROUTES.use, rank)) return { useLocked: false, advanceNote: '' };
  const open = openRoutes(skill, rank).map((id) => ADVANCEMENT_ROUTE_DEFS[id].label);
  return { useLocked: true, advanceNote: open.length ? `Advances by ${open.join(', ')}` : 'No way left to advance' };
}

/**
 * Sheet-only fields on an owned skill (grinding progress, damage formula). Ranks come from
 * `BaseActorDataModel.prepareDerivedItemRanks`; nothing here writes `skill.system`.
 */
function decorateOwnedSkill(skill, actor, context) {
  skill.sourceBadge = sourceBadge(skill);
  skill.groupLabel = skillGroupLabel(skill);
  skill.specialtyLabel = specialtyLabel(skill.system?.specialty);
  // A `no-ranks` core action has no Ranks, Used mark or grinding: the row shows the [CORE] badge instead (E7.9 D9).
  if (hasRuleFlag(skill, RULE_FLAGS.noRanks)) {
    Object.assign(skill, { isCore: true, isUnusable: isSkillUnusable(skill) });
    skill.hasDamage = false;
    skill.isAttack = false;
    return;
  }
  const baseRank = Number(skill.system?.rank) || 0;
  const reqHours = getRequiredGrindingHours(baseRank);
  // A stored Rank above what acts (derived in `deriveSkillRanks`) is shown with a badge saying when it comes online
  const inactiveHighRank = (Number(skill.storedRank) || 0) > (Number(skill.baseRank) || 0);
  const investedHours = Number(skill.system?.investedHours ?? skill.system?.grindHours) || 0;
  Object.assign(skill, {
    isChecked: Boolean(skill.system?.checked),
    highRankBadge: inactiveHighRank ? skillText('COG.Skill.HighRankBadge', {}) : '',
    highRankTip: inactiveHighRank ? skillText('COG.Skill.HighRankTip', { rank: skill.storedRank, floor: HIGH_RANK_FLOOR }) : '',
    isUnusable: isSkillUnusable(skill),
    ...advanceView(skill, baseRank),
    requiredGrindHours: reqHours,
    advancementTarget: getAdvancementTarget(baseRank),
    investedHours,
    neededHours: Math.max(0, reqHours - investedHours),
    canAdvance: investedHours >= reqHours,
    canAddHour: context.bankedGrindHours > 0 && investedHours < reqHours,
    canSubHour: investedHours > 0,
    progressPct: Math.min(100, Math.round((investedHours / Math.max(1, reqHours)) * 100))
  });
  const dmg = actor.getSkillDamageData(skill);
  skill.hasDamage = dmg.hasDamage;
  skill.damageFormulaWithStat = dmg.formulaWithStat;
  skill.isAttack = skill.system?.isAttack === true;
}

/** A gear-granted skill the actor does not own, built from its catalog entry (`data` is a gear bonus entry). */
function grantedSkill(data, actor) {
  const skill = buildSkillStandIn(actor, data.identifier, { ...data, label: data.label || data.identifier });
  skill.groupLabel = skillGroupLabel(skill);
  const dmg = actor.getSkillDamageData(skill);
  skill.hasDamage = dmg.hasDamage;
  skill.damageFormulaWithStat = dmg.formulaWithStat;
  skill.isAttack = isAttackSkill(skill) || dmg.hasDamage;
  return skill;
}

/**
 * Spells equipped gear grants, keyed by spell identifier: `grants` rows of kind `spell` (from the gear bonus map) and
 * spell outcomes on activated gear.
 */
function gearGrantedSpells(gear, gearBonuses) {
  const granted = new Map();
  const add = (identifier, rank, sources, itemIds, extra = {}) => {
    if (!identifier) return;
    if (!granted.has(identifier)) granted.set(identifier, { identifier, rank, sources: [], itemIds: [], label: '', cooldown: null, ...extra });
    const entry = granted.get(identifier);
    entry.rank = Math.max(entry.rank, rank);
    entry.sources.push(...sources);
    entry.itemIds.push(...itemIds);
  };
  for (const data of gearBonuses.values()) {
    if (data.kind === 'spell') add(data.identifier, data.rank || 1, data.sources, data.itemIds, { label: data.label, cooldown: data.cooldown, grantSources: data.grantSources });
  }
  for (const item of gear) {
    if (!item.system?.equipped) continue;
    for (const out of asList(item.system.outcomes)) {
      if (out?.type !== 'spell') continue;
      if (!out.spellIdentifier) continue; // a row without a linked spell is a one-off effect, not a granted spell
      add(out.spellIdentifier, Number(out.rank) || 1, [item.name], [item.id ?? item._id], { label: out.spellName || out.name || '' });
    }
  }
  return granted;
}

function grantedSpell(data, context) {
  const official = catalogEntries('spells').find(s => s.system?.identifier === data.identifier);
  const grantedId = `granted-spell-${data.identifier}`;
  const stat = official?.system?.stat || 'int';
  const mod = context.system.abilities?.[stat]?.mod ?? 0;
  const sys = official?.system ?? {};
  const sources = data.sources.join(', ');
  return {
    id: grantedId,
    _id: grantedId,
    name: official ? official.name : (data.label || data.identifier),
    type: 'spell',
    img: official?.img || 'icons/svg/aura.svg',
    isGranted: true,
    grantSources: data.grantSources ?? [],
    rank: data.rank,
    modifiedRank: data.rank,
    itemSources: sources,
    statMod: mod,
    statModStr: signed(mod),
    system: {
      identifier: data.identifier,
      rank: data.rank,
      modifiedRank: data.rank,
      stat,
      manaCost: sys.manaCost ?? 0,
      range: sys.range || '30 feet',
      duration: sys.duration || 'Instantaneous',
      // The grant row's own cooldown wins over the catalog spell's (3.12 D4: the gear carries the use record).
      cooldown: data.cooldown ?? sys.cooldown ?? { value: 0, unit: '' },
      durationConfig: sys.durationConfig ?? { type: 'instant', value: 0 },
      checkType: sys.checkType || 'attack',
      healing: sys.healing ?? {},
      tags: sys.tags ?? [],
      baseDamage: normalizeBaseDamage(sys.baseDamage),
      damageModifiers: sys.damageModifiers || [],
      critMultiplierR5: sys.critMultiplierR5 || 1,
      critMultiplierR15: sys.critMultiplierR15 || 1,
      fumbleDebuff: sys.fumbleDebuff || '',
      onHit: sys.onHit ?? {},
      optionalEffects: sys.optionalEffects || [],
      description: sys.description || `Granted by ${sources}`,
      quote: sys.quote || '',
      upgrades: sys.upgrades || {},
      rankBreaks: sys.rankBreaks || {},
      notes: `Granted by ${sources}`
    }
  };
}

/**
 * Decorate `context.skills` and `context.spells` (owned plus gear-granted) and sort them.
 * Requires `prepareItemLists` and `prepareCoreContext` (for `bankedGrindHours`).
 * @param {object} context
 * @param {Actor} actor
 * @returns {{ grantedSkills: Map<string, object>, grantedSpells: Map<string, object> }}
 *   gear-granted entries by their synthetic id, for the roll actions
 */
export function prepareSkillsAndSpells(context, actor) {
  const rankSources = rankGrantSources(actor, context.gear.filter(g => g.system?.equipped));
  const gearBonuses = collectGearSkillBonuses(rankSources);
  const rankRaises = collectRankRaiseGrants({ sources: rankSources });
  const ownedSkills = [...context.skills];
  const ownedSkillIds = new Set(ownedSkills.map(s => s.system?.identifier).filter(Boolean));
  for (const skill of ownedSkills) decorateOwnedSkill(skill, actor, context);

  // Gear-only abilities stay listed in a zone, marked offline when no working gear still grants them
  const working = new Set(workingGear(actor, context.gear, 'grantedAbilities').map(g => g.id ?? g._id));
  // A buff that grants an ability keeps it listed and online: only worn gear goes offline
  const buffGrants = collectGearSkillBonuses(actor.getActiveBuffs?.() ?? []);
  const markOffline = (entry, data) => {
    entry.isOffline = !buffGrants.has(gearGrantKey(data.kind, data.identifier)) && !(data.itemIds ?? []).some(id => working.has(id));
    if (entry.isOffline) entry.offlineTip = offlineTip(actor);
  };

  const grantedSkills = new Map();
  for (const data of gearBonuses.values()) {
    if (data.kind !== 'skill' || ownedSkillIds.has(data.identifier)) continue;
    const skill = grantedSkill(data, actor);
    markOffline(skill, data);
    grantedSkills.set(skill.id, skill);
    context.skills.push(skill);
  }
  context.skills.sort(sortItems);

  // Owned spell ranks come from the DataModel; only gear-granted spells are built here.
  const ownedSpellIds = new Set(context.spells.map(s => s.system?.identifier).filter(Boolean));
  const grantedSpells = new Map();
  for (const data of gearGrantedSpells(context.gear, gearBonuses).values()) {
    if (ownedSpellIds.has(data.identifier)) continue;
    // A granted spell acts at its Rank raised by the rank_raise rows that name it
    const rank = raisedRank(data.rank, raiseRowsFor({ system: { identifier: data.identifier } }, rankRaises));
    const spell = grantedSpell({ ...data, rank }, context);
    markOffline(spell, { ...data, kind: 'spell' });
    grantedSpells.set(spell.id, spell);
    context.spells.push(spell);
  }

  for (const spell of context.spells) {
    if (spell.isGranted) {
      const mod = context.system.abilities?.[spell.system?.stat || 'int']?.mod ?? 0;
      spell.statMod = mod;
      spell.statModStr = signed(mod);
    }
    const dmg = actor.getSpellDamageData(spell);
    spell.hasDamage = dmg?.hasDamage ?? false;
    spell.damageFormula = dmg?.formula ?? '';
    spell.damageDice = dmg?.dice ?? '';
    spell.damageType = dmg?.damageType || spell.system?.baseDamage?.damageType || '';
    // 3.47: the button follows the structured tags (action.attack, not an aura). The role badge and accent read the tags too.
    spell.isAttack = offersSpellAttack(spell);
    spell.role = spellRole(spell);
    spell.roleLabel = spellRoleLabel(spell.role);
    spell.isHeal = spell.role === 'heal';
    if (spell.isAttack) {
      spell.attackTooltip = attackText('COG.SpellCast.AttackTooltip', {
        rank: spell.system?.rank ?? 0, stat: String(spell.system?.stat || 'int').toUpperCase()
      });
    }
  }
  context.spells.sort(sortItems);

  const now = currentTimeContext(actor);
  for (const skill of context.skills) {
    if (!skill.isGranted) skill.cooldownBadge = cooldownBadge(actor, skill, now);
    skill.checkTypeLabel = checkTypeLabel(skill.system?.checkType);
    if (!skill.isGranted) skill.checkTypeOptions = checkTypeOptions(skill.system?.checkType);
  }
  for (const spell of context.spells) {
    spell.cooldownBadge = spell.isGranted ? grantedSpellCooldownBadge(actor, spell, now) : cooldownBadge(actor, spell, now);
  }

  return { grantedSkills, grantedSpells };
}
