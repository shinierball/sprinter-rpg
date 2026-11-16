/**
 * The facts of one attack for the situation detectors (`situation-detectors.mjs`): plain data read once per attack.
 * Never throws; anything it cannot read is null. It reads what the actors alone say (sizes, the unseen flag, dark
 * sight), the edge-to-edge distance to the first target and the enemies whose reach covers the attacker (both need
 * the attacker's token). The light at the target token's centre comes from `scene-light.mjs` (null when it cannot say).
 */
import { actorSizeNumber } from '../../data/sizes.mjs';
import { RULE_FLAGS, hasRuleFlag, collectItemSources } from '../tag/tag-behaviour.mjs';
import { collectSenses } from '../character/senses.mjs';
import { RANGED_ANY } from '../../data/tag-vocabulary.mjs';
import { CHECK_TAGS } from '../tag/tag-mechanics.mjs';
import { MELEE_ATTACK_ANY } from '../../data/rules/melee-attack.mjs';
import { attackerTokenOf } from './attack-range.mjs';
import { tokenGapFeet } from '../combat/interrupts.mjs';
import { lightBandAt } from './scene-light.mjs';
import { isMobSide } from '../combat/combat-sides.mjs';
import { getItemAllTags } from '../../documents/active-tags.mjs';
import { MELEE_REACH_FEET, REACH_WEAPON_FEET, REACH_TAGS } from '../../data/rules/attack-situation-rules.mjs';

/**
 * @typedef {object} AttackFacts
 * @property {{ size: number, unseen: boolean, tokenHidden: boolean, hasToken: boolean, darkSight: { feet: number, unlimited: boolean } }} attacker
 * @property {{ size: number, unseen: boolean, hasToken: boolean, name: string }|null} target the first target; null when none
 * @property {{ ranged: boolean, spell: boolean, melee: boolean, rangeFeet: number }} attack from the context's tags and the item's `rangeFeet`
 * @property {number|null} targetFeet null = cannot tell
 * @property {Array<{ feet: number, reach: number }>|null} threats null = cannot tell
 * @property {'bright'|'dim'|'dark'|null} targetLight
 */

const hasAny = (tags, list) => list.some((tag) => tags.has(tag));

/** The default readers of the canvas; `opts.readers` replaces any of them (tests pass plain objects). */
const defaultReaders = () => ({
  gapFeet: tokenGapFeet,
  lightBandAt,
  sceneTokens: () => globalThis.canvas?.tokens?.placeables ?? [],
  isGM: () => globalThis.game?.user?.isGM === true
});

/** How far an actor's melee reaches: 10 ft with an equipped weapon or an attack item that carries a Reach tag, else 5 ft. */
function reachOf(actor) {
  const carried = collectItemSources(actor).filter((item) => item.type === 'gear');
  const attacks = Array.from(actor?.items ?? []).filter((item) => item?.type === 'attack');
  for (const item of [...carried, ...attacks]) {
    const tags = item.allTags instanceof Set ? item.allTags : getItemAllTags(item);
    if (hasAny(tags, REACH_TAGS)) return REACH_WEAPON_FEET;
  }
  return MELEE_REACH_FEET;
}

const defeated = (token) => token?.combatant?.defeated === true || token?.document?.combatant?.defeated === true;

/** Enemies the user can see, still up, whose reach covers the attacker (edge to edge), as `{ feet, reach }`. */
function readThreats(actor, attackerToken, readers) {
  const mine = isMobSide({ actor, token: attackerToken.document });
  const gm = readers.isGM();
  const out = [];
  for (const other of readers.sceneTokens()) {
    if (!other?.actor || other === attackerToken || other.actor === actor) continue;
    if (isMobSide({ actor: other.actor, token: other.document }) === mine) continue;
    if (other.visible === false || (!gm && other.document?.hidden === true)) continue;
    if (defeated(other)) continue;
    const feet = readers.gapFeet(attackerToken, other);
    const reach = reachOf(other.actor);
    if (Number.isFinite(feet) && feet <= reach) out.push({ feet, reach });
  }
  return out;
}

const finiteOrNull = (n) => (Number.isFinite(n) ? n : null);

function safely(read, fallback) {
  try {
    return read();
  } catch {
    return fallback;
  }
}

/**
 * @param {object} actor the attacker
 * @param {object} item the attack, weapon, skill or spell
 * @param {object} context the roll's toHit RollContext (before situations)
 * @param {Array<{ actor: object, token?: object|null }>} targets `attackTargetEntries` result
 * @param {{ attackerToken?: object|null, readers?: object }} [opts] `readers` replaces the canvas readers (`gapFeet`, `sceneTokens`, `isGM`, `lightBandAt`) in tests
 * @returns {AttackFacts}
 */
export function readAttackFacts(actor, item, context, targets, opts = {}) {
  const tags = context?.tags instanceof Set ? context.tags : new Set(context?.tags ?? []);
  const token = safely(() => attackerTokenOf(actor, opts.attackerToken), null);
  const senses = safely(() => collectSenses(actor), { darkvision: 0, darkvisionUnlimited: false });
  const readers = { ...defaultReaders(), ...(opts.readers ?? {}) };
  const first = Array.isArray(targets) ? (targets.find((e) => e?.actor) ?? null) : null;
  return {
    attacker: {
      size: actorSizeNumber(actor),
      unseen: safely(() => hasRuleFlag(actor, RULE_FLAGS.unseen), false),
      tokenHidden: token?.document?.hidden === true,
      hasToken: Boolean(token),
      darkSight: { feet: Number(senses.darkvision) || 0, unlimited: senses.darkvisionUnlimited === true }
    },
    target: first ? {
      size: actorSizeNumber(first.actor),
      unseen: safely(() => hasRuleFlag(first.actor, RULE_FLAGS.unseen), false),
      hasToken: Boolean(first.token),
      name: String(first.actor.name ?? '')
    } : null,
    attack: {
      ranged: hasAny(tags, RANGED_ANY),
      spell: tags.has(CHECK_TAGS.spell),
      melee: hasAny(tags, MELEE_ATTACK_ANY),
      rangeFeet: Number(item?.system?.rangeFeet) || 0
    },
    targetFeet: token && first?.token ? safely(() => finiteOrNull(readers.gapFeet(token, first.token)), null) : null,
    threats: token ? safely(() => readThreats(actor, token, readers), null) : null,
    targetLight: first?.token ? safely(() => readers.lightBandAt(first.token) ?? null, null) : null
  };
}
