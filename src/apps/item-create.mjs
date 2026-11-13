/**
 * Sprinter RPG: the one path that makes a new authored item from the UI. The Items directory button, the item setup
 * modal, the Item, Skill and Spell managers, the crawler sheet's "new" links and the Item from Words review (paused:
 * no button opens it, only the console) all end in `createFromSpec`: build the payload (with the completeness check),
 * ask "Create anyway?" when something is broken, create it, open its sheet, and say what is still missing.
 *
 * Permissive adjudication (Directive 2): an unfinished item breaks no rule, so the confirm records no Rule Break and
 * `ruleBreakMode: refuse` does not apply to it (Question 1080 (a)). A broken item may always be made.
 */
import { buildPayload } from '../data/builders/item-payload.mjs';
import { worldSkillResolver } from '../utils/skill/weapon-skill-options.mjs';
import { escapeAttr } from '../utils/escape-attr.mjs';
import { COGRaceClassApplier } from '../data/race-class-applier.mjs';
import { RACE_CLASS_KINDS } from '../data/race-class-grants.mjs';
import { SYSTEM_ID } from '../constants.mjs';

const t = (key, data) => (data ? globalThis.game?.i18n?.format?.(key, data) : globalThis.game?.i18n?.localize?.(key)) ?? key;

/** A finding's sentence: its lang key filled with its data. */
const findingText = (found) => globalThis.game?.i18n?.format?.(found.messageKey, found.data) ?? found.messageKey;

/** The Item class Foundry creates through. */
const itemClass = () => CONFIG.Item?.documentClass ?? globalThis.foundry?.documents?.Item ?? globalThis.Item;

/**
 * Whether the current user may create world Items: the test Foundry applies to its own Create button
 * (`Item.canUserCreate`), else the `ITEM_CREATE` permission.
 * @returns {boolean}
 */
export function canCreateItems() {
  const user = globalThis.game?.user;
  const ItemClass = itemClass();
  if (typeof ItemClass?.canUserCreate === 'function') return Boolean(ItemClass.canUserCreate(user));
  return Boolean(user?.isGM || user?.can?.('ITEM_CREATE'));
}

/**
 * The one permission gate for a world Item create: true when the user may; otherwise a plain warning and false.
 * @returns {boolean}
 */
export function ensureCanCreateItems() {
  if (canCreateItems()) return true;
  globalThis.ui?.notifications?.warn(t('COG.ItemSetup.NoPermission'));
  return false;
}

/**
 * Ask "Create anyway?" for the broken findings. Resolves false when the dialog is declined or closed; true when no
 * dialog is available (nothing may block the user).
 * @param {Array<object>} broken the `broken` findings
 * @returns {Promise<boolean>}
 */
async function confirmCreateAnyway(broken) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.confirm !== 'function') return true;
  const lines = broken.map((found) => `<li>${escapeAttr(findingText(found))}</li>`).join('');
  try {
    return Boolean(await DialogV2.confirm({
      window: { title: t('COG.ItemSetup.CreateAnyway.Title') },
      content: `<p>${escapeAttr(t('COG.ItemSetup.CreateAnyway.Intro'))}</p><ul>${lines}</ul>`,
      yes: { label: t('COG.ItemSetup.CreateAnyway.Yes') },
      no: { label: t('COG.ItemSetup.CreateAnyway.No'), default: true },
      rejectClose: false,
      modal: true
    }));
  } catch {
    return false;
  }
}

/**
 * Make a new authored item: the payload with the completeness check, a confirm when something is broken, the create,
 * the sheet, a notification for what is only a warning.
 * @param {string} type item type, or the `weapon` pseudo-type (gear with `isWeapon`)
 * @param {object} [spec] a partial payload (`{ name, img, system, folder, ... }`)
 * @param {{ actor?: object|null, options?: object }} [config] `actor` embeds the item on it (a race or class is applied, replacing the current one); `options` go to Foundry's create call; `apply` are extra options for the applier (a race or class on an actor)
 * @returns {Promise<object|null>} the new item, or null when "Create anyway?" was declined
 */
export async function createFromSpec(type, spec = {}, { actor = null, options = {}, apply = {} } = {}) {
  if (!actor && !ensureCanCreateItems()) return null;
  const warnings = [];
  const payload = buildPayload(type, spec, { delegate: false, warnings, check: { resolve: worldSkillResolver() } });
  const findings = warnings.filter((w) => w.code === 'check' && w.finding).map((w) => w.finding);
  for (const other of warnings.filter((w) => w.code !== 'check')) console.warn(`Sprinter RPG | ${other.path}: ${other.message}`);

  const broken = findings.filter((found) => found.severity === 'broken');
  if (broken.length && !(await confirmCreateAnyway(broken))) return null;

  // A race or class on an actor goes through the applier (stat changes, grants, applied record, gates), as a drop does.
  if (actor && RACE_CLASS_KINDS[type]) {
    const applied = await COGRaceClassApplier.applyKind(actor, type, payload, { interactive: true, ...apply, createOptions: options });
    if (!applied) return null;
    const itemId = actor.getFlag?.(SYSTEM_ID, RACE_CLASS_KINDS[type].flagKey)?.itemId;
    return (itemId && actor.items?.get(itemId)) || actor.items?.find((i) => i.type === type) || null;
  }

  const ItemClass = itemClass();
  const created = actor
    ? (await actor.createEmbeddedDocuments('Item', [payload], options))?.[0]
    : await ItemClass.create(payload, options);
  if (created && typeof created.sheet?.render === 'function') created.sheet.render({ force: true });

  const warned = findings.filter((found) => found.severity === 'warning');
  if (created && warned.length) globalThis.ui?.notifications?.warn(warned.map(findingText).join(' '));
  return created ?? null;
}

/**
 * Create an item of `type` from a partial payload, as `createFromSpec` does. `isWeapon` (on the payload or its
 * `system`) makes a weapon: gear in the hands slot. The shape the Item from Words review (paused, console
 * only: `itemFromWords.openBridge`) and the dev API call.
 * @param {string} [type]
 * @param {object} [initialData]
 * @returns {Promise<object|null>}
 */
export function createAndEditItem(type = 'gear', initialData = {}) {
  // `initialData` is a partial payload, not a budget builder's spec: the sheet is where race and class get edited.
  const spec = { ...initialData };
  const weapon = type === 'weapon' || initialData.isWeapon || initialData.system?.isWeapon;
  if (weapon) spec.system = { ...(initialData.system || {}), isWeapon: true };
  delete spec.isWeapon;
  return createFromSpec(weapon ? 'weapon' : type, spec);
}
