/**
 * The zero-zone Rule Break gate. Inside a zero zone a crawler's enhancements are offline: using an item, casting a
 * spell or attacking asks a Rule Break (never a block, GEMINI rule 2) and the card records `zeroZoneRuleBreak`.
 *
 * Only player-controlled crawlers are asked: `actor.hasPlayerOwner` (some non-GM user owns the actor), read from the
 * document and not from who clicked. A GM running their own NPCs or mobs is never prompted; a GM who clicks for a
 * player-owned crawler is, with wording that may name the zone. Players never see the words "zero zone".
 */
import { confirmRuleBreak, RULE_BREAK_REFUSALS } from '../../utils/rule-break.mjs';
import { isZeroZoneSubject, zeroZoneFor } from '../../utils/effects/zero-zone.mjs';

const NO_FLAGS = Object.freeze({});

/** What a gate that does not ask returns. */
export const ZERO_ZONE_CLEAR = Object.freeze({ proceed: true, ruleBreak: false, flags: NO_FLAGS });

/** Localized text with an English fallback for a client that has not loaded the language file. */
function text(key, data, fallback) {
  const i18n = globalThis.game?.i18n;
  const out = data ? i18n?.format?.(key, data) : i18n?.localize?.(key);
  if (typeof out === 'string' && out && out !== key) return out;
  return Object.entries(data ?? {}).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), fallback);
}

/** Player-controlled by structured data: a non-GM user owns the actor. */
export function isPlayerControlled(actor) {
  return actor?.hasPlayerOwner === true;
}

/**
 * The tokens that decide an actor's zone. Never `actor.getActiveTokens()`: it follows the scene each client views, so two
 * clients could disagree. An unlinked actor is its own token; a linked one reads its tokens on the active scene.
 */
export function zoneTokensOf(actor) {
  try {
    if (actor?.isToken && actor.token) return [actor.token];
    const scenes = globalThis.game?.scenes?.active;
    if (typeof actor?.getDependentTokens !== 'function' || !scenes) return [];
    return actor.getDependentTokens({ scenes });
  } catch {
    return [];
  }
}

/**
 * Synchronous: does a zero zone ask this actor now? Callers await `gateZeroZone` only when it does, so an ordinary use
 * keeps reaching its later gates (cooldown, range) in the same tick.
 * @param {Actor} actor
 * @param {object} [options] `zeroZoneChecked` skips
 * @returns {boolean}
 */
export function zeroZoneApplies(actor, options = {}) {
  if (options?.zeroZoneChecked === true) return false;
  if (!isZeroZoneSubject(actor) || !isPlayerControlled(actor)) return false;
  return zeroZoneFor(actor, { tokens: zoneTokensOf(actor) }).active;
}

/**
 * @param {Actor} actor who acts
 * @param {Item} item what they use, cast or attack with
 * @param {object} [params]
 * @param {string} [params.verb='Use'] 'Use', 'Cast' or 'Attack with' (the prompt reads "<verb> <name> anyway")
 * @param {object} [params.options] `zeroZoneChecked` skips; `ruleBreak` / `interactive` pass to `confirmRuleBreak`
 * @returns {Promise<{ proceed: boolean, ruleBreak: boolean, flags: object, refusal?: string }>}
 */
export async function gateZeroZone(actor, item, { verb = 'Use', options = {} } = {}) {
  if (!zeroZoneApplies(actor, options)) return ZERO_ZONE_CLEAR;

  const name = item?.name || 'Item';
  const asGM = globalThis.game?.user?.isGM === true;
  const notice = text('COG.Hud.ZoneNotice', null, 'Your interface isn\'t responding.');
  const message = asGM
    ? text('COG.ZeroZoneGate.GMPrompt', { name, verb }, `${name}: zero zone, enhancements are offline. ${verb} it anyway as a Rule Break?`)
    : text('COG.ZeroZoneGate.PlayerPrompt', { notice, verb, name }, `${notice} ${verb} ${name} anyway as a Rule Break?`);
  const res = await confirmRuleBreak({
    title: asGM ? text('COG.ZeroZoneGate.GMTitle', null, 'Zero Zone') : text('COG.ZeroZoneGate.PlayerTitle', null, 'Interface'),
    message,
    reason: asGM ? message : notice,
    options
  });
  if (!res.confirmed) {
    if (res.refusal === RULE_BREAK_REFUSALS.POLICY) globalThis.ui?.notifications?.warn?.(asGM ? message : notice);
    return { proceed: false, ruleBreak: false, flags: NO_FLAGS, refusal: res.refusal };
  }
  return { proceed: true, ruleBreak: true, flags: { ruleBreak: true, zeroZoneRuleBreak: true } };
}
