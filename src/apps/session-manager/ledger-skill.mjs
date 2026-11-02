import { slugifyIdentifier } from '../../utils/identifier.mjs';

/**
 * The identifier a ledger event records for its skill. Untrained attempts are tallied and later looked
 * up by this identifier, never by the event's display name.
 *
 * Resolution runs once, when the event is written (a roll, or a GM typing a manual event): an explicit
 * `skillIdentifier` wins, else the identifier of the skill the actor owns under that name, else the slug of the typed
 * name (the same rule `COGItem#_preCreate` uses for a new item).
 * @param {{actor?: object, name?: string, skillIdentifier?: *}} p
 * @returns {string}
 */
export function resolveLedgerSkillIdentifier({ actor = null, name = '', skillIdentifier = '' } = {}) {
  let explicit = skillIdentifier ?? '';
  if (Array.isArray(explicit)) explicit = explicit[0] ?? '';
  explicit = String(explicit).trim();
  if (explicit) return explicit;
  const slug = slugifyIdentifier(name);
  const owned = Array.from(actor?.items ?? []).find(i => i?.type === 'skill' && slugifyIdentifier(i.name) === slug);
  return String(owned?.system?.identifier ?? '').trim() || slug;
}
