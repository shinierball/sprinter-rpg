/**
 * Attack targets: evade DCs, the Difficulty an attack meets, target resolution and the interrupt prompts for them.
 * A leaf below the roll and cast stages (imports no `vehicle-drive`).
 */

import { getCurrentFloor } from './actor-environment.mjs';
import { getCOGStatModifier } from './actor-constants.mjs';
import { OFFER_ROLES } from '../../utils/tag/tag-mechanics.mjs';
import { collectRollAdvantage } from '../../utils/roll/damage-modifiers.mjs';
import { buildRollContext, resolveRowAdvantage, rollContextDataAttr } from '../../utils/roll/roll-context.mjs';
import { classifyAttackOutcome, collectInterruptOffers, interruptEffectsText } from '../../utils/combat/interrupts.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { firstScalar } from '../../utils/first-scalar.mjs';
import { toHitForTarget, toHitLineText } from '../../utils/attack/per-target-to-hit.mjs';
import { asTriggersOf, asTriggerLines, amazingNames, isAmazingOutcome, amazingCardText } from '../../utils/roll/amazing-success.mjs';
import { clickTargetsOf } from '../../utils/roll/scalars.mjs';
import { findOutOfRange, rangeText } from '../../utils/attack/attack-range.mjs';
import { isHeadOn, occupantEvadeLine, vehicleEvadeDifficulty, vehicleTargetOf } from '../../utils/vehicle/vehicle-combat.mjs';
import { mobAttackText } from '../../utils/combat/declared-attacks.mjs';
import { driverOf } from './vehicle-crew.mjs';
import { COG_ROLL_OUTCOMES } from '../session/roll-outcomes.mjs';

const vehicleText = (key, fallback) => {
  const text = globalThis.game?.i18n?.localize?.(key);
  return text && text !== key ? text : fallback;
};

/** The mob qualities whose Difficulty a net Advantage shifts (book p. 60). */
export const MOB_QUALITIES = Object.freeze({ action: 'action', evade: 'evade', surprise: 'surprise', check: 'check' });
/** Points per net step. */
const MOB_ADVANTAGE_SHIFT = 5;

/**
 * A mob's net Advantage for one quality, as a Difficulty shift (E6.10 D-M1). Each quality is judged in its own roll
 * context, so a row means on a mob what it means on a crawler: Action in the attack's `toHit` context, Evade in the
 * context of an Evade roll (`check.evade`, `stat.dex`, the attacker as `attacker.*`), Surprise in `check.surprise` +
 * `stat.int`. Manual `options.advantage` / `options.disadvantage` count as one reason each. Mobs never roll, so the
 * net becomes +5 / 0 / -5 on the Difficulty. Non-mobs: no shift, unless the caller says `fixed: true` (3.45: a racing
 * or chasing contest gives NPCs a fixed result too, and the book's Debuff rule says "Mobs or NPCs").
 * The `check` quality (3.45) is judged in the caller's `context` (the leg's check context); without one, no shift.
 * @param {object} actor
 * @param {'action'|'evade'|'surprise'|'check'} quality
 * @param {{ item?: object|null, context?: object|null, attacker?: object|null, options?: object|null, fixed?: boolean }} [opts]
 * @returns {{ quality: string, mode: string, shift: number, reasons: string[], label: string|null }}
 */
