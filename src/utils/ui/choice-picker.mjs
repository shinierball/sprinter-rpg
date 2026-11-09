/**
 * The shared picker for tag-query item choices: one `<select>` per open choice, its candidates as options. Starting items
 * (race and class) embed its selects in their own checkbox dialog; a loot box open shows the whole dialog.
 *
 * The first option of each select is the first candidate, so a dialog confirmed untouched still answers every entry.
 * A candidate's value is what the caller resolves later (a uuid); labels are display text only.
 */
import { dialogAnswer } from './dialog-answer.mjs';

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** The form name of an entry's select. */
const choiceFieldName = (key) => `choice-${key}`;

/** The form name of an entry's free-text input (an entry with `freeText`). */
const choiceTextName = (key) => `choice-${key}-text`;

/** The key under which `readChoicePicks` returns what was typed into an entry's free-text input. */
export const choiceTextKey = (key) => `${key}:text`;

/**
 * One entry's select.
 * @param {{ key: string|number, candidates?: Array<{ value: string, label: string }> }} entry
 * @returns {string}
 */
export function choiceSelectHtml(entry) {
  const options = (Array.isArray(entry?.candidates) ? entry.candidates : [])
    .map((c) => `<option value="${escapeHtml(c?.value)}">${escapeHtml(c?.label)}</option>`).join('');
  return `<select name="${escapeHtml(choiceFieldName(entry?.key))}">${options}</select>`;
}

/**
 * Read the picks back from a dialog form: `{ [key]: value }`, leaving out an entry with no value.
 * @param {HTMLFormElement|null} form
 * @param {Array<{ key: string|number }>} entries
 * @returns {Record<string, string>}
 */
export function readChoicePicks(form, entries) {
  const picks = {};
  for (const entry of entries ?? []) {
    const name = choiceFieldName(entry?.key).replaceAll('"', '\\"');
    const field = form?.querySelector?.(`[name="${name}"]`);
    // A DOM with no select value (a headless one) reads the selected option, else the first, as a browser would.
    const value = typeof field?.value === 'string'
      ? field.value
      : (field?.querySelector?.('option[selected]') ?? field?.querySelector?.('option'))?.value;
    if (value) picks[entry.key] = value;
    const typedName = choiceTextName(entry?.key).replaceAll('"', '\\"');
    const typed = form?.querySelector?.(`[name="${typedName}"]`)?.value;
    if (typeof typed === 'string' && typed.trim()) picks[choiceTextKey(entry.key)] = typed.trim();
  }
  return picks;
}

/**
 * Ask for one pick per entry. Entries sharing a `group` are listed under one heading, in order.
 * An entry with `freeText: { label }` also shows a text input; what is typed comes back under `choiceTextKey(key)` and wins
 * over the select.
 * @param {{ title: string, intro?: string, entries: Array<{ key: string, label: string, hint?: string, group?: string, freeText?: { label: string },
 *   candidates: Array<{ value: string, label: string }> }>, notes?: string[], confirmLabel?: string, cancelLabel?: string }} spec
 * @returns {Promise<Record<string, string>|null>} the picks, or null when cancelled or closed
 */
export async function promptChoicePicks({ title, intro = '', entries = [], notes = [], confirmLabel = 'Confirm', cancelLabel = 'Cancel' } = {}) {
  const rows = [];
  let group = null;
  for (const entry of entries) {
    if (entry.group && entry.group !== group) {
      group = entry.group;
      rows.push(`<h4 class="cog-choice-group">${escapeHtml(group)}</h4>`);
    }
    const hint = entry.hint ? ` <small class="cog-choice-hint">${escapeHtml(entry.hint)}</small>` : '';
    rows.push(`
    <label class="cog-choice-pick" style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
      <span>${escapeHtml(entry.label)}${hint}</span>
      ${choiceSelectHtml(entry)}
    </label>`);
    if (entry.freeText) {
      rows.push(`
    <label class="cog-choice-pick" style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
      <span>${escapeHtml(entry.freeText.label)}</span>
      <input type="text" name="${escapeHtml(choiceTextName(entry.key))}" />
    </label>`);
    }
  }
  const noteHtml = (notes ?? []).filter(Boolean).map((n) => `<p class="cog-choice-note"><em>${escapeHtml(n)}</em></p>`).join('');
  const content = `<div class="cog-dialog-choices" style="padding:6px;font-family:'Oswald',sans-serif;">
    ${intro ? `<p>${escapeHtml(intro)}</p>` : ''}${rows.join('')}${noteHtml}</div>`;
  // Cancel's null callback comes back as the string 'cancel'; only the confirm object is an answer.
  return dialogAnswer(await foundry.applications.api.DialogV2.wait({
    window: { title },
    position: { width: 420 },
    classes: ['cog-dialog', 'cog-choices-wizard'],
    content,
    buttons: [
      { action: 'pick', icon: 'fas fa-check', label: confirmLabel, default: true, callback: (event, button) => readChoicePicks(button.form, entries) },
      { action: 'cancel', icon: 'fas fa-times', label: cancelLabel, callback: () => null }
    ],
    rejectClose: false
  }));
}
