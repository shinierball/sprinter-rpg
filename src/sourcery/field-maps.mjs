/**
 * src/sourcery/field-maps.mjs
 * Per-kind field maps: which block part fills which human-text field of a redacted spec.
 *
 * Entry: `{ path, from, as }` or `{ path, join: { sep, parts: [{ label, from }] }, as }`.
 *   path   dotted path into the spec document; the hydrator only fills paths that already exist and are empty.
 *   from   a source key: `name`, `quote`, `body`, or `fields.<name>`.
 *   as     `text` (plain string, `<` and `>` neutralised) or `html` (escaped `<p>` paragraphs built by the system).
 *   join   several labelled parts in one field, for a skill's combined `upgrades` text; the labels are system text.
 *          A part is `{ label?, from }` (book text), `{ label?, from, ifNoPath }` (skipped when the spec has that path:
 *          a structural test) or `{ gen }` (a generator id of generators.mjs: mechanics written from the spec's own
 *          numbers, never read from the book, rules 3 and 6). A join fills only when a non-generator part has text.
 *
 * Other text that is mechanics in disguise is generated the same way; hydrators also accept a `generators` option
 * (`{ [path]: (spec) => string }`) for that.
 * Anything the compiler decides per entity goes in the anchors entry's `map` override, which may only re-source
 * paths listed here.
 */

import { isSourceKey, readTargetPath } from './anchors.mjs';

const rank = n => `rank${n}`;
const RANK_NOTES = [5, 10, 15].map(n => ({ path: `system.rankBreaks.${rank(n)}.notes`, from: `fields.${rank(n)}`, as: 'text' }));
const NAME = { path: 'name', from: 'name', as: 'text' };

export const FIELD_MAPS = Object.freeze({
  skill: [
    NAME,
    // Plain paragraphs, like every other text field: the sheets show this field in a textarea, where a tag would read literally.
    { path: 'system.description', from: 'body', as: 'text' },
    ...RANK_NOTES,
    {
      path: 'system.upgrades',
      join: { sep: '\n', parts: [5, 10, 15].map(n => ({ label: `Rank ${n}: `, from: `fields.${rank(n)}` })) },
      as: 'text'
    },
    // The notes join. The body goes to `description` where the spec has that path (11 skills).
    {
      path: 'system.notes',
      join: {
        sep: ' ',
        parts: [
          { from: 'body', ifNoPath: 'system.description' },
          { label: 'Limitations: ', from: 'fields.limitations' },
          { gen: 'range' }, { gen: 'cooldown' }, { gen: 'aiFavor' }, { gen: 'baseDamage' }
        ]
      },
      as: 'text'
    }
  ],
  spell: [
    NAME,
    { path: 'system.quote', from: 'quote', as: 'text' },
    { path: 'system.description', from: 'body', as: 'text' },
    { path: 'system.limitations', from: 'fields.limitations', as: 'text' },
    ...[5, 10, 15].map(n => ({ path: `system.upgrades.${rank(n)}`, from: `fields.${rank(n)}`, as: 'text' })),
    ...RANK_NOTES
  ],
  race: [
    NAME,
    { path: 'system.description', from: 'body', as: 'text' },
    { path: 'system.prerequisites', from: 'fields.prerequisites', as: 'text' }
  ],
  class: [
    NAME,
    { path: 'system.description', from: 'body', as: 'text' },
    { path: 'system.prerequisites', from: 'fields.prerequisites', as: 'text' }
  ],
  mob: [
    NAME,
    { path: 'prototypeToken.name', from: 'name', as: 'text' },
    { path: 'system.details.description', from: 'body', as: 'text' },
    { path: 'system.details.aiDescription', from: 'fields.sidebar', as: 'text' },
    { path: 'system.details.notes', from: 'fields.notes', as: 'text' }
  ],
  gear: [
    NAME,
    { path: 'system.description', from: 'body', as: 'text' }
  ],
  buff: [
    NAME,
    { path: 'system.description', from: 'body', as: 'text' }
  ],
  debuff: [
    NAME,
    // The compiled debuff document carries its description twice (top level and under system).
    { path: 'description', from: 'fields.description', as: 'text' },
    { path: 'system.description', from: 'fields.description', as: 'text' },
    { path: 'system.duration', from: 'fields.duration', as: 'text' }
  ],
  achievement: [
    NAME,
    { path: 'system.quote', from: 'body', as: 'text' },
    // The default has no source; the compiler picks one per entity through the anchors entry's `map`.
    { path: 'system.description', from: 'fields.description', as: 'text' },
    { path: 'system.reward', from: 'fields.reward', as: 'text' },
    { path: 'system.rewardContents', from: 'fields.contents', as: 'text' }
  ],
  space: [
    NAME,
    { path: 'system.description', from: 'body', as: 'text' }
  ]
});

