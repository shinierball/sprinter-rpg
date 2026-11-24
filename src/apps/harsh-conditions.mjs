/**
 * The GM's Harsh Conditions dialog (core p. 76), opened from the floor clock HUD: pick a hazard, how far, and which of the
 * selected tokens it happens to; OK posts one card per ticked token. Today the one hazard is a fall; hunger and thirst
 * add entries to `HARSH_CONDITIONS` later and nothing else changes. Apps glue only: the rules are in `fall-damage.mjs`.
 */
import { postFallDamage } from '../documents/actor/fall-damage.mjs';
import { dialogAnswer } from '../utils/ui/dialog-answer.mjs';
import { escapeAttr } from '../utils/escape-attr.mjs';
import { isChecked } from '../utils/roll/roll-context.mjs';
import { langText } from '../utils/lang-text.mjs';

const text = langText({
  'COG.HarshConditions.DialogTitle': 'Harsh Conditions',
  'COG.HarshConditions.Hazard': 'Hazard',
  'COG.HarshConditions.Fall': 'Fall',
  'COG.HarshConditions.Feet': 'Feet fallen',
  'COG.HarshConditions.Fallers': 'Who',
  'COG.HarshConditions.Apply': 'Roll',
  'COG.HarshConditions.GmOnly': 'Only the GM can trigger a hazard.',
  'COG.HarshConditions.SelectToken': 'Select the token or tokens first.'
});

const notify = (level, key) => globalThis.ui?.notifications?.[level]?.(`Sprinter RPG | ${text(key)}`);

/** The hazards the dialog offers. `run(actor, answer)` posts one actor's card. */
const HARSH_CONDITIONS = Object.freeze([
  Object.freeze({ id: 'fall', labelKey: 'COG.HarshConditions.Fall', run: (actor, answer) => postFallDamage(actor, answer.feet) })
]);

/** The actors of the controlled tokens, one each by uuid. */
function controlledActors() {
  const seen = new Map();
  for (const token of globalThis.canvas?.tokens?.controlled ?? []) {
    const actor = token?.actor;
    if (actor?.uuid && !seen.has(actor.uuid)) seen.set(actor.uuid, actor);
  }
  return [...seen.values()];
}

/**
 * Ask the GM which hazard happens to which selected token, then post a card for each. GM only.
 * @returns {Promise<ChatMessage[]|null>} the posted cards, or null (not a GM, nothing selected, cancelled)
 */
export async function openHarshConditionsDialog() {
  if (!globalThis.game?.user?.isGM) { notify('warn', 'COG.HarshConditions.GmOnly'); return null; }
  const fallers = controlledActors();
  if (!fallers.length) { notify('warn', 'COG.HarshConditions.SelectToken'); return null; }
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.prompt !== 'function') return null;
  const hazardOptions = HARSH_CONDITIONS.map((h) => `<option value="${escapeAttr(h.id)}">${escapeAttr(text(h.labelKey))}</option>`).join('');
  const fallerRows = fallers.map((a) => `<label class="cog-party-pick"><input type="checkbox" name="faller" value="${escapeAttr(a.uuid)}" checked> ${escapeAttr(a.name)}</label>`).join('');
  const content = `<label>${escapeAttr(text('COG.HarshConditions.Hazard'))} <select name="hazard">${hazardOptions}</select></label>
    <label>${escapeAttr(text('COG.HarshConditions.Feet'))} <input type="number" name="feet" min="0" step="1" value="10"></label>
    <fieldset><legend>${escapeAttr(text('COG.HarshConditions.Fallers'))}</legend>${fallerRows}</fieldset>`;
  let answer;
  try {
    answer = dialogAnswer(await DialogV2.prompt({
      window: { title: text('COG.HarshConditions.DialogTitle') },
      content,
      ok: {
        label: text('COG.HarshConditions.Apply'),
        callback: (_event, button) => ({
          hazard: button?.form?.elements?.hazard?.value ?? '',
          feet: button?.form?.elements?.feet?.value ?? '',
          uuids: [...(button?.form?.querySelectorAll?.('input[name="faller"]') ?? [])].filter(isChecked).map((el) => el.getAttribute('value'))
        })
      },
      rejectClose: false,
      modal: true
    }));
  } catch {
    return null;
  }
  const hazard = HARSH_CONDITIONS.find((h) => h.id === answer?.hazard);
  if (!hazard) return null;
  const posted = [];
  for (const actor of fallers.filter((a) => answer.uuids.includes(a.uuid))) {
    const message = await hazard.run(actor, answer);
    if (message) posted.push(message);
  }
  return posted;
}
