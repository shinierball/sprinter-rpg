/**
 * "Roll Evade" chat button on an incoming attack card.
 */
import { parseRollContext } from '../../utils/roll/roll-context.mjs';
import { getCurrentFloor } from '../../documents/actor/actor-environment.mjs';
import { appliedBeforeEvade, listEvadesFor, classifyNextEvade } from '../../utils/attack/evade-link.mjs';
import { getDamageApplications } from '../damage-applications.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { gateActionBlock, actionBlockApplies } from '../../documents/actor/action-block.mjs';
import { mobTargetDifficulty, isForcedAttacker } from '../../documents/actor/attack-targets.mjs';
import { mobAttackText } from '../../utils/combat/declared-attacks.mjs';
import { attackerIdOf, mobAdvantageOf, targetResultsOf } from '../../utils/combat/card-flags.mjs';
import { recordEvade, evadeCoveredFor } from '../../documents/combat-declarations.mjs';
import { COG_ACTION_TYPES } from '../../documents/combat/action-ledger.mjs';
import { isOutOfRangeOnMessage, rangeText } from '../../utils/attack/attack-range.mjs';
import { recordAttackTotal } from '../../utils/roll/check-assists.mjs';
import { parseMessageContent } from '../chat-relay.mjs';

const crawlerOf = (token) => (token?.actor?.type === 'crawler' ? token.actor : null);

/**
 * The crawler a click acts for (E6.4): the controlled token's, else the targeted token's, else the user's assigned
 * character, else the only crawler the user owns, else a picker over the crawlers they own. Never a silent default
 * among several (a GM owns every crawler), and never a block: closing the picker is the only way to act for no one.
 * @param {{ title: string, hint: string, none: string }} text the picker's title and line, and the no-crawler warning
 * @returns {Promise<Actor|null>}
 */
export async function resolveActingCrawler({ title, hint, none }) {
  const controlled = Array.from(canvas?.tokens?.controlled ?? []).map(crawlerOf).find(Boolean);
  if (controlled) return controlled;
  const targeted = Array.from(game.user?.targets ?? []).map(crawlerOf).find(Boolean);
  if (targeted) return targeted;
  const character = game.user?.character;
  if (character?.type === 'crawler') return character;
  const actors = game.actors ? Array.from(game.actors.values()) : [];
  const owned = actors.filter(a => a.type === 'crawler' && a.isOwner);
  if (!owned.length) ui.notifications?.warn(none);
  if (owned.length <= 1) return owned[0] ?? null;
  const picked = await foundry.applications.api.DialogV2.wait({
    window: { title },
    content: `<p>${escapeAttr(hint)}</p>`,
    buttons: owned.map(a => ({ action: a.id, label: a.name })),
    rejectClose: false
  });
  return owned.find(a => a.id === picked) ?? null;
}

/** The crawler a Roll Evade click rolls for (see resolveActingCrawler). */
export function resolveEvadingCrawler() {
  return resolveActingCrawler({
    title: 'Roll Evade for which crawler?',
    hint: 'No crawler is selected or targeted. Choose who rolls the Evade.',
    none: 'Sprinter RPG | Please select or assign a Crawler character to roll Evade!'
  });
}

/** A button's named evader (a redirected attack's Taunter), when this user may roll for them. */
function namedEvader(button) {
  const actor = resolveActorByUuid(button.dataset?.evaderUuid);
  return actor && (game.user?.isGM || actor.isOwner) ? actor : null;
}

/**
 * The attack context the attack card's own Evade button carries (`data-roll-context`), or null. A Taunter's Evade
 * button sits on the interrupt card, so it reads the context from the original attack card: the same one the original
 * target's Evade gets (attacker tags, the attack's own tags).
 */
