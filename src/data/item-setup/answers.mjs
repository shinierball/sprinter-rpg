/**
 * src/data/item-setup/answers.mjs
 * The answer readers every setup kind shares. An answer may arrive as anything the window or an import handed over, so each
 * reads through `firstScalar` / `toStringList` and falls back safely. Pure.
 */
import { firstScalar, toStringList } from '../../utils/first-scalar.mjs';
import { timeUnitsFor } from '../../utils/time/timing.mjs';

/** A trimmed string; anything unreadable is ''. */
export const text = (raw) => String(firstScalar(raw, '') ?? '').trim();

/** An integer of at least 0; anything unreadable is 0. */
export const wholeNumber = (raw) => {
  const n = Math.trunc(Number(firstScalar(raw, 0)));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** A list of identifiers in order, each once (compared case-insensitively). */
export function idList(raw) {
  const seen = new Set();
  return toStringList(raw).filter((id) => {
    const key = id.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** True only for `true`, `'true'` and `'on'`. */
export const checked = (raw) => raw === true || raw === 'true' || raw === 'on';

/**
 * What a choice that follows another field holds: its own answer, or while that answer is `null` the followed field's
 * answer when it is one of `values`, else ''. The achievement's "Reward box" follows its trophy tier this way.
 * @param {object} field a `choice` field with `follows`
 * @param {object} answers
 * @param {ReadonlyArray<string>} values every value the choice offers
 * @returns {string}
 */
export function followedChoice(field, answers, values) {
  const own = answers?.[field.id];
  if (own !== null && own !== undefined) return text(own);
  const followed = text(answers?.[field.follows]);
  return values.includes(followed) ? followed : '';
}

/** The name question every kind asks. Its words are shared, not per kind. */
export const NAME_FIELD = Object.freeze({
  id: 'name',
  type: 'text',
  labelKey: 'COG.ItemSetup.Field.Name',
  placeholder: 'COG.ItemSetup.Field.NamePlaceholder'
});

/** A name-only spec: a blank name is left out, so the builder's default name applies. */
export const nameSpec = (answers) => {
  const name = text(answers?.name);
  return name ? { name } : {};
};

/**
 * A duration answer `{ value, unit }` as `{ type, value }` for `system.durationConfig`. `type` is kept only when it is a
 * unit a duration may use (`timeUnitsFor('duration')`), else ''; `value` is a whole number of at least 0.
 * @param {*} raw
 * @returns {{ type: string, value: number }}
 */
export function durationSpec(raw) {
  const unit = text(raw?.unit);
  const known = timeUnitsFor('duration').some((def) => def.id === unit);
  return { type: known ? unit : '', value: wholeNumber(raw?.value) };
}
