/**
 * DialogV2 answers a button whose callback returns null/undefined with the button's `action` string
 * (`(await callback()) ?? button.action`), so a Cancel/Skip button written as `callback: () => null` hands back
 * "cancel"/"skip" rather than null. A dialog whose confirm button returns an object (or array) is therefore only
 * answered when `DialogV2.wait` resolves to one; every string (a falsy-callback button's action) or null (closed
 * window) means "no answer".
 */

/**
 * @param {*} raw what `DialogV2.wait` resolved to
 * @returns {object|Array|null} the confirm callback's object/array, or null for Cancel, Skip or a closed window
 */
export function dialogAnswer(raw) {
  return raw && typeof raw === 'object' ? raw : null;
}
