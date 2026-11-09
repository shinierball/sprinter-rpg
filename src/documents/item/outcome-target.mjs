

/**
 * Target detection helper for item outcomes: closest mob, self, or targeted token.
 */
export function resolveOutcomeTarget(actor, targetType = 'self') {
  let targetToken = null;
  let targetActor = null;
  let targetDistFt = null;

  const tType = String(targetType || 'self').toLowerCase().trim();

  if (tType === 'closest_mob' || tType === 'closest' || tType === 'closest_enemy') {
    if (typeof canvas !== 'undefined' && canvas?.tokens?.placeables) {
      const casterToken = actor?.token?.object ||
        canvas.tokens.placeables.find(t => t.actor?.id === actor?.id);

      const candidateTokens = canvas.tokens.placeables.filter(t =>
        t.actor &&
        t.actor.id !== actor?.id &&
        (t.actor.type === 'mob' || t.actor.type === 'npc') &&
        Number(t.actor.system?.attributes?.hp?.value ?? 1) > 0
      );

      let minDist = Infinity;
      for (const cand of candidateTokens) {
        let dist;
        if (canvas.grid && typeof canvas.grid.measureDistance === 'function' && casterToken) {
          dist = canvas.grid.measureDistance(casterToken, cand);
        } else if (casterToken) {
          dist = Math.hypot(cand.x - casterToken.x, cand.y - casterToken.y);
        } else {
          dist = 0;
        }
        if (dist < minDist) {
          minDist = dist;
          targetToken = cand;
          targetActor = cand.actor;
        }
      }
      if (minDist !== Infinity) {
        targetDistFt = Math.round(minDist);
      }
    }
  } else if (tType === 'self') {
    targetActor = actor;
  }

  if (!targetActor && typeof game !== 'undefined' && game.user?.targets?.size) {
    targetToken = Array.from(game.user.targets)[0];
    targetActor = targetToken?.actor || null;
  }

  if (!targetActor) {
    targetActor = actor;
  }

  const targetName = targetActor ? targetActor.name : (tType === 'closest_mob' ? 'Closest Mob (None in range)' : 'Target');
  const distLabel = targetDistFt !== null ? ` (${targetDistFt} ft away)` : '';

  return { targetToken, targetActor, targetDistFt, targetName, distLabel };
}
