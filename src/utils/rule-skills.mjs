/**
 * Rule-skill registry: which skill a book rule uses (see `src/data/rule-skills.mjs`). A leaf module; `CONFIG.COG.ruleSkills`
 * is `RULE_SKILL_DEFS`. A module remaps a rule with `registerRuleSkill({ id: 'fatigueCheck', identifier: 'stamina', label }, { priority: 10 })`.
 */
import { RULE_SKILLS } from '../data/rule-skills.mjs';

/** @type {Record<string, { id: string, identifier: string, label: string, provider: string }>} */
export const RULE_SKILL_DEFS = {};
const priorities = new Map();
const warned = new Set();

/**
 * Declare or remap a rule skill. An equal-or-higher priority owner refuses it (core seeds at 0, modules default to 10).
 * @param {{ id: string, identifier: string, label?: string }} def
 * @returns {boolean} whether the declaration took effect
 */
export function registerRuleSkill(def, { priority = 10, provider = 'module' } = {}) {
  if (!def || typeof def !== 'object') return false;
  const id = typeof def.id === 'string' ? def.id.trim() : '';
  const identifier = typeof def.identifier === 'string' ? def.identifier.trim() : '';
  if (!id || !identifier) return false;
  const prio = Number.isFinite(priority) ? priority : 10;
  const current = priorities.get(id);
  if (current !== undefined && current >= prio) return false;
  priorities.set(id, prio);
  const label = typeof def.label === 'string' && def.label.trim() ? def.label.trim() : (RULE_SKILL_DEFS[id]?.label || id);
  RULE_SKILL_DEFS[id] = { id, identifier, label, provider };
  return true;
}

function seedRuleSkills() {
  for (const def of Object.values(RULE_SKILLS)) registerRuleSkill(def, { priority: 0, provider: 'core' });
}
seedRuleSkills();

/** Test hook: drop every module remap and re-seed the core rule skills. */
export function _resetRuleSkills() {
  for (const k of Object.keys(RULE_SKILL_DEFS)) delete RULE_SKILL_DEFS[k];
  priorities.clear();
  warned.clear();
  seedRuleSkills();
}

/** The skill identifier a rule uses, or '' when the rule is unknown (warns once per key). */
export function getRuleSkillIdentifier(key) {
  const def = typeof key === 'string' ? RULE_SKILL_DEFS[key] : null;
  if (def) return def.identifier;
  const name = String(key);
  if (!warned.has(name)) {
    warned.add(name);
    console.warn(`Sprinter RPG | Rule skill "${name}" is not registered (registerRuleSkill).`);
  }
  return '';
}

/** The actor's owned skill for a rule, or null. */
export function ruleSkillOf(actor, key) {
  const identifier = getRuleSkillIdentifier(key);
  if (!identifier || typeof actor?.getSkillByIdentifier !== 'function') return null;
  return actor.getSkillByIdentifier(identifier) ?? null;
}

/** The actor's rank in a rule's skill: the owned rank, else the gear-granted bonus (0 when unknown). */
export function ruleSkillRank(actor, key) {
  const identifier = getRuleSkillIdentifier(key);
  if (!identifier || typeof actor?.getSkillRank !== 'function') return 0;
  return Number(actor.getSkillRank(identifier)) || 0;
}
