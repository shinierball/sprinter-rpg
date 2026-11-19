/**
 * The unopened loot boxes a crawler holds: `system.lootBoxes[]`, one entry per stack. Pure helpers build an entry from an
 * award row or from a box item, find the stack an entry joins, and read the entries as views; the writers add, change,
 * remove, spend and move entries. Every writer replaces the array (a field update replaces it whole), so they run one at
 * a time per actor under `lootBoxQueueKey`, the key the open engine already serialises on.
 * A leaf: imports only data, models and utils.
 */
import { runKeyed } from '../../utils/keyed-queue.mjs';
import { langText } from '../../utils/lang-text.mjs';
import { deepEqual } from '../../utils/migrations/migrate-tree.mjs';
import { DEFAULT_LOOT_BOX_IMG, lootBoxTierDef, resolveLootBoxTier } from '../../data/loot-box-tiers.mjs';
import {
  newLootBoxId, sanitizeLootBox, sanitizeLootBoxEntries, sanitizeLootBoxEntry, sanitizeRewardBoxes
} from '../../data/loot-box-rows.mjs';
import { entryFromBoxItem } from './migrate-loot-boxes-onto-crawler.mjs';

/** The actor type that holds loot boxes: the book gives boxes to crawlers. */
const CRAWLER_TYPE = 'crawler';

const TEXT = Object.freeze({ 'COG.Award.BoxName': '{tier} Loot Box' });
const boxText = langText(TEXT);

/** "<Tier label> Loot Box" for a tier id, from the registry. */
export function lootBoxName(tier) {
  return boxText('COG.Award.BoxName', { tier: lootBoxTierDef(tier).label });
}

/** Whether an actor holds loot boxes (a crawler). */
export const canHoldLootBoxes = (actor) => actor?.type === CRAWLER_TYPE;

/** The key writers on one actor's boxes serialise on; the open engine's key, so a spend inside an open shares it. */
export const lootBoxQueueKey = (actor) => `loot-box-open:${actor?.uuid ?? actor?.id ?? ''}`;

const plain = (value) => JSON.parse(JSON.stringify(value));

/** The actor's entries as plain copies (nothing here edits the live array). */
const entriesOf = (actor) => (Array.isArray(actor?.system?.lootBoxes) ? plain(actor.system.lootBoxes) : []);

/**
 * Pure: the entry for one reward-box row. With no template it is the generic tier box; with a template (a box item as plain
 * data, `uuid` set) it is a copy of the template's prizes. The template's theme does not matter: a box is made from a
 * template of a theme that is off as if it were on (no Celestial AI Poop for boxes).
 * @param {object} row a `rewardBoxes` row (`whenEmpty: 'keep'` makes a box that waits for the GM)
 * @param {object|null} [template] the template box as plain data, or null
 * @param {{ sourceName?: string, id?: string }} [options]
 * @returns {object} a sanitized entry
 */
export function entryFromRow(row, template = null, { sourceName = '', id = '' } = {}) {
  const [clean] = sanitizeRewardBoxes([row ?? {}]);
  const isTemplate = Boolean(template) && typeof template === 'object';
  const box = sanitizeLootBox(isTemplate ? template.system?.box : null);
  const tier = resolveLootBoxTier((isTemplate ? template.system?.box?.tier : '') || clean.tier);
  const whenEmpty = clean.whenEmpty === 'keep' ? 'keep' : box.whenEmpty;
  const base = { id: id || newLootBoxId(), quantity: clean.quantity, awardedBy: sourceName };
  if (isTemplate) {
    return sanitizeLootBoxEntry({
      ...base,
      name: template.name,
      img: template.img,
      identifier: template.system?.identifier,
      template: clean.uuid || template.uuid || '',
      description: template.system?.description,
      ...box,
      tier,
      whenEmpty
    });
  }
  return sanitizeLootBoxEntry({
    ...base,
    name: lootBoxName(tier),
    img: lootBoxTierDef(tier).img || DEFAULT_LOOT_BOX_IMG,
    identifier: `loot-box-${tier}`,
    tier,
    contents: [],
    whenEmpty
  });
}

