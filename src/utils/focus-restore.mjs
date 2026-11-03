/**
 * Keep keyboard focus across an application re-render.
 *
 * A control that re-renders its window on `change` (Award Levels amount, Mercenary days, ...) loses focus when
 * the Tab key moves it to the next field and the DOM is then replaced: focus falls to the page body. These helpers
 * describe the focused control by a locator that survives the replacement and find it again afterwards.
 */

const attr = (value) => String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');

/** Tooltip attributes often carry live values ("3/5 HP"), so they never identify a control. */
const IDENTITY_SKIP = /^data-tooltip/;

/**
 * A locator for `el` inside `root`: its id, else its name, else its `data-*` attributes (a ledger row's
 * `data-entry-id` + `data-change-action`), each plus its index among matching controls; else its position in the
 * tree. Identity beats position: a row inserted above the focused one must not move focus to its neighbour.
 * @param {Element} root
 * @param {Element} el
 * @returns {{ selector: string, index: number, fromRoot?: boolean }|null}
 */
export function focusKey(root, el) {
  if (!root || !el || el === root || !root.contains?.(el)) return null;
  if (el.id) return { selector: `[id="${attr(el.id)}"]`, index: 0 };
  const tag = el.tagName.toLowerCase();
  const name = el.getAttribute?.('name');
  const data = [...(el.attributes ?? [])]
    .filter((a) => a.name.startsWith('data-') && !IDENTITY_SKIP.test(a.name))
    .map((a) => `[${a.name}="${attr(a.value)}"]`)
    .join('');
  if (name || data) {
    const selector = name ? `${tag}[name="${attr(name)}"]` : `${tag}${data}`;
    return { selector, index: [...root.querySelectorAll(selector)].indexOf(el) };
  }
  const path = [];
  for (let node = el; node && node !== root; node = node.parentElement) {
    const siblings = [...(node.parentElement?.children ?? [])];
    path.unshift(`${node.tagName.toLowerCase()}:nth-child(${siblings.indexOf(node) + 1})`);
  }
  return { selector: path.join(' > '), index: 0, fromRoot: true };
}

/**
 * Find the control a {@link focusKey} describes in the freshly rendered `root`.
 * @param {Element} root
 * @param {{ selector: string, index: number, fromRoot?: boolean }|null} key
 * @returns {Element|null}
 */
export function findByFocusKey(root, key) {
  if (!root || !key) return null;
  try {
    if (key.fromRoot) {
      let node = root;
      for (const step of key.selector.split(' > ')) {
        const n = Number(/:nth-child\((\d+)\)$/.exec(step)?.[1]);
        node = node?.children?.[n - 1] ?? null;
        if (!node) return null;
      }
      return node;
    }
    return root.querySelectorAll(key.selector)[Math.max(0, key.index)] ?? null;
  } catch {
    return null;
  }
}

/**
 * Focus `target` the way Tab would: text-like inputs get their content selected.
 * @param {Element} target
 */
export function focusLikeTab(target) {
  target.focus?.({ preventScroll: true });
  if (target.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(target.type)) {
    try { target.select?.(); } catch { /* not selectable */ }
  }
}

const NOT_TEXT = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'color', 'range', 'image', 'hidden']);

/** True for a control the user types into (text-like input or textarea). */
function isTextEntry(el) {
  if (el?.tagName === 'TEXTAREA') return true;
  return el?.tagName === 'INPUT' && !NOT_TEXT.has(el.type);
}

/** The caret/selection of a text control, or null where the browser does not expose one (number inputs). */
function readSelection(el) {
  try {
    if (el.selectionStart === null || el.selectionStart === undefined) return null;
    return { start: el.selectionStart, end: el.selectionEnd, direction: el.selectionDirection ?? 'none' };
  } catch {
    return null;
  }
}

/**
 * Record what a re-render must put back on the focused control `el`: where it is ({@link focusKey}), its caret,
 * and text typed but not yet committed by a `change` event (`draft`, kept with the value it was rendered with).
 * @param {Element} root
 * @param {Element} el
 * @returns {{ key: object, rendered?: string, draft?: string, selection?: object }|null}
 */
export function captureFocus(root, el) {
  const key = focusKey(root, el);
  if (!key) return null;
  const snapshot = { key };
  if (isTextEntry(el)) {
    snapshot.rendered = el.defaultValue;
    if (el.value !== el.defaultValue) snapshot.draft = el.value;
    const selection = readSelection(el);
    if (selection) snapshot.selection = selection;
  }
  return snapshot;
}

/**
 * Put a {@link captureFocus} snapshot back on the freshly rendered `root`: focus the control, carry over a draft
 * when the control was re-rendered with the same value (a changed value means someone else wrote it; theirs wins),
 * then restore the caret. Without a known caret, select the text the way Tab does.
 * @param {Element} root
 * @param {ReturnType<typeof captureFocus>} snapshot
 * @returns {{ target: Element, draft: boolean }|null} the refocused control and whether a draft was carried over
 */
export function restoreFocus(root, snapshot) {
  const target = findByFocusKey(root, snapshot?.key);
  if (!target) return null;
  if (target.ownerDocument?.activeElement !== target) target.focus?.({ preventScroll: true });
  const draft = snapshot.draft !== undefined && isTextEntry(target) && target.defaultValue === snapshot.rendered;
  if (draft) target.value = snapshot.draft;
  const { selection } = snapshot;
  if (selection && isTextEntry(target)) {
    try { target.setSelectionRange(selection.start, selection.end, selection.direction); } catch { /* not selectable */ }
  } else if (!draft) {
    focusLikeTab(target);
  }
  return { target, draft };
}

/** Collapsible blocks whose open state should survive a re-render. */
export const COLLAPSIBLE_SELECTOR = 'details.cog-collapsible-block';

/**
 * Keys of the open collapsible blocks under `root`: a block's `data-block` attribute when it has one, else its
 * position among all collapsible blocks (templates render the same blocks in the same order).
 * @param {Element} root
 * @returns {string[]}
 */
export function openBlockKeys(root) {
  if (!root?.querySelectorAll) return [];
  return [...root.querySelectorAll(COLLAPSIBLE_SELECTOR)]
    .map((el, index) => (el.open || el.hasAttribute?.('open') ? (el.dataset?.block || `#${index}`) : null))
    .filter(Boolean);
}

/**
 * Re-open the blocks named by {@link openBlockKeys} in a freshly rendered `root`.
 * A block the template now renders open stays open; this only ever adds `open`.
 * @param {Element} root
 * @param {string[]} keys
 */
export function restoreOpenBlocks(root, keys) {
  if (!root?.querySelectorAll || !keys?.length) return;
  const blocks = [...root.querySelectorAll(COLLAPSIBLE_SELECTOR)];
  for (const key of keys) {
    const el = key.startsWith('#') ? blocks[Number(key.slice(1))] : blocks.find((b) => b.dataset?.block === key);
    if (!el) continue;
    el.open = true;
    el.setAttribute?.('open', '');
  }
}