function attackCardRollContext(attackCard) {
  if (typeof attackCard?.content !== 'string' || !attackCard.content || typeof globalThis.DOMParser !== 'function') return null;
  const doc = parseMessageContent(attackCard.content);
  const own = [...doc.querySelectorAll('[data-action]')].find(b => b.dataset.action === 'crawlerRollEvade' && b.dataset.rollContext);
  return own ? parseRollContext(own.dataset.rollContext) : null;
}

/**
 * The Opposed row an attack card stored for this evader (`pvp: true`, core p. 87): its `targetDC` is the attack total plus
 * that target's own row bonus. Null when the card has none.
 * @param {ChatMessage|null} attackCard
 * @param {Actor} evader
 * @returns {object|null}
 */
function opposedRowFor(attackCard, evader) {
  const rows = targetResultsOf(attackCard);
  if (!Array.isArray(rows)) return null;
  return rows.find((r) => r?.pvp === true && r.actorId === evader?.id) ?? null;
}

/** The Evade interrupt entry an Evade roll on a declared attack records as the evader's Action. */
const EVADE_INTERRUPT = Object.freeze({ ...COG_ACTION_TYPES.evade, name: COG_ACTION_TYPES.evade.label, type: 'action', isFree: false, actionCost: 1 });
/** The free Evade a disadvantaged mob attack gives (E6.10): recorded, but no Action is spent. */
const EVADE_INTERRUPT_FREE = Object.freeze({ ...EVADE_INTERRUPT, isFree: true, actionCost: 0 });

/**
 * The crawler sheet's Evade button (no attack card): roll the Evade and, in combat, spend the round's Evade Action. An
 * Evade already covered this round is rolled without a new Action or a second "cannot take Actions" ask.
 * @param {Actor} actor
 */
export async function rollSheetEvade(actor) {
  const covered = evadeCoveredFor(actor, null);
  // Asked once here, so the ledger does not ask a second time (as on the attack card).
  let ruleBreak = false;
  if (!covered && actionBlockApplies(actor, 'evade')) {
    const blockGate = await gateActionBlock(actor, 'evade');
    if (!blockGate.proceed) return null;
    ruleBreak = blockGate.ruleBreak === true;
  }
  const evadeMessage = await actor.rollEvade({
    actionBlockChecked: true,
    ...(ruleBreak ? { ruleBreak } : {}),
    ...(covered ? { evadeActionSpent: true } : {})
  });
  if (evadeMessage) await recordEvade(actor, evadeMessage, null, { ruleBreak, interrupt: EVADE_INTERRUPT });
  return evadeMessage;
}

/**
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message
 */