/**
 * The entry a box item dropped onto a crawler becomes. A box item embedded on an actor is an old copy of a template (it
 * keeps its template link and award, `entryFromBoxItem`); one from a compendium or the Items sidebar is the template itself
 * (`entryFromRow`, its uuid the template key). A new id either way.
 * @param {object} item the dropped Item document
 * @returns {object} a sanitized entry
 */
export function entryFromDroppedBox(item) {
  const source = typeof item?.toObject === 'function' ? item.toObject() : plain(item ?? {});
  if (item?.parent?.documentName === 'Actor') return entryFromBoxItem(source, { id: newLootBoxId() });
  const uuid = String(item?.uuid ?? '');
  const quantity = Number(source.system?.quantity) || 1;
  return entryFromRow({ tier: source.system?.box?.tier, quantity, uuid }, { ...source, uuid });
}

/**
 * Pure: the entry a race's or class's starting item becomes when it is a box template and the actor a crawler: a copy of the
 * template (`entryFromRow`, the template's uuid its key), with the starting entry's quantity.
 * @param {{ data: object, uuid?: string, entry?: object }} planned a starting-items plan item
 * @param {{ id?: string }} [options] a fixed id (the crawler creator's plan)
 * @returns {object} a sanitized entry
 */
export function startingBoxEntry(planned, { id = '' } = {}) {
  const uuid = String(planned?.uuid ?? '');
  const data = planned?.data ?? {};
  const quantity = Number(planned?.entry?.quantity) || Number(data.system?.quantity) || 1;
  return entryFromRow({ tier: data.system?.box?.tier, quantity, uuid }, { ...data, uuid }, { id });
}

/**
 * Pure: the entry of `entries` that `candidate` stacks onto (same identifier, tier, template, `whenEmpty` and equal
 * contents), or null. A box the GM edited no longer matches, so it stays separate.
 * @param {object[]} entries
 * @param {object} candidate
 */
function findEntryStack(entries, candidate) {
  const wanted = sanitizeLootBoxEntry(candidate);
  return Array.from(entries ?? []).find((entry) => {
    const have = sanitizeLootBoxEntry(entry);
    return have.identifier === wanted.identifier && have.tier === wanted.tier && have.template === wanted.template
      && have.whenEmpty === wanted.whenEmpty && deepEqual(have.contents, wanted.contents);
  }) ?? null;
}

/**
 * Pure: what the open engine and the strip read for each held box.
 * @param {object} actor
 * @returns {Array<{ id: string, name: string, img: string, tier: string, quantity: number, box: { tier: string, contents: object[], whenEmpty: string } }>}
 */
export function boxViews(actor) {
  return entriesOf(actor).map((raw) => {
    const entry = sanitizeLootBoxEntry(raw);
    const { tier, contents, whenEmpty } = entry;
    return { id: entry.id, name: entry.name, img: entry.img, tier, quantity: entry.quantity, box: { tier, contents, whenEmpty } };
  });
}

/** Pure: how many units of unopened boxes the actor holds. */
export const unopenedBoxUnits = (actor) => boxViews(actor).reduce((sum, view) => sum + view.quantity, 0);

const writeEntries = (actor, list) => actor.update({ 'system.lootBoxes': list });

/**
 * Add entries to a crawler, stacking each onto an equal held box (or onto an equal one added in the same call). One write.
 * Another actor type holds none: nothing is written and the result is empty.
 * @param {Actor} actor
 * @param {object[]} entries
 * @returns {Promise<object[]>} the entries now held that this call added to or created
 */
export function addLootBoxes(actor, entries) {
  if (!canHoldLootBoxes(actor) || !Array.isArray(entries) || !entries.length) return Promise.resolve([]);
  return runKeyed(lootBoxQueueKey(actor), async () => {
    const { list, touched } = stackLootBoxes(entriesOf(actor), entries);
    if (!touched.length) return [];
    await writeEntries(actor, list);
    return touched;
  });
}

/**
 * Pure: `entries` stacked into a copy of `held` (each onto an equal box, or onto an equal one added before it; a new id
 * when its own is taken). The crawler creator's plan uses it for a starting box; `addLootBoxes` writes its result.
 * @param {object[]} held the entries already held
 * @param {object[]} entries the entries to add
 * @returns {{ list: object[], touched: object[] }} the whole new list, and the entries of it this added to or created
 */