export function mobDifficultyShift(actor, quality, { item = null, context = null, attacker = null, options = null, fixed = false } = {}) {
  const none = { quality, mode: 'normal', shift: 0, reasons: [], label: null };
  if ((actor?.type !== 'mob' && fixed !== true) || !Object.values(MOB_QUALITIES).includes(quality)) return none;
  let ctx;
  let isAttack = false;
  if (quality === MOB_QUALITIES.action) {
    isAttack = true;
    ctx = context && typeof context === 'object' ? context : buildRollContext({
      actor, phase: 'toHit', item, check: item?.type === 'spell' ? ['attack', 'spell'] : 'attack', other: null
    });
  } else if (quality === MOB_QUALITIES.check) {
    if (!context || typeof context !== 'object') return none;
    ctx = context;
  } else if (quality === MOB_QUALITIES.evade) {
    ctx = buildRollContext({ actor, phase: 'check', check: 'evade', stat: 'dex', other: attacker ?? null, otherRole: 'attacker' });
  } else {
    ctx = buildRollContext({ actor, phase: 'check', check: 'surprise', stat: 'int', other: null });
  }
  const found = collectRollAdvantage(actor, ctx, { isAttack });
  const advantages = [...found.advantages];
  const disadvantages = [...found.disadvantages];
  if (options?.advantage === true) advantages.push('Advantage (Manual Selection)');
  if (options?.disadvantage === true) disadvantages.push('Disadvantage (Manual Selection)');
  const net = resolveRowAdvantage({ advantages, disadvantages });
  return { quality, mode: net.mode, shift: Math.sign(net.net) * MOB_ADVANTAGE_SHIFT, reasons: net.reasons, label: net.label };
}

/** `hitDifficulty` as a whole number, or null when it is unset or not numeric (CONTRIBUTING §4). */
function hitDifficultyOf(attackItem) {
  let base = firstScalar(attackItem?.system?.hitDifficulty, null);
  if (typeof base === 'string') base = base.trim();
  const n = base === null || base === '' || typeof base === 'boolean' ? NaN : Number(base);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : null;
}

/** The built-in Evade stance interrupt (src/data/core-interrupts.mjs). */
const CORE_EVADE_ID = 'evade';

/**
 * Calculate Target Evade DC for an attacker aiming at this actor
 * For mobs: base evade difficulty + floor (e.g. 14 + F), shifted +/-5 by the mob's own net Advantage on Evade
 * For crawlers/others: 10 + dexMod + floor
 * @param {number|null} [floor=null]
 * A vehicle has no Evade stat: its Difficulty is 10 + speed / 5, or 10 head-on (3.44e, no Floor). Someone aboard a moving
 * vehicle adds its Evade Buff to the shifted number.
 * @param {{ attacker?: object|null, shift?: boolean, headOn?: boolean }} [opts] `attacker`: the actor attacking (its tags join the
 *   Evade context); `shift: false` returns the stat-block number; `headOn`: the attack is head-on or from behind
 * @returns {number}
 */
export function getEvadeTargetDC(actor, floor = null, { attacker = null, shift = true, headOn = false } = {}) {
  if (actor.type === 'mount_vehicle') return vehicleEvadeDifficulty(actor, { headOn });
  const aboard = shift ? (occupantEvadeLine(actor, { headOn })?.amount ?? 0) : 0;
  if (actor.type === 'mob') {
    let dc;
    if (floor === null && typeof actor.system.attributes?.effectiveEvadeDC === 'number') {
      dc = actor.system.attributes.effectiveEvadeDC;
    } else {
      const currentFloor = floor !== null ? (parseInt(floor, 10) || 1) : getCurrentFloor();
      const dexMod = actor.system.abilities?.dex?.mod ?? (typeof getCOGStatModifier === 'function' ? getCOGStatModifier(actor.system?.abilities?.dex?.value ?? 10) : 0);
      const base = (actor.system.attributes?.evadeBase !== null && actor.system.attributes?.evadeBase !== undefined)
        ? Number(actor.system.attributes.evadeBase)
        : (10 + dexMod);
      dc = base + currentFloor;
    }
    return shift ? dc + mobDifficultyShift(actor, MOB_QUALITIES.evade, { attacker }).shift + aboard : dc;
  }
  const currentFloor = floor !== null ? (parseInt(floor, 10) || 1) : getCurrentFloor();
  const dexMod = actor.system.abilities?.dex?.mod ?? 0;
  return 10 + dexMod + currentFloor + aboard;
}

