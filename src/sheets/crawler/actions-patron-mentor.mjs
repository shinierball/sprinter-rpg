/**
 * Patron mentor, quest and ideas buttons on the crawler sheet (core rulebook pp. 316-317). Each handler runs with `this`
 * bound to the sheet, reads the row's `data-item-id` and calls the patron benefits; the engine asks any Rule Break itself.
 */
import { rowItem } from './dom.mjs';
import { mentor, mentorChoices, addPatronQuest, postPatronIdeas } from '../../documents/actor/patron-benefits.mjs';
import { say, notify } from '../../documents/actor/vehicle-drive-common.mjs';
import { isPatronItem } from '../../utils/document-types.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';

const patronRow = (sheet, target) => {
  const item = rowItem(sheet, target);
  return isPatronItem(item) ? item : null;
};

/** Ask which Skill the patron mentors: a select of the offered rows (a Spell is marked). Null when closed. */
async function pickMentorSkill(item, rows) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.wait !== 'function') return null;
  const spell = say('COG.Patron.Mentor.SpellMark', '(Spell, a Rule Break)');
  const options = rows.map((r) => `<option value="${escapeAttr(r.identifier)}">${escapeAttr(r.name)}${r.ruleBreak ? ` ${escapeAttr(spell)}` : ''}</option>`).join('');
  const picked = await DialogV2.wait({
    window: { title: say('COG.Patron.Mentor.Title', 'Mentor') },
    content: `<div class="form-group"><label>${escapeAttr(say('COG.Patron.Mentor.Pick', 'What does {patron} teach?', { patron: item.name }))}</label><select name="skill">${options}</select></div>`,
    buttons: [
      { action: 'mentor', label: say('COG.Patron.Mentor.Button', 'Mentor (1 hour)'), default: true, callback: (event, button) => button.form?.elements?.skill?.value ?? null },
      { action: 'cancel', label: say('COG.Patron.Mentor.Cancel', 'Cancel') }
    ],
    rejectClose: false,
    modal: true
  });
  return picked && picked !== 'cancel' ? picked : null;
}

/** One labelled text input or textarea of the quest form. */
const field = (name, key, fallback, multiline = false) => `<div class="form-group"><label>${escapeAttr(say(key, fallback))}</label>${multiline ? `<textarea name="${name}"></textarea>` : `<input type="text" name="${name}">`}</div>`;

/** The quest form: title, reward, description. Null when cancelled. */
async function askQuest() {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.prompt !== 'function') return null;
  const result = await DialogV2.prompt({
    window: { title: say('COG.Patron.Quest.Title', 'Patron quest') },
    content: field('title', 'COG.Patron.Quest.FieldTitle', 'Quest') + field('reward', 'COG.Patron.Quest.FieldReward', 'Reward') + field('description', 'COG.Patron.Quest.FieldDescription', 'Details', true),
    ok: {
      label: say('COG.Patron.Quest.Add', 'Set the quest'),
      callback: (event, button) => {
        const els = button.form?.elements;
        return { title: String(els?.title?.value ?? '').trim(), reward: String(els?.reward?.value ?? '').trim(), description: String(els?.description?.value ?? '').trim() };
      }
    },
    rejectClose: false,
    modal: true
  });
  return result && typeof result === 'object' ? result : null;
}

export const PATRON_MENTOR_ACTIONS = {
  /** The owner has the patron teach a Skill: a pick from what the Bard lacks or holds at Rank 0. */
  async patronMentor(event, target) {
    const item = patronRow(this, target);
    if (!item || !this.isEditable) return;
    const rows = mentorChoices(this.actor, item).filter((r) => r.offered);
    if (!rows.length) {
      notify('info', say('COG.Patron.Mentor.Nothing', '{patron} has nothing left to teach {actor}.', { patron: item.name, actor: this.actor.name }));
      return;
    }
    const identifier = await pickMentorSkill(item, rows);
    if (identifier) await mentor(this.actor, item, identifier);
  },

  /** The GM sets the Bard a quest from the patron. */
  async patronQuest(event, target) {
    const item = patronRow(this, target);
    if (!item || !this.isEditable) return;
    const quest = await askQuest();
    if (quest) await addPatronQuest(this.actor, item, quest);
  },

  /** The GM posts the patron's ideas card. */
  async patronIdeas(event, target) {
    const item = patronRow(this, target);
    if (item && this.isEditable) await postPatronIdeas(this.actor, item);
  }
};
