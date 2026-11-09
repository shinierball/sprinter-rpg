/**
 * Whether an owned skill or spell is the same entry as incoming creation data. Shared by `COGActor#createEmbeddedDocuments`,
 * the crawler drop handler and the race / class planner, so all three match exactly alike. Pure: no document class.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { itemIdentifier } from '../identifier.mjs';

/** The compendium entry a document or creation data came from (`_stats.compendiumSource`, else the managers' flag). */
function compendiumSourceOf(doc) {
  return String(doc?._stats?.compendiumSource || doc?.flags?.[SYSTEM_ID]?.sourceUuid || '');
}

/**
 * Whether an owned skill/spell is the same entry as incoming creation data: the same compendium source,
 * else the same `system.identifier` (data without one gets the slug `_preCreate` would give it). Names never match.
 */
export function isSameOwnedEntry(owned, data) {
  const source = compendiumSourceOf(data);
  if (source && compendiumSourceOf(owned) === source) return true;
  const ownedId = String(owned?.system?.identifier ?? '').trim();
  return Boolean(ownedId) && ownedId === itemIdentifier(data);
}
