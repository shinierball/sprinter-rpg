/**
 * "Roll Evade" chat button on an incoming attack card.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { parseRollContext } from '../../utils/roll/roll-context.mjs';
import { getCurrentFloor } from '../../documents/actor/actor-environment.mjs';
import { appliedBeforeEvade, listEvadesFor, classifyNextEvade } from '../../utils/attack/evade-link.mjs';
import { getDamageApplications } from '../damage-applications.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { mobAttackText } from '../../utils/combat/declared-attacks.mjs';
import { recordEvadeOnDeclaration } from '../../documents/combat-declarations.mjs';
import { COG_ACTION_TYPES } from '../../documents/combat/action-ledger.mjs';
import { isOutOfRangeOnMessage, rangeText } from '../../utils/attack/attack-range.mjs';
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
    content: `<p>${hint}</p>`,
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

/** The Evade interrupt entry an Evade roll on a declared attack records as the evader's Action. */
const EVADE_INTERRUPT = Object.freeze({ ...COG_ACTION_TYPES.evade, name: COG_ACTION_TYPES.evade.label, type: 'action', isFree: false, actionCost: 1 });
/** The free Evade a disadvantaged mob attack gives (E6.10): recorded, but no Action is spent. */
const EVADE_INTERRUPT_FREE = Object.freeze({ ...EVADE_INTERRUPT, isFree: true, actionCost: 0 });

/**
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message
 */
export async function handleRollEvade(event, button, message) {
  const attackerName = button.dataset?.attackerName || 'Attacker';
  const targetDC = button.dataset?.targetDc !== undefined && button.dataset?.targetDc !== ''
    ? Number(button.dataset.targetDc)
    : (button.dataset?.attackTotal !== undefined && button.dataset?.attackTotal !== '' ? Number(button.dataset.attackTotal) : undefined);
  const attackTotal = targetDC;
  const floor = Number(button.dataset?.floor) || getCurrentFloor();
  const isArea = button.dataset?.isArea === 'true' || button.dataset?.isArea === true;

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
    const disadvantaged = attackCard?.flags?.[SYSTEM_ID]?.mobAdvantage?.mode === 'disadvantage';
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
    const evadeMessage = await crawler.rollEvade({
      targetDC, attackTotal, attackerName, floor, isArea, attackMessageId, appliedBefore,
      ...(ruleBreak ? { ruleBreak } : {}),
      ...(kind === 'free' ? { freeEvade: true } : {}),
      ...(rollContext ? { rollContext } : {})
    });
    // On a declared mob attack the Evade spends the crawler's Interrupt Action and lands on the declaration.
    await recordEvadeOnDeclaration(crawler, evadeMessage, attackMessageId, { ruleBreak, interrupt: kind === 'free' ? EVADE_INTERRUPT_FREE : EVADE_INTERRUPT });
    return evadeMessage;
  }
}
