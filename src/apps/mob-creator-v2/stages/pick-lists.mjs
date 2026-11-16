/**
 * The three actions the shared pick list (`templates/items/parts/pick-list.hbs`) names: an Add select, a custom entry's
 * button and a chip's remove link. A chip carries only its list key (`data-list`), so one handler per action routes by it:
 * the actor's tags on the Identity stage, a rider list of the attack card the control sits in on the Attacks stage.
 */
import { ATTACK_RIDER_LISTS } from '../../../data/mob-creator/draft.mjs';
import { MOB_CREATOR_V2_FORM } from '../form.mjs';

/** The pick list key of the actor's tags. */
export const TAG_LIST = 'actorTags';

/** The attack row a pick-list control belongs to, from the card around it. */
const attackIndex = (target) => Number(target?.closest?.(MOB_CREATOR_V2_FORM.rows.attacks.card)?.dataset?.index);

/** Add `value` to the list a control names; returns whether the draft took it. */
function addTo(app, list, value, target) {
  if (list === TAG_LIST) return app.draft.addTag(value);
  if (Object.hasOwn(ATTACK_RIDER_LISTS, list)) return app.draft.addRider(attackIndex(target), list, value);
  return false;
}

export const PICK_LIST_ACTIONS = Object.freeze({
  /** The Add select (a change): the chosen option's `data-list` names the list. */
  async addPick(event, target) {
    const option = target?.selectedOptions?.[0] ?? [...(target?.querySelectorAll?.('option') ?? [])].find((o) => o.selected);
    if (!option?.value || !addTo(this, option.dataset?.list, option.value, target)) return;
    await this.render({ parts: this._parts() });
  },
  /** The custom entry's button, beside its text box. */
  async addCustomPick(event, target) {
    const input = target?.closest?.('[data-custom-entry]')?.querySelector('input');
    const list = target?.dataset?.list;
    if (!input || !addTo(this, list, input.value, target)) return;
    input.value = '';
    await this.render({ parts: this._parts() });
  },
  /** A chip's remove link. */
  async removePick(event, target) {
    const list = target?.dataset?.list;
    const taken = list === TAG_LIST
      ? this.draft.removeTag(target.dataset.value)
      : this.draft.removeRider(attackIndex(target), list, target?.dataset?.value);
    if (!taken) return;
    await this.render({ parts: this._parts() });
  }
});
