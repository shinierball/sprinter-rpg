/**
 * The audition buttons on the crawler sheet's patron rows (core rulebook pp. 315-316). Each handler runs with `this` bound
 * to the sheet and reads the row's `data-item-id`; the dialogs gather the choices and the engine
 * (`documents/actor/patron-audition.mjs`) asks every Rule Break question itself.
 */
import { rowItem } from './dom.mjs';
import { itemIdentifier } from '../../utils/identifier.mjs';
import { PATRON_ATTITUDES, patronageOf } from '../../utils/patron/patronage-state.mjs';
import { patronCriteriaHtml } from '../../documents/actor/patronage.mjs';
import { auditionStartsOpposed, rollAuditionCheck, startAudition, undoAuditionCheck } from '../../documents/actor/patron-audition.mjs';
import { say } from '../../documents/actor/vehicle-drive-common.mjs';
import { isPatronItem } from '../../utils/document-types.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';

const t = (key, fallback, data) => say(`COG.Patron.Audition.${key}`, fallback, data);
const attitudeName = (attitude) => t(`Attitude.${attitude}`, attitude.charAt(0).toUpperCase() + attitude.slice(1));
const patronItem = (sheet, target) => {
  const item = rowItem(sheet, target);
  return isPatronItem(item) ? item : null;
};

/** The start dialog: attitude (Willing selected), the Difficulty and the criteria. Resolves `{ attitude, dc }` or null. */
function startDialog(actor, item) {
  const forced = auditionStartsOpposed(actor);
  const options = PATRON_ATTITUDES.map((a) => `<option value="${a}"${a === (forced ? 'opposed' : 'willing') ? ' selected' : ''}>${escapeAttr(attitudeName(a))}</option>`).join('');
  const content = `
    <p>${escapeAttr(t('Start.Intro', 'Start {actor}\'s audition for {patron}. Three checks, each with a different Skill.', { actor: actor.name, patron: item.name }))}</p>
    ${forced ? `<p class="cog-text-muted">${escapeAttr(t('Start.Forced', 'They killed their last patron, so this audition starts Opposed.'))}</p>` : ''}
    <label>${escapeAttr(t('Start.Attitude', 'Starting attitude'))} <select name="attitude"${forced ? ' disabled' : ''}>${options}</select></label>
    <label>${escapeAttr(t('Difficulty', 'Difficulty'))} <input type="number" name="dc" min="0" step="1" value="" /></label>
    ${patronCriteriaHtml(actor, item)}`;
  return foundry.applications.api.DialogV2.wait({
    window: { title: t('Start.Title', 'Start audition') },
    content,
    buttons: [
      {
        action: 'start', icon: 'fa-solid fa-microphone-lines', label: t('Start.Go', 'Start'), default: true,
        callback: (event, button) => ({ attitude: button.form.elements.attitude?.value || 'willing', dc: button.form.elements.dc?.value ?? '' })
      },
      { action: 'cancel', icon: 'fa-solid fa-xmark', label: t('Cancel', 'Cancel') }
    ],
    rejectClose: false
  });
}

/** The Skill pick: owned Skills, those already used in this audition marked "(used)". Resolves the Skill item or null. */
async function pickSkill(actor, item) {
  const used = new Set(patronageOf(item).audition.checks.map((c) => c.skill));
  const skills = Array.from(actor.items).filter((i) => i.type === 'skill');
  if (!skills.length) return null;
  const options = skills.map((s) => `<option value="${escapeAttr(s.id)}">${escapeAttr(s.name)}${used.has(itemIdentifier(s)) ? ` ${escapeAttr(t('Used', '(used)'))}` : ''}</option>`).join('');
  const id = await foundry.applications.api.DialogV2.wait({
    window: { title: t('Check.Title', 'Audition check') },
    content: `<label>${escapeAttr(t('Check.Skill', 'Skill'))} <select name="skill">${options}</select></label>`,
    buttons: [
      { action: 'roll', icon: 'fa-solid fa-dice-d20', label: t('Check.Roll', 'Roll'), default: true, callback: (event, button) => button.form.elements.skill?.value ?? '' },
      { action: 'cancel', icon: 'fa-solid fa-xmark', label: t('Cancel', 'Cancel') }
    ],
    rejectClose: false
  });
  return id && id !== 'cancel' ? actor.items.get(id) ?? null : null;
}

export const PATRON_AUDITION_ACTIONS = {
  /** [Audition] (GM): the start dialog, then the engine. */
  async patronAudition(event, target) {
    const item = patronItem(this, target);
    if (!item || !this.isEditable || !globalThis.game?.user?.isGM) return;
    const answer = await startDialog(this.actor, item);
    if (answer && answer !== 'cancel') await startAudition(this.actor, item, { attitude: answer.attitude, dc: answer.dc === '' ? null : answer.dc });
  },

  /** [Audition check] (the owner or the GM): pick a Skill and roll it for this patron. */
  async patronAuditionCheck(event, target) {
    const item = patronItem(this, target);
    if (!item || !this.isEditable) return;
    const skill = await pickSkill(this.actor, item);
    if (skill) await rollAuditionCheck(this.actor, item, skill);
  },

  /** [Undo last check] (GM). */
  async patronAuditionUndo(event, target) {
    const item = patronItem(this, target);
    if (item && this.isEditable) await undoAuditionCheck(this.actor, item);
  }
};
