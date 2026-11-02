/**
 * Starting items for a race or class (spec 3.4 as amended by decision Q2).
 *
 * One shared `grantStartingItems(actor, source, options)` runs wherever a race or class is applied: the
 * applier (gaining a class, swapping a race or class) and the crawler creator's `buildPayload` through
 * `planStartingItems`. It shows a lightweight confirmation listing the items with one checkbox each. The
 * actor records each race or class source it has received starting items from (`startingItemsGranted`
 * flag), so applying the same source again never duplicates them. Items already given stay when the race or
 * class is removed. Granting a second time is permissive: it needs a Rule Break confirmation and the record
 * notes `ruleBreak: true`.
 *
 * Entries reference their item by `uuid` or `identifier` (never by name). `mode: 'choice'` entries are
 * answered from a tag `query` over the TagIndex. Companion entries (`actor:pet`, `actor:mount`) wait for the
 * companion creation path and are reported as skipped. Entries that reference crafting tables wait for 3.15 S3.
 */
import { SYSTEM_ID } from '../constants.mjs';
import { tagIndex } from '../apps/tag-index.mjs';
import { dialogAnswer } from '../utils/dialog-answer.mjs';
import { confirmRuleBreak } from '../utils/rule-break.mjs';
import { resolveGrantDocument } from './race-class-grants.mjs';
import { stampCompendiumLink } from './compendium-sync.mjs';

export const STARTING_ITEMS_FLAG = 'startingItemsGranted';

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** The stable key a race or class is recorded under (`race:<id>`), from its uuid, identifier or id. */
export function startingSourceKey(source) {
  const def = source?.def ?? {};
  const id = def.uuid || def.system?.identifier || def._id || def.id || '';
  return source?.type && id ? `${source.type}:${id}` : '';
}

/** The source's `startingItems` entries (a defensive copy; non-objects dropped). */
export function startingEntriesOf(source) {
  const rows = source?.def?.system?.startingItems;
  return Array.isArray(rows) ? rows.filter(r => r && typeof r === 'object') : [];
}

/** Candidate items for a `choice` entry: TagIndex matches of its tag query (and item type, when set). */
export function startingChoiceCandidates(entry) {
  const type = entry.itemType && !entry.itemType.startsWith('actor:') ? entry.itemType : undefined;
  try {
    return tagIndex.find(entry.query ?? null, type ? { type } : {}) || [];
  } catch {
    return [];
  }
}

/** Item creation data for a resolved document, with the entry's quantity. */
function itemDataFor(doc, entry, sourceKey) {
  const raw = typeof doc.toObject === 'function' ? doc.toObject() : structuredClone({ name: doc.name, type: doc.type, img: doc.img, system: doc.system ?? {} });
  delete raw._id;
  delete raw.id;
  raw.system = raw.system ?? {};
  if (Number(entry.quantity) > 1 || 'quantity' in raw.system) raw.system.quantity = Math.max(1, Number(entry.quantity) || 1);
  raw.flags = { ...(raw.flags ?? {}), [SYSTEM_ID]: { ...(raw.flags?.[SYSTEM_ID] ?? {}), startingItemOf: sourceKey } };
  stampCompendiumLink(raw, doc);
  return raw;
}

/**
 * Resolve a source's entries into creatable items (no document is created).
 * @param {{type: 'race'|'class', def: object}} source
 * @param {object} [options] `choices`: `{ [entryIndex]: uuid | identifier }` answers for choice entries
 * @returns {Promise<{ sourceKey: string, items: Array<{index: number, entry: object, label: string, data: object}>,
 *   pending: Array<{index: number, entry: object, label: string, candidates: object[]}>,
 *   skipped: Array<{index: number, entry: object, reason: string}> }>}
 */
