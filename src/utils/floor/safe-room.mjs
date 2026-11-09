/**
 * "Is this crawler in a safe room?" Loot boxes are opened in a safe room; anywhere else the opener is asked for a
 * lightweight Rule Break, never blocked.
 *
 * A crawler is in a safe room only when a token of it is on a scene tagged `scene.safe_room`
 * (`flags.sprinter-rpg.tags`, set by the checkbox the system adds to Scene Config). A personal space sheet, even a linked
 * one, does not count: a safe room and a personal space are different things.
 *
 * Reads only tags and flags, never a name (GEMINI §2).
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { SAFE_ROOM_TAG } from '../tag/tag-mechanics.mjs';
import { crawlerDoc } from '../../documents/actor/personal-space-links.mjs';

/** Values of an array, Map, Foundry collection or plain object. */
function listOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return Array.from(collection.values());
  if (typeof collection === 'object') return Object.values(collection);
  return [];
}

/**
 * A scene's system tags (`flags.sprinter-rpg.tags`), sanitized: an array of trimmed strings, a comma string split, anything
 * else empty.
 * @param {object|null} scene a Scene document or its data
 * @returns {string[]}
 */
export function sceneTags(scene) {
  let raw = scene?.flags?.[SYSTEM_ID]?.tags;
  if (raw === undefined && typeof scene?.getFlag === 'function') {
    try { raw = scene.getFlag(SYSTEM_ID, 'tags'); } catch { raw = undefined; }
  }
  if (typeof raw === 'string') raw = raw.split(',');
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((t) => typeof t === 'string').map((t) => t.trim()).filter(Boolean))];
}

/** Whether the scene is tagged as a safe room. */
export function isSafeRoomScene(scene) {
  return sceneTags(scene).includes(SAFE_ROOM_TAG);
}

/**
 * The tag list a scene gets when its safe-room checkbox is set or cleared; every other tag is kept.
 * @param {object|null} scene
 * @param {boolean} on
 * @returns {string[]}
 */
export function sceneTagsWithSafeRoom(scene, on) {
  const tags = sceneTags(scene).filter((t) => t !== SAFE_ROOM_TAG);
  return on ? [...tags, SAFE_ROOM_TAG] : tags;
}

/** Whether a token (document or placeable) stands for this crawler: its actor id, or a synthetic actor of it. */
function tokenIsCrawler(token, crawler) {
  const base = crawlerDoc(crawler);
  if (!base) return false;
  const doc = token?.document ?? token;
  if (crawler?.uuid && doc?.actor?.uuid === crawler.uuid) return true;
  const actorId = doc?.actorId ?? doc?.actor?.id ?? null;
  return Boolean(base.id) && actorId === base.id;
}

/** Whether the scene holds a token of the crawler. */
function sceneHoldsCrawler(scene, crawler) {
  return listOf(scene?.tokens).some((t) => tokenIsCrawler(t, crawler));
}

/**
 * The scene a crawler's token is on: its own token's scene (an unlinked token actor), the viewed canvas scene, the active
 * scene, then any world scene that holds one of its tokens. Null when no scene holds one.
 * @param {Actor} crawler
 * @returns {object|null}
 */
export function findCrawlerScene(crawler) {
  if (!crawler) return null;
  const own = crawler.token?.parent ?? null;
  const scenes = globalThis.game?.scenes;
  const candidates = [own, globalThis.canvas?.scene, scenes?.active, scenes?.viewed, ...listOf(scenes)].filter(Boolean);
  return candidates.find((scene) => sceneHoldsCrawler(scene, crawler)) ?? null;
}

/**
 * Pure: whether the crawler is in a safe room, from the scene its token is on.
 * @param {Actor} crawler
 * @param {{ scene?: object|null }} [where] `scene`: the scene to judge (it must hold a token of the crawler)
 * @returns {boolean}
 */
export function isInSafeRoom(crawler, { scene = null } = {}) {
  if (!crawler) return false;
  return Boolean(scene) && isSafeRoomScene(scene) && sceneHoldsCrawler(scene, crawler);
}
