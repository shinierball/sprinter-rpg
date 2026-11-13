/**
 * The cleanup after content is turned off: find the documents that are off, replace the ones the GM keeps ticked with
 * Celestial AI Poop, delete the whole off documents the GM ticked, and restore poops whose content is on again.
 *
 * The finder takes a predicate, `isOff(doc)`, and defaults to `isContentOff` (a theme that is off). Another rule that
 * turns documents off (hiding AI-written content) passes its own predicate and reuses everything else here.
 */
import { SYSTEM_ID } from '../constants.mjs';
import { contentRegistry } from './registry.mjs';
import { isContentOff, readSourceStamp } from '../utils/content-source.mjs';
import { celestialAiPoopPayload, isPoop, readReplacedRecord, replacedRecordOf } from '../data/rules/celestial-ai-poop.mjs';
import { restoreFromPoop } from './theme-restore.mjs';
import { slotReferencesTo } from '../utils/ui/slot-references.mjs';
import { RACE_CLASS_TYPES } from '../utils/document-types.mjs';

/** World setting: the off-content list the GM has already been shown. */
export const THEME_CLEANUP_SEEN_SETTING = 'themeCleanupSeen';

/** Race and class items go first, one at a time, so their grants are reverted before anything else is replaced. */
const REVERTING_TYPES = new Set(RACE_CLASS_TYPES);

const list = (collection) => {
  try { return Array.from(collection ?? []); } catch { return []; }
};
const t = (key, data) => {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data && typeof i18n.format === 'function' ? i18n.format(key, data) : i18n.localize(key);
};

/**
 * The embedded items of an owner that are off, leaving out the ones that share the owner's own source theme: an example
 * mob's attacks are part of the mob, not things it gained. A token passes `ownIds` (its base actor's item ids) instead:
 * the base actor's items are the token's own, anything else it holds was added. Poops are never off (they carry no stamp) and are skipped.
 */
function offItemsOf(items, ownerTheme, isOff, ownIds = null) {
  return list(items).filter((item) => {
    if (isPoop(item)) return false;
    if (!isOff(item)) return false;
    if (ownIds) return !ownIds.has(item.id);
    return !(ownerTheme && readSourceStamp(item)?.theme === ownerTheme);
  });
}

/** The poops among `items` whose recorded document is no longer off. */
function restorableIn(items, owner, isOff) {
  const out = [];
  for (const poop of list(items)) {
    const record = isPoop(poop) ? readReplacedRecord(poop) : null;
    if (!record || isOff(record.data)) continue;
    out.push({ key: `${owner.key}:${poop.id}`, owner: owner.actor, poop, record });
  }
  return out;
}

/**
 * Everything that is off in the world, over the collections it is handed (defaults to the live `game`).
 * @param {object} [params]
 * @param {import('./registry.mjs').COGContentRegistry} [params.registry]
 * @param {object} [params.game]
 * @param {(doc: object) => boolean} [params.isOff] the rule that turns a document off (default: its theme is turned off)
 * @returns {{
 *   actors: { key: string, actor: object, items: object[] }[],
 *   tokens: { key: string, scene: object, token: object, actor: object, items: object[] }[],
 *   wholeActors: object[], worldItems: object[], worldTables: object[],
 *   restorable: { key: string, owner: object, poop: object, record: object }[]
 * }}
 */
export function findOffContent({ registry = contentRegistry, game = globalThis.game, isOff = (doc) => isContentOff(doc, registry) } = {}) {
  const actors = [];
  const tokens = [];
  const restorable = [];
  for (const actor of list(game?.actors)) {
    const owner = { key: actor.uuid ?? `Actor.${actor.id}`, actor };
    const items = offItemsOf(actor.items, readSourceStamp(actor)?.theme ?? null, isOff);
    if (items.length) actors.push({ key: owner.key, actor, items });
    restorable.push(...restorableIn(actor.items, owner, isOff));
  }
  for (const scene of list(game?.scenes)) {
    for (const token of list(scene.tokens)) {
      if (token.actorLink) continue;
      const actor = token.actor ?? null;
      if (!actor) continue;
      const owner = { key: token.uuid ?? `Scene.${scene.id}.Token.${token.id}`, actor };
      const deltaItems = token.delta?.items ?? actor.items;
      const baseItems = token.baseActor?.items;
      const ownIds = baseItems ? new Set(list(baseItems).map((i) => i.id)) : null;
      const items = offItemsOf(deltaItems, readSourceStamp(token.baseActor ?? actor)?.theme ?? null, isOff, ownIds);
      if (items.length) tokens.push({ key: owner.key, scene, token, actor, items });
      restorable.push(...restorableIn(deltaItems, owner, isOff));
    }
  }
  return {
    actors,
    tokens,
    wholeActors: list(game?.actors).filter((doc) => isOff(doc)),
    worldItems: list(game?.items).filter((doc) => isOff(doc)),
    worldTables: list(game?.tables).filter((doc) => isOff(doc)),
    restorable
  };
}

