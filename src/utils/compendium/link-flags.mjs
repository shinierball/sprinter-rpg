/**
 * The two flags that tie a world document back to the compendium entry it was copied from: `compendiumId` (the pack
 * `_id`, the durable link) and `sourceUuid` (the pack uuid it was filled from). This module owns those words.
 */
import { readFlag, withFlags } from '../flags.mjs';

const COMPENDIUM_ID = 'compendiumId';
const SOURCE_UUID = 'sourceUuid';

/** The pack `_id` a document or creation data was copied from (undefined when it has none). */
export const compendiumIdOf = (doc) => readFlag(doc, COMPENDIUM_ID);

/** The pack uuid a document or creation data was filled from (undefined when it has none). */
export const sourceUuidOf = (doc) => readFlag(doc, SOURCE_UUID);

/**
 * The link flags for an entry: `compendiumId` when `id` is given, `sourceUuid` when `sourceUuid` is given. A patch to
 * merge with `withFlags`, or to add more flags to before it is merged.
 * @param {{ id?: string, sourceUuid?: string }} link
 * @returns {{ compendiumId?: string, sourceUuid?: string }}
 */
export function compendiumLinkPatch({ id, sourceUuid } = {}) {
  return { ...(id ? { [COMPENDIUM_ID]: id } : {}), ...(sourceUuid ? { [SOURCE_UUID]: sourceUuid } : {}) };
}

/** `data` with both link flags set exactly as given (a copy; see `withFlags`). */
export const withCompendiumLink = (data, id, sourceUuid) => withFlags(data, { [COMPENDIUM_ID]: id, [SOURCE_UUID]: sourceUuid });

/** `data` with `compendiumId` set to `id` unless it already has one; `data` is changed in place. */
export function ensureCompendiumId(data, id) {
  if (id && !compendiumIdOf(data)) data.flags = withFlags(data, { [COMPENDIUM_ID]: id }).flags;
  return data;
}

/** The flags value a sync writes onto a copy: its `compendiumId`, and its `sourceUuid` kept when it has one (else `sourceUuid`). */
export function syncedLinkPatch(target, id, sourceUuid) {
  return { [COMPENDIUM_ID]: id, [SOURCE_UUID]: sourceUuidOf(target) || sourceUuid };
}
