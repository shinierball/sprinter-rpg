/**
 * Page 1 attack table context: synthesized skill attacks, combat techniques, stowed attacks.
 */
import { sortItems } from './context-items.mjs';
import { cooldownBadge } from '../../utils/time/cooldown-badge.mjs';
import { currentTimeContext } from '../../documents/actor/dungeon-time.mjs';
import { attackText } from '../../utils/attack/attack-text.mjs';
import { canSwingImprovised } from '../../utils/gear/wielding.mjs';
import { resolveAttackToHit } from '../../utils/attack/to-hit-display.mjs';
import { attackDamageDisplay } from '../../utils/damage/damage-parts.mjs';

/**
 * The read-only "Damage Effects" reference strip: per effect its Rank (or
 * Untrained), summary band, cooldown badge and the attacks it applies to. Nothing here is a control; a click opens the skill.
 * @param {Actor} actor
 * @param {Array<object>} techniques `actor.getCombatTechniques()`
 * @param {Array<object>} attacks the sheet's attack rows
 * @returns {Array<object>}
 */
function buildTechniqueStrip(actor, techniques, attacks) {
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
 * The page 1 "Improvised (n)" list (core p. 178): one plain row per held, carried non-weapon item, with the To Hit and damage
 * the roll will use. Plain objects, never `prepareAttackDisplay` (it writes weapon fields onto the item, which the inventory row prints).
 * @param {Actor} actor
 * @returns {Array<{id: string, name: string, toHit: string, damage: string, summaryTip: string}>}
 */
function improvisedRows(actor) {
  return [...actor.items].filter(canSwingImprovised).sort(sortItems).map((item) => ({
    id: item.id,
    name: item.name,
    toHit: resolveAttackToHit(item, actor).hit.formula,
    damage: attackDamageDisplay(item, actor),
    summaryTip: item.summaryTip ?? ''
  }));
}

/**
 * Requires `prepareItemLists`.
 * @param {object} context
 * @param {Actor} actor
 * @param {{ showStowedAttacks?: boolean, showImprovisedAttacks?: boolean }} [state] sheet-local view state
 */
export function prepareCombat(context, actor, { showStowedAttacks = false, showImprovisedAttacks = false } = {}) {
  // getSynthesizedAttacks already drops a skill attack whose skill an owned weapon/attack item rolls with.
  for (const sa of actor.getSynthesizedAttacks()) {
    if (sa.isSkillAttack && !context.attacks.some(a => a.id === sa.id)) context.attacks.push(sa);
  }

  context.combatTechniques = buildTechniqueStrip(actor, actor.getCombatTechniques(), context.attacks);

  context.attacks.sort(sortItems);
  context.stowedAttacks.sort(sortItems);
  context.stowedAttacksCount = context.stowedAttacks.length;
  context.showStowedAttacks = Boolean(showStowedAttacks);

  // The held non-weapons the attack path swings (7.50a), listed on page 1 when the link is open.
  const improvised = improvisedRows(actor);
  const count = improvised.length;
  context.improvisedAttacks = improvised;
  context.improvisedCount = count;
  context.showImprovisedAttacks = count > 0 && Boolean(showImprovisedAttacks);
  if (count) {
    context.improvisedToggle = attackText('COG.Attack.Improvised.Toggle', { count });
    context.improvisedToggleTip = attackText('COG.Attack.Improvised.ToggleTip');
    context.improvisedTitle = attackText('COG.Attack.Improvised.Title');
    context.improvisedHint = attackText('COG.Attack.Improvised.Hint');
    context.improvisedBadge = attackText('COG.Attack.Improvised.Badge');
  }
}
