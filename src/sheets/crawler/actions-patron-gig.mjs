/**
 * The [Perform] button on the crawler sheet's patron rows (core rulebook p. 316). The handler runs with `this` bound to the
 * sheet, reads the row's `data-item-id`, picks a Skill and calls `performGig`; the engine asks any Rule Break itself.
 */
import { rowItem } from './dom.mjs';
import { itemIdentifier } from '../../utils/identifier.mjs';
import { patronProfileOf } from '../../utils/patron/patron-profile.mjs';
import { performGig } from '../../documents/actor/patron-gig.mjs';
import { say } from '../../documents/actor/vehicle-drive-common.mjs';
import { isPatronItem } from '../../utils/document-types.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';

const patronRow = (sheet, target) => {
  const item = rowItem(sheet, target);
  return isPatronItem(item) ? item : null;
};

/** The owned Skills in the order the pick lists them: the patron's performance Skills first, then every other. */
function gigSkills(actor, item) {
  const performance = new Set(patronProfileOf(item).performanceSkills);
  const skills = Array.from(actor.items).filter((i) => i.type === 'skill');
  const mine = skills.filter((s) => performance.has(itemIdentifier(s)));
  return [...mine, ...skills.filter((s) => !performance.has(itemIdentifier(s)))];
}

/** Ask which Skill to perform with. Resolves the Skill item or null. */
async function pickSkill(actor, item) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  const skills = gigSkills(actor, item);
  if (typeof DialogV2?.wait !== 'function' || !skills.length) return null;
  const options = skills.map((s) => `<option value="${escapeAttr(s.id)}">${escapeAttr(s.name)}</option>`).join('');
  const id = await DialogV2.wait({
    window: { title: say('COG.Patron.Gig.Title', 'Gig') },
    content: `<div class="form-group"><label>${escapeAttr(say('COG.Patron.Gig.Pick', 'Perform for {patron} with', { patron: item.name }))}</label><select name="skill">${options}</select></div>`,
    buttons: [
      { action: 'perform', label: say('COG.Patron.Gig.Perform', 'Perform (1 hour)'), default: true, callback: (event, button) => button.form?.elements?.skill?.value ?? '' },
      { action: 'cancel', label: say('COG.Patron.Gig.Cancel', 'Cancel') }
    ],
    rejectClose: false,
    modal: true
  });
  return id && id !== 'cancel' ? actor.items.get(id) ?? null : null;
}

export const PATRON_GIG_ACTIONS = {
  /** [Perform] (the owner or the GM): pick a Skill, roll it for this patron and spend the hour. */
  async patronPerform(event, target) {
    const item = patronRow(this, target);
    if (!item || !this.isEditable) return;
    const skill = await pickSkill(this.actor, item);
    if (skill) await performGig(this.actor, item, skill);
  }
};