/**
 * The counts a window headline and the summary card both use.
 * @param {ReturnType<typeof findOffContent>} found
 * @returns {{ owners: number, documents: number, byType: Record<string, number>, wholeActors: number, worldItems: number, worldTables: number, restorable: number }}
 */
export function summarizeFound(found) {
  const byType = {};
  let documents = 0;
  for (const entry of [...(found?.actors ?? []), ...(found?.tokens ?? [])]) {
    for (const item of entry.items) {
      byType[item.type] = (byType[item.type] ?? 0) + 1;
      documents += 1;
    }
  }
  return {
    owners: (found?.actors?.length ?? 0) + (found?.tokens?.length ?? 0),
    documents,
    byType,
    wholeActors: found?.wholeActors?.length ?? 0,
    worldItems: found?.worldItems?.length ?? 0,
    worldTables: found?.worldTables?.length ?? 0,
    restorable: found?.restorable?.length ?? 0
  };
}

/**
 * Replace `items` on `actor` with one Celestial AI Poop each. Races and classes are deleted first so their grants revert;
 * anything the revert removed is not pooped; slots that pointed at a replaced item are cleared; the poops are created in one
 * call and the originals deleted in one call. Each poop records its original (taken before anything changed).
 * @param {object} actor the owner (a token's synthetic actor for an unlinked token)
 * @param {object[]} items the ticked items
 * @returns {Promise<{ replaced: number, byType: Record<string, number>, revertedAway: number }>}
 */
export async function replaceWithPoop(actor, items, { replacedAt = Date.now() } = {}) {
  const targets = list(items).filter((item) => item && !isPoop(item));
  const records = new Map(targets.map((item) => [item.id, replacedRecordOf(item, { replacedAt })]));
  const reverting = targets.filter((item) => REVERTING_TYPES.has(item.type));
  for (const item of reverting) {
    if (actor.items.get(item.id)) await actor.deleteEmbeddedDocuments('Item', [item.id]);
  }
  // The revert may have removed some of the others (a race's granted skills); only what is still there is replaced.
  const others = targets.filter((item) => !REVERTING_TYPES.has(item.type));
  const remaining = others.filter((item) => actor.items.get(item.id));
  const revertedAway = others.length - remaining.length;
  const kept = [...reverting, ...remaining];
  const byType = {};
  for (const item of kept) byType[item.type] = (byType[item.type] ?? 0) + 1;

  const slotUpdates = {};
  for (const item of remaining) Object.assign(slotUpdates, slotReferencesTo(actor, item));
  if (Object.keys(slotUpdates).length) await actor.update(slotUpdates);

  const poops = kept.map((item) => {
    const payload = celestialAiPoopPayload(records.get(item.id));
    // The original still holds its id while the poop is created.
    delete payload._id;
    return payload;
  });
  if (poops.length) await actor.createEmbeddedDocuments('Item', poops);
  if (remaining.length) await actor.deleteEmbeddedDocuments('Item', remaining.map((item) => item.id));
  return { replaced: kept.length, byType, revertedAway };
}

/**
 * Delete whole world documents (the ones the GM ticked).
 * @param {object[]} docs
 * @returns {Promise<number>} how many were deleted
 */
export async function deleteWholeDocuments(docs) {
  let deleted = 0;
  for (const doc of list(docs)) {
    await doc.delete();
    deleted += 1;
  }
  return deleted;
}

