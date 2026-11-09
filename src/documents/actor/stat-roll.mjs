import { COGSessionEngine } from '../session/session-engine.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { sanitizeContestRef, moveLine } from '../../utils/contest/contest-roll.mjs';
import { sanitizeVehicleRef, vehicleCheckSetup, vehicleCheckKeys, withVehicleSources } from '../../utils/vehicle/vehicle-check.mjs';
import { buildCheckRecord, combatRefFor, rollerTokenIdOf, CHECK_RECORD_FLAG } from '../../utils/roll/check-assists.mjs';
import { collectCheckToHit, rollCheckTargets } from '../../utils/attack/per-target-to-hit.mjs';
import { buildRollContext, extendContext, resolveRollToggles } from '../../utils/roll/roll-context.mjs';
import { cameraParts, consumeArmedCamera } from '../../utils/roll/cameras.mjs';
import { getCurrentFloor } from './actor-environment.mjs';
import { attackTargetEntries } from './attack-targets.mjs';
import { getRollAdvantageState } from './combat-rolls.mjs';

/**
 * Roll a stat check
 * @param {COGActor} actor
 * @param {string} statKey - str, int, con, dex, cha
 */
export async function rollStat(actor, statKey, options = {}) {
  const ability = actor.system.abilities?.[statKey];
  if (!ability) return;

  const mod = ability.mod ?? 0;
  const statName = statKey.toUpperCase();

  // Context tags: `check.stat`, `stat.<stat>` and any ticked `situation.*` toggle
  // The roller's targets: the first is the check's subject, and the rest get a per-target total (E3.5c).
  const targetActors = attackTargetEntries(actor, options).map(e => e.actor);
  // A check made for a leg of a race or chase (3.45): `contest.race` / `contest.chase` on the context, Move Rate as a flat line
  const contest = sanitizeContestRef(options.contest);
  // A check made to board, brake or ram a vehicle (3.44d): the same context, sources and Advantage as a skill check
  const vehicleRef = sanitizeVehicleRef(options.vehicle);
  const vehicleSetup = vehicleRef ? vehicleCheckSetup(actor, vehicleRef) : null;
  const vehicle = vehicleRef ? { ...vehicleRef, stat: vehicleRef.stat || statKey, advantage: Boolean(vehicleSetup?.advantage) } : null;
  const baseContext = withVehicleSources(buildRollContext({
    actor: actor, phase: 'check', check: vehicleCheckKeys('stat', vehicleRef), stat: statKey, other: targetActors[0],
    tags: [...(contest ? [contest.tag] : []), ...(vehicleSetup?.tags ?? [])]
  }), vehicleSetup);
  const toggles = await resolveRollToggles(actor, baseContext, options, { cameras: true });
  const situationContext = extendContext(baseContext, { situations: toggles.situations });
  // Playing to the Cameras (E6.10): one extra Disadvantage reason, recorded on the card.
  const camera = cameraParts(actor, toggles.cameras, getCurrentFloor());

  // Advantage rows read the context before `situation.disadvantaged` exists; flat and dice rows read it after.
  const advState = getRollAdvantageState(actor, {
    rollType: 'stat',
    stat: statKey,
    rollContext: situationContext,
    extraDisadvantages: camera.disadvantages,
    extraAdvantages: vehicleSetup?.advantage ? [vehicleSetup.advantage] : [],
    options
  });
  const rollContext = extendContext(situationContext, { disadvantaged: advState.mode === 'disadvantage' });
  const { mods: checkMods, targetRows } = collectCheckToHit(actor, rollContext, { targetActors });

  const moveMod = contest?.moveMod ?? 0;
  const total = mod + checkMods.flatBonus + moveMod;
  const extraDice = checkMods.diceParts.map(d => ` + ${d}`).join('');
  const formula = `${advState.formula} + ${total}${extraDice}`;
  const roll = await new Roll(formula, { mod }).evaluate();

  COGSessionEngine.recordRoll({
    actor: actor,
    roll,
    type: 'stat',
    name: `${statName} Check`,
    isUntrained: false
  }).catch(() => {});

  const modLines = moveLine(contest) ? [...checkMods.breakdown, moveLine(contest)] : checkMods.breakdown;
  const modDesc = modLines.length > 0 ? ` [${modLines.join(', ')}]` : '';
  const flavor = advState.label
    ? `<strong>${actor.name}</strong>: ${statName} Check (<strong>${advState.label}</strong>: ${advState.formula} + ${statName} Mod ${mod >= 0 ? `+${mod}` : mod}${modDesc})`
    : `<strong>${actor.name}</strong>: ${statName} Check${modDesc}`;

  const perTarget = await rollCheckTargets(roll, targetRows, rollContext, targetActors);
  const message = await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor: actor }),
    flavor: `${flavor}${camera.noteHtml}`,
    ...(perTarget.html ? { content: `${typeof roll.render === 'function' ? await roll.render() : ''}${perTarget.html}` } : {}),
    flags: {
      [SYSTEM_ID]: {
        ...perTarget.flags,
        ...camera.flags,
        [CHECK_RECORD_FLAG]: buildCheckRecord({
          kind: 'stat',
          roller: actor,
          rollerTokenId: rollerTokenIdOf(actor),
          roll,
          combat: combatRefFor(actor),
          tags: [...rollContext.tags],
          targets: perTarget.results.map((r, i) => ({ actorId: r.actorId, actorUuid: targetActors[i]?.uuid, name: r.actorName, dc: null, bonus: r.bonus })),
          dc: vehicle ? vehicle.dc : null,
          contest,
          vehicle
        })
      }
    }
  });
  await consumeArmedCamera(actor);
  return message;
}
