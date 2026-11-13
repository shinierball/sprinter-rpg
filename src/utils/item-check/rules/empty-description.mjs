/**
 * src/utils/item-check/rules/empty-description.mjs
 * An item with no description tells its owner nothing; a note, never a warning (the text is for humans, Principle 2).
 * A description that is only markup (`<p></p>`) is empty too.
 */
import { registerItemRule, finding } from '../registry.mjs';

/** The text outside any `<...>` markup, whitespace trimmed. */
function visibleText(html) {
  let depth = 0;
  let text = '';
  for (const ch of String(html ?? '')) {
    if (ch === '<') depth += 1;
    else if (ch === '>' && depth > 0) depth -= 1;
    else if (depth === 0) text += ch;
  }
  return text.replaceAll('&nbsp;', ' ').trim();
}

registerItemRule('*', (item) => (visibleText(item.system?.description) ? [] : [finding('description.empty', 'note', 'system.description')]));
