/**
 * Movement bands (core p. 69): while a combatant's token is dragged, the token ruler tints each grid space and names the
 * waypoint by what the move so far costs against the creature's Move and Step, and when a move ends past the whole
 * round's budget its owner gets one notification. Shown, never asked: nothing blocks and nothing is stored (Directive 2).
 */
import { creatureMoveOf } from '../documents/actor/actor-move.mjs';
import { getCombatantActions } from '../documents/combat/action-ledger.mjs';
import { isMigrationWrite } from '../documents/migrations/world-migration.mjs';
import {
  MOVEMENT_BAND, movementBands, movementBand, movementBandId, isMoveWarningRecipient, overBudgetWarning
} from '../utils/combat/movement-budget.mjs';

/** Theme token that tints each band; read at draw time so the theme decides the colour (rail 9). */
const BAND_COLOUR_TOKEN = Object.freeze({
  [MOVEMENT_BAND.steps]: '--cog-success',
  [MOVEMENT_BAND.one]: '--cog-info',
  [MOVEMENT_BAND.many]: '--cog-warning',
  [MOVEMENT_BAND.over]: '--cog-danger'
});

/** The token's combatant in the active combat, or null (outside combat the core ruler is untouched). */
function combatantOf(tokenDoc) {
  const combat = globalThis.game?.combat;
  if (!combat || !tokenDoc?.id) return null;
  const combatants = Array.from(combat.combatants?.values?.() ?? combat.combatants ?? []);
  return combatants.find((c) => c?.tokenId === tokenDoc.id) ?? null;
}

/**
 * @param {TokenDocument} tokenDoc
 * @returns {{ actor: Actor, combatant: Combatant, actions: number, bands: ReturnType<typeof movementBands>, budget: number }|null}
 *   the token's movement budget for this round, or null when it is not a combatant
 */
function movementBudgetOf(tokenDoc) {
  const combatant = combatantOf(tokenDoc);
  const actor = tokenDoc?.actor ?? combatant?.actor ?? null;
  if (!combatant || !actor?.system) return null;
  const actions = getCombatantActions(combatant).max;
  const bands = movementBands({ move: creatureMoveOf(actor).rated, step: actor.system.attributes?.speed?.step, actions });
  return { actor, combatant, actions, bands, budget: bands.at(-1).upTo };
}

/** The measured cost a waypoint reaches (the history included), or null when it has none (unreachable, infinite). */
const costOf = (waypoint) => {
  const cost = waypoint?.measurement?.cost;
  return Number.isFinite(cost) ? cost : null;
};

/** A theme colour as a number, or `fallback` when the token is not readable. */
function themeColour(token, fallback) {
  const css = globalThis.getComputedStyle?.(globalThis.document?.documentElement)?.getPropertyValue?.(token)?.trim();
  return css ? globalThis.foundry.utils.Color.from(css).valueOf() : fallback;
}

/**
 * The ruler class, built on whatever class holds the slot, so a unit test can pass a stub base.
 * @param {typeof foundry.canvas.placeables.tokens.TokenRuler} Base
 */
function createMovementBandRuler(Base) {
  return class MovementBandRuler extends Base {
    /** @override */
    _getGridHighlightStyle(waypoint, offset) {
      const style = super._getGridHighlightStyle(waypoint, offset);
      if (!(style?.alpha > 0)) return style;
      const feet = costOf(waypoint);
      const budget = feet === null ? null : movementBudgetOf(this.token?.document);
      if (!budget) return style;
      const { id } = movementBandId(budget.bands, feet);
      return { ...style, color: themeColour(BAND_COLOUR_TOKEN[id], style.color) };
    }

    /** @override */
    _getWaypointLabelContext(waypoint, state) {
      const context = super._getWaypointLabelContext(waypoint, state);
      if (!context?.cost) return context;
      const feet = costOf(waypoint);
      const budget = feet === null ? null : movementBudgetOf(this.token?.document);
      if (!budget) return context;
      const { id, moveActions } = movementBandId(budget.bands, feet);
      const label = globalThis.game.i18n.format(`COG.Movement.Band.${id}`, { count: moveActions });
      // The core label template prints `cost.total` then `cost.units`: the band name rides on the units.
      context.cost = { ...context.cost, units: `${context.cost.units} (${label})` };
      return context;
    }
  };
}

let notedForeignRuler = false;

/**
 * At init: put the band ruler in `CONFIG.Token.rulerClass`, but only while the slot still holds Foundry's own class. A
 * module that already replaced it keeps its ruler and the bands are absent (one console note).
 * @param {object} [config] `CONFIG`
 * @param {Function|undefined} [core] Foundry's own `TokenRuler`
 * @returns {boolean} whether the slot now holds the band ruler
 */
export function installMovementBandRuler(config = globalThis.CONFIG, core = globalThis.foundry?.canvas?.placeables?.tokens?.TokenRuler) {
  if (!config?.Token || !core) return false;
  if (config.Token.rulerClass !== core) {
    if (!notedForeignRuler) console.log('Sprinter RPG | Another module replaced the token ruler: movement bands are not shown');
    notedForeignRuler = true;
    return false;
  }
  config.Token.rulerClass = createMovementBandRuler(core);
  return true;
}

/**
 * `moveToken` on every client: warn the mover's owner once, when a move ends past the round's budget.
 * @param {TokenDocument} tokenDoc
 * @param {object} movement Foundry's `TokenMovementOperation` data (`history`, `passed`, `pending`)
 */
function onMovementBandsTokenMove(tokenDoc, movement) {
  if (movement?.pending?.waypoints?.length) return; // a paused or split drag warns once, at its end
  const passed = Number(movement?.passed?.cost);
  if (!(passed > 0)) return; // a displacement costs nothing and is not the creature's own movement
  const budget = movementBudgetOf(tokenDoc);
  if (!budget) return;
  const feet = (Number(movement?.history?.cost) || 0) + passed;
  if (movementBand(budget.bands, feet) !== MOVEMENT_BAND.over) return;
  const user = globalThis.game?.user;
  if (!isMoveWarningRecipient({ isGM: user?.isGM, isOwner: budget.actor.testUserPermission?.(user, 'OWNER'), hasPlayerOwner: budget.actor.hasPlayerOwner })) return;
  const text = overBudgetWarning({ name: tokenDoc.name ?? budget.actor.name, feet, budget: budget.budget, actions: budget.actions });
  if (text) globalThis.ui.notifications.warn(text);
}

export function registerMovementBandHooks() {
  // A migration write that moves a token is not the creature's own movement
  Hooks.on('moveToken', (tokenDoc, movement, operation) => (isMigrationWrite(operation) ? undefined : onMovementBandsTokenMove(tokenDoc, movement)));
}
