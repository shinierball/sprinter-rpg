/**
 * The "Certified Safe Room" checkbox the system adds to Foundry's Scene Config (7.3 D7, 535 a).
 *
 * Foundry v14's `SceneConfig` is an AppV2 `HandlebarsApplicationMixin(DocumentSheetV2)` with fixed PARTS (basics, grid,
 * levels, visibility, environment, misc). Its render hook `renderSceneConfig(app, element, context, options)` runs after
 * every render, including a partial one that replaces only some parts, so the field is injected into the Basics tab
 * whenever it is missing.
 *
 * The checkbox has no `name` (GEMINI §5): the form harvester never sees it, and a scene's tag list is not one boolean.
 * Its change writes `flags.sprinter-rpg.tags` straight away with `render: false`, so the open form keeps what the GM
 * has typed but not saved. Only a user who can edit the scene sees it.
 */
import { SYSTEM_ID } from '../constants.mjs';
import { isSafeRoomScene, sceneTagsWithSafeRoom } from '../utils/floor/safe-room.mjs';

/** The attribute that marks the injected field (and keeps the injection idempotent). */
export const SAFE_ROOM_FIELD_ATTR = 'data-cog-safe-room';

const TEXT = Object.freeze({
  'COG.SafeRoom.SceneLegend': 'Sprinter RPG',
  'COG.SafeRoom.SceneLabel': 'Certified Safe Room',
  'COG.SafeRoom.SceneHint': 'Crawlers with a token on this scene open loot boxes without a Rule Break.'
});

/** Localized safe-room text, with the English default when the key is not loaded. */
function safeRoomText(key) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.localize === 'function') return i18n.localize(key);
  return TEXT[key] ?? key;
}

/** Turn a scene's safe-room tag on or off, keeping its other tags. */
async function setSceneSafeRoom(scene, on) {
  if (!scene || typeof scene.update !== 'function') return null;
  return scene.update({ [`flags.${SYSTEM_ID}.tags`]: sceneTagsWithSafeRoom(scene, Boolean(on)) }, { render: false });
}

/** The root element of a render hook: AppV2 passes an HTMLElement; an older caller may pass a jQuery-like list. */
const rootOf = (element) => (element?.querySelector ? element : element?.[0] ?? null);

function canEdit(app, scene) {
  if (app?.isEditable === false) return false;
  return Boolean(globalThis.game?.user?.isGM || scene?.isOwner);
}

/**
 * Add the safe-room field to a rendered Scene Config, once.
 * @param {object} app the SceneConfig application (`app.document` is the Scene)
 * @param {HTMLElement} element the rendered application element
 * @returns {HTMLElement|null} the field, or null when nothing was added
 */
export function injectSafeRoomField(app, element) {
  const root = rootOf(element);
  const scene = app?.document;
  if (!root || !scene || !canEdit(app, scene)) return null;
  const existing = root.querySelector(`[${SAFE_ROOM_FIELD_ATTR}]`);
  if (existing) return null;
  const tab = root.querySelector('.tab[data-tab="basics"]') ?? root.querySelector('form') ?? root;
  const doc = root.ownerDocument ?? globalThis.document;
  if (!doc) return null;

  const fieldset = doc.createElement('fieldset');
  fieldset.setAttribute(SAFE_ROOM_FIELD_ATTR, '');
  const legend = doc.createElement('legend');
  legend.textContent = safeRoomText('COG.SafeRoom.SceneLegend');
  const group = doc.createElement('div');
  group.className = 'form-group';
  const label = doc.createElement('label');
  label.textContent = safeRoomText('COG.SafeRoom.SceneLabel');
  const fields = doc.createElement('div');
  fields.className = 'form-fields';
  const input = doc.createElement('input');
  input.type = 'checkbox';
  input.className = 'cog-scene-safe-room';
  input.checked = isSafeRoomScene(scene);
  if (input.checked) input.setAttribute('checked', '');
  input.addEventListener('change', (event) => {
    event?.stopPropagation?.();
    setSceneSafeRoom(scene, input.checked).catch((err) => console.warn('Sprinter RPG | Could not tag the scene:', err));
  });
  const hint = doc.createElement('p');
  hint.className = 'hint';
  hint.textContent = safeRoomText('COG.SafeRoom.SceneHint');
  fields.append(input);
  group.append(label, fields, hint);
  fieldset.append(legend, group);
  tab.append(fieldset);
  return fieldset;
}

/** Register the Scene Config hook. Called once from the entry point. */
export function registerSceneConfigHooks() {
  globalThis.Hooks?.on('renderSceneConfig', (app, element) => injectSafeRoomField(app, element));
}
