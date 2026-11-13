/**
 * Buff activation windows, the write half (D3). A buff with `system.activation.enabled` applies only inside a window:
 * Use gates the cooldown (a Rule Break when spent), records the use and opens it; the window closes by the clock, at
 * combat end, after N uses or hits, or by End. Reads are `utils/effects/activation-window.mjs` (and the one suppression
 * predicate, `isBuffSuppressed`); the arithmetic is `utils/effects/activation-plan.mjs`.
 */
import { isActiveGM } from '../../utils/gm-relay.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { ACTIVATION_RECORD_KEY, activationOf, isEventUnit } from '../../utils/effects/activation-window.mjs';
import { closePatch, isDueToClose, openPatch, spendPatch } from '../../utils/effects/activation-plan.mjs';
import { activationWindowPhrase } from '../../utils/effects/activation-text.mjs';
import { isBuffSuppressed } from '../../utils/effects/dispel.mjs';
import { matchesTagQuery } from '../../utils/tag/tag-query.mjs';
import { cardMessageOptions } from '../../utils/card/chat-mode.mjs';
import { getItemAllTags } from '../active-tags.mjs';
import { currentTimeContext } from './dungeon-time.mjs';
import { gateItemCooldown } from './cooldown-gate.mjs';
import { registerExpirySource, sweepActors } from './duration-expiry.mjs';
import { notify, say, speakerOf } from './vehicle-drive-common.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';

const asArray = (list) => (Array.isArray(list) ? list : Array.from(list?.values?.() ?? list ?? []));

/** The state fields of a patch as the item update's dotted paths. */
const statePaths = (patch) => Object.fromEntries(Object.entries(patch).map(([key, value]) => [`system.activation.${key}`, value]));

/** The actor's activated buffs whose window is open. */
function openWindows(actor) {
  return asArray(actor?.items).filter((item) => {
    if (item?.type !== 'buff') return false;
    const activation = activationOf(item);
    return activation.enabled && activation.open;
  });
}

const itemOf = (actor, buff) => (typeof buff === 'string' ? actor?.items?.get(buff) : buff) ?? null;

/**
 * Use an activated buff: open its window. Already open is a no-op success (no second use). A buff withheld for another
 * reason (dispel, a lapsed god, a smite, a zero zone) cannot take effect, so nothing is spent. A spent cooldown asks a
 * Rule Break (permissive adjudication); Cancel writes nothing.
 * @param {Actor} actor the owner
 * @param {Item|string} buff the owned buff, or its id
 * @param {{ options?: object }} [params] `options` is passed to the Rule Break confirmation
 * @returns {Promise<{ ok: boolean, ruleBreak: boolean, reason?: string }>}
 */
export async function useBuffActivation(actor, buff, { options } = {}) {
  const item = itemOf(actor, buff);
  const activation = activationOf(item);
  if (!item || item.type !== 'buff' || !activation.enabled) return { ok: false, ruleBreak: false, reason: 'not-activatable' };
  if (activation.open) return { ok: true, ruleBreak: false };
  if (isBuffSuppressed(actor, item, { ignoreWindow: true })) {
    notify('warn', say('COG.Activation.Suppressed', '{buff} cannot take effect right now.', { buff: item.name }));
    return { ok: false, ruleBreak: false, reason: 'suppressed' };
  }

  const gate = await gateItemCooldown(actor, item, { key: ACTIVATION_RECORD_KEY, grantRow: { cooldown: activation.cooldown }, options });
  if (!gate.proceed) return { ok: false, ruleBreak: false, reason: 'cancelled' };
  await gate.commit();

  const now = currentTimeContext(actor);
  await item.update(statePaths(openPatch(activation, { now: now.time, combatId: now.combat?.id ?? '' })));
  await globalThis.ChatMessage?.create?.({
    speaker: speakerOf(actor),
    content: `<div class="cog-chat-card"><div class="cog-text-secondary">${escapeAttr(say('COG.Activation.Used', '{actor} uses {buff} {window}.', { actor: actor.name, buff: item.name, window: activationWindowPhrase(activation, say, 'COG.Activation.') }))}</div></div>`,
    flags: { [SYSTEM_ID]: { buffActivation: item.id } }
  }, cardMessageOptions(actor));
  return { ok: true, ruleBreak: gate.ruleBreak };
}

/**
 * End a buff's window by hand (the window closes; the cooldown record stays).
 * @param {Actor} actor
 * @param {Item|string} buff
 * @returns {Promise<{ ok: boolean }>}
 */
export async function endBuffActivation(actor, buff) {
  const item = itemOf(actor, buff);
  if (!item || !activationOf(item).enabled) return { ok: false };
  await item.update(statePaths(closePatch()));
  return { ok: true };
}

/**
 * Count a use (or a hit) against the actor's open windows of that kind. `matched` is the window's `query` against the
 * union of the used items' tags (null query: any). A window spent by the use before closes first. Await it before the
 * use reads ranks or rows, so a window that has just closed no longer applies to this one. `settleOnly` closes
 * the spent windows and spends nothing (a use that may still be cancelled calls it early, then spends once it proceeds).
 * @param {Actor} actor
 * @param {Item[]} usedItems what is being used (empty for a hit)
 * @param {{ event?: 'use'|'hit', settleOnly?: boolean }} [params]
 * @returns {Promise<number>} how many windows were written
 */
export async function spendActivationUses(actor, usedItems, { event = 'use', settleOnly = false } = {}) {
  let written = 0;
  const windows = openWindows(actor).filter((item) => activationOf(item).window.unit === event && isEventUnit(event));
  if (!windows.length) return written;
  const tags = new Set();
  for (const used of usedItems ?? []) for (const tag of getItemAllTags(used)) tags.add(tag);
  const now = currentTimeContext(actor).time;
  for (const item of windows) {
    const activation = activationOf(item);
    if (settleOnly && activation.usesLeft > 0) continue;
    const patch = spendPatch(activation, { now, matched: matchesTagQuery(tags, activation.window.query) });
    if (!patch) continue;
    await item.update(statePaths(patch));
    written += 1;
  }
  return written;
}

/** The `'activation'` expiry source: every open window whose stamped end has been reached, on any actor. */
const activationExpirySource = {
  collect: (now) => sweepActors().flatMap((actor) => openWindows(actor)
    .filter((item) => isDueToClose(activationOf(item), now))
    .map((item) => ({
      label: item.name || 'Buff',
      actorName: actor.name ?? '',
      expire: () => item.update(statePaths(closePatch()))
    })))
};
registerExpirySource('activation', activationExpirySource);

/**
 * `deleteCombat`: close every open `combat` window that belongs to the ended combat (or to none).
 * @param {{ id?: string }} combat
 * @returns {Promise<number>} how many windows were closed
 */
async function closeCombatWindows(combat) {
  let closed = 0;
  for (const actor of sweepActors()) {
    for (const item of openWindows(actor)) {
      const activation = activationOf(item);
      if (activation.window.unit !== 'combat' || (activation.combatId && activation.combatId !== combat?.id)) continue;
      await item.update(statePaths(closePatch()));
      closed += 1;
    }
  }
  return closed;
}

let hooked = false;
/** Register the combat-end close (active GM only at run time). Once, from the ready hook. */
export function registerActivationHooks() {
  if (hooked) return;
  hooked = true;
  globalThis.Hooks?.on?.('deleteCombat', (combat) => { if (isActiveGM()) return closeCombatWindows(combat); });
}
