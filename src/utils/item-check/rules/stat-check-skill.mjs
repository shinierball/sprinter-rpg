/**
 * src/utils/item-check/rules/stat-check-skill.mjs
 * A Skill whose check is a Stat Check (1d20 + Stat Mod, no Rank) is not an attack: it has no to-hit roll for a foe to evade,
 * and its damage is dealt on a Success. Marking it as an attack would roll the wrong check.
 */
import { registerItemRule, finding } from '../registry.mjs';
import { rollsStatOnly } from '../../../data/rules/check-types.mjs';

registerItemRule('attackSkill', (item) => (rollsStatOnly(item) ? [finding('attackSkill.stat-check', 'warning', 'system.checkType')] : []));
