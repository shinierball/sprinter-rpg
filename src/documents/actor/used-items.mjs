/**
 * Used-up consumables. One unit of a consumable leaves: the stack drops by one (the last unit is deleted)
 * and the unit's used form is left behind as a piece of crafting junk on the same owner. Junk is just junk: it forgets
 * what it was, unless the used item carries `usage.restorable`, in which case it keeps `system.usedFrom` and stacks only
 * with junk of the same origin. Nothing here reads names or descriptions.
 */
import { buildPayload } from '../../data/builders/item-payload.mjs';
import {
  FALLBACK_USED_FORM, LIGHT_USED_FORM, USED_FORM_BY_LOOT_TYPE, USED_FORM_NONE, getUsedForm
} from '../../data/rules/used-forms.mjs';
import { firstScalar } from '../../utils/first-scalar.mjs';
import { slugifyIdentifier } from '../../utils/identifier.mjs';
import { isRestorableUsage, JUNK_TAGS, USAGE_RESTORABLE_TAG } from '../../utils/tag/tag-mechanics.mjs';
import { findCatalogEntry } from '../../content/catalog-lookup.mjs';
import { landItems } from '../../utils/content-source.mjs';

/** The identifier prefix of every piece of used-form junk. */
const USED_IDENTIFIER_PREFIX = 'used-';

/**
 * The used-form id an item leaves: its own `usedInto` when that is registered, else the default for its loot type, else
 * `burnt-torch` for a light source, else `spent-item`. An unknown id falls through with no error. `usedInto: 'none'` returns
 * `none`, which leaves nothing (`usedFormPayloadById` has no such form).
 * @param {object} item an Item document or `{ type, system }`
 * @param {{ ignoreOwn?: boolean, light?: boolean }} [params] `ignoreOwn` skips the item's own `usedInto` (the sheet names the
 *   default it would fall to); `light` says the item is a light source (the caller asks `emitsLight`, which this module cannot import)
 * @returns {string}
 */
export function resolveUsedFormId(item, { ignoreOwn = false, light = false } = {}) {
  const sys = item?.system ?? {};
  if (!ignoreOwn && String(firstScalar(sys.usedInto)).trim().toLowerCase() === USED_FORM_NONE) return USED_FORM_NONE;
  const own = ignoreOwn ? null : getUsedForm(sys.usedInto);
  if (own) return own.id;
  const byType = USED_FORM_BY_LOOT_TYPE[String(sys.lootType ?? '').toLowerCase().trim()];
  if (byType && getUsedForm(byType)) return byType;
  if (light && getUsedForm(LIGHT_USED_FORM)) return LIGHT_USED_FORM;
  return getUsedForm(FALLBACK_USED_FORM)?.id ?? FALLBACK_USED_FORM;
}

/** What a restorable item remembers about itself on its junk. */
function originOf(item) {
  const sys = item?.system ?? {};
  return {
    identifier: String(sys.identifier || '').trim() || slugifyIdentifier(item?.name ?? ''),
    name: String(item?.name ?? ''),
    spellIdentifier: String(sys.spellIdentifier ?? '').trim()
  };
}

/**
 * The creation payload of the junk a used-form leaves, compiled by `buildPayload` like any user-made loot. Plain junk has
 * the form's identifier (`used-<form>`) and no origin; junk of a restorable item adds the origin to both identifier and
 * `usedFrom`, so only the same origin stacks.
 * @param {string} formId a used-form id
 * @param {{ identifier: string, name: string, spellIdentifier: string }|null} [origin] set only for a restorable item
 * @returns {object|null} the payload, or null when the registry has no such form
 */
function usedFormPayloadById(formId, origin = null) {
  const form = getUsedForm(formId);
  if (!form) return null;
  const identifier = [form.id, origin?.identifier, origin?.spellIdentifier].filter(Boolean).join('-');
  return buildPayload('loot', {
    name: form.name,
    img: form.img || undefined,
    system: {
      ...form.system,
      identifier: `${USED_IDENTIFIER_PREFIX}${identifier}`,
      description: form.description,
      value: form.value,
      quantity: 1,
      lootType: 'crafting',
      used: true,
      usedInto: '',
      outcomes: [],
      tags: [...new Set([...JUNK_TAGS, ...(Array.isArray(form.system?.tags) ? form.system.tags : [])])],
      ...(origin ? { usedFrom: origin } : {})
    }
  }, { warnings: [] });
}

