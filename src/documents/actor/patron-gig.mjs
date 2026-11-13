/**
 * A patron-booked gig (core rulebook p. 316): the Bard performs for an hour with a Skill and the GM pays it from the
 * check card: Rank x (10 + Floor + a GM modifier) x the degree, less the venue's cut, which the patron keeps and which
 * counts toward the termination fee. Permissive adjudication: a patron who is not active, or a second payment, each ask a
 * Rule Break.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { confirmRuleBreak, markRuleBreak } from '../../utils/rule-break.mjs';
import { COG_OUTCOME_CONFIG } from '../session/roll-outcomes.mjs';
import { readCheckRecord, effectiveCheck, outcomeIdOf } from '../../utils/roll/check-assists.mjs';
import { GIG_HOURS, gigPayout } from '../../utils/patron/gig.mjs';
import { patronageOf } from '../../utils/patron/patronage-state.mjs';
import { effectiveFloor } from '../../utils/character/race-class-floor.mjs';
import { postPatronCard } from '../../chat/patron-card.mjs';
import { writePatronage } from './patronage.mjs';
import { decrementFloorTimer } from './actor-environment.mjs';
import { say, notify } from './vehicle-drive-common.mjs';

/** The message flag set once a gig card has been paid. */
export const GIG_PAID_FLAG = 'patronGigPaid';

const canWrite = (actor) => Boolean(globalThis.game?.user?.isGM || actor?.testUserPermission?.(globalThis.game?.user, 'OWNER'));

/**
 * Perform a gig (the owner or the GM): roll the Skill with the gig reference, then take the hour off the Floor clock. A
 * cancelled roll (a gate or its dialog) spends nothing. A patron who is not active asks a Rule Break first.
 * @param {object} actor the Bard
 * @param {object} item the embedded patron or deity item
 * @param {object} skill an owned Skill item
 * @param {{ options?: object }} [p] `options.ruleBreak: true` pre-confirms
 * @returns {Promise<{ ok: boolean, ruleBreak?: boolean, reason?: string }>}
 */
export async function performGig(actor, item, skill, { options } = {}) {
  if (!item || !skill || !canWrite(actor)) return { ok: false, reason: 'no-access' };
  let ruleBreak = false;
  if (patronageOf(item).status !== 'patron') {
    const answer = await confirmRuleBreak({
      title: say('COG.Patron.Gig.Title', 'Gig'),
      message: say('COG.Patron.Gig.NotPatron', '{patron} is not {actor}\'s patron, so books no performances (p. 316). Perform anyway as a Rule Break?', { patron: item.name, actor: actor.name }),
      options
    });
    if (!answer.confirmed) return { ok: false, reason: answer.refusal ?? 'cancelled' };
    ruleBreak = true;
  }
  const message = await actor.rollSkill(skill, { patron: { kind: 'gig', itemId: item.id } });
  if (!message) return { ok: false, reason: 'not-rolled' };
  await decrementFloorTimer(GIG_HOURS, { actorUuid: actor.uuid });
  if (ruleBreak) await markRuleBreak(item);
  return { ok: true, ruleBreak };
}

/**
 * Pay a gig card (GM only): the card's effective degree (rerolls and assists count; a pending card takes `dc`) through
 * `gigPayout`; the net goes to the Bard's gold, the cut to the patron's `earned`; the card is flagged paid and one card
 * posted. A second payment asks a Rule Break. A patron since quit or dead is still paid.
 * @param {ChatMessage} message a skill check card whose record carries a patron ref of kind `gig`
 * @param {{ modifier?: number, dc?: number|null, options?: object }} [p] the GM's modifier (p. 316) and a pending card's Difficulty
 * @returns {Promise<{ ok: boolean, reason?: string, payout?: object }>}
 */
export async function payGig(message, { modifier = 0, dc = null, options } = {}) {
  if (!globalThis.game?.user?.isGM) return { ok: false, reason: 'gm-only' };
  const record = readCheckRecord(message);
  const ref = record?.patron;
  if (!record || ref?.kind !== 'gig') return { ok: false, reason: 'not-gig' };
  const actor = globalThis.fromUuidSync?.(record.rollerUuid) ?? null;
  const item = actor?.items.get(ref.itemId) ?? null;
  if (!actor || !item) return { ok: false, reason: 'no-patron' };
  const data = { patron: item.name, actor: actor.name };
  if (message.flags?.[SYSTEM_ID]?.[GIG_PAID_FLAG]) {
    const answer = await confirmRuleBreak({
      title: say('COG.Patron.Gig.Title', 'Gig'),
      message: say('COG.Patron.Gig.PaidAsk', 'This gig is already paid. Pay it again as a Rule Break?', data),
      options
    });
    if (!answer.confirmed) return { ok: false, reason: answer.refusal ?? 'cancelled' };
  }
  const eff = effectiveCheck(record);
  let outcome = eff.outcome;
  if (eff.pending) {
    if (dc === null || dc === undefined || dc === '' || !Number.isFinite(Number(dc))) return { ok: false, reason: 'no-difficulty' };
    outcome = outcomeIdOf(eff.total, Math.max(0, Math.trunc(Number(dc))), record.d20);
  }
  const payout = gigPayout({ rank: ref.rank, floor: effectiveFloor(actor), modifier, outcome });
  if (!payout) return { ok: false, reason: 'pending' };
  const gold = Number(actor.system?.currency?.gold) || 0;
  await actor.update({ 'system.currency.gold': gold + payout.net });
  await writePatronage(item, { earned: patronageOf(item).earned + payout.cut });
  await message.update({ [`flags.${SYSTEM_ID}.${GIG_PAID_FLAG}`]: { net: payout.net, gross: payout.gross, cut: payout.cut, outcome } });
  await postPatronCard(actor, {
    title: say('COG.Patron.Gig.CardTitle', 'Gig: {patron}', data),
    icon: 'fa-sack-dollar',
    audience: 'all',
    lines: [{
      text: say('COG.Patron.Gig.Paid', 'Gig paid: {gross} gold ({net} to {actor}, {cut} to {patron})', { ...data, gross: payout.gross, net: payout.net, cut: payout.cut })
        + ` ${COG_OUTCOME_CONFIG[outcome]?.label ?? outcome}.`
    }]
  });
  notify('info', say('COG.Patron.Gig.PaidNotice', '{patron}\'s gig paid {net} gold.', { ...data, net: payout.net }));
  return { ok: true, payout };
}