export async function planStartingItems(source, options = {}) {
  const sourceKey = startingSourceKey(source);
  const items = [];
  const pending = [];
  const skipped = [];
  const entries = startingEntriesOf(source);
  for (const [index, entry] of entries.entries()) {
    if (typeof entry.itemType === 'string' && entry.itemType.startsWith('actor:')) {
      skipped.push({ index, entry, reason: 'companion' });
      continue;
    }
    let ref = entry;
    if (entry.mode === 'choice') {
      const picked = options.choices?.[index];
      if (!picked) {
        pending.push({ index, entry, label: entry.label || 'Choose an item', candidates: startingChoiceCandidates(entry) });
        continue;
      }
      ref = { uuid: String(picked), identifier: String(picked), itemType: entry.itemType };
    }
    const doc = await resolveGrantDocument(ref, entry.itemType || undefined);
    if (!doc) {
      skipped.push({ index, entry, reason: 'unresolved' });
      continue;
    }
    items.push({ index, entry, label: entry.label || doc.name || ref.identifier, data: itemDataFor(doc, entry, sourceKey) });
  }
  return { sourceKey, items, pending, skipped };
}

/** The record stored for a source once its starting items were given. */
function recordFor(plan, ruleBreak, previous) {
  return {
    items: plan.items.map(i => i.label),
    count: (previous?.count ?? 0) + 1,
    ...(ruleBreak || previous?.ruleBreak ? { ruleBreak: true } : {})
  };
}

/**
 * Pure builder step for the crawler creator: resolve the sources' starting items into the creation payload
 * pieces `buildCrawlerPayload` takes as `spec.startingItems`.
 * @param {Array<{type: 'race'|'class', def: object}>} sources
 * @param {object} [options] `choices`: answers keyed by `sourceKey` then entry index
 * @returns {Promise<{ items: object[], record: object }>} item payloads, and the `startingItemsGranted` record
 */
export async function buildStartingItemsSpec(sources, options = {}) {
  const items = [];
  const record = {};
  for (const source of sources || []) {
    const plan = await planStartingItems(source, { choices: options.choices?.[startingSourceKey(source)] });
    if (!plan.sourceKey || record[plan.sourceKey] || plan.items.length === 0) continue;
    items.push(...plan.items.map(i => i.data));
    record[plan.sourceKey] = recordFor(plan, false);
  }
  return { items, record };
}

/**
 * Confirmation dialog: the items listed with one checkbox each (all ticked); choice entries get a select.
 * @returns {Promise<{ accepted: number[], choices: Object<number, string> }|null>} null when skipped or closed
 */
async function promptStartingItems(source, plan) {
  const name = escapeHtml(source.def?.name);
  const rows = plan.items.map(i => `
    <label class="cog-starting-item" style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
      <input type="checkbox" name="starting-${i.index}" checked />
      <span>${escapeHtml(i.label)}${Number(i.entry.quantity) > 1 ? ` x${Number(i.entry.quantity)}` : ''}</span>
    </label>`);
  for (const p of plan.pending) {
    const options = p.candidates.map(c => `<option value="${escapeHtml(c.uuid)}">${escapeHtml(c.name)}</option>`).join('');
    rows.push(`
    <label class="cog-starting-item" style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
      <input type="checkbox" name="starting-${p.index}" checked />
      <span>${escapeHtml(p.label)}</span>
      <select name="choice-${p.index}">${options}</select>
    </label>`);
  }
  const content = `<div class="cog-dialog-choices" style="padding:6px;font-family:'Oswald',sans-serif;">
    <p><strong>${name}</strong> gives these starting items. Untick any you do not want.</p>${rows.join('')}</div>`;
  const indexes = [...plan.items.map(i => i.index), ...plan.pending.map(p => p.index)];
  // Skip's null callback comes back as the string 'skip'; only the Give Items object is an answer.
  return dialogAnswer(await foundry.applications.api.DialogV2.wait({
    window: { title: `${source.def?.name ?? 'Starting'} Items` },
    position: { width: 380 },
    classes: ['cog-dialog', 'cog-choices-wizard'],
    content,
    buttons: [
      {
        action: 'give',
        icon: 'fas fa-check',
        label: 'Give Items',
        default: true,
        callback: (event, button) => {
          const form = button.form;
          const accepted = indexes.filter(i => form.querySelector(`[name="starting-${i}"]:checked`));
          const choices = {};
          for (const p of plan.pending) {
            const value = form.querySelector(`[name="choice-${p.index}"]`)?.value;
            if (value) choices[p.index] = value;
          }
          return { accepted, choices };
        }
      },
      { action: 'skip', icon: 'fas fa-times', label: 'Skip', callback: () => null }
    ],
    rejectClose: false
  }));
}