/**
 * The Difficulty a target's Evade must meet for an attack this actor makes with `attackItem` (the mob auto-hit
 * path), with how it was reached. A numeric `hitDifficulty` is the base; null keeps this actor's own stat-block Evade
 * (unshifted, so the Action shift is added exactly once). The Action shift is this actor's net Advantage on its attack.
 * @param {object} attackItem
 * @param {number|null} [floor=null] defaults to the current Floor
 * @param {{ context?: object|null, options?: object|null }} [opts] the attack's own roll context and manual options
 * @returns {{ dc: number, base: number, floor: number, shift: number, mode: string, reasons: string[], label: string|null }}
 */
export function getAttackDifficultyState(actor, attackItem, floor = null, { context = null, options = null } = {}) {
  const currentFloor = floor !== null && floor !== undefined ? (parseInt(floor, 10) || 1) : getCurrentFloor();
  const hit = hitDifficultyOf(attackItem);
  const base = hit ?? getEvadeTargetDC(actor, currentFloor, { shift: false }) - currentFloor;
  const s = mobDifficultyShift(actor, MOB_QUALITIES.action, { item: attackItem, context, options });
  return { dc: base + currentFloor + s.shift, base, floor: currentFloor, shift: s.shift, mode: s.mode, reasons: s.reasons, label: s.label };
}

/**
 * The Difficulty a target's Evade must meet for an attack this actor makes with `attackItem`.
 * @param {object} attackItem
 * @param {number|null} [floor=null] defaults to the current Floor
 * @returns {number}
 */
export function getAttackDifficulty(actor, attackItem, floor = null) {
  return getAttackDifficultyState(actor, attackItem, floor).dc;
}

/**
 * The attack's targets as `{ actor, token }` entries: `options.targets`, `options.target`, else the user's Foundry targets.
 * @param {object} [options={}]
 * @returns {Array<{ actor: object, token: object|null }>}
 */
export function attackTargetEntries(actor, options = {}) {
  let entries = [];
  const toEntry = (t) => (t?.actor ? { actor: t.actor, token: t } : { actor: t, token: null });
  if (options.targets && Array.isArray(options.targets)) {
    entries = options.targets.filter(Boolean).map(toEntry);
  } else if (options.target) {
    entries = [toEntry(options.target)];
  } else if (typeof game !== 'undefined' && game.user?.targets && game.user.targets.size > 0) {
    entries = Array.from(game.user.targets).filter(Boolean).map(toEntry);
  }
  return entries.filter(e => e.actor);
}

/**
 * Determine and evaluate attack hits against active targets
 * @param {Roll} roll
 * @param {object} [options={}]
 * @param {Array<object>} [options.toHitRows] per-target to-hit rows with their dice rolled (per-target-to-hit.mjs)
 * @param {object} [options.toHitContext] the attack's RollContext those rows are judged against per target
 * @returns {{ targetResults: Array<object>, targetResultsHtml: string, currentFloor: number }}
 */
