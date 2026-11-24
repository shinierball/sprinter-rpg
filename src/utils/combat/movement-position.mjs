/**
 * Where a token is once a movement ends. v14 fires `moveToken` at the START of an animated movement, so the token
 * document and placeable still hold the origin when the hook (and anything shortly after it) reads them. Consumers
 * that need the position the token is heading to read it from the movement payload instead: its `destination`, else
 * the last waypoint, else the document.
 */

const isPoint = (p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y));

/**
 * The top-left pixel position of the token after `movement`.
 * @param {object} tokenDoc token document (the fallback)
 * @param {object|null} [movement] the `moveToken` movement payload
 * @returns {{ x: number, y: number }}
 */
export function positionAfterMovement(tokenDoc, movement = null) {
  if (isPoint(movement?.destination)) return { x: Number(movement.destination.x), y: Number(movement.destination.y) };
  const lists = [movement?.pending?.waypoints, movement?.passed?.waypoints, movement?.waypoints];
  for (const list of lists) {
    const last = Array.isArray(list) ? list[list.length - 1] : null;
    if (isPoint(last)) return { x: Number(last.x), y: Number(last.y) };
  }
  return { x: Number(tokenDoc?.x) || 0, y: Number(tokenDoc?.y) || 0 };
}

/**
 * The centre in pixels of the token at a top-left position.
 * @param {object} tokenDoc supplies width and height in grid squares
 * @param {{x:number,y:number}} pos
 * @param {number} gridSize pixels per grid square
 */
function centreAtPosition(tokenDoc, pos, gridSize) {
  const size = Number(gridSize) || 50;
  return {
    x: (Number(pos?.x) || 0) + ((Number(tokenDoc?.width) || 1) * size) / 2,
    y: (Number(pos?.y) || 0) + ((Number(tokenDoc?.height) || 1) * size) / 2
  };
}

/** The centre of the token once `movement` ends (see `positionAfterMovement`). */
export function centreAfterMovement(tokenDoc, movement, gridSize) {
  return centreAtPosition(tokenDoc, positionAfterMovement(tokenDoc, movement), gridSize);
}

/**
 * The feet a token has moved since its movement history was last cleared: the creature's own walked segments, each measured
 * by the token's own measurement. A waypoint a push or pull made (`displace`) ends one walked run and starts the next, so the
 * jump to it, and any push in the middle of the history, is never counted as walking.
 * @param {object|null} tokenDoc a token document (`movementHistory`, `measureMovementPath`)
 * @returns {number} 0 when there is no history or the token cannot measure it
 */
export function movedFeet(tokenDoc) {
  const history = Array.isArray(tokenDoc?.movementHistory) ? tokenDoc.movementHistory : [];
  if (history.length === 0 || typeof tokenDoc.measureMovementPath !== 'function') return 0;
  const runs = [];
  let run = [];
  for (const waypoint of history) {
    if (waypoint?.action === 'displace') {
      if (run.length > 1) runs.push(run);
      run = [waypoint];
    } else run.push(waypoint);
  }
  if (run.length > 1) runs.push(run);
  let total = 0;
  for (const walked of runs) {
    const distance = Number(tokenDoc.measureMovementPath(walked)?.distance);
    if (Number.isFinite(distance) && distance > 0) total += distance;
  }
  return total;
}