/**
 * The payload of the junk an item leaves (its resolved form; the item's origin too when it is tagged `usage.restorable`).
 * @param {object} item the item being used up
 * @param {{ light?: boolean }} [params] see {@link resolveUsedFormId}
 * @returns {object|null}
 */
function usedFormPayload(item, { light = false } = {}) {
  return usedFormPayloadById(resolveUsedFormId(item, { light }), isRestorableUsage(item) ? originOf(item) : null);
}

/** Whether a junk item on the owner is the stack this payload belongs to (same identifier, same origin). */
function sameJunk(existing, payload) {
  const a = existing?.system ?? {};
  const b = payload.system ?? {};
  if (existing?.type !== 'loot' || !a.used || a.identifier !== b.identifier) return false;
  return (a.usedFrom?.identifier ?? '') === (b.usedFrom?.identifier ?? '')
    && (a.usedFrom?.spellIdentifier ?? '') === (b.usedFrom?.spellIdentifier ?? '');
}

/** Leave `quantity` units of a payload's junk on the owner: the matching stack gains them, or a new junk item is created. */
async function leavePayload(actor, payload, quantity = 1) {
  if (!actor || typeof actor.createEmbeddedDocuments !== 'function' || !payload) return null;
  const stack = [...(actor.items ?? [])].find((existing) => sameJunk(existing, payload));
  if (stack) {
    await stack.update({ 'system.quantity': (Number(stack.system.quantity) || 0) + quantity });
    return stack;
  }
  const [created] = await actor.createEmbeddedDocuments('Item', [{ ...payload, system: { ...payload.system, quantity } }]);
  return created ?? null;
}

/**
 * Leave one unit of an item's used form on its owner. An item with no owner leaves nothing.
 * @param {object} actor the owner
 * @param {object} item the item being used up
 * @param {{ light?: boolean }} [params] see {@link resolveUsedFormId}
 * @param {number} [quantity=1] units to leave (one write, however many)
 * @returns {Promise<object|null>} the junk item, or null
 */
function leaveUsedForm(actor, item, params = {}, quantity = 1) {
  return leavePayload(actor, usedFormPayload(item, params), quantity);
}

/**
 * Leave one unit of a form by id: the junk of a consumed torch whose light has ended, when the item itself is long gone.
 * It forgets what it was (no origin). An unknown id leaves nothing.
 * @param {object} actor the owner
 * @param {string} formId a used-form id
 * @param {number} [quantity=1] units to leave (a whole number, at least 1)
 * @returns {Promise<object|null>}
 */
export function leaveUsedFormById(actor, formId, quantity = 1) {
  return leavePayload(actor, usedFormPayloadById(formId), Math.max(1, Math.floor(Number(quantity)) || 1));
}

/**
 * Spend one unit of a consumable: its used form is left first (so a failure never loses the junk), then the stack drops by
 * `units` (default 1) or the last units are deleted, the form left once per unit. A consumed light leaves its junk when the light ends instead (3.76 B3), so it passes
 * `leaveForm: false`. `refillCharges` is a multi-dose item whose last dose was just taken: the units left start full.
 * @param {object} item the consumable
 * @param {object|null} actor the owner
 * @param {{ quantity?: number, units?: number, leaveForm?: boolean, refillCharges?: boolean }} [params] `quantity` is the stack's
 *   current count, `units` how many leave it
 */
export async function spendConsumableUnit(item, actor, { quantity = 1, units = 1, leaveForm = true, refillCharges = false } = {}) {
  if (leaveForm) await leaveUsedForm(actor, item, {}, units);
  if (quantity - units > 0) {
    const update = { 'system.quantity': quantity - units };
    if (refillCharges) update['system.charges.value'] = Number(item.system?.charges?.max) || 0;
    await item.update(update);
  } else if (typeof item.delete === 'function') {
    await item.delete();
  } else if (actor && typeof actor.deleteEmbeddedDocuments === 'function') {
    await actor.deleteEmbeddedDocuments('Item', [item.id]);
  }
}

/** What a piece of restorable junk remembers (`system.usedFrom`; empty for plain junk). */
const usedFromOf = (junk) => junk?.system?.usedFrom ?? {};

