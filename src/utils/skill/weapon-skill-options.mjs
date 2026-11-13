/**
 * src/utils/skill/weapon-skill-options.mjs
 * The catalog half of a weapon's Skill options (7.51): the Skills `system.associatedSkills` lists, in list order, each
 * named once by identifier and checked against what this world has. The actor half (which of them the attacker owns, at
 * what Rank) is `weaponSkillOptions` in `documents/actor/weapon-skills.mjs`; the completeness check, the setup modal
 * and the Attack Options window share this half.
 *
 * Reads structured data only: an id, a uuid, an identifier or `id.skill.<slug>` all name the same Skill. A name is
 * never matched.
 */
import { DEFAULT_RESOLVER } from '../item-from-words/check-references.mjs';
import { itemIdentifier, slugifyIdentifier } from '../identifier.mjs';

const SKILL_ID_PREFIX = 'id.skill.';

/** The raw list entries of `system.associatedSkills`: an array, or one string (never a name match). */
function listedRefs(sys) {
  const raw = sys?.associatedSkills;
  if (Array.isArray(raw)) return raw;
  return typeof raw === 'string' && raw.trim() ? [raw] : [];
}

/**
 * A Skill reference as the bare identifier slug: `id.skill.<slug>` loses its prefix.
 * @param {*} raw
 * @returns {string}
 */
export function skillRefSlug(raw) {
  const clean = String(raw ?? '').trim();
  return slugifyIdentifier(clean.toLowerCase().startsWith(SKILL_ID_PREFIX) ? clean.slice(SKILL_ID_PREFIX.length) : clean);
}

/** The forms one reference may take in a catalog: as typed, the id after a uuid's last dot, the bare slug. */
function candidateRefs(clean) {
  const out = [clean];
  const tail = clean.includes('.') ? clean.slice(clean.lastIndexOf('.') + 1) : '';
  if (tail) out.push(tail);
  out.push(skillRefSlug(clean));
  return [...new Set(out.filter(Boolean))];
}

/**
 * The Skill a reference names in a catalog, or null. Matches an id, a uuid, an identifier or `id.skill.<slug>`.
 * @param {*} raw
 * @param {{ find?: Function, list?: Function }} resolver `find(kind, ref)` and `list(kind)` (`DEFAULT_RESOLVER` shape)
 * @returns {object|null}
 */
function findSkillDefinition(raw, resolver = DEFAULT_RESOLVER) {
  const clean = String(raw ?? '').trim();
  if (!clean) return null;
  const find = resolver.find ?? DEFAULT_RESOLVER.find;
  const list = resolver.list ?? DEFAULT_RESOLVER.list;
  for (const ref of candidateRefs(clean)) {
    const hit = find('skills', ref);
    if (hit) return hit;
  }
  const slug = skillRefSlug(clean);
  return (list('skills') ?? []).find((def) => slug && def?.system?.identifier === slug) ?? null;
}

/**
 * A resolver that also reads the world's own Skill items, so a homebrew Skill nobody owns still counts as in this world.
 * @param {Iterable<object>|null} [worldItems] the world Items directory (default `game.items`)
 * @returns {{ find: Function, list: Function }}
 */
export function worldSkillResolver(worldItems = globalThis.game?.items) {
  let cached = null;
  const world = () => cached ?? (cached = [...(worldItems ?? [])].filter((i) => i?.type === 'skill'));
  const list = (kind) => (kind === 'skills' ? [...world(), ...(DEFAULT_RESOLVER.list(kind) ?? [])] : (DEFAULT_RESOLVER.list(kind) ?? []));
  const find = (kind, ref) => DEFAULT_RESOLVER.find(kind, ref)
    ?? (kind === 'skills' ? world().find((i) => i.id === ref || i.uuid === ref || i.system?.identifier === ref) ?? null : null);
  return { find, list };
}

/**
 * The Skills a weapon lists, in list order. Every entry is normalised once; a repeat of the same Skill is dropped.
 * @param {object} itemSystem a gear or attack item's `system`
 * @param {{ find?: Function, list?: Function }} [resolver]
 * @returns {Array<{ identifier: string, definition: object|null, inWorld: boolean, refs: string[] }>} `refs` are the
 *   lower-case references the list wrote for this Skill (an owned Skill with no identifier is found through its id)
 */
export function listedSkillEntries(itemSystem, resolver = DEFAULT_RESOLVER) {
  const byIdentifier = new Map();
  for (const raw of listedRefs(itemSystem)) {
    if (typeof raw !== 'string' && typeof raw !== 'number') continue;
    const definition = findSkillDefinition(raw, resolver);
    const identifier = definition ? itemIdentifier(definition) : skillRefSlug(raw);
    if (!identifier) continue;
    const ref = String(raw).trim().toLowerCase();
    if (byIdentifier.has(identifier)) byIdentifier.get(identifier).refs.push(ref);
    else byIdentifier.set(identifier, { identifier, definition, inWorld: Boolean(definition), refs: [ref] });
  }
  return [...byIdentifier.values()];
}

/**
 * A Skill identifier made readable for a Skill this world lacks ("book-bite" reads "Book Bite"); never a raw id.
 * @param {string} identifier
 * @returns {string}
 */
export function readableSkillName(identifier) {
  return String(identifier ?? '').split('-').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
