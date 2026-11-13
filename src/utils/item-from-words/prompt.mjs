/**
 * src/utils/item-from-words/prompt.mjs
 * `buildItemPrompt(words, vocabulary)`: the one string the user pastes into their own chatbot (step doc 7.43 section 2.8).
 * Prints a `describeVocabulary()` result compactly, one line per entry, and only the sections the vocabulary holds (one item
 * type's vocabulary makes a prompt for that type); the fixed wording is `prompt-text.mjs`.
 * The request is printed right after the intro and again at the end, so a paste box that cuts the prompt keeps it.
 */
import { ABILITIES } from '../ui/field-options.mjs';
import { PROMPT_EXAMPLES } from '../../data/item-from-words-examples.mjs';
import { isPartyTag } from '../../data/tag-vocabulary.mjs';
import { WEAPON_TAG_NAMESPACES } from './draft-fields.mjs';
import {
  PROMPT_INTRO, PROMPT_INTRO_TYPED, PROMPT_RULES, PROMPT_SHAPE, PROMPT_HEADINGS, PROMPT_FIELD_NOTES, PROMPT_FIELD_TYPE_WORDS
} from './prompt-text.mjs';

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/** `name (number, integer, min 0; one of: a, b; an id from skills)`. A list the vocabulary also prints once (damage types, stats, slots, weapon tags) is named instead of repeated. */
function fieldText(field, shared) {
  const notes = [(field.path && PROMPT_FIELD_TYPE_WORDS[field.path]) || field.type];
  if (field.integer) notes.push('integer');
  if (field.min !== undefined) notes.push(`min ${field.min}`);
  if (field.max !== undefined) notes.push(`max ${field.max}`);
  if (field.choices?.length) {
    const choices = field.choices.filter((c) => c !== '');
    const named = shared.find(([list]) => list.length && sameList(list, choices));
    notes.push(named ? `one of ${named[1]}` : `one of: ${choices.join(', ')}`);
  }
  if (field.ref) notes.push(`an id from the ${field.ref} list`);
  if (field.path && PROMPT_FIELD_NOTES[field.path]) notes.push(PROMPT_FIELD_NOTES[field.path]);
  return `${field.path ?? field.name} (${notes.join(', ')})`;
}

const fieldsTextOf = (fields, shared) => fields.map((field) => fieldText(field, shared)).join('; ');
const idList = (entries) => entries.map(({ id, label }) => (label && label !== id ? `${id} (${label})` : id)).join(', ');
const holdsWeapon = (vocabulary) => vocabulary.types.some((type) => type.id === 'weapon');

function vocabularyLines(vocabulary) {
  const shared = [
    [vocabulary.damageTypes, 'the damage types'], [vocabulary.stats, 'the stats'],
    [vocabulary.slots.map((s) => s.id), 'the gear slots'], [vocabulary.weaponTags.map((t) => t.id), 'the weapon, weaponClass and weaponGroup tags in TAGS']
  ];
  const fieldsText = (fields) => fieldsTextOf(fields, shared);
  const lines = [vocabulary.types.length === 1
    ? 'Item type (the "type" value) and the "system" fields it takes:'
    : 'Item types (the "type" value) and the "system" fields each takes:'];
  for (const type of vocabulary.types) {
    lines.push(`- ${type.id}: ${type.label}. Fields: ${fieldsText(type.fields)}. Row arrays: ${type.arrays.join(', ')}.`);
  }
  if (Object.keys(vocabulary.rows).length) lines.push('Row arrays. Each row names its kind in the kind field and may carry "label" and "condition":');
  for (const [array, kinds] of Object.entries(vocabulary.rows)) {
    const kindField = kinds[0]?.kindField ?? 'kind';
    lines.push(`${array} (kind field "${kindField}"; condition prefixes: ${vocabulary.roles[array].join(', ')}):`);
    for (const kind of kinds) {
      const hint = kind.hint && kind.hint !== kind.label ? ` ${kind.hint}` : '';
      lines.push(`  - ${kind.kind} "${kind.label}": ${kind.fields.length ? fieldsText(kind.fields) : 'no fields'}.${hint}`);
    }
  }
  if (vocabulary.grants.length) {
    lines.push('grants (fixed rows, "kind" and "label" plus):');
    for (const grant of vocabulary.grants) lines.push(`  - ${grant.kind}: ${fieldsText(grant.fields)}.`);
  }
  if (holdsWeapon(vocabulary)) lines.push('A weapon deals its Skill\'s Base Damage: set baseDamage (dice, stat, damageType) only to change it, and add bonus damage as a damageModifiers row of mode add.');
  if (vocabulary.outcomes.length) {
    lines.push('outcomes (loot rows, "type" plus):');
    for (const outcome of vocabulary.outcomes) lines.push(`  - ${outcome.type} "${outcome.label}": ${fieldsText(outcome.fields)}.`);
  }
  if (vocabulary.slots.length) lines.push(`Gear slots: ${idList(vocabulary.slots)}.`);
  if (vocabulary.damageTypes.length) lines.push(`Damage types: ${vocabulary.damageTypes.join(', ')}.`);
  if (vocabulary.stats.length) lines.push(`Stats: ${vocabulary.stats.map((stat) => (ABILITIES[stat] ? `${stat} (${ABILITIES[stat]})` : stat)).join(', ')}.`);
  for (const [kind, entries] of Object.entries(vocabulary.catalogs)) {
    if (!entries.length && !vocabulary.omitted[kind]) continue;
    const more = vocabulary.omitted[kind] ? ` (and ${vocabulary.omitted[kind]} more: write the plain name)` : '';
    lines.push(`Known ${kind} (id, name): ${entries.map((e) => `${e.identifier} (${e.name})`).join(', ') || 'none'}${more}.`);
  }
  return lines;
}

