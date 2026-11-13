/**
 * The identification markers (p. 164), drawn per viewer: on a token whose actor worships the same god as the viewer's
 * character, that god's image; on a token whose god is a rival, the rival's image and an accent-red ring around the token. The GM's client
 * draws none. Nothing here changes a token's disposition; the decision is `identificationMark` (pure).
 */
import { collectActorTags } from '../documents/active-tags.mjs';
import { godsFromTags, identificationMark, rivalsLookup } from '../utils/deity/rivals.mjs';
import { deityImage, deityRecords } from '../utils/deity/deity-names.mjs';

/** The children's names; a refresh removes them first. */
const MARKER_NAME = 'cog-worship-marker';
const RING_NAME = 'cog-worship-rival-ring';
/** The marker's side as a share of the token's width (a UI constant). */
const WORSHIP_MARKER_SCALE = 0.25;
const FALLBACK_IMAGE = 'icons/svg/sun.svg';
/** The rival ring's stroke as a share of the token's width. */
const RING_WIDTH_SCALE = 0.04;
/** The theme token the ring is coloured from (the accent red). */
const RING_COLOUR_TOKEN = '--cog-accent';

const godsOf = (actor) => godsFromTags(collectActorTags(actor));

function clearMarker(token) {
  for (const name of [MARKER_NAME, RING_NAME]) {
    const old = token.getChildByName?.(name) ?? token.children?.find?.((c) => c?.name === name);
    if (!old) continue;
    token.removeChild?.(old);
    old.destroy?.({ children: true });
  }
}

/** A ring around the token in the theme's accent colour (PIXI 7 `lineStyle` or PIXI 8 `stroke`). */
function rivalRing(PIXI, token) {
  const w = token.w ?? token.document?.width ?? 1;
  const h = token.h ?? w;
  const width = Math.max(2, w * RING_WIDTH_SCALE);
  const css = globalThis.getComputedStyle?.(globalThis.document?.documentElement)?.getPropertyValue?.(RING_COLOUR_TOKEN)?.trim();
  const color = css ? globalThis.foundry.utils.Color.from(css).valueOf() : 0xff0000;
  const ring = new PIXI.Graphics();
  ring.name = RING_NAME;
  if (typeof ring.lineStyle === 'function') {
    ring.lineStyle(width, color, 1);
    ring.drawRoundedRect(0, 0, w, h, width * 2);
  } else {
    ring.roundRect(0, 0, w, h, width * 2).stroke({ width, color });
  }
  return ring;
}

function sprite(PIXI, image, side) {
  const s = PIXI.Sprite.from(image);
  s.width = side;
  s.height = side;
  return s;
}

/** Redraw (or remove) one token's marker for this client's user. */
function refreshMarker(token) {
  const PIXI = globalThis.PIXI;
  if (!token || !PIXI?.Sprite) return;
  clearMarker(token);
  const user = globalThis.game?.user;
  const viewer = user?.character;
  if (!user || user.isGM || !viewer || !token.actor || token.actor === viewer || token.actor.id === viewer.id) return;
  const viewerGods = godsOf(viewer);
  const tokenGods = godsOf(token.actor);
  if (!viewerGods.length || !tokenGods.length) return;
  const records = deityRecords([viewer, token.actor]);
  const mark = identificationMark(viewerGods, tokenGods, rivalsLookup(records));
  if (!mark) return;
  const side = (token.w ?? token.document?.width ?? 1) * WORSHIP_MARKER_SCALE;
  const marker = new PIXI.Container();
  marker.name = MARKER_NAME;
  marker.addChild(sprite(PIXI, deityImage(records, mark.deity, FALLBACK_IMAGE), side));
  marker.x = (token.w ?? 0) - side;
  marker.y = 0;
  token.addChild(marker);
  if (mark.kind === 'rival') token.addChild(rivalRing(PIXI, token));
}

const refreshVisible = () => {
  for (const token of globalThis.canvas?.tokens?.placeables ?? []) refreshMarker(token);
};

let registered = false;
/** Once, from the ready hook. */
export function registerWorshipMarkerHooks() {
  if (registered) return;
  registered = true;
  globalThis.Hooks?.on?.('refreshToken', (token) => refreshMarker(token));
  // The viewer's own gods changed: every visible token may now read differently.
  const onDeity = (item) => {
    const character = globalThis.game?.user?.character;
    if (item?.type === 'deity' && character && item.parent?.id === character.id) refreshVisible();
  };
  for (const name of ['createItem', 'updateItem', 'deleteItem']) globalThis.Hooks?.on?.(name, onDeity);
}
