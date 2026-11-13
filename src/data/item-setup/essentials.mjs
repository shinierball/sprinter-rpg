/**
 * src/data/item-setup/essentials.mjs
 * The item setup modal's questions, one registered kind each (`kinds/`): what to ask (`fields`, plain data the window
 * renders) and how the answers become a spec (`toSpec(answers, resolver)`). Pure: no Foundry globals, no DOM; the window
 * (`COGItemSetupApp`) holds the answers, the kinds hold the rules. The spec goes to `createFromSpec`, which builds it, checks
 * it and asks "Create anyway?" when something is broken. Importing this module loads every kind.
 *
 * A kind nobody registered (a module's own item type) asks the name only.
 */
import './kinds/index.mjs';
import { registeredSetupKinds, setupKindDef } from './registry.mjs';
import { NAME_FIELD, nameSpec } from './answers.mjs';

/**
 * The questions for a kind: its `createType` (what `createFromSpec` builds), `fields`, `start()` for the first answers
 * and `toSpec(answers, resolver)`. A kind with a studio returns its def (`{ studio }`, no fields); an unregistered kind asks the name.
 * @param {string} kind
 * @returns {{ studio: string }|{ createType: string, fields: ReadonlyArray<object>, start: Function, toSpec: Function }}
 */
export function essentialsFor(kind) {
  const def = setupKindDef(kind);
  if (def) return def;
  return { createType: kind, fields: [NAME_FIELD], start: () => ({ name: '' }), toSpec: nameSpec };
}

/** The kinds the type picker offers, in order: `[{ id, icon }]` (a kind with `picker: false` is opened only by a link); their words are `COG.ItemSetup.Kind.<id>.Label` and `.Hint`. */
export function setupKinds() {
  return registeredSetupKinds().filter((kind) => kind.picker !== false).map(({ id, icon }) => ({ id, icon }));
}

/** Whether one `when` condition `{ field, in }` holds for `answers`, given the ids already shown. */
const conditionHolds = (condition, answers, shown) => shown.has(condition?.field) && (condition.in ?? []).includes(answers?.[condition.field]);

/**
 * The fields to show for the current answers. A field with no `when` always shows; `when` is one condition
 * `{ field, in: [...] }` or an array of them that must all hold. A condition on a field that is itself hidden fails.
 * @param {{ fields?: ReadonlyArray<object> }} essentials
 * @param {object} answers
 * @returns {object[]}
 */
export function visibleFields(essentials, answers) {
  const shown = new Set();
  const out = [];
  for (const field of essentials?.fields ?? []) {
    const when = field.when ? [].concat(field.when) : [];
    if (when.every((condition) => conditionHolds(condition, answers, shown))) {
      shown.add(field.id);
      out.push(field);
    }
  }
  return out;
}