/**
 * The tag namespaces whose descriptions the TAGS section prints (7.54, Question 1097): what a weapon, weapon class, weapon
 * group or item kind tag means is not obvious from its label. Every other tag prints its id (and a label only when it says
 * more than the id); the prompt is pasted into a chatbot with a character limit. The three weapon namespaces are described
 * only in a prompt that holds the weapon type (7.73).
 */
const PROMPT_TAG_DESCRIPTION_NAMESPACES = Object.freeze(['weapon', 'weaponClass', 'weaponGroup', 'kind']);

/** `id`, then `[Label: description]` where either says more than the id, then `[engine]`. */
function tagItem(tag, described) {
  const leaf = tag.id.split('.').pop().split('_').join(' ').toLowerCase();
  const label = tag.label && tag.label.toLowerCase() !== leaf ? tag.label : '';
  const description = described && tag.description ? tag.description : '';
  const note = [label, description].filter(Boolean).join(': ');
  return `${tag.id}${note ? ` [${note}]` : ''}${tag.engine ? ' [engine]' : ''}`;
}

/** One line per namespace: `situation: situation.in_combat, ...`; a party namespace is headed "(with a prefix only)". */
function tagLines(tags, weapon) {
  const byNamespace = new Map();
  for (const tag of tags) {
    if (!byNamespace.has(tag.namespace)) byNamespace.set(tag.namespace, []);
    byNamespace.get(tag.namespace).push(tag);
  }
  const lines = [];
  for (const [namespace, list] of byNamespace) {
    const described = PROMPT_TAG_DESCRIPTION_NAMESPACES.includes(namespace) && (weapon || !WEAPON_TAG_NAMESPACES.includes(namespace));
    const head = isPartyTag(list[0].id) ? `${namespace} (with a prefix only)` : namespace;
    lines.push(`${head}: ${list.map((tag) => tagItem(tag, described)).join(', ')}`);
  }
  return lines;
}

/** What a rule may need from the vocabulary, as a test of the vocabulary. */
const RULE_NEEDS = Object.freeze({
  rows: (v) => Object.keys(v.rows).length > 0,
  weaponTags: (v) => v.weaponTags.length > 0,
  outcomes: (v) => v.outcomes.length > 0,
  drBonus: (v) => v.types.some((type) => type.fields.some((field) => field.path === 'drBonus'))
});

/**
 * @param {string} words what the user typed
 * @param {object} vocabulary a `describeVocabulary()` result (its `type` option makes a prompt for one item type)
 * @returns {string}
 */
export function buildItemPrompt(words, vocabulary) {
  const h = PROMPT_HEADINGS;
  const request = String(words ?? '').trim();
  const single = vocabulary.types.length === 1 ? vocabulary.types[0] : null;
  const intro = single ? PROMPT_INTRO_TYPED.replace('{type}', single.id).replace('{label}', single.label) : PROMPT_INTRO;
  const example = PROMPT_EXAMPLES[single?.id] ?? PROMPT_EXAMPLES.gear;
  const rules = PROMPT_RULES.filter((rule) => rule.needs.every((need) => RULE_NEEDS[need](vocabulary)));
  return [
    intro,
    '',
    h.request,
    request,
    '',
    h.rules,
    ...rules.map((rule) => `- ${rule.text}`),
    '',
    h.shape,
    PROMPT_SHAPE,
    '',
    h.vocabulary,
    ...vocabularyLines(vocabulary),
    '',
    ...(vocabulary.tags.length ? [h.tags, ...tagLines(vocabulary.tags, holdsWeapon(vocabulary)), ''] : []),
    h.example,
    `Request: ${example.request}`,
    'Reply:',
    example.reply,
    '',
    h.request,
    request
  ].join('\n');
}