/** The field map for a kind, or null for an unknown kind. */
export function fieldMapFor(kind) {
  const k = typeof kind === 'string' ? kind : '';
  return Object.hasOwn(FIELD_MAPS, k) ? FIELD_MAPS[k] : null;
}

/* ------------------------------------------------------------------------------------------------------------ */
/* The field-class table (option C)                                                                   */
/* ------------------------------------------------------------------------------------------------------------ */

/**
 * What kind of field a leaf is. `structured` fields ship as they are. `rules` text ships when it passes the scans and is
 * empty when it fails. `story` text is empty where the import asks the book for it. `name` follows the kind table of step N.
 */
export const FIELD_CLASS = Object.freeze({ STRUCTURED: 'structured', RULES: 'rules', STORY: 'story', NAME: 'name' });
const R = FIELD_CLASS.RULES;
const S = FIELD_CLASS.STORY;
const N = FIELD_CLASS.NAME;
const RANKS = [5, 10, 15];
const LABELS = ['grants', 'startingItems', 'attackModifiers', 'checkModifiers', 'damageModifiers', 'defenseModifiers',
  'manaCostModifiers', 'recoveryModifiers', 'popularityTriggers'].map(k => [`system.${k}.*.label`, N]);

/** The embedded items of a pet or a mercenary (skills, spells, gear): hand-written and public, listed so the short-line gate reads them. */
const EMBEDDED_ROWS = {
  'items.skill.name': N, 'items.skill.system.notes': R, 'items.skill.system.checkNote': R, 'items.skill.system.upgrades': R, 'items.skill.system.range': R,
  'items.spell.name': N, 'items.spell.system.description': R, 'items.spell.system.notes': R, 'items.spell.system.effects': R,
  'items.spell.system.duration': R, 'items.spell.system.range': R, 'items.spell.system.limitations': R,
  'items.gear.name': N, 'items.gear.system.description': R, 'items.gear.system.notes': R
};

/**
 * Per Sourcery kind (`KIND_OF_TYPE`), the class of each human-text path. A dotted pattern; `*` matches exactly one segment.
 * A document's own `description` is story, but not every `description` is: a skill's `techniqueConfig.description`, a gear outcome's `outcomes.*.description` and an embedded spell's `system.description` are rules. An embedded item is addressed as `items.<itemType>.<subpath>`. A path that is not listed is `structured`
 * (a coverage test makes every human-text leaf be listed).
 */
export const FIELD_CLASSES = Object.freeze({
  skill: {
    name: N, 'system.description': S, 'system.notes': R, 'system.upgrades': R,
    ...Object.fromEntries(RANKS.map(n => [`system.rankBreaks.rank${n}.notes`, R])),
    'system.checkNote': R, 'system.range': R, 'system.techniqueConfig.description': R, 'system.techniqueConfig.notes': R,
    'system.techniqueConfig.summaryBands.*.text': R, 'system.techniqueConfig.variants.*.label': N, ...Object.fromEntries(LABELS)
  },
  spell: {
    name: N, 'system.quote': S, 'system.description': S, 'system.limitations': R, 'system.duration': R, 'system.range': R,
    ...Object.fromEntries(RANKS.flatMap(n => [[`system.upgrades.rank${n}`, R], [`system.rankBreaks.rank${n}.notes`, R]])),
    ...Object.fromEntries(LABELS)
  },
  race: { name: N, 'system.description': S, 'system.prerequisites': R, ...Object.fromEntries(LABELS) },
  class: { name: N, 'system.description': S, 'system.prerequisites': R, ...Object.fromEntries(LABELS) },
  mob: {
    name: N, 'prototypeToken.name': N, 'system.details.description': S, 'system.details.aiDescription': S,
    'system.details.notes': S, 'system.details.special': R, 'system.details.creatureType': N,
    'items.attack.name': N, 'items.attack.system.effects': R,
    'items.spell.name': N, 'items.spell.system.description': R, 'items.spell.system.notes': R, 'items.spell.system.effects': R,
    'items.spell.system.duration': R, 'items.spell.system.range': R,
    'items.loot.name': N, 'items.loot.system.description': S, 'items.loot.system.notes': R
  },
  gear: {
    name: N, 'system.description': S, 'system.notes': R, 'system.outcomes.*.description': R, 'system.outcomes.*.name': N,
    'system.outcomes.*.spellName': N, 'system.spellName': N, ...Object.fromEntries(LABELS)
  },
  buff: { name: N, 'system.description': S, 'system.duration': R, ...Object.fromEntries(LABELS) },
  debuff: { name: N, description: S, 'system.description': S, 'system.duration': R },
  achievement: { name: N, 'system.quote': S, 'system.description': S, 'system.reward': R, 'system.rewardContents': R },
  space: { name: N, 'system.description': S },
  // No grammar and no import path; listed for completeness and for the coverage test. Never redacted (src/data/*.mjs).
  pet: { name: N, 'prototypeToken.name': N, 'system.details.notes': S, 'system.details.special': R, ...EMBEDDED_ROWS },
  mercenary: { name: N, 'prototypeToken.name': N, 'system.details.notes': S, 'system.details.special': R, ...EMBEDDED_ROWS }
});

