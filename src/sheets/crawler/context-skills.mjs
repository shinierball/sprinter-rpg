/**
 * Page 3 (Skills & Spells) context: rank breakdowns, gear-granted skills and spells,
 * grinding progress and damage formulas.
 *
 * Owned skill and spell ranks are derived once, by `BaseActorDataModel.prepareDerivedItemRanks`;
 * this module only reads them and adds view fields. Gear `grants` rows reference skills and spells by
 * `system.identifier`; names are display text only.
 */
import { normalizeBaseDamage } from '../../utils/base-damage.mjs';
import { isSkillUnusable } from '../../utils/animal-skills.mjs';
import { getRequiredGrindingHours, getAdvancementTarget } from '../../data/rules/grinding-rules.mjs';
import { catalogEntries } from '../../content/catalog-lookup.mjs';
import { sortItems } from './context-items.mjs';
import { cooldownBadge, grantedSpellCooldownBadge } from '../../utils/cooldown-badge.mjs';
import { currentTimeContext } from '../../documents/actor/dungeon-time.mjs';
import { isAttackSkill, skillGroupLabel, spellRole, spellRoleLabel } from '../../utils/tag-mechanics.mjs';
import { offersSpellAttack } from '../../utils/spell-cast-link.mjs';
import { attackText } from '../../utils/attack-text.mjs';
import { hasRuleFlag, RULE_FLAGS } from '../../utils/tag-behaviour.mjs';
import { checkTypeLabel, checkTypeOptions } from '../../data/rules/check-types.mjs';
import { buildSkillStandIn } from '../../utils/skill-stand-in.mjs';
import { collectGearSkillBonuses } from '../../models/actors/actor-derivation.mjs';

const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);

function asList(raw) {
  if (Array.isArray(raw)) return raw;
  return raw && typeof raw === 'object' ? Object.values(raw) : [];
}

/**
 * Sheet-only fields on an owned skill (grinding progress, damage formula). Ranks come from
 * `BaseActorDataModel.prepareDerivedItemRanks`; nothing here writes `skill.system`.
 */
function decorateOwnedSkill(skill, actor, context) {
  skill.groupLabel = skillGroupLabel(skill);
  // A `no-ranks` core action has no Ranks, Used mark or grinding: the row shows the [CORE] badge instead (E7.9 D9).
  if (hasRuleFlag(skill, RULE_FLAGS.noRanks)) {
    Object.assign(skill, { isCore: true, isUnusable: isSkillUnusable(skill) });
    skill.hasDamage = false;
    skill.isAttack = false;
    return;
  }
  const baseRank = Number(skill.system?.rank) || 0;
  const reqHours = getRequiredGrindingHours(baseRank);
  const investedHours = Number(skill.system?.investedHours ?? skill.system?.grindHours) || 0;
  Object.assign(skill, {
    isChecked: Boolean(skill.system?.checked),
    isUnusable: isSkillUnusable(skill),
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
  const add = (identifier, rank, sources, extra = {}) => {
    if (!identifier) return;
    if (!granted.has(identifier)) granted.set(identifier, { identifier, rank, sources: [], label: '', cooldown: null, ...extra });
    const entry = granted.get(identifier);
    entry.rank = Math.max(entry.rank, rank);
    entry.sources.push(...sources);
  };
  for (const data of gearBonuses.values()) {
    if (data.kind === 'spell') add(data.identifier, data.rank || 1, data.sources, { label: data.label, cooldown: data.cooldown, grantSources: data.grantSources });
  }
  for (const item of gear) {
    if (!item.system?.equipped) continue;
    for (const out of asList(item.system.outcomes)) {
      if (out?.type !== 'spell') continue;
      if (!out.spellIdentifier) continue; // a row without a linked spell is a one-off effect, not a granted spell
      add(out.spellIdentifier, Number(out.rank) || 1, [item.name], { label: out.spellName || out.name || '' });
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
  const gearBonuses = collectGearSkillBonuses(context.gear.filter(g => g.system?.equipped));
  const ownedSkills = [...context.skills];
  const ownedSkillIds = new Set(ownedSkills.map(s => s.system?.identifier).filter(Boolean));
  for (const skill of ownedSkills) decorateOwnedSkill(skill, actor, context);

  const grantedSkills = new Map();
  for (const data of gearBonuses.values()) {
    if (data.kind !== 'skill' || ownedSkillIds.has(data.identifier)) continue;
    const skill = grantedSkill(data, actor);
    grantedSkills.set(skill.id, skill);
    context.skills.push(skill);
  }
  context.skills.sort(sortItems);

  // Owned spell ranks come from the DataModel; only gear-granted spells are built here.
  const ownedSpellIds = new Set(context.spells.map(s => s.system?.identifier).filter(Boolean));
  const grantedSpells = new Map();
  for (const data of gearGrantedSpells(context.gear, gearBonuses).values()) {
    if (ownedSpellIds.has(data.identifier)) continue;
    const spell = grantedSpell(data, context);
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