export function stackLootBoxes(held, entries) {
  const list = sanitizeLootBoxEntries(plain(Array.isArray(held) ? held : []));
  const touched = new Set();
  for (const raw of entries ?? []) {
    const entry = sanitizeLootBoxEntry(raw);
    if (!entry) continue;
    const stack = findEntryStack(list, entry);
    if (stack) {
      stack.quantity += entry.quantity;
      touched.add(stack.id);
      continue;
    }
    if (list.some((have) => have.id === entry.id)) entry.id = newLootBoxId();
    list.push(entry);
    touched.add(entry.id);
  }
  return { list, touched: list.filter((entry) => touched.has(entry.id)) };
}

/**
 * Change one held box: `patch` is merged over it and the result sanitized. The id stays.
 * @returns {Promise<object|null>} the entry as written, or null when there is none with that id
 */
export function updateLootBoxEntry(actor, id, patch) {
  return runKeyed(lootBoxQueueKey(actor), async () => {
    const list = entriesOf(actor);
    const at = list.findIndex((entry) => entry.id === id);
    if (at < 0) return null;
    list[at] = sanitizeLootBoxEntry({ ...list[at], ...patch, id });
    await writeEntries(actor, list);
    return list[at];
  });
}

/** @returns {Promise<object|null>} the entry removed, or null when there is none with that id */
export function removeLootBoxEntry(actor, id) {
  return runKeyed(lootBoxQueueKey(actor), async () => {
    const list = entriesOf(actor);
    const at = list.findIndex((entry) => entry.id === id);
    if (at < 0) return null;
    const [removed] = list.splice(at, 1);
    await writeEntries(actor, list);
    return removed;
  });
}

/**
 * Spend opened units in one write: each count comes off its entry, and an entry at 0 is removed. An id with no entry is
 * skipped, and a count above the units left spends what is left. Boxes won in the same open (`add`) are stacked in by the
 * same write.
 * @param {Actor} actor
 * @param {Record<string, number>} countsById units opened per entry id
 * @param {{ held?: boolean, add?: object[] }} [options] `held`: the caller already runs inside the actor's queue key (the
 *   open engine), so the write does not queue again; `add`: entries to add after the spend
 * @returns {Promise<Record<string, number>>} the units spent per entry id
 */
export function spendLootBoxUnits(actor, countsById, { held = false, add = [] } = {}) {
  const spend = async () => {
    const list = entriesOf(actor);
    const spent = {};
    for (const [id, count] of Object.entries(countsById ?? {})) {
      const entry = list.find((candidate) => candidate.id === id);
      const units = Math.min(Math.trunc(Number(count)) || 0, entry?.quantity ?? 0);
      if (units < 1) continue;
      entry.quantity -= units;
      spent[id] = units;
    }
    const won = canHoldLootBoxes(actor) && Array.isArray(add) ? add : [];
    if (!Object.keys(spent).length && !won.length) return spent;
    const left = list.filter((entry) => entry.quantity > 0);
    await writeEntries(actor, won.length ? stackLootBoxes(left, won).list : left);
    return spent;
  };
  return held ? spend() : runKeyed(lootBoxQueueKey(actor), spend);
}

/**
 * Move a whole stack to another crawler (stacking there onto an equal box). The move holds both actors' queue keys for
 * both writes, so an open or another move of the same box waits for it and then sees the box gone; the source is read
 * inside that job, so a second drop of the same tile moves nothing. The keys are taken in one fixed order (sorted), so two
 * moves in opposite directions cannot wait on each other. The target is written first, so a failure loses nothing.
 * @returns {Promise<object|null>} the entry now held by `to`, or null when nothing moved
 */
export function moveLootBox(from, to, id) {
  if (!from || !to || from === to || !canHoldLootBoxes(to)) return Promise.resolve(null);
  const [first, second] = [lootBoxQueueKey(from), lootBoxQueueKey(to)].sort();
  if (first === second) return Promise.resolve(null);
  return runKeyed(first, () => runKeyed(second, async () => {
    const entry = entriesOf(from).find((candidate) => candidate.id === id);
    if (!entry) return null;
    const { list, touched } = stackLootBoxes(entriesOf(to), [{ ...entry, id: newLootBoxId() }]);
    if (!touched.length) return null;
    await writeEntries(to, list);
    await writeEntries(from, entriesOf(from).filter((candidate) => candidate.id !== id));
    return touched[0];
  }));
}
