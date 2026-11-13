/**
 * Plain text of an HTML field. Item descriptions are rich text (the sheet's editor stores `<p>` markup); every place
 * that shows one as a line of text, copies it into a plain text field or prints it reads it through here, so the
 * markup never shows as literal tags.
 */

/** Plain text of an HTML description for a one-line card snippet. */
export function htmlSnippet(html) {
  const raw = String(html ?? '');
  if (!raw) return '';
  if (typeof DOMParser !== 'undefined') {
    return (new DOMParser().parseFromString(raw, 'text/html').body.textContent || '').replace(/\s+/g, ' ').trim();
  }
  return raw.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
