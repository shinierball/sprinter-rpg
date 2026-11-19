/**
 * The one "pick one of your items" prompt: a DialogV2 select over candidates the caller chose. The enchant outcome and the
 * recharge outcome both ask through it.
 */
import { escapeAttr } from '../../utils/escape-attr.mjs';

/**
 * Ask which of a list of candidate items to act on. Candidates come in the order to show; a `note` is appended to the
 * option's text and a `disabled` one is listed but cannot be chosen. Null when nothing can be chosen, when the user
 * cancels, or when no dialog can be shown. Without a dialog API the only choosable candidate is returned.
 * @param {Actor} actor
 * @param {{ candidates: Array<{ item: Item, note?: string, disabled?: boolean }>, title: string, label: string, okLabel: string }} params
 * `title` is the window title, `label` the select's label, `okLabel` the confirm button
 * @returns {Promise<Item|null>}
 */
export async function pickOwnedItem(actor, { candidates, title, label, okLabel }) {
  const choosable = (Array.isArray(candidates) ? candidates : []).filter((c) => c?.item && !c.disabled);
  if (!choosable.length) return null;
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.prompt !== 'function') return choosable.length === 1 ? choosable[0].item : null;
  const options = candidates.map((c) => {
    const text = c.note ? `${c.item.name} ${c.note}` : c.item.name;
    return `<option value="${escapeAttr(c.item.id)}"${c.disabled ? ' disabled' : ''}>${escapeAttr(text)}</option>`;
  }).join('');
  const chosen = await DialogV2.prompt({
    window: { title },
    content: `<div class="form-group"><label>${escapeAttr(label)}</label><select name="itemId">${options}</select></div>`,
    ok: { label: okLabel, callback: (event, button) => button.form?.elements?.itemId?.value ?? null },
    rejectClose: false,
    modal: true
  });
  return choosable.find((c) => c.item.id === chosen)?.item ?? null;
}
