/**
 * src/utils/item-check/rules/weapon.mjs
 * Weapon rules (gear that is a weapon, and attack items). A weapon rolls its Skill's Base Damage (the weapon's own
 * `baseDamage` replacing only what it fills), so it needs a Skill this world has, that Skill needs damage, and the
 * weapon needs a type tag. Reads the Skills only through `listedSkillEntries`.
 */
import { registerItemRule, finding } from '../registry.mjs';
import { listedSkillEntries } from '../../skill/weapon-skill-options.mjs';
import { mergeBaseDamage, baseDamageDice, normalizeBaseDamage } from '../../damage/base-damage.mjs';
import { weaponTypeTags } from '../weapon-type.mjs';
import { itemTagIds } from '../read.mjs';
import { hasWeaponTypeTag } from '../../gear/wield-mode.mjs';

const sameDice = (a, b) => String(a ?? '').replace(/\s+/g, '').toLowerCase() === String(b ?? '').replace(/\s+/g, '').toLowerCase();

function skillTags(entry) {
  const tags = entry.definition?.system?.tags;
  return Array.isArray(tags) ? tags : [];
}

/** The ready fix of a weapon with no usable Skill: the surface opens its attack-Skill picker. */
const PICK_ATTACK_SKILL = Object.freeze({ op: 'pickAttackSkill' });

function weaponRule(item, ctx) {
  const sys = item.system ?? {};
  const out = [];
  const isAttackItem = item.type === 'attack';
  const entries = listedSkillEntries(sys, ctx.resolve);
  const found = entries.filter((entry) => entry.inWorld);
  const ownTypes = weaponTypeTags(itemTagIds(item), ctx.tags);
  const handless = itemTagIds(item).some((id) => ctx.tags.get(id)?.flags?.includes('no-hands'));
  // The severity of a missing Skill: a gear weapon cannot be rolled without one. An attack item may be a natural attack (a bare one with
  // no weapon type, or a no-hands class tag) or stand on its to-hit Rank, so it needs no Skill; one that names a weapon type warns.
  const noSkillSeverity = isAttackItem ? 'warning' : 'broken';

  if (!entries.length) {
    if (!(isAttackItem && (handless || Number(sys.toHitRank) > 0 || !hasWeaponTypeTag(sys)))) out.push(finding('weaponItem.no-skill', noSkillSeverity, 'system.associatedSkills', {}, PICK_ATTACK_SKILL));
  } else if (!found.length) {
    out.push(finding('weaponItem.skill-not-in-world', noSkillSeverity, 'system.associatedSkills', { skills: entries.map((e) => e.identifier).join(', ') }, PICK_ATTACK_SKILL));
  } else {
    for (const entry of entries.filter((e) => !e.inWorld)) out.push(finding('weaponItem.skill-unresolved', 'warning', 'system.associatedSkills', { skill: entry.identifier }));
  }

  for (const entry of found) {
    const skillSys = entry.definition.system ?? {};
    const skill = entry.identifier;
    if (skillSys.isAttack !== true || skillSys.checkType === 'passive') out.push(finding('weaponItem.skill-not-attack', 'warning', 'system.associatedSkills', { skill }));
    if (!baseDamageDice(mergeBaseDamage(skillSys.baseDamage, sys.baseDamage))) out.push(finding('weaponItem.no-damage', 'warning', 'system.baseDamage', { skill }));
  }

  const skillTypes = [...new Set(found.flatMap((entry) => weaponTypeTags(skillTags(entry), ctx.tags)))];
  if (!ownTypes.length && !isAttackItem) {
    const firstWithType = found.map((entry) => weaponTypeTags(skillTags(entry), ctx.tags)).find((types) => types.length);
    out.push(finding('weaponItem.no-type', 'broken', 'system.tags', {}, firstWithType ? { op: 'addTags', tags: firstWithType } : undefined));
  } else if (ownTypes.length && skillTypes.length && !ownTypes.some((id) => skillTypes.includes(id))) {
    out.push(finding('weaponItem.type-mismatch', 'warning', 'system.tags', { types: ownTypes.join(', '), skillTypes: skillTypes.join(', ') }));
  }

  // A bonus row that repeats a Skill's own dice adds them a second time (the Skill already supplies its Base Damage).
  const rows = Array.isArray(sys.damageModifiers) ? sys.damageModifiers : [];
  rows.forEach((row, i) => {
    if (!row || typeof row !== 'object' || row.disabled === true) return;
    if ((row.mode ?? 'add') !== 'add' || !row.dice) return;
    if (row.condition && ['all', 'any', 'none'].some((k) => Array.isArray(row.condition[k]) && row.condition[k].length)) return;
    for (const entry of found) {
      const base = normalizeBaseDamage(mergeBaseDamage(entry.definition.system?.baseDamage, sys.baseDamage));
      const sameType = !row.damageType || !base.damageType || String(row.damageType).toLowerCase() === base.damageType.toLowerCase();
      if (sameDice(row.dice, base.dice) && sameType) {
        out.push(finding('weaponItem.bonus-repeats-base', 'warning', `system.damageModifiers[${i}]`, { dice: String(row.dice), skill: entry.identifier }));
        break;
      }
    }
  });

  if (entries.length && Number(sys.toHitRank) > 0) out.push(finding('weaponItem.to-hit-rank-hides-untrained', 'note', 'system.toHitRank', { rank: Number(sys.toHitRank) }));
  return out;
}

registerItemRule('weapon', weaponRule);