export function resolveAttackTargets(actor, roll, options = {}) {
  const currentFloor = getCurrentFloor();
  const entries = attackTargetEntries(actor, options);
  const toHitRows = Array.isArray(options.toHitRows) && options.toHitContext ? options.toHitRows : [];

  // Rows scaled by the target count the whole click's targets (E3.5c): build that batch once.
  const batch = toHitRows.some(r => r.applyScale) ? clickTargetsOf(entries.map(e => e.actor)) : undefined;

  const d20Face = roll?.dice?.[0]?.total ?? roll?.terms?.[0]?.results?.[0]?.result ?? null;

  const isMobAttacker = actor.type === 'mob' || options.isAutoHit === true;
  const mobEvadeDC = isMobAttacker
    ? (options.targetDC !== undefined && options.targetDC !== null
        ? Number(options.targetDC)
        : getAttackDifficulty(actor, options.sourceItem ?? null, currentFloor))
    : null;

  const outOfRangeRows = Array.isArray(options.outOfRange) ? options.outOfRange : [];
  const headOn = isHeadOn(options.toHitContext);
  const targetResults = entries.map(({ actor: target, token }) => {
    // Beyond the attack's range (3.48-8): a failure for this target, shown as a miss and never hit, damaged or saved.
    const farAway = outOfRangeRows.length ? findOutOfRange(outOfRangeRows, { uuid: target.uuid ?? null, actorId: target.id ?? null, tokenId: token?.id ?? token?.document?.id ?? null }) : null;
    if (farAway) {
      return {
        actor: target,
        actorId: target.id,
        actorName: target.name,
        tokenId: token?.id ?? token?.document?.id ?? null,
        targetDC: isMobAttacker ? mobEvadeDC : (typeof target.getEvadeTargetDC === 'function' ? target.getEvadeTargetDC(currentFloor, { attacker: actor }) : null),
        isHit: false,
        diff: 0,
        outcome: 'Out of Range',
        outcomeId: 'out_of_range',
        outOfRange: true,
        rangeFeet: farAway.feet,
        rangeLimit: farAway.range
      };
    }
    if (isMobAttacker) {
      // 545: a mob's attack on a vehicle hits unless the driver chooses to evade with a Driving check.
      const driver = target.type === 'mount_vehicle' ? driverOf(target) : null;
      return {
        actor: target,
        actorId: target.id,
        actorName: target.name,
        tokenId: token?.id ?? token?.document?.id ?? null,
        targetDC: mobEvadeDC,
        isHit: true,
        diff: 0,
        outcome: 'Auto-Hit',
        ...(driver ? { vehicleEvade: { vehicleUuid: target.uuid, driverUuid: driver.uuid } } : {})
      };
    }

    const targetDC = typeof target.getEvadeTargetDC === 'function'
      ? target.getEvadeTargetDC(currentFloor, { attacker: actor, headOn })
      : (10 + (target.system?.abilities?.dex?.mod ?? 0) + currentFloor);
    // Rows that depend on this target add to its comparison only; the d20 was rolled once.
    const rowHit = toHitRows.length > 0 ? toHitForTarget(toHitRows, options.toHitContext, target, { targets: batch }) : { bonus: 0, lines: [] };
    const { isHit, diff, outcome, outcomeId } = classifyAttackOutcome((roll?.total ?? 0) + rowHit.bonus, targetDC, d20Face);
    // A Near Miss on someone aboard a vehicle hits the vehicle (3.44e): the card offers a button that targets it.
    const aboard = target.type === 'mount_vehicle' ? null : vehicleTargetOf(target);
    const hitsVehicle = aboard && !isHit && outcomeId === COG_ROLL_OUTCOMES.NEAR_MISS ? aboard.vehicle.uuid : null;
    return {
      ...(hitsVehicle ? { hitsVehicle } : {}),
      toHitBonus: rowHit.bonus,
      toHitLines: rowHit.lines,
      actor: target,
      actorId: target.id,
      actorName: target.name,
      tokenId: token?.id ?? token?.document?.id ?? null,
      targetDC,
      isHit,
      diff,
      outcome,
      outcomeId
    };
  });

  // An Amazing Success row names the weapon's AS triggers (E6.9 3.5) and the Floor it adds.
  const asTriggers = asTriggersOf(options.sourceItem);
  const asLines = asTriggerLines(asTriggers, { found: amazingNames(asTriggers) }).map(l => l.text);
  let targetResultsHtml = '';
  if (targetResults.length > 0) {
    const rows = targetResults.map(tr => {
      const img = tr.actor?.img || tr.actor?.prototypeToken?.texture?.src || 'icons/svg/mystery-man.svg';
      const hit = tr.isHit;
      const badgeBg = hit ? 'var(--cog-success-fill)' : 'var(--cog-accent-fill)';
      const diffStr = tr.diff >= 0 ? `+${tr.diff}` : `${tr.diff}`;
      const lines = (tr.toHitLines ?? []).map(toHitLineText);
      if (tr.outcome === 'Critical Miss') lines.push('Natural 1: automatic miss');
      if (tr.outOfRange) lines.push(rangeText('COG.AttackRange.RowLine', { feet: tr.rangeFeet, range: tr.rangeLimit }));
      const isAmazing = isAmazingOutcome(tr.outcomeId);
      if (isAmazing) lines.push(...asLines);
      const linesHtml = lines.length > 0
        ? `<div class="cog-target-tohit-lines cog-text-secondary" style="flex-basis: 100%; font-size: 9px;">${escapeAttr(lines.join(', '))}</div>`
        : '';
      let outcomeBadge = tr.outOfRange ? rangeText('COG.AttackRange.Badge') : (tr.outcome === 'Auto-Hit' ? 'AUTO-HIT' : `${tr.outcome.toUpperCase()} (${diffStr})`);
      if (isAmazing) outcomeBadge += ` ${amazingCardText('COG.AmazingSuccess.Card.FloorBadge', { floor: currentFloor })}`;
      const vehicleButtons = `${tr.hitsVehicle ? `<button type="button" class="cog-vehicle-near-miss-btn" data-action="crawlerHitVehicle" data-vehicle-uuid="${escapeAttr(tr.hitsVehicle)}" style="flex-basis: 100%; cursor: pointer;"><i class="fa-solid fa-car-burst"></i> ${escapeAttr(vehicleText('COG.Vehicle.NearMiss.Button', 'Hits the vehicle'))}</button>` : ''}`
        + `${tr.vehicleEvade ? `<button type="button" class="cog-vehicle-evade-btn" data-action="crawlerVehicleEvade" data-vehicle-uuid="${escapeAttr(tr.vehicleEvade.vehicleUuid)}" data-driver-uuid="${escapeAttr(tr.vehicleEvade.driverUuid)}" data-target-dc="${escapeAttr(tr.targetDC)}" data-attacker-name="${escapeAttr(actor.name)}" style="flex-basis: 100%; cursor: pointer;"><i class="fa-solid fa-car-side"></i> ${escapeAttr(vehicleText('COG.Vehicle.Evade.Button', 'Driver: evade with a Driving check'))} (${escapeAttr(tr.targetDC)})</button>` : ''}`;
      return `
        <div class="cog-target-eval-row ${hit ? 'hit' : 'miss'} cog-bg-dyn" data-target-id="${tr.actorId}" style="--cog-bg-dyn: ${hit ? 'var(--cog-success-tint)' : 'var(--cog-danger-tint)'}; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; padding: 4px 6px; border: 1px solid ${hit ? 'var(--cog-success)' : 'var(--cog-accent)'}; border-radius: 3px; margin-top: 3px;">
          <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
            <img class="cog-bg-icon-box" src="${img}" style="width: 20px; height: 20px; border-radius: 2px; border: 1px solid var(--cog-border-muted); object-fit: cover;" />
            <span class="cog-text" style="font-size: 11px; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${tr.actorName}</span>
            ${tr.outOfRange ? '' : `<span class="cog-text-secondary" style="font-size: 10px;">(DC ${tr.targetDC})</span>`}
          </div>
          <div class="cog-bg-dyn cog-text-on-fill" style="--cog-bg-dyn: ${badgeBg}; font-size: 10px; font-weight: bold; padding: 2px 6px; border-radius: 2px; text-transform: uppercase; white-space: nowrap;">
            ${outcomeBadge}
          </div>
          ${linesHtml}
          ${vehicleButtons}
        </div>
      `;
    }).join('');

    targetResultsHtml = `
      <div class="cog-attack-targets-container" style="margin-top: 6px; font-family: var(--font-primary, 'Oswald', sans-serif);">
        <div class="cog-text-gold" style="font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; display: flex; justify-content: space-between;">
          <span><i class="fa-solid fa-crosshairs"></i> Target Evaluation</span>
          <span>Floor ${currentFloor}</span>
        </div>
        ${rows}
      </div>
    `;
  }

  const promptsHtml = interruptPromptsHtml(actor, targetResults, {
    ...options,
    attackTotal: isMobAttacker ? mobEvadeDC : roll?.total,
    targetDC: isMobAttacker ? mobEvadeDC : undefined,
    floor: currentFloor,
    d20Face
  });
  return { targetResults, targetResultsHtml, currentFloor, interruptPromptsHtml: promptsHtml };
}

