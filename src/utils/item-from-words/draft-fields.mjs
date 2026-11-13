/**
 * src/utils/item-from-words/draft-fields.mjs
 * What an item draft ("Item from words", 7.43) may set, per type. One allow-list of `system` paths (the models also hold
 * play state a draft must not write), the field types read from the DataModel schema, and the tables that name where
 * an open-vocabulary field draws its ids. Pure: reads `CONFIG` and the registries only when a function runs.
 */
import { GEAR_SLOTS } from '../gear/gear-slots.mjs';
import { STAT_KEYS } from '../../models/actors/actor-derivation.mjs';
import { DEBUFF_SEVERITIES } from '../../models/items/debuff-model.mjs';
import { configuredDamageTypes } from '../ui/field-options.mjs';
import { RESTORE_RESOURCES, OUTCOME_TARGET_TYPES, OUTCOME_EXECUTION_MODES } from '../loot/outcome-defaults.mjs';
import { timeUnitsFor } from '../time/timing.mjs';
import { tagCatalog } from '../tag/tag-list.mjs';

/** The item types a first-release draft may name (decision 1054). `weapon` is `buildPayload`'s pseudo-type for weapon gear. */
export const DRAFT_TYPES = Object.freeze(['gear', 'weapon', 'loot', 'buff', 'debuff']);

/** The words a chatbot reads for each draft type. */
export const DRAFT_TYPE_LABELS = Object.freeze({
  gear: 'Gear: worn or carried equipment',
  weapon: 'Weapon: a gear item wielded in the hands',
  loot: 'Loot: a consumable, a spell scroll or a wand',
  buff: 'Buff: a beneficial effect',
  debuff: 'Debuff: a harmful effect'
});

/** The DataModel a draft type is read against: a weapon is a gear item. */
const modelTypeOf = (type) => (type === 'weapon' ? 'gear' : type);

/** The four row arrays a draft may fill with modifier rows, in prompt order. */
export const MODIFIER_ARRAYS = Object.freeze(['damageModifiers', 'defenseModifiers', 'attackModifiers', 'checkModifiers']);

/** The loot types the first release writes (the other loot types have their own creators). */
const DRAFT_LOOT_TYPES = Object.freeze(['consumable', 'scroll', 'wand']);

/** The tag namespaces a weapon's `tags` may use. */
export const WEAPON_TAG_NAMESPACES = Object.freeze(['weapon', 'weaponClass', 'weaponGroup']);

const GEAR_SCALARS = ['slot', 'quantity', 'value', 'drBonus', 'healing.hasHealing', 'healing.barsPerRound'];
const GEAR_ARRAYS = ['grants', ...MODIFIER_ARRAYS, 'persistentBuffs', 'persistentDebuffs'];
const EFFECT_ARRAYS = ['grants', ...MODIFIER_ARRAYS];

const deepFreeze = (table) => Object.freeze(Object.fromEntries(Object.entries(table).map(([type, f]) => [type, Object.freeze({ scalars: Object.freeze(f.scalars), arrays: Object.freeze(f.arrays) })])));

/**
 * The `system` paths a draft may set, per type. Dotted paths are nested objects (`durationConfig.type`). Scalars are
 * read through the DataModel field at the path (`fieldSpec`); each array path has its own row shape (check-draft.mjs).
 */
export const DRAFT_FIELDS = deepFreeze({
  gear: { scalars: GEAR_SCALARS, arrays: GEAR_ARRAYS },
  weapon: { scalars: [...GEAR_SCALARS, 'wieldMode', 'critMultiplier', 'baseDamage.dice', 'baseDamage.stat', 'baseDamage.damageType'], arrays: [...GEAR_ARRAYS, 'tags', 'associatedSkills', 'onHit.debuffs'] },
  buff: { scalars: ['healingPerRound', 'durationConfig.type', 'durationConfig.value'], arrays: EFFECT_ARRAYS },
  debuff: { scalars: ['severity', 'damagePerRound', 'damageType', 'repeat.mode', 'repeat.into', 'durationConfig.type', 'durationConfig.value'], arrays: [...EFFECT_ARRAYS, 'alsoApplies'] },
  loot: { scalars: ['lootType', 'quantity', 'value', 'executionMode', 'charges.value', 'charges.max', 'spellIdentifier'], arrays: ['outcomes'] }
});

/** The fixed grant rows a draft may write: the row's `kind` and the fields it carries (every row also takes `label`). */
export const GRANT_DRAFT_FIELDS = Object.freeze({
  stat: Object.freeze(['stat', 'value']),
  skill: Object.freeze(['identifier', 'value']),
  spell: Object.freeze(['identifier', 'rank'])
});

const TEXT = Object.freeze({ type: 'string' });
/** A number field of an outcome row: its minimum, and whether the engine reads it as a whole number. */
const count = (min, integer = true) => Object.freeze({ type: 'number', ...(min === undefined ? {} : { min }), ...(integer ? { integer: true } : {}) });

/** Fields every outcome row takes, with their value types and limits (the same `{ type, integer?, min? }` a schema field reports). */
export const OUTCOME_COMMON_FIELDS = Object.freeze({ name: TEXT, targetType: TEXT, weight: count(0) });

/**
 * Loot outcome rows (`system.outcomes[]`, an untyped ObjectField): per outcome `type`, the fields a draft may set and
 * their value types and minimums. A hand-written table because no schema knows these keys (step doc 7.43 section 2.4). Outcome types
 * left out come back as dropped rows.
 */
