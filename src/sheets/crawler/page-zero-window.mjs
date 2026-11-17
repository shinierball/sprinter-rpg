/**
 * Page 0's window: the tab strip collapses while it shows, it has a size of its own per user, and a sheet can open on it.
 * For an actor not offered page 0 (`pageZeroOffered`) every function does nothing.
 *
 * Foundry does not remember a sheet's size between sessions, and `ApplicationV2#_updatePosition` already clamps any
 * requested size and position to the viewport, so the page 0 size is kept in a client setting and requested through
 * `setPosition`; `_onPosition` is the one hook that sees a resize (a drag also reaches it, with the size unchanged).
 */
import { pageZeroOffered, PAGE_ZERO_PART_ID } from './context-page-zero.mjs';
import { opensOnPageZero, readPageZeroSize, savePageZeroSize } from '../../utils/ui/page-zero-window.mjs';

/** Set on the sheet window while page 0 is the active tab; the stylesheet hides the tab strip under it. */
const PAGE_ZERO_WINDOW_CLASS = 'cog-p0-window';

const GROUP = 'primary';

/** The tab a sheet shows first: page 0 for a user whose setting says so, otherwise the TABS default. */
export function pageZeroInitialTab(sheet, fallback) {
  return pageZeroOffered(sheet.actor) && opensOnPageZero() ? PAGE_ZERO_PART_ID : fallback;
}

const isPageZeroActive = (sheet) => pageZeroOffered(sheet.actor) && (sheet.tabGroups?.[GROUP] ?? pageZeroInitialTab(sheet)) === PAGE_ZERO_PART_ID;

const optionSize = (sheet) => ({ width: sheet.options.position.width, height: sheet.options.position.height });

function state(sheet) {
  sheet._pageZeroWindow ??= { fullSize: null, applying: false, firstPosition: false };
  return sheet._pageZeroWindow;
}

/** Request a size; `applying` keeps `onPageZeroPosition` from taking our own request for the user's resize. */
function requestSize(sheet, size) {
  const s = state(sheet);
  s.applying = true;
  try {
    sheet.setPosition({ width: size.width, height: size.height });
  } finally {
    s.applying = false;
  }
}

/** Before the first render: a sheet opening on page 0 opens at the page 0 size (Foundry applies `options.position` after the render). */
export function configurePageZeroOpening(sheet, options) {
  if (!options?.isFirstRender || !pageZeroOffered(sheet.actor)) return;
  const s = state(sheet);
  s.fullSize = optionSize(sheet);
  // Foundry seeds the active tab from the static TABS before any render, so the opening tab is set here, not by `initial`.
  if (opensOnPageZero()) sheet.tabGroups[GROUP] = PAGE_ZERO_PART_ID;
  if (!isPageZeroActive(sheet) || !options.position) return;
  Object.assign(options.position, readPageZeroSize());
  s.firstPosition = true;
}

/** After a render: the window class follows the active tab. */
export function syncPageZeroWindowClass(sheet) {
  sheet.element?.classList?.toggle(PAGE_ZERO_WINDOW_CLASS, isPageZeroActive(sheet));
}

/** After the primary tab changed from `before`: update the class and swap between the page 0 size and the full sheet size. */
export function onPageZeroTabChange(sheet, before) {
  if (!pageZeroOffered(sheet.actor)) return;
  syncPageZeroWindowClass(sheet);
  const wasZero = before === PAGE_ZERO_PART_ID;
  const nowZero = isPageZeroActive(sheet);
  if (wasZero === nowZero) return;
  requestSize(sheet, nowZero ? readPageZeroSize() : state(sheet).fullSize ?? optionSize(sheet));
}

/** A position change: on page 0 the size is remembered for the user, on any other tab it is the full sheet's size. */
export function onPageZeroPosition(sheet, position) {
  if (!pageZeroOffered(sheet.actor)) return;
  const s = state(sheet);
  if (s.applying) return;
  if (s.firstPosition) {
    // The size Foundry applied at the end of the first render is ours, clamped to the viewport; not a resize.
    s.firstPosition = false;
    return;
  }
  const size = { width: position?.width, height: position?.height };
  if (!(size.width > 0) || !(size.height > 0)) return;
  if (isPageZeroActive(sheet)) savePageZeroSize(size);
  else s.fullSize = size;
}
