/**
 * The forced-movement box of a damage card (an attack's or a spell's): the `forcedMove` rows the attacker carries, judged
 * once for each targeted creature (a size condition reads that creature), as lines the GM or the token's owner acts on.
 * Nothing moves a token.
 */
import { collectForcedMoves, hasForcedMoveRows } from '../../utils/roll/damage-modifiers.mjs';
import { retargetContext, serializeRollContext } from '../../utils/roll/roll-context.mjs';
import { hasRuleFlag, RULE_FLAGS } from '../../utils/tag/tag-behaviour.mjs';
import { forcedMoveBoxHtml } from '../../utils/damage/forced-move-lines.mjs';

/** The entries of the box: one per targeted creature, or one for the roll's own context when nothing is targeted. */
function forcedMoveEntries(actor, rollContext) {
  const targets = [...(globalThis.game?.user?.targets ?? [])].map((token) => ({ token, actor: token?.actor ?? token?.document?.actor ?? null })).filter((t) => t.actor);
  if (targets.length === 0) {
    return [{ target: null, source: actor.name, immovable: false, moves: collectForcedMoves(actor, rollContext) }];
  }
  const card = serializeRollContext(rollContext);
  return targets.map(({ token, actor: targetActor }) => {
    // The card's context re-aimed at this target; the live item and skill stay, so a row's scope and Rank are judged as for the roll.
    const aimed = { ...retargetContext(card, { other: targetActor, attacker: actor }), item: rollContext.item, skill: rollContext.skill, actor };
    return {
      target: token.name ?? token.document?.name ?? targetActor.name,
      source: actor.name,
      immovable: hasRuleFlag(targetActor, RULE_FLAGS.immovable),
      moves: collectForcedMoves(actor, aimed)
    };
  });
}

/**
 * The card box for a damage roll, '' when the attacker carries no forced movement (the card is then unchanged).
 * @param {Actor} actor the attacker
 * @param {object} rollContext the damage roll's context
 * @returns {string} HTML
 */
export function forcedMoveCardHtml(actor, rollContext) {
  // No forced-movement row on the attacker: the card is unchanged and no target is read.
  if (!hasForcedMoveRows(actor, rollContext)) return '';
  return forcedMoveBoxHtml(forcedMoveEntries(actor, rollContext));
}
