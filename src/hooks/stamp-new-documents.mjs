/**
 * New-document stamps (7.16e). Two jobs, both reading and writing only the structured source stamp
 * (`flags.sprinter-rpg.source`), never a name or a description's words:
 *
 * - `preCreate` of a top-level world Item, Actor or RollTable that has no stamp and no compendium source: the document
 *   is stamped as made in this world by a person (`authorship: 'human'`). A document with a stamp (the system's own,
 *   a compendium import, a duplicate) keeps it, and a write that passes the create option `cogAuthorship: false` is skipped.
 * - `preUpdate` of a top-level Item or Actor, or an Item embedded on a world Actor, whose stamp says `ai`: a change to its name or description makes it
 *   `edited`. Only changed keys are compared. A system write that rewrites text (the compendium sync after a Sourcery
 *   import) passes the update option `cogAuthorship: false` and does not flip.
 *
 * The homebrew stamp (7.15b) also records who made it (`by` the user id, `byName` their name then). One path writes it:
 * - a system path that makes a world document of its own passes the create option `cogSystemMade: true` (no stamp), or
 *   carries a stamp in its data;
 * - an actor made with embedded items stamps the ones that have no stamp;
 * - an item made on an actor by the sheet's own "new" buttons passes `cogHomebrew: true` and is stamped.
 */
import { SYSTEM_ID } from '../constants.mjs';
import { readSourceStamp } from '../utils/content-source.mjs';

/** Dotted paths whose change counts as rewriting the words of a document. */
const TEXT_PATHS = ['name', 'system.description', 'system.details.description'];

const USER_ID = /^[A-Za-z0-9]{16}$/;

/**
 * The stamp a document made in a world gets: `by` is the id of the user who made it and `byName` their name then (the
 * badge shows the live name and falls back to this one when the user is deleted). Either is left out when unknown.
 * @param {string} [userId] defaults to the current user
 */
export function worldStamp(userId) {
  const stamp = { theme: 'world', set: 'homebrew', authorship: 'human' };
  const id = userId ?? globalThis.game?.user?.id;
  if (typeof id === 'string' && USER_ID.test(id)) {
    stamp.by = id;
    const name = globalThis.game?.users?.get?.(id)?.name ?? (id === globalThis.game?.user?.id ? globalThis.game?.user?.name : '');
    if (typeof name === 'string' && name.trim()) stamp.byName = name.trim().slice(0, 64);
  }
  return stamp;
}

/** True for a top-level world document (no parent, not in a pack). */
const isTopLevelWorld = (doc) => !doc?.parent && !doc?.pack;

/** True for an Item embedded on a world Actor (not in a pack): its stamp came from the example or bundled copy. */
const isEmbeddedWorldItem = (doc) => doc?.documentName === 'Item' && doc.parent?.documentName === 'Actor' && !doc.pack && !doc.parent.pack && !doc.parent.parent;

/** The stamp as a flags update. */
const stampFlags = (stamp) => ({ flags: { [SYSTEM_ID]: { source: stamp } } });

/** Stamp the embedded items of a new actor that have none (`_id` keyed, so the update merges with the built items). */
function stampEmbeddedItems(doc, data, stamp) {
  const built = Array.from(doc?._source?.items ?? data?.items ?? []);
  const updates = built.filter((item) => item && !readSourceStamp(item) && item._id).map((item) => ({ _id: item._id, ...stampFlags(stamp) }));
  if (updates.length) doc.updateSource({ items: updates });
}

/**
 * preCreate handler for Item, Actor and RollTable. Stamps a top-level world document with no stamp, and an actor's
 * unstamped embedded items with it; stamps an item made on an actor by the sheet's own buttons (`cogHomebrew`).
 * Skips `cogAuthorship: false`, `cogSystemMade`, a compendium write, a stamped document and a compendium copy.
 * @returns {boolean} true when the document was stamped
 */
export function stampNewDocument(doc, data, options, userId) {
  try {
    if (options?.cogAuthorship === false || options?.cogSystemMade || options?.pack) return false;
    if (readSourceStamp(doc) || readSourceStamp(data)) return false;
    if (doc?._stats?.compendiumSource || data?._stats?.compendiumSource) return false;
    if (doc?.parent) {
      if (!options?.cogHomebrew || doc.documentName !== 'Item' || doc.parent.documentName !== 'Actor') return false;
      doc.updateSource(stampFlags(worldStamp(userId)));
      return true;
    }
    if (!isTopLevelWorld(doc)) return false;
    const stamp = worldStamp(userId);
    doc.updateSource(stampFlags(stamp));
    if (doc.documentName === 'Actor') stampEmbeddedItems(doc, data, stamp);
    return true;
  } catch (err) {
    console.warn('Sprinter RPG | could not stamp a new document', err);
    return false;
  }
}

/** The value of a dotted path in an update (nested or dotted keys), or `undefined` when the update does not touch it. */
function changedValue(changes, path) {
  if (!changes || typeof changes !== 'object') return undefined;
  if (path in changes) return changes[path];
  return foundry.utils.getProperty(foundry.utils.expandObject(changes), path);
}

/**
 * preUpdate handler for Item and Actor: an `ai` document whose name or description changes becomes `edited`.
 * @returns {boolean} true when the update was changed to set `edited`
 */
export function flipEditedAuthorship(doc, changes, options) {
  try {
    if (options?.cogAuthorship === false) return false;
    if (!isTopLevelWorld(doc) && !isEmbeddedWorldItem(doc)) return false;
    if (readSourceStamp(doc)?.authorship !== 'ai') return false;
    const touched = TEXT_PATHS.some((path) => {
      const next = changedValue(changes, path);
      return next !== undefined && next !== foundry.utils.getProperty(doc, path);
    });
    if (!touched) return false;
    changes[`flags.${SYSTEM_ID}.source.authorship`] = 'edited';
    return true;
  } catch (err) {
    console.warn('Sprinter RPG | could not mark an edit of written-with-AI text', err);
    return false;
  }
}

/**
 * The handlers return a boolean for tests; a pre-hook that returns `false` cancels the create or update in Foundry, so
 * the registered listeners drop the return value.
 */
export function registerStampNewDocumentHooks() {
  for (const name of ['Item', 'Actor', 'RollTable']) {
    Hooks.on(`preCreate${name}`, (doc, data, options, userId) => { stampNewDocument(doc, data, options, userId); });
  }
  for (const name of ['Item', 'Actor']) {
    Hooks.on(`preUpdate${name}`, (doc, changes, options) => { flipEditedAuthorship(doc, changes, options); });
  }
}