export async function handleRollEvade(event, button, message) {
  const attackerName = button.dataset?.attackerName || 'Attacker';
  let targetDC = button.dataset?.targetDc !== undefined && button.dataset?.targetDc !== ''
    ? Number(button.dataset.targetDc)
    : (button.dataset?.attackTotal !== undefined && button.dataset?.attackTotal !== '' ? Number(button.dataset.attackTotal) : undefined);
  let attackTotal = targetDC;
  const floor = Number(button.dataset?.floor) || getCurrentFloor();
  let isArea = button.dataset?.isArea === 'true' || button.dataset?.isArea === true;

  const crawler = namedEvader(button) ?? await resolveEvadingCrawler();
  if (!crawler) return;

  if (typeof crawler.rollEvade === 'function') {
    // The Evade names the attack message it answers, so the damage card's apply can find it (E6.3). A Taunter's
    // button sits on the interrupt card and names the original attack.
    const named = button.dataset?.attackMessageId;
    const attackMessageId = typeof named === 'string' && named
      ? named
      : (typeof message?.id === 'string' && message.id ? message.id : null);
    // The attack card fixes the mob's net state (E6.10): a Disadvantage attack gives one free Evade, and after a failed
    // free one a costed second Evade is not a Rule Break. The handler reads the card, never the button.
    const attackCard = attackMessageId ? game.messages?.get?.(attackMessageId) ?? null : null;
    // The attack's context (3.18): the clicked button's, else the attack card's own Evade button's (a Taunter's button).
    const rollContext = parseRollContext(button.dataset?.rollContext) ?? attackCardRollContext(attackCard);
    // The card's net Advantage plus what this crawler's own rows give attackers (Held, Take Down): this crawler's Difficulty.
    const cardState = mobAdvantageOf(attackCard);
    const attacker = game.actors?.get?.(attackerIdOf(attackCard)) ?? null;
    const own = mobTargetDifficulty(cardState, crawler, attacker, rollContext ?? []);
    const opposed = opposedRowFor(attackCard, crawler);
    if (opposed) {
      // The evader's own row: the card's current total (a reroll or an assist moved it) with this target's bonus, else the stored DC.
      const current = recordAttackTotal(attackCard, crawler.uuid);
      targetDC = current ?? Number(opposed.targetDC);
      attackTotal = targetDC;
      isArea = false;
    } else if (own) { targetDC = own.dc; attackTotal = own.dc; }
    else if (attackCard) {
      // A crawler's attack: the card's record holds the current total (a reroll or an assist moved it), not the button's.
      const current = recordAttackTotal(attackCard, crawler.uuid);
      if (current !== null) { targetDC = current; attackTotal = current; }
    }
    const disadvantaged = opposed ? isForcedAttacker(attacker) : (own ? own.disadvantaged : cardState?.mode === 'disadvantage');
    const prior = attackMessageId ? listEvadesFor(game.messages, { attackMessageId, targetUuid: crawler.uuid }) : [];
    const kind = classifyNextEvade({ disadvantaged, prior });
    // One Evade per attack (3.18): any other roll by the same crawler is a Rule Break (the latest one counts).
    let ruleBreak = false;
    if (kind === 'ruleBreak') {
      const verdict = await confirmRuleBreak({
        title: mobAttackText('COG.MobAttack.RuleBreakTitle'),
        message: mobAttackText('COG.MobAttack.EvadeTwice', { name: crawler.name })
      });
      if (!verdict.confirmed) return;
      ruleBreak = true;
    }
    // A target the attack could not reach (3.48-8) has nothing to Evade.
    if (attackCard && isOutOfRangeOnMessage(attackCard, crawler, crawler.token?.id ?? null)) {
      ui.notifications?.info(rangeText('COG.AttackRange.NoRoll', { name: crawler.name }));
      return;
    }
    const appliedBefore = attackMessageId
      ? appliedBeforeEvade(game.messages, { attackMessageId, evaderUuid: crawler.uuid, getApplications: getDamageApplications })
      : false;
    // One Evade Action covers the round (9.17): the Check is still rolled, the Action is not charged again.
    const covered = kind !== 'free' && evadeCoveredFor(crawler, attackMessageId);
    // A bearer who cannot take Actions asks before rolling; an Evade already covered this round is no new Action.
    if (!covered && actionBlockApplies(crawler, 'evade')) {
      const blockGate = await gateActionBlock(crawler, 'evade');
      if (!blockGate.proceed) return;
      if (blockGate.ruleBreak) ruleBreak = true;
    }
    const evadeMessage = await crawler.rollEvade({
      targetDC, attackTotal, attackerName, floor, isArea, attackMessageId, appliedBefore,
      ...(ruleBreak ? { ruleBreak } : {}),
      actionBlockChecked: true,
      ...(kind === 'free' ? { freeEvade: true } : {}),
      ...(covered ? { evadeActionSpent: true } : {}),
      ...(rollContext ? { rollContext } : {})
    });
    // In combat the Evade spends the crawler's Evade Action; on a declared mob attack it also lands on the declaration.
    await recordEvade(crawler, evadeMessage, attackMessageId, { ruleBreak, interrupt: kind === 'free' ? EVADE_INTERRUPT_FREE : EVADE_INTERRUPT });
    return evadeMessage;
  }
}
