/**
 * Plain paragraphs for text fields. A description field is a plain textarea and nothing renders it as HTML, so a stored
 * `<p>` tag would read literally. An import writes plain paragraphs (blank-line separated); this is the
 * same shape for markup that came from somewhere else. Authoring time only: plain string splitting, no pattern matching.
 */

/** The wrapper the perk conversion put around generated rules text. */
const RULES_SECTION_OPEN = '<section class="cog-rules-text">';
const RULES_SECTION_CLOSE = '</section>';

/** Entities the perk proposer's escaper writes. `&amp;` goes last so `&amp;lt;` decodes to `&lt;`. */
const ENTITIES = [['&lt;', '<'], ['&gt;', '>'], ['&quot;', '"'], ['&#39;', '\''], ['&amp;', '&']];

/**
 * Unwrap paragraphs, the rules-text wrapper, line breaks and the entities the proposer escapes. Only the markup changes:
 * every word is kept, and paragraphs become blank-line separated.
 * @param {string} html
 * @returns {string}
 */
export function descriptionToPlainText(html) {
  let text = String(html ?? '')
    .split(RULES_SECTION_OPEN).join('')
    .split(RULES_SECTION_CLOSE).join('')
    .split('</p><p>').join('\n\n')
    .split('<p>').join('')
    .split('</p>').join('')
    .split('<br>').join('\n')
    .split('<br/>').join('\n')
    .trim();
  for (const [entity, char] of ENTITIES) text = text.split(entity).join(char);
  return text;
}

