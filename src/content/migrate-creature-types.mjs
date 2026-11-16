/**
 * Stored-data migration: the bundled races, mobs, pets and mercenary gained their `creature.*` tags (the types the book gives
 * them), but a world that took copies of them on release 8.0.0 keeps copies without the tags, so a row that tests a type
 * ("Disadvantage dealing with elves") never fires against them. This adds the tags the compendium document now carries to
 * the world copy, and only adds: a tag the GM set is never removed, and a document that already has the tag is returned
 * untouched.
 *
 * The table of which document gets which tag has one home, the `system.tags` of the bundled specs (`PACK_SPECS`), read here
 * as the content provider compiles it. A world copy is matched, in this order of evidence, by the compendium document it
 * was made from (`_stats.compendiumSource`, or the core `sourceId` flag), by its own `_id` (a copy kept in a world
 * compendium), and failing those, for a race by its `system.identifier`, for a mob, pet or mercenary by its name, when that
 * names exactly one document. The public specs hold no
 * book text, so the identifiers and names of the book documents come from the content registry's catalogs (the world after
 * an import), the document's own `_id` being the key to both. Registered at import (`default-content-provider.mjs`).
 */
import { registerMigration } from '../utils/migrations/registry.mjs';
import { PACK_SPECS } from './specs/index.mjs';
import { contentRegistry } from './registry.mjs';

const CREATURE_PREFIX = 'creature.';

/** The registry catalog that holds the imported (named) copy of each spec type whose text the public specs leave out. */
const CATALOG_OF_TYPE = Object.freeze({ race: 'races', mob: 'mobs' });

/** The document name each spec type is stored as. */
const DOCUMENT_OF_TYPE = Object.freeze({ race: 'Item', mob: 'Actor', pet: 'Actor', mercenary: 'Actor' });

/** What names a copy when its source is lost: a race by its identifier, an actor by its name. */
const WEAK_KEY_OF_TYPE = Object.freeze({
  race: (source) => source.system?.identifier,
  mob: (source) => source.name,
  pet: (source) => source.name,
  mercenary: (source) => source.name
});

const specTags = (spec) => spec.system?.tags ?? spec.tags ?? [];
const idOf = (ref) => String(ref ?? '').split('.').pop();

/**
 * The check rows of a spec that test a creature type and exclude some tag (`condition.none`): the row's place in the list,
 * its `any` list as identity, and the tags it excludes. The Cat Girl/Cat Boy row excludes its own race, which now carries the
 * type the row tests, so a copy that gains the type must gain the exclusion with it.
 */
function creatureExclusions(spec) {
  const rows = Array.isArray(spec.system?.checkModifiers) ? spec.system.checkModifiers : [];
  const testsCreature = (list) => Array.isArray(list) && list.some((tag) => String(tag).includes(CREATURE_PREFIX));
  return rows.flatMap((row, at) => {
    const { any, none } = row?.condition ?? {};
    return testsCreature(any) && Array.isArray(none) && none.length ? [{ at, any, none }] : [];
  });
}

/**
 * The specs that carry a creature type, with what identifies a world copy of each.
 * @returns {{ type: string, tags: string[], keys: { ids: Set<string>, weak: Set<string> }, exclusions: object[] }[]}
 */
function creatureSpecs() {
  const named = new Map(Object.entries(CATALOG_OF_TYPE).map(([type, kind]) => [type, new Map(contentRegistry.getCatalog(kind).map((entry) => [entry._id, entry]))]));
  const out = [];
  for (const { specs } of PACK_SPECS) {
    for (const spec of specs) {
      const tags = specTags(spec).filter((tag) => typeof tag === 'string' && tag.startsWith(CREATURE_PREFIX));
      if (!tags.length || !DOCUMENT_OF_TYPE[spec.type]) continue;
      const imported = named.get(spec.type)?.get(spec._id);
      const weak = WEAK_KEY_OF_TYPE[spec.type]({ name: spec.name, system: spec.system });
      const weakImported = imported ? WEAK_KEY_OF_TYPE[spec.type](imported) : '';
      const keys = { ids: new Set([spec._id]), weak: new Set([weak, weakImported].filter(Boolean)) };
      out.push({ type: spec.type, tags, keys, exclusions: creatureExclusions(spec) });
    }
  }
  return out;
}

/**
 * The bundled specs a world copy was made from; empty when none is known. A source or `_id` names its document; an
 * identifier or a name is weaker evidence (two bundled races can share an identifier), so it counts only when it names
 * exactly one document.
 */
function specsOf(source, specs) {
  const ids = new Set([source._id, idOf(source._stats?.compendiumSource), idOf(source.flags?.core?.sourceId)]);
  const ofType = specs.filter(({ type }) => type === source.type);
  const weak = WEAK_KEY_OF_TYPE[source.type]?.(source);
  const named = typeof weak === 'string' ? ofType.filter(({ keys }) => keys.weak.has(weak)) : [];
  const byId = ofType.filter(({ keys }) => [...ids].some((id) => keys.ids.has(id)));
  return byId.length ? byId : (named.length === 1 ? named : []);
}

const sameList = (a, b) => Array.isArray(a) && a.length === b.length && a.every((tag, at) => tag === b[at]);

/** Add the exclusions the specs' creature check rows carry to the copy's row at the same place, when that row is still the spec's (same `any` list). */
function addExclusions(source, matched) {
  const rows = source.system.checkModifiers;
  if (!Array.isArray(rows)) return;
  for (const { exclusions } of matched) {
    for (const { at, any, none } of exclusions) {
      const condition = rows[at]?.condition;
      if (!condition || !sameList(condition.any, any)) continue;
      const have = Array.isArray(condition.none) ? condition.none : [];
      const missing = none.filter((tag) => !have.includes(tag));
      if (missing.length) condition.none = [...have, ...missing];
    }
  }
}

/** Add the missing creature tags (and the row exclusions that go with them) to a race, mob, pet or mercenary copy; any other source, or one without a tag list, is returned as it came. */
function addCreatureTags(source, ctx) {
  const tags = source?.system?.tags;
  if (ctx?.partial || !Array.isArray(tags) || !Object.hasOwn(DOCUMENT_OF_TYPE, source.type)) return source;
  const matched = specsOf(source, creatureSpecs());
  if (!matched.length) return source;
  const missing = [...new Set(matched.flatMap((spec) => spec.tags))].filter((tag) => !tags.includes(tag));
  if (missing.length) source.system.tags = [...tags, ...missing];
  addExclusions(source, matched);
  return source;
}

registerMigration({
  id: 'creature-types',
  release: '8.1.0',
  covers: [],
  documents: {
    Item: addCreatureTags,
    Actor: addCreatureTags
  }
});
