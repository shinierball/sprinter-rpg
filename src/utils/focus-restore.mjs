/**
 * Keep keyboard focus across an application re-render.
 *
 * A control that re-renders its window on `change` (Award Levels amount, Mercenary days, ...) loses focus when
 * the Tab key moves it to the next field and the DOM is then replaced: focus falls to the page body. These helpers
 * describe the focused control by a locator that survives the replacement and find it again afterwards.
 */

const attr = (value) => String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');

/**
 * A locator for `el` inside `root`: its id, else its name (plus its index among same-named controls), else its
 * position in the tree.
 * @param {Element} root
 * @param {Element} el
 * @returns {{ selector: string, index: number }|null}
 */
export function focusKey(root, el) {
  if (!root || !el || el === root || !root.contains?.(el)) return null;
  if (el.id) return { selector: `[id="${attr(el.id)}"]`, index: 0 };
  const name = el.getAttribute?.('name');
  if (name) {
    const selector = `${el.tagName.toLowerCase()}[name="${attr(name)}"]`;
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

