/**
 * The stock attack reasons' core detectors (size, reach, light and unseen) and the world setting that decides whether the stock
 * reasons alone open the Attack Options window. The detectors are pure functions of the facts (`attack-facts.mjs`); they are
 * registered at priority 0 when this module loads (`attack-options.mjs` imports it).
 */
import { STOCK_SITUATIONS } from '../../data/tag-vocabulary.mjs';
import { SIZE_GAP_FOR_ADVANTAGE, MELEE_REACH_FEET, DETECTED } from '../../data/rules/attack-situation-rules.mjs';
import { sizeText } from '../../data/sizes.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { attackText } from './attack-text.mjs';
import { registerSituationDetector } from './situation-detectors.mjs';

/** World setting key: whether stock attack reasons alone open the Attack Options window. */
export const STOCK_SITUATIONS_OPEN_SETTING = 'stockSituationsOpenWindow';

/** The setting's value. Anything but a stored `false` (an unregistered setting included) reads as true. */
export function stockSituationsOpenWindow() {
  try {
    return globalThis.game?.settings?.get?.(SYSTEM_ID, STOCK_SITUATIONS_OPEN_SETTING) !== false;
  } catch {
    return true;
  }
}

const say = (state, note = '') => ({ state, note });
const noTarget = () => say(DETECTED.unknown, attackText('COG.AttackSituation.NoTarget'));

/** The one size detector: `direction` is +1 when the target must be the larger side, -1 the smaller. */
function sizeDetector(direction) {
  return (facts) => {
    if (!facts.target) return noTarget();
    const gap = (facts.target.size - facts.attacker.size) * direction;
    if (gap < SIZE_GAP_FOR_ADVANTAGE) return say(DETECTED.no);
    return say(DETECTED.yes, attackText('COG.AttackSituation.SizeNote', {
      targetSize: sizeText(facts.target.size), ownSize: sizeText(facts.attacker.size)
    }));
  };
}

/** Enemy Within Melee Reach: a ranged attack, or a spell that is not a touch spell (rangeFeet 0 = unset), with an enemy's reach on the attacker. */
function reachDetector(facts) {
  const { ranged, spell, rangeFeet } = facts.attack;
  const touchSpell = spell && rangeFeet > 0 && rangeFeet <= MELEE_REACH_FEET;
  if (!(ranged || spell) || touchSpell) return say(DETECTED.no);
  if (!facts.threats) return say(DETECTED.unknown, attackText('COG.AttackSituation.NoToken'));
  if (!facts.threats.length) return say(DETECTED.no);
  return say(DETECTED.yes, attackText('COG.AttackSituation.EnemyInReach'));
}

/** The attacker's dark sight reaches the target: unlimited, or at least as far as the target. */
const darkSightReaches = ({ attacker, targetFeet }) => (
  attacker.darkSight.unlimited || (targetFeet !== null && attacker.darkSight.feet >= targetFeet)
);

/** The target is in darkness the attacker cannot see through: the one case that ticks Darkness (and replaces Target Unseen). */
const inUnseenDarkness = (facts) => facts.targetLight === 'dark' && !darkSightReaches(facts);

function darknessDetector(facts) {
  if (facts.targetLight === null) return say(DETECTED.unknown, attackText('COG.AttackSituation.NoLight'));
  return inUnseenDarkness(facts) ? say(DETECTED.yes, attackText('COG.AttackSituation.DarkTarget')) : say(DETECTED.no);
}

/** Dim light is offered, never ticked (the GM says when it matters). */
function dimLightDetector(facts) {
  if (facts.targetLight === null) return say(DETECTED.unknown, attackText('COG.AttackSituation.NoLight'));
  if (facts.targetLight !== 'dim' || darkSightReaches(facts)) return say(DETECTED.no);
  return say(DETECTED.unknown, attackText('COG.AttackSituation.DimLight'));
}

function registerStockDetectors() {
  const core = { priority: 0 };
  registerSituationDetector(STOCK_SITUATIONS.targetLarger, sizeDetector(1), core);
  registerSituationDetector(STOCK_SITUATIONS.targetSmaller, sizeDetector(-1), core);
  registerSituationDetector(STOCK_SITUATIONS.inMeleeReach, reachDetector, core);
  registerSituationDetector(STOCK_SITUATIONS.unseenAttacker, (facts) => (
    facts.attacker.unseen || facts.attacker.tokenHidden ? say(DETECTED.yes, attackText('COG.AttackSituation.AttackerUnseen')) : say(DETECTED.unknown)
  ), core);
  registerSituationDetector(STOCK_SITUATIONS.darkness, darknessDetector, core);
  registerSituationDetector(STOCK_SITUATIONS.dimLight, dimLightDetector, core);
  // A target in darkness already ticks Darkness (never both for one cause).
  registerSituationDetector(STOCK_SITUATIONS.unseenTarget, (facts) => (
    facts.target?.unseen && !inUnseenDarkness(facts) ? say(DETECTED.yes, attackText('COG.AttackSituation.TargetUnseen')) : say(DETECTED.unknown)
  ), core);
}

registerStockDetectors();
