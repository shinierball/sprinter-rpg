/**
 * Combat: the Evade roll.
 */

import { COGSessionEngine } from '../session/session-engine.mjs';
import { newRollId } from '../../utils/roll/check-difficulty.mjs';
import { getCurrentFloor } from './actor-environment.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { CHECK_TAGS } from '../../utils/tag/tag-mechanics.mjs';
import { buildCheckRecord, classifyEvade, combatRefFor, rollerTokenIdOf, CHECK_RECORD_FLAG } from '../../utils/roll/check-assists.mjs';
import { collectCheckModifiers, collectRollAdvantage, collectEvadeOutcome } from '../../utils/roll/damage-modifiers.mjs';
import { cameraParts, consumeArmedCamera } from '../../utils/roll/cameras.mjs';
import { buildRollContext, extendContext, resolveRollToggles, resolveRowAdvantage, actionTagsOf, roleTagsOf } from '../../utils/roll/roll-context.mjs';
import { escapeAttr, trustedHtml } from '../../utils/escape-attr.mjs';
import { mobAttackText } from '../../utils/combat/declared-attacks.mjs';
import { aboardState, isEvadeNearMiss, isHeadOn, occupantEvadeLine } from '../../utils/vehicle/vehicle-combat.mjs';
import { withFlags } from '../../utils/flags.mjs';
import { gateActionBlock, actionBlockApplies } from './action-block.mjs';

const vehicleText = (key, fallback) => {
  const text = globalThis.game?.i18n?.localize?.(key);
  return text && text !== key ? text : fallback;
};

/**
 * Roll Evade check against incoming attack DC
 * @param {object} [options={}]
 * @param {number} [options.targetDC] - Incoming fixed Evade DC
 * @param {number} [options.attackTotal] - Incoming attack total (fallback for opposed checks)
 * @param {string} [options.attackerName] - Name of the attacker
 * @param {number} [options.floor] - Dungeon floor
 * @param {boolean} [options.isArea=false] - Whether the attack has an area of effect
 * @param {string|null} [options.attackMessageId] - The attack message this Evade answers (links it to the damage card's apply)
 * @param {boolean} [options.appliedBefore=false] - Damage from that attack was already applied to this crawler
 * @param {boolean} [options.ruleBreak=false] - A confirmed Rule Break (a second Evade against the same attack)
 * @param {boolean} [options.freeEvade=false] - The first Evade against a disadvantaged mob attack: it spends no Action (E6.10)
 */
