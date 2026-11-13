/**
 * The gig card button (core rulebook p. 316): [Pay gig] (`crawlerPatronGig`, GM only). A dialog takes the GM's modifier
 * and, for a card still pending, the Difficulty, then `payGig` pays it.
 */
import { payGig } from '../../documents/actor/patron-gig.mjs';
import { readCheckRecord, effectiveCheck } from '../../utils/roll/check-assists.mjs';
import { gigPayout } from '../../utils/patron/gig.mjs';
import { effectiveFloor } from '../../utils/character/race-class-floor.mjs';
import { COG_OUTCOME_CONFIG } from '../../documents/session/roll-outcomes.mjs';
import { say } from '../../documents/actor/vehicle-drive-common.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';

/** The dialog: modifier (default 0), the Difficulty when pending, and the figures at modifier 0. Null when cancelled. */
async function askPayment(record, actor) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.wait !== 'function') return null;
  const eff = effectiveCheck(record);
  const floor = effectiveFloor(actor);
  const rank = record.patron.rank;
  const base = eff.pending ? null : gigPayout({ rank, floor, modifier: 0, outcome: eff.outcome });
  const figures = base
    ? say('COG.Patron.Gig.Figures', 'Rank {rank}, Floor {floor}, {outcome}: {gross} gold ({net} to the Bard, {cut} to the patron) before the modifier.',
      { rank, floor, outcome: COG_OUTCOME_CONFIG[eff.outcome]?.label ?? eff.outcome, gross: base.gross, net: base.net, cut: base.cut })
    : say('COG.Patron.Gig.Pending', 'Rank {rank}, Floor {floor}: set the Difficulty to judge the check.', { rank, floor });
  const dcField = base
    ? ''
    : `<div class="form-group"><label>${escapeAttr(say('COG.Patron.Gig.Difficulty', 'Difficulty'))}</label><input type="number" name="dc" min="0" step="1" value="" /></div>`;
  const answer = await DialogV2.wait({
    window: { title: say('COG.Patron.Gig.PayTitle', 'Pay gig') },
    content: `<p>${escapeAttr(figures)}</p>
      <div class="form-group"><label>${escapeAttr(say('COG.Patron.Gig.Modifier', 'Modifier (audience, fame and the patron\'s influence)'))}</label><input type="number" name="modifier" step="1" value="0" /></div>${dcField}`,
    buttons: [
      {
        action: 'pay', label: say('COG.Patron.Gig.Pay', 'Pay gig'), default: true,
        callback: (event, button) => ({ modifier: button.form?.elements?.modifier?.value ?? '0', dc: button.form?.elements?.dc?.value ?? '' })
      },
      { action: 'cancel', label: say('COG.Patron.Gig.Cancel', 'Cancel') }
    ],
    rejectClose: false,
    modal: true
  });
  return answer && typeof answer === 'object' ? answer : null;
}

/** @param {HTMLElement} button on a skill check card whose record carries a gig ref */
export async function handlePatronGig(event, button, message) {
  if (!globalThis.game?.user?.isGM) return null;
  const record = readCheckRecord(message);
  if (record?.patron?.kind !== 'gig') return null;
  const actor = globalThis.fromUuidSync?.(record.rollerUuid) ?? null;
  if (!actor) return null;
  const answer = await askPayment(record, actor);
  if (!answer) return null;
  const modifier = Number.isFinite(Number(answer.modifier)) ? Math.trunc(Number(answer.modifier)) : 0;
  const dc = answer.dc === '' || !Number.isFinite(Number(answer.dc)) ? null : Math.max(0, Math.trunc(Number(answer.dc)));
  return payGig(message, { modifier, dc });
}