/** Story paths emptied on every canon document of the kind (a mob's prose and a spell's quote). */
export const WITHHELD_PATHS = Object.freeze({
  mob: Object.freeze(['system.details.description', 'system.details.aiDescription', 'system.details.notes']),
  spell: Object.freeze(['system.quote'])
});

const COMPILED = new Map();
function compiledClasses(kind) {
  if (!COMPILED.has(kind)) {
    COMPILED.set(kind, Object.entries(FIELD_CLASSES[kind] ?? {}).map(([pattern, cls]) => ({ segs: pattern.split('.'), cls })));
  }
  return COMPILED.get(kind);
}

/**
 * The class of a path of a kind: an exact or `*`-segment match of the table, else `structured`.
 * @param {string} kind Sourcery kind (`KIND_OF_TYPE`)
 * @param {string} classPath see {@link classPathOf}
 * @returns {'structured'|'rules'|'story'|'name'}
 */
export function fieldClass(kind, classPath) {
  if (typeof kind !== 'string' || !Object.hasOwn(FIELD_CLASSES, kind) || typeof classPath !== 'string') return FIELD_CLASS.STRUCTURED;
  const segs = classPath.split('.');
  for (const row of compiledClasses(kind)) {
    if (row.segs.length === segs.length && row.segs.every((s, i) => s === '*' || s === segs[i])) return row.cls;
  }
  return FIELD_CLASS.STRUCTURED;
}

/** True when the path is emptied on every canon document of the kind, whatever the anchors say. */
export const isWithheldPath = (kind, path) => Object.hasOwn(WITHHELD_PATHS, kind) && WITHHELD_PATHS[kind].includes(path);

/**
 * The table address of a leaf: `items.3.system.effects` or `items.<_id>.system.effects` on a doc becomes
 * `items.attack.system.effects` (the embedded item's type); other paths are unchanged.
 */
export function classPathOf(doc, leafPath) {
  const m = /^items\.([^.]+)\.(.+)$/.exec(String(leafPath));
  const items = doc?.items && typeof doc.items === 'object' ? Array.from(doc.items) : null;
  if (!m || !items) return String(leafPath);
  const item = items.find(i => i && typeof i === 'object' && i._id === m[1]) ?? (/^\d+$/.test(m[1]) ? items[Number(m[1])] : null);
  return item && typeof item.type === 'string' && item.type ? `items.${item.type}.${m[2]}` : String(leafPath);
}

/** The source keys an entry lends: its `fields` plus the keys of its `more[]` extras; null when it lends them all. */
export function providedKeys(entry) {
  if (!entry?.fields) return null;
  return [...new Set([...entry.fields, ...(entry.more ?? []).flatMap(m => m.fields ?? [])])];
}

/**
 * The mapped paths an anchors entry asks the book for: the same rule as the hydrator. The entry lends source keys; a path is
 * asked when its source key (the entry's `map` override applied) is lent, or, for a join, when a book part is lent.
 * @param {string} kind
 * @param {object|null|undefined} entry a sanitised anchors entry; none means the document is not anchored and nothing is asked
 * @param {object} [doc] the document, to resolve a join part that is skipped when the document has another path
 * @returns {Set<string>}
 */
export function askedPaths(kind, entry, doc = null) {
  const out = new Set();
  const map = fieldMapFor(kind);
  if (!map || !entry) return out;
  const provided = providedKeys(entry);
  const lends = key => !provided || provided.includes(key);
  const override = {};
  for (const [target, from] of Object.entries(entry.map ?? {})) {
    const p = readTargetPath(target);
    if (p && map.some(m => m.path === p) && isSourceKey(from)) override[p] = from;
  }
  const has = path => path.split('.').reduce((o, k) => (o && typeof o === 'object' && Object.hasOwn(o, k) ? o[k] : undefined), doc) !== undefined;
  for (const m of map) {
    if (m.join && !Object.hasOwn(override, m.path)) {
      if (m.join.parts.some(p => !p.gen && !(p.ifNoPath && doc && has(p.ifNoPath)) && lends(p.from))) out.add(m.path);
    } else if (lends(override[m.path] ?? m.from)) out.add(m.path);
  }
  return out;
}