/**
 * Helper to build interactive interrupt prompts HTML for targets and allies
 * @param {Array<object>} targetResults
 * @param {object} [options={}]
 * @returns {string}
 */
export function interruptPromptsHtml(actor, targetResults, options = {}) {
  if (!Array.isArray(targetResults) || targetResults.length === 0) return '';

  const offers = collectInterruptOffers({
    attacker: actor,
    targetResults,
    combat: globalThis.game?.combat,
    sourceItem: options.sourceItem || null
  });

  // On a mob's declared attack the Roll Evade button is the Evade interrupt (rolled and paid in one click), so the
  // core Evade stance offer would charge the Action twice (3.18).
  const isAutoHit = options.isAutoHit === true;
  // A vehicle does not Evade (V9): the core Evade stance is never offered to a mount_vehicle.
  const isCoreEvade = (o) => !o.interrupt?.item && o.interrupt?.id === CORE_EVADE_ID;
  const prompts = offers.filter(o => !(isAutoHit && isCoreEvade(o)) && !(isCoreEvade(o) && o.actor?.type === 'mount_vehicle')).map(o => {
    const int = o.interrupt;
    let detail = int.costDesc ? `(${int.costDesc})` : '';
    if (o.interceptMode === 'redirect') detail = `(Redirect from ${o.defenderName})`;
    else if (o.interceptMode === 'intercept') detail = `(Protect ${o.defenderName})`;
    const effects = interruptEffectsText(int);
    if (effects) detail = detail ? `${detail} ${effects}` : `(${effects})`;
    return {
      ...o,
      interruptId: int.id,
      label: `${o.actorName}: ${int.name}`,
      detail,
      icon: int.icon || (o.role === OFFER_ROLES.ALLY ? 'fa-solid fa-shield-halved' : 'fa-solid fa-bolt'),
      isFree: Boolean(int.isFree),
      targetName: o.defenderName
    };
  });

  if (prompts.length === 0) return '';

  const buttonsHtml = prompts.map(p => {
    const freeBadge = p.isFree
      ? `<span class="cog-bg-success-fill cog-text-on-fill" style="padding: 1px 4px; border-radius: 2px; font-size: 9px; font-weight: bold; margin-left: 4px;">FREE</span>`
      : '';
    return `
      <button type="button" class="cog-trigger-interrupt-btn cog-dark cog-bg-header-fill cog-text-on-fill" data-action="crawlerTriggerInterrupt"
        data-actor-uuid="${escapeAttr(p.actorUuid)}"
        data-combatant-id="${escapeAttr(p.combatantId || '')}"
        data-interrupt-id="${escapeAttr(p.interruptId)}"
        data-target-name="${escapeAttr(p.targetName)}"
        data-defender-id="${escapeAttr(p.defenderId)}"
        data-defender-uuid="${escapeAttr(p.defender?.uuid || '')}"
        data-defender-token-id="${escapeAttr(p.defenderTokenId || '')}"
        data-attacker-uuid="${escapeAttr(actor.uuid)}"
        data-attack-total="${escapeAttr(options.attackTotal ?? '')}"
        data-floor="${escapeAttr(options.floor ?? '')}"
        data-d20="${escapeAttr(options.d20Face ?? '')}"
        data-role="${escapeAttr(p.role)}"
        style="width: 100%; margin-top: 4px; padding: 5px 8px; font-size: 11px; cursor: pointer; border: 1px solid var(--cog-warning); border-radius: 3px; display: flex; align-items: center; justify-content: space-between; gap: 6px; font-weight: bold; font-family: var(--font-primary, 'Oswald', sans-serif); text-transform: uppercase;">
        <span style="display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          <i class="${p.icon} cog-dark cog-text-warning"></i>
          <span>${escapeAttr(p.label)}</span>
          ${freeBadge}
        </span>
        <span class="cog-dark cog-text-warning" style="font-size: 10px; white-space: nowrap;">${escapeAttr(p.detail)}</span>
      </button>
    `;
  }).join('');

  return `
    <div class="cog-interrupt-prompts-container cog-bg-warning-tint" style="margin-top: 8px; padding: 6px 8px; border: 1.5px solid var(--cog-warning); border-radius: 4px; font-family: var(--font-primary, 'Oswald', sans-serif);">
      <div class="cog-text-warning" style="font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px;">
        <span><i class="fa-solid fa-bolt"></i> Interrupt Opportunities</span>
        <span class="cog-text-secondary" style="font-size: 9px;">1 Action Out-of-Turn</span>
      </div>
      ${buttonsHtml}
    </div>
  `;
}

