import { readFlag, writeFlag } from '../../utils/flags.mjs';
import { appendGrindLog } from '../../utils/skill/grind-log.mjs';

/** Crawler flag: the grind log (`utils/skill/grind-log.mjs`). */
const GRIND_LOG_FLAG = 'grindLog';

/** A crawler's grind log as stored (any shape; `utils/skill/grind-log.mjs` cleans it). */
export function grindLogOf(actor) {
  return readFlag(actor, GRIND_LOG_FLAG);
}

/**
 * Record `hours` of grinding that ended at world time `at` on a crawler's grind log.
 * @param {Actor} actor
 * @param {number} hours clock hours taken off the floor timer
 * @param {number} [at] world seconds the grind ended (world time now by default)
 */
export async function recordGrind(actor, hours, at = globalThis.game?.time?.worldTime) {
  if (!actor) return;
  await writeFlag(actor, GRIND_LOG_FLAG, appendGrindLog(readFlag(actor, GRIND_LOG_FLAG), { at: Number(at), hours }));
}
