/**
 * Page 1 attack table context: synthesized skill attacks, combat techniques, stowed attacks.
 */
import { sortItems } from './context-items.mjs';
import { cooldownBadge } from '../../utils/cooldown-badge.mjs';
import { currentTimeContext } from '../../documents/actor/dungeon-time.mjs';
import { attackText } from '../../utils/attack-text.mjs';

/**
 * The read-only "Damage Effects" reference strip: per effect its Rank (or
 * Untrained), summary band, cooldown badge and the attacks it applies to. Nothing here is a control; a click opens the skill.
 * @param {Actor} actor
 * @param {Array<object>} techniques `actor.getCombatTechniques()`
 * @param {Array<object>} attacks the sheet's attack rows
 * @returns {Array<object>}
 */
export function buildTechniqueStrip(actor, techniques, attacks) {
  const now = currentTimeContext(actor);
  const applies = typeof actor.isTechniqueApplicable === 'function';
  return (techniques ?? []).map((tech) => {
    const untrained = !(Number(tech.rank) > 0);
    const names = applies ? (attacks ?? []).filter(a => actor.isTechniqueApplicable(tech, a.item ?? a)).map(a => a.name) : [];
    return {
      id: tech.id,
      name: tech.name,
      icon: tech.icon,
      summary: tech.summary,
      notes: tech.notes,
      untrained,
      rankText: untrained ? '' : attackText('COG.AttackOptions.Rank', { n: tech.rank }),
      cooldownBadge: tech.item ? cooldownBadge(actor, tech.item, now) : null,
      appliesTo: names.join(', ')
    };
  });
}

/**
 * Requires `prepareItemLists`.
 * @param {object} context
 * @param {Actor} actor
 * @param {{ showStowedAttacks?: boolean }} [state] sheet-local view state
 */
export function prepareCombat(context, actor, { showStowedAttacks = false } = {}) {
  // getSynthesizedAttacks already drops a skill attack whose skill an owned weapon/attack item rolls with.
  for (const sa of actor.getSynthesizedAttacks()) {
    if (sa.isSkillAttack && !context.attacks.some(a => a.id === sa.id)) context.attacks.push(sa);
  }

  context.combatTechniques = buildTechniqueStrip(actor, actor.getCombatTechniques(), context.attacks);

  context.attacks.sort(sortItems);
  context.stowedAttacks.sort(sortItems);
  context.stowedAttacksCount = context.stowedAttacks.length;
  context.showStowedAttacks = Boolean(showStowedAttacks);
}