/**
 * What a piece of restorable junk was, as text: the origin's name, with its spell identifier after it for a scroll. Empty for
 * plain junk. The inventory, the item sheet and the recharge picker all print it.
 * @param {object} junk an Item document or `{ system: { usedFrom } }`
 * @returns {string}
 */
export function usedFromLabel(junk) {
  const from = usedFromOf(junk);
  return from.name ? (from.spellIdentifier ? `${from.name} (${from.spellIdentifier})` : from.name) : '';
}

/** The unused loot item of an identifier in a collection of items, or null. */
function findUnused(items, identifier, skip = null) {
  for (const item of items ?? []) {
    if (item === skip || item?.type !== 'loot' || item.system?.used) continue;
    if (item.system?.identifier === identifier) return item;
  }
  return null;
}

/** A minimal scroll for junk whose origin is gone but whose spell is known: a scroll casts from `spellIdentifier` alone. */
function scrollFromJunk(junk) {
  const from = usedFromOf(junk);
  return buildPayload('loot', {
    name: from.name || junk.name,
    system: {
      identifier: from.identifier || '',
      lootType: 'scroll',
      spellIdentifier: from.spellIdentifier,
      quantity: 1,
      tags: [USAGE_RESTORABLE_TAG]
    }
  }, { warnings: [] });
}

/**
 * Find the item a piece of restorable junk used to be: an unused item of that identifier on the actor, then in the world,
 * then in the `items` catalog; failing all three, a minimal scroll when the junk remembers a spell. Null when none applies.
 * @param {object} actor the junk's owner
 * @param {object} junk a junk item with `system.usedFrom`
 * @returns {Promise<{ doc: object, source: 'owned'|'world'|'catalog'|'scroll' }|null>}
 */
export async function resolveUsedOrigin(actor, junk) {
  const { identifier, spellIdentifier } = usedFromOf(junk);
  if (identifier) {
    const owned = findUnused(actor?.items, identifier, junk);
    if (owned) return { doc: owned, source: 'owned' };
    const world = findUnused(globalThis.game?.items, identifier);
    if (world) return { doc: world, source: 'world' };
    const entry = findCatalogEntry('items', identifier);
    if (entry && (!entry.type || entry.type === 'loot')) return { doc: entry, source: 'catalog' };
  }
  return spellIdentifier ? { doc: scrollFromJunk(junk), source: 'scroll' } : null;
}

/** The creation payload of one origin: its data through `buildPayload`, `units` of it, charges full. */
function originPayload(doc, units) {
  const source = typeof doc.toObject === 'function' ? doc.toObject() : structuredClone(doc);
  const system = structuredClone(source.system ?? {});
  system.quantity = units;
  system.used = false;
  if (Number(system.charges?.max) > 0) system.charges = { ...system.charges, value: system.charges.max };
  return buildPayload('loot', { name: source.name ?? doc.name, img: source.img, system }, { warnings: [] });
}

/**
 * Turn units of a junk stack back into the item it was. The restored item is made (or its stack grown) first, then the junk
 * stack shrinks by the same units (deleted at 0), so a failure never loses both.
 * @param {object} actor the owner
 * @param {object} junk the junk stack
 * @param {number} units how many to restore; capped at the stack, at least 1
 * @param {{ doc: object, source: string }} origin from {@link resolveUsedOrigin}
 * @returns {Promise<{ item: object|null, units: number }>} the restored item and the units restored
 */
export async function restoreUsedForm(actor, junk, units, origin) {
  const stack = Math.max(0, Math.floor(Number(junk?.system?.quantity)) || 0);
  const count = Math.min(stack, Math.max(1, Math.floor(Number(units)) || 1));
  let item;
  if (origin.source === 'owned') {
    item = origin.doc;
    await item.update({ 'system.quantity': (Number(item.system.quantity) || 0) + count });
  } else {
    [item] = await actor.createEmbeddedDocuments('Item', landItems([originPayload(origin.doc, count)]));
  }
  if (count >= stack) {
    if (typeof junk.delete === 'function') await junk.delete();
    else await actor.deleteEmbeddedDocuments('Item', [junk.id]);
  } else {
    await junk.update({ 'system.quantity': stack - count });
  }
  return { item: item ?? null, units: count };
}
