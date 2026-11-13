/**
 * The one HTML escaper. Plain string replacement, pure, no Foundry global.
 * Escaping is not idempotent: `&amp;` escaped again prints as the text `&amp;`, so a value is escaped once,
 * at the point it enters markup.
 */

/** Escape text for a text node or a double- or single-quoted attribute value: `& " ' < >`. `null`/`undefined` give `''`. */
export function escapeAttr(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/**
 * JSON for a SINGLE-quoted `data-` attribute: `JSON.stringify` with `& ' < >` escaped; `"` stays, so the
 * attribute does not grow. Read it back with `dataset` and `JSON.parse`.
 */
export function jsonAttr(value) {
  return JSON.stringify(value)
    .replaceAll('&', '&amp;')
    .replaceAll('\'', '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/** Marker for HTML that is not typed text: an `HTMLField` read or a Foundry render result. Identity; checked by shape. */
export function trustedHtml(html) {
  return html;
}