/**
 * Helper to build Evade button HTML for non-crawler attacks
 * @param {Roll} roll
 * @param {number} currentFloor
 * @param {object} [options={}]
 * @returns {string}
 */
export function evadeButtonHtml(actor, roll, currentFloor, options = {}) {
  // A crawler's single-target attack has no Evade (the target's DC is its own); an Area Attack lets the crawlers
  // caught in it Evade for half damage (book p. 85), against the attack total.
  if ((actor.type === 'crawler' || actor.type === 'mercenary') && options.isArea !== true) return '';
  const isMob = actor.type === 'mob';
  const targetDC = options.targetDC !== undefined && options.targetDC !== null
    ? Number(options.targetDC)
    : (isMob
        ? getAttackDifficulty(actor, options.item ?? null, currentFloor)
        : (roll?.total ?? 10));
  const isArea = Boolean(options.isArea);
  // The attack's context rides on the button: Evade rows judge `attacker.*` and the attack's own tags (`shape.aoe`).
  const attackContext = options.rollContext
    ?? (options.item ? buildRollContext({ actor, phase: 'toHit', item: options.item, check: options.item.type === 'spell' ? 'spell' : ['skill', 'attack'], other: null }) : null);
  const areaAttr = `${isArea ? ' data-is-area="true"' : ''}${attackContext ? rollContextDataAttr(attackContext) : ''}`;
  // A disadvantaged mob attack gives each target one free Evade (the handler reads the card, never this label).
  const displayLabel = isMob
    ? mobAttackText(options.freeEvade === true ? 'COG.MobAttack.EvadeButtonFree' : 'COG.MobAttack.EvadeButton', { dc: targetDC })
    : `Roll Evade vs Attack (${targetDC})`;
  return `
    <div class="cog-evade-btn-container" style="margin-top: 6px;">
      <button type="button" class="cog-evade-roll-btn cog-bg-info-fill cog-text-on-fill" data-action="crawlerRollEvade" data-attacker-id="${actor.id}" data-attacker-name="${actor.name}" data-target-dc="${targetDC}" data-attack-total="${targetDC}" data-floor="${currentFloor}"${areaAttr} style="width: 100%; padding: 4px 8px; font-size: 11px; cursor: pointer; border: 1px solid var(--cog-info-fill); border-radius: 3px; display: flex; align-items: center; justify-content: center; gap: 6px; font-weight: bold; font-family: var(--font-primary, 'Oswald', sans-serif); text-transform: uppercase;">
        <i class="fa-solid fa-person-running"></i> ${displayLabel}
      </button>
    </div>
  `;
}