/**
 * Restore each poop given (the `{ owner, poop }` entries of `found.restorable`).
 * @returns {Promise<number>} how many were restored
 */
export async function restoreAll(entries, { registry = contentRegistry, options = {} } = {}) {
  let restored = 0;
  for (const { owner, poop } of list(entries)) {
    const result = await restoreFromPoop(owner, poop, { registry, options });
    if (result.restored) restored += 1;
  }
  return restored;
}

/** The sorted list of themes that are off, the value `themeCleanupSeen` holds. */
export function offThemeList(registry = contentRegistry) {
  return registry.getDisabledThemeIds().filter((id) => registry.isThemeOff(id)).sort();
}

/**
 * What `themeCleanupSeen` holds: the themes that are off, plus `ai:<level>` while the `aiContent` setting hides AI-written
 * content (7.16f), so the prompt asks again when either changes.
 */
export function offContentList(registry = contentRegistry) {
  const level = registry.getAiContentLevel?.() ?? 'show';
  return level === 'show' ? offThemeList(registry) : [...offThemeList(registry), `ai:${level}`].sort();
}

const typeLabel = (type) => {
  const key = `TYPES.Item.${type}`;
  const label = globalThis.game?.i18n?.localize?.(key);
  return label && label !== key ? label : type;
};

/** "12 Skills, 9 Spells" for a by-type count. */
export function typeCountsText(byType) {
  return Object.entries(byType ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)).map(([type, n]) => `${n} ${typeLabel(type)}`).join(', ');
}

/**
 * Post the GM-whispered summary card of a run.
 * @param {{ replaced?: number, byType?: Record<string, number>, owners?: number, deleted?: number, restored?: number }} counts
 * @returns {Promise<object|null>} the message, or null when nothing happened
 */
export async function postCleanupSummary(counts) {
  const { replaced = 0, owners = 0, deleted = 0, restored = 0, byType = {} } = counts ?? {};
  if (!replaced && !deleted && !restored) return null;
  const lines = [];
  if (replaced) lines.push(t('COG.ThemeCleanup.SummaryReplaced', { count: replaced, owners, types: typeCountsText(byType) }));
  if (deleted) lines.push(t('COG.ThemeCleanup.SummaryDeleted', { count: deleted }));
  if (restored) lines.push(t('COG.ThemeCleanup.SummaryRestored', { count: restored }));
  const whisper = globalThis.ChatMessage?.getWhisperRecipients?.('GM')?.map((u) => u.id);
  return globalThis.ChatMessage.create({
    speaker: { alias: t('COG.ThemeCleanup.Title') },
    content: `<div class="cog-theme-cleanup-card"><h3>${t('COG.ThemeCleanup.Title')}</h3><ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul></div>`,
    ...(whisper?.length ? { whisper } : {}),
    flags: { [SYSTEM_ID]: { themeCleanupSummary: { replaced, deleted, restored, owners, byType } } }
  });
}

/**
 * Whether the active GM should be offered the cleanup at ready (or when the AI-content setting changes): the off list differs from the one last asked about and
 * there is something to report (off documents, or poops that can be restored). When the list changed and there is
 * nothing to report, it records the list itself and stays quiet.
 * @returns {Promise<boolean>} true when the window was opened
 */
export async function maybePromptCleanup({ registry = contentRegistry, game = globalThis.game, isActiveGM, open, find = findOffContent } = {}) {
  if (!isActiveGM?.()) return false;
  const off = offContentList(registry);
  const raw = game?.settings?.get?.(SYSTEM_ID, THEME_CLEANUP_SEEN_SETTING);
  const seen = (Array.isArray(raw) ? raw : []).filter((id) => typeof id === 'string').sort();
  if (JSON.stringify(seen) === JSON.stringify(off)) return false;
  const summary = summarizeFound(find({ registry, game }));
  const anything = summary.documents + summary.wholeActors + summary.worldItems + summary.worldTables + summary.restorable > 0;
  if (!anything) {
    await game.settings.set(SYSTEM_ID, THEME_CLEANUP_SEEN_SETTING, off);
    return false;
  }
  await open?.();
  return true;
}