export async function rollEvade(actor, options = {}) {
  // Every entry point (sheet button, attack card, tracker drawer) lands here: a bearer who cannot take Actions asks first.
  // A caller that already asked passes `actionBlockChecked`; a declined Evade rolls nothing.
  if (actionBlockApplies(actor, 'evade', options)) {
    const blockGate = await gateActionBlock(actor, 'evade', { options });
    if (!blockGate.proceed) return null;
    if (blockGate.ruleBreak) options = { ...options, ruleBreak: true };
  }
  const dexMod = actor.system.abilities?.dex?.mod ?? 0;
  const evadeAttr = actor.system.attributes?.evade;
  const items = Number(evadeAttr?.items ?? evadeAttr?.gear) || 0;
  // Manual bonus plus the derived total of the active buffs' evade modifiers (`fromBuffs`).
  const buffs = (Number(evadeAttr?.buffs) || 0) + (Number(evadeAttr?.fromBuffs) || 0);
  // Context tags: `check.evade`, `stat.dex` and any ticked `situation.*` toggle. Rows (flat, dice, advantage)
  // from race, class, gear, buffs and skills apply when their condition matches.
  // The other party is the attacker (`attacker.*`) and the attack's own tags (`shape.aoe`) join the context, both
  // from the attack card's context the Evade button carried (`options.rollContext`, a parsed card context).
  const attack = options.rollContext && typeof options.rollContext === 'object' ? options.rollContext : null;
  const attacker = attack?.actorUuid ? resolveActorByUuid(attack.actorUuid) : null;
  const baseContext = buildRollContext({
    actor, phase: 'check', check: 'evade', stat: 'dex', tags: [...actionTagsOf(attack)],
    other: attacker ?? null, otherRole: 'attacker', otherTags: attacker ? undefined : roleTagsOf(attack, 'self')
  });
  const toggles = await resolveRollToggles(actor, baseContext, options, { cameras: true });
  const rollContext = extendContext(baseContext, { situations: toggles.situations });
  const rowMods = collectCheckModifiers(actor, rollContext);
  // Playing to the Cameras (E6.10): one extra Disadvantage reason, recorded on the card.
  const camera = cameraParts(actor, toggles.cameras, getCurrentFloor());
  const found = collectRollAdvantage(actor, rollContext);
  const rowAdv = resolveRowAdvantage({ advantages: found.advantages, disadvantages: [...found.disadvantages, ...camera.disadvantages] });
  // 3.44e: a moving vehicle adds its Evade Buff to someone aboard (0 head-on).
  const movingLine = occupantEvadeLine(actor, { headOn: isHeadOn(rollContext) });
  const total = dexMod + items + buffs + rowMods.flatBonus + (movingLine?.amount ?? 0);
  const rowDice = rowMods.diceParts.map(d => ` + ${d}`).join('');
  const formula = `${rowAdv.formula} + ${total}${rowDice}`;
  const roll = await new Roll(formula).evaluate();

  const parts = [`DEX Mod ${dexMod}`];
  if (items) parts.push(`Items ${items >= 0 ? '+' : ''}${items}`);
  if (buffs) parts.push(`Buffs ${buffs >= 0 ? '+' : ''}${buffs}`);
  parts.push(...rowMods.breakdown);
  if (movingLine) parts.push(movingLine.label);
  if (rowAdv.mode !== 'normal') parts.push(rowAdv.label);
  if (options.freeEvade === true) parts.push(mobAttackText('COG.MobAttack.FreeEvadeLine'));
  if (options.evadeActionSpent === true) parts.push(mobAttackText('COG.MobAttack.EvadeCoveredLine'));

  const rollId = newRollId();
  COGSessionEngine.recordRoll({
    actor,
    roll,
    type: 'stat',
    name: 'Evade Roll',
    isUntrained: false,
    rollId,
    // The Evade Action is spent once a round (9.17): a free or already covered Evade is no new Action.
    spendsAction: options.freeEvade !== true && options.evadeActionSpent !== true
  }).catch(() => {});
  actor.awardPopularityForRoll(roll, { context: rollContext, options }).catch(() => {});

  let resultHtml = '';
  let flavor = `<strong>${actor.name}</strong>: Evade Roll (1d20 + ${parts.join(' + ')})`;

  const targetDC = options.targetDC !== undefined && options.targetDC !== null
    ? Number(options.targetDC)
    : (options.attackTotal !== undefined && options.attackTotal !== null ? Number(options.attackTotal) : null);

  let isEvaded = null;
  const isArea = Boolean(options.isArea === true || options.isArea === 'true');
  // Area Evade outcome: `evadeOutcome` rows against this Evade's context (a tag such as `rule.evade-area-full` carries
  // one). The worse outcome for the defender wins; none = half.
  const areaOutcome = isArea ? (collectEvadeOutcome(actor, rollContext).areaOutcome ?? 'half') : 'half';
  let evadeOutcome = 'normal';
  let damageMultiplier = 1;
  // The book's Evade failure results (E6.4): a Major Fail (short by 10 or more) adds the Floor number to the damage and a
  // Natural 1 (the kept d20 without modifiers, a Critical Fail) doubles it. Both are recorded for the damage card's apply.
  let floorBonus = 0;
  let double = false;
  const floorNumber = Number(options.floor) || getCurrentFloor();

  if (targetDC !== null) {
    const d20Face = roll?.dice?.[0]?.total ?? roll?.terms?.[0]?.results?.[0]?.result ?? null;
    const verdict = classifyEvade({ total: roll.total, dc: targetDC, d20: d20Face, isArea, areaOutcome, floor: floorNumber });
    ({ isEvaded, evadeOutcome, damageMultiplier, floorBonus, double } = verdict);
    const { bannerText, bannerBg, bannerBorder } = verdict;
    const attackerLabel = options.attackerName ? ` vs ${options.attackerName}` : '';
    const dcLabel = options.targetDC !== undefined ? `DC ${targetDC}` : `Attack Roll ${targetDC}`;
    flavor = `<strong>${actor.name}</strong>: Evade Roll${attackerLabel} (vs ${dcLabel}): 1d20 + ${parts.join(' + ')}`;

    // 548 a: an Evade Near Miss by someone aboard sends the hit to the vehicle.
    const nearMissVehicle = !isEvaded && !isArea && isEvadeNearMiss({ total: roll.total, dc: targetDC, d20: d20Face }) ? aboardState(actor)?.vehicle : null;
    resultHtml = `
      <div class="cog-evade-result-banner cog-bg-dyn cog-text-on-fill" style="--cog-bg-dyn: ${bannerBg}; margin-top: 6px; padding: 4px 8px; border-radius: 3px; font-family: var(--font-primary, 'Oswald', sans-serif); font-size: 12px; font-weight: bold; text-align: center; text-transform: uppercase; border: 1px solid ${bannerBorder};">
        <i class="fa-solid ${isEvaded ? 'fa-shield-halved' : 'fa-burst'}"></i>
        ${bannerText}
        <span style="font-size: 10px; font-weight: normal; margin-left: 4px;">(${roll.total} vs ${targetDC})</span>
      </div>
    `;
    if (nearMissVehicle) {
      resultHtml += `<button type="button" class="cog-vehicle-near-miss-btn" data-action="crawlerHitVehicle" data-vehicle-uuid="${escapeAttr(nearMissVehicle.uuid)}" style="margin-top: 4px; cursor: pointer;"><i class="fa-solid fa-car-burst"></i> ${escapeAttr(vehicleText('COG.Vehicle.NearMiss.Button', 'Hits the vehicle'))}</button>`;
    }
  }

  if (options.appliedBefore === true && resultHtml) {
    resultHtml += `
      <div class="cog-evade-applied-note" style="margin-top: 4px; font-size: 11px;">Damage from this attack was already applied to ${escapeAttr(actor.name)}. Undo it on the damage card and apply again to use this Evade.</div>
    `;
  }

  const rollHtml = typeof roll.render === 'function' ? trustedHtml(await roll.render()) : '';
  const content = rollHtml ? `${rollHtml}${resultHtml}` : (resultHtml || undefined);
  const attackMessageId = typeof options.attackMessageId === 'string' && options.attackMessageId ? options.attackMessageId : null;

  const message = await roll.toMessage(withFlags({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `${flavor}${camera.noteHtml}`,
    content
  }, {
    isEvadeRoll: true,
    ...camera.flags,
    evadeTotal: roll.total,
    targetDC,
    attackTotal: targetDC,
    isEvaded,
    isArea,
    evadeOutcome,
    damageMultiplier,
    floorBonus,
    double,
    attackMessageId,
    evaderUuid: actor.uuid,
    ...(options.ruleBreak === true ? { ruleBreak: true } : {}),
    ...(options.freeEvade === true ? { freeEvade: true } : {}),
    [CHECK_RECORD_FLAG]: buildCheckRecord({
      kind: 'evade',
      roller: actor,
      rollerTokenId: rollerTokenIdOf(actor),
      roll,
      combat: combatRefFor(actor),
      tags: [CHECK_TAGS.evade],
      dc: targetDC,
      evade: { isArea, areaOutcome, floor: floorNumber },
      rollId,
      stat: 'dex',
      floor: floorNumber
    })
  }));
  await consumeArmedCamera(actor);
  return message;
}