export const OUTCOME_DRAFT_FIELDS = Object.freeze({
  heal: Object.freeze({ healBars: count(1) }),
  heal_over_time: Object.freeze({ healBars: count(1), rounds: count(1) }),
  damage: Object.freeze({ damage: TEXT, damageType: TEXT }),
  restore_resource: Object.freeze({ resource: TEXT, amount: count(0, false) }),
  buff: Object.freeze({ buffIdentifier: TEXT }),
  debuff: Object.freeze({ debuffIdentifier: TEXT }),
  skill_rank: Object.freeze({ skillIdentifier: TEXT, rankBonus: count(0) }),
  stat_permanent: Object.freeze({ stat: TEXT, value: count(undefined, false) })
});

/** The catalog kinds a draft may reference. */
export const CATALOG_KINDS = Object.freeze(['skills', 'spells', 'buffs', 'debuffs']);

/** Which catalog a reference field names: string lists, one scalar, a grant row's `identifier` by grant kind, and outcome fields. */
export const LIST_REFERENCES = Object.freeze({ associatedSkills: 'skills', persistentBuffs: 'buffs', persistentDebuffs: 'debuffs', alsoApplies: 'debuffs', 'onHit.debuffs': 'debuffs' });
export const SCALAR_REFERENCES = Object.freeze({ spellIdentifier: 'spells' });
export const GRANT_REFERENCES = Object.freeze({ skill: 'skills', spell: 'spells' });
export const OUTCOME_REFERENCES = Object.freeze({ skillIdentifier: 'skills', buffIdentifier: 'buffs', debuffIdentifier: 'debuffs' });

const statKeys = () => [...STAT_KEYS];

/**
 * Where each open-vocabulary field draws its ids, keyed by its path under `system` (rows and outcomes as
 * `<array>.<field>`). A field the schema gives `choices` needs no entry. Each value returns a fresh list at call time,
 * so a module's slot, damage type, duration unit or weapon tag is included.
 */
export const VOCAB_SOURCES = Object.freeze({
  slot: () => Object.keys(GEAR_SLOTS),
  severity: () => [...DEBUFF_SEVERITIES],
  'durationConfig.type': () => timeUnitsFor('duration').map((unit) => unit.id),
  lootType: () => [...DRAFT_LOOT_TYPES],
  executionMode: () => [...OUTCOME_EXECUTION_MODES],
  damageType: configuredDamageTypes,
  'damageModifiers.damageType': configuredDamageTypes,
  'defenseModifiers.damageType': configuredDamageTypes,
  'baseDamage.damageType': configuredDamageTypes,
  'baseDamage.stat': statKeys,
  'grants.stat': statKeys,
  'outcomes.stat': statKeys,
  'outcomes.damageType': configuredDamageTypes,
  'outcomes.resource': () => RESTORE_RESOURCES.map((r) => r.value),
  'outcomes.targetType': () => [...OUTCOME_TARGET_TYPES],
  tags: () => tagCatalog().filter((tag) => WEAPON_TAG_NAMESPACES.includes(tag.namespace)).map((tag) => tag.id)
});

/**
 * The type of the DataModel field at `path` under `system` (`gear` reads the gear model). Arrays are walked through
 * their element, so `damageModifiers.value` is the row field. `null` when the model or the path does not exist.
 * @param {string} type a draft type
 * @param {string} path dotted path under `system`
 * @returns {{ type: 'number'|'string'|'boolean'|'array'|'object', integer?: boolean, min?: number, max?: number, choices?: string[] }|null}
 */
export function fieldSpec(type, path) {
  let field = globalThis.CONFIG?.Item?.dataModels?.[modelTypeOf(type)]?.schema;
  for (const segment of String(path).split('.')) {
    while (field?.element && !field.fields) field = field.element;
    field = field?.fields?.[segment];
    if (!field) return null;
  }
  return describeField(field);
}

function describeField(field) {
  const fields = globalThis.foundry?.data?.fields;
  if (fields?.ArrayField && field instanceof fields.ArrayField) return { type: 'array' };
  if (fields?.SchemaField && field instanceof fields.SchemaField) return { type: 'object' };
  if (fields?.NumberField && field instanceof fields.NumberField) {
    const out = { type: 'number' };
    if (field.integer) out.integer = true;
    if (Number.isFinite(field.min)) out.min = field.min;
    if (Number.isFinite(field.max)) out.max = field.max;
    return out;
  }
  if (fields?.BooleanField && field instanceof fields.BooleanField) return { type: 'boolean' };
  if (fields?.StringField && field instanceof fields.StringField) {
    const choices = typeof field.choices === 'function' ? field.choices() : field.choices;
    const list = Array.isArray(choices) ? [...choices] : Object.keys(choices ?? {});
    return list.length ? { type: 'string', choices: list } : { type: 'string' };
  }
  return null;
}

/**
 * The values a field may take: the schema's `choices`, else its `VOCAB_SOURCES` entry; null when it is free.
 * @param {string} type a draft type
 * @param {string} path dotted path under `system`, as `fieldSpec` takes it
 * @returns {string[]|null}
 */
export function fieldChoices(type, path) {
  const spec = fieldSpec(type, path);
  if (spec?.choices) return spec.choices;
  const source = VOCAB_SOURCES[path];
  return source ? source() : null;
}