/**
 * Give an actor the starting items of a race or class it has just received.
 *
 * Headless answers (tests, builders), in the style of the applier's `statPools`:
 * `options.startingItems === false` gives nothing; `options.startingItems = { accept?, choices? }` answers
 * without a dialog (`accept`: entry indexes to give, default all; `choices`: entry index to uuid/identifier).
 * With no answer, an interactive call shows the dialog and a non-interactive call gives every resolvable
 * fixed entry. A source already given needs a Rule Break confirmation (`options.ruleBreak: true` pre-confirms).
 *
 * @param {object} actor
 * @param {{type: 'race'|'class', def: object}} source
 * @param {object} [options]
 * @returns {Promise<{ granted: object[], skipped: object[], ruleBreak: boolean, declined?: boolean }>}
 */
export async function grantStartingItems(actor, source, options = {}) {
  const result = { granted: [], skipped: [], ruleBreak: false };
  if (!actor || options.startingItems === false) return result;
  const entries = startingEntriesOf(source);
  const sourceKey = startingSourceKey(source);
  if (!entries.length || !sourceKey) return result;

  const answer = options.startingItems && typeof options.startingItems === 'object' ? options.startingItems : null;
  const interactive = Boolean(options.interactive || (typeof document !== 'undefined' && !options.skipDialog));

  const records = actor.getFlag?.(SYSTEM_ID, STARTING_ITEMS_FLAG) ?? {};
  const previous = records[sourceKey];
  let ruleBreak = false;
  if (previous) {
    const res = await confirmRuleBreak({
      title: 'Starting Items Already Given',
      message: `${source.def?.name ?? 'This source'} already gave ${actor.name} its starting items. Give them again as a Rule Break?`,
      options
    });
    if (!res.confirmed) return { ...result, declined: true };
    ruleBreak = true;
  }

  let plan = await planStartingItems(source, { choices: answer?.choices });
  result.skipped = plan.skipped;
  let accepted = answer?.accept ? new Set(answer.accept) : null;
  if (!answer && interactive && (plan.items.length || plan.pending.length)) {
    const reply = await promptStartingItems(source, plan);
    if (!reply) return { ...result, declined: true };
    accepted = new Set(reply.accepted);
    if (plan.pending.length) {
      plan = await planStartingItems(source, { choices: reply.choices });
      result.skipped = plan.skipped;
    }
  }

  result.skipped = [...result.skipped, ...plan.pending.map(p => ({ index: p.index, entry: p.entry, reason: 'unresolved-choice' }))];
  const chosen = plan.items.filter(i => !accepted || accepted.has(i.index));
  if (!chosen.length) return result;
  if (ruleBreak) {
    for (const i of chosen) i.data.flags[SYSTEM_ID].ruleBreak = true;
  }
  const created = typeof actor.createEmbeddedDocuments === 'function'
    ? await actor.createEmbeddedDocuments('Item', chosen.map(i => i.data))
    : [];
  result.granted = created ?? [];
  result.ruleBreak = ruleBreak;
  await actor.setFlag?.(SYSTEM_ID, STARTING_ITEMS_FLAG, {
    ...records,
    [sourceKey]: recordFor({ items: chosen }, ruleBreak, previous)
  });
  return result;
}
