/**
 * src/utils/item-from-words/extract-draft.mjs
 * `extractDraft(replyText)`: the JSON object a chatbot reply carries (step doc 7.43 section 2.9). Plain string search, no
 * regex. The reply is untrusted text; this only finds and parses the object, `checkDraft` judges what is in it.
 */
import { isPlainObject } from './check-reading.mjs';

const FENCE = '```';
const LIST_ERROR = 'The reply is a list, not one JSON object.';

/** The bodies of every fenced block, in order (a language tag line is skipped; an unclosed fence is no block). */
function fencedBodies(text) {
  const bodies = [];
  let from = 0;
  for (;;) {
    const open = text.indexOf(FENCE, from);
    if (open === -1) return bodies;
    const close = text.indexOf(FENCE, open + FENCE.length);
    if (close === -1) return bodies;
    const lineEnd = text.indexOf('\n', open + FENCE.length);
    bodies.push(text.slice(lineEnd !== -1 && lineEnd < close ? lineEnd + 1 : open + FENCE.length, close));
    from = close + FENCE.length;
  }
}

/** The last non-space character before `index`, or ''. */
function charBefore(text, index) {
  for (let i = index - 1; i >= 0; i--) if (text[i].trim()) return text[i];
  return '';
}

/** From the first `{` to the last `}` of `body`: `null` when there is none, else `{ draft }` or `{ error }`. */
function parseBraces(body) {
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end < start) return null;
  if (charBefore(body, start) === '[') return { error: LIST_ERROR };
  let parsed;
  try {
    parsed = JSON.parse(body.slice(start, end + 1));
  } catch (err) {
    return { error: `The reply is not valid JSON: ${err?.message ?? err}` };
  }
  return isPlainObject(parsed) ? { draft: parsed } : { error: 'The reply is not one JSON object.' };
}

/**
 * Each fenced block is tried in turn, then the whole reply; the first that holds one JSON object wins.
 * @param {string|object} replyText a chatbot's reply, or a provider's already-parsed object
 * @returns {{ draft: object }|{ error: string }}
 */
export function extractDraft(replyText) {
  if (isPlainObject(replyText)) return { draft: replyText };
  if (Array.isArray(replyText)) return { error: LIST_ERROR };
  if (typeof replyText !== 'string' || !replyText.trim()) return { error: 'The reply is empty.' };
  let firstError = null;
  for (const body of [...fencedBodies(replyText), replyText]) {
    const found = parseBraces(body);
    if (found?.draft) return found;
    if (found && !firstError) firstError = found;
  }
  return firstError ?? { error: 'No JSON object found in the reply.' };
}
