/**
 * Sprinter RPG: the item setup window's generic fields. A kind (`src/data/item-setup/kinds/`) declares plain field data;
 * this file turns one field plus the current answers into the view the one partial (`templates/apps/item-setup/field.hbs`)
 * renders (`fieldView`: labels, option lists and `selected` flags precomputed, Principle 5), and reads a field's value back
 * off the page (`readField`). Every option source is built here over the helpers the item sheets already use, so a kind
 * names a source and never touches this file. No control has a `name`; they carry `data-field` (a value) or
 * `data-action` / `data-change-action` (a click or choice).
 *
 * Words: `COG.ItemSetup.Kind.<kind>.<field id>.Label` (or the field's own `labelKey`), `.Hint` when the key exists, and a
 * static option's `.Options.<value>`.
 */
import { statOptions, choiceOptions, configuredDamageTypes } from '../../utils/ui/field-options.mjs';
import { checkTypeOptions } from '../../data/rules/check-types.mjs';
import { GEAR_SLOTS } from '../../utils/gear/gear-slots.mjs';
import { lootBoxTierOptions } from '../../data/loot-box-tiers.mjs';
import { COG_ACHIEVEMENT_TIERS } from '../../data/rules/achievement-tiers.mjs';
import { BONUS_NUMBERS } from '../../utils/item-describer/space-upgrade-fields.mjs';
import { tableTypeOptions } from '../../documents/actor/space-purchases.mjs';
import { tagCatalog } from '../../utils/tag/tag-list.mjs';
import { toStringList } from '../../utils/first-scalar.mjs';
import { unitOptions } from '../../sheets/item/context-timing.mjs';
import { buildPickList, identifierEntries } from '../../sheets/item/context-pick-list.mjs';
import { getCompendiumSkills, getAvailableSpells, getAvailableBuffs, getAvailableDebuffs } from '../../sheets/item/catalogs.mjs';
import { HANDS_CHOICES, skillRows, typesFromFirstSkill, weaponTypeChoices } from '../../data/item-setup/kinds/weapon.mjs';
import { idList, checked, followedChoice } from '../../data/item-setup/answers.mjs';

const t = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;

/** A word that may not exist: '' when the key has no entry. */
const word = (key) => {
  const found = t(key);
  return found === key ? '' : found;
};

const lower = (v) => String(v ?? '').trim().toLowerCase();

/** The placeholder a dice box shows. */
const DICE_PLACEHOLDER = '1d8';

/** The lang key prefix of a kind's field. */
const wordBase = (kind, field) => `COG.ItemSetup.Kind.${kind}.${field.id}`;

// ---------------------------------------------------------------------------
// Option sources
// ---------------------------------------------------------------------------

const pairs = (list) => list.map(({ value, label }) => ({ value, label }));

/** The `choice` sources, each `({ kind, field }) => [{ value, label }]`. */
const CHOICE_SOURCES = {
  stats: () => pairs(statOptions('')),
  statsOrNone: () => [...pairs(statOptions('')), { value: 'none', label: t('COG.ItemSetup.Field.None') }],
  damageTypes: () => configuredDamageTypes().map((value) => ({ value, label: value })),
  checkTypes: ({ field }) => pairs(checkTypeOptions(undefined)).filter((o) => !field.values || field.values.includes(o.value)),
  slots: () => Object.values(GEAR_SLOTS).map((slot) => ({ value: slot.id, label: slot.label })),
  hands: ({ kind, field }) => HANDS_CHOICES.map((value) => ({ value, label: t(`${wordBase(kind, field)}.Options.${value}`) })),
  lootBoxTiers: () => lootBoxTierOptions().map((o) => ({ value: o.key, label: o.label })),
  achievementTiers: () => Object.values(COG_ACHIEVEMENT_TIERS).map(({ id, label }) => ({ value: id, label })),
  spaceBonuses: () => BONUS_NUMBERS.map(([value, label]) => ({ value, label })),
  tableTypes: () => tableTypeOptions().map(({ tag, label }) => ({ value: tag, label }))
};

/** The catalogs a `catalogPick` / `catalogList` reads: each a loader of catalog definitions. Read once per window. */
const CATALOGS = {
  attackSkills: async () => (await getCompendiumSkills()).filter((s) => s.system.checkType === 'attack'),
  skills: getCompendiumSkills,
  spells: getAvailableSpells,
  buffs: getAvailableBuffs,
  debuffs: getAvailableDebuffs
};

/**
 * Load the named catalogs into `into` (a name already there is kept), so a window reads each once.
 * @param {string[]} names catalog names (`attackSkills`, `skills`, `spells`, `buffs`, `debuffs`)
 * @param {object} [into]
 * @returns {Promise<object>} `into`
 */
export async function loadCatalogs(names, into = {}) {
  for (const name of names) {
    if (!into[name] && CATALOGS[name]) into[name] = await CATALOGS[name]();
  }
  return into;
}

/** The `tagChips` sources: `chips()` is every chip; `derive(ids, deps)` the tags a following field starts with. */
const CHIP_SOURCES = {
  weaponTypes: {
    chips: () => weaponTypeChoices(tagCatalog()),
    derive: (skillIds, deps) => typesFromFirstSkill(skillIds, deps.resolver)
  },
  skillGroups: {
    chips: () => tagCatalog().filter((tag) => tag.namespace === 'skillGroup').map((tag) => ({ id: tag.id, label: tag.label, description: tag.description ?? '' }))
  }
};

/**
 * The tags a chip field has selected: its own list, or while it follows another field the tags derived from that field.
 * @param {object} field a `tagChips` field
 * @param {object} answers
 * @param {{ resolver?: object }} deps
 * @returns {string[]}
 */
export function chipSelection(field, answers, deps) {
  const stored = answers?.[field.id];
  if (Array.isArray(stored)) return toStringList(stored);
  const derive = CHIP_SOURCES[field.chips]?.derive;
  return field.follows && derive ? derive(idList(answers?.[field.follows]), deps) : [];
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** Options with `selected`: exactly one is selected, the first when no value matches. `blank` (a lang key) adds a leading ''. */
function selectable(options, current, blank) {
  const list = blank ? [{ value: '', label: t(blank) }, ...options] : options.map((o) => ({ ...o }));
  const cur = String(current ?? '');
  const hit = Math.max(0, list.findIndex((o) => o.value === cur));
  return list.map((o, index) => ({ ...o, selected: index === hit }));
}

const TYPE_FLAGS = Object.freeze({
  text: 'isText', textarea: 'isTextarea', number: 'isNumber', checkbox: 'isCheckbox', choice: 'isChoice', duration: 'isDuration',
  baseDamage: 'isBaseDamage', catalogPick: 'isCatalogPick', catalogList: 'isCatalogList', tagChips: 'isTagChips'
});

function choiceOptionsFor(kind, field) {
  if (field.source) return CHOICE_SOURCES[field.source]?.({ kind, field }) ?? [];
  return (field.options ?? []).map((option) => (typeof option === 'string'
    ? { value: option, label: t(`${wordBase(kind, field)}.Options.${option}`) }
    : { value: option.value, label: t(option.labelKey) }));
}

function baseDamageView(kind, field, answers, deps, base) {
  const value = answers?.[field.id] ?? {};
  const prefix = field.prefix ?? field.id;
  const stats = [{ value: '', label: t(`${base}.StatOwn`) }, ...pairs(statOptions('')), { value: 'none', label: t(`${base}.StatNone`) }];
  const types = choiceOptions(configuredDamageTypes(), value.damageType);
  const typeOptions = field.inherit ? [{ value: '', label: t(`${base}.TypeOwn`), selected: !value.damageType }, ...types] : types;
  const filled = Boolean(value.dice || value.stat || value.damageType);
  return {
    dice: value.dice ?? '',
    dicePlaceholder: DICE_PLACEHOLDER,
    diceField: `${prefix}Dice`,
    statField: `${prefix}Stat`,
    typeField: `${prefix}Type`,
    collapsed: Boolean(field.collapsed),
    open: Boolean(field.collapsed) && (filled || Boolean(deps.openFields?.has(field.id))),
    statOptions: selectable(stats, value.stat),
    typeOptions: field.inherit ? typeOptions : selectable(types, value.damageType),
    diceLabel: t(`${base}.Dice`),
    statLabel: t(`${base}.Stat`),
    typeLabel: t(`${base}.Type`)
  };
}

function catalogListView(kind, field, answers, deps, base) {
  const ids = idList(answers?.[field.id]);
  const entries = identifierEntries(deps.catalogs?.[field.catalog] ?? []);
  const defaultTip = word(`${base}.Default`);
  const named = (identifier) => entries.find((e) => lower(e.value) === lower(identifier))?.label ?? identifier;
  const rows = field.showDamage
    ? skillRows(ids, deps.resolver)
    : ids.map((identifier) => ({ identifier, name: named(identifier), baseDamage: '', inWorld: true }));
  return {
    rows: rows.map((row, index) => ({
      ...row,
      index,
      isFirst: index === 0,
      isLast: index === rows.length - 1,
      defaultTip: index === 0 ? defaultTip : '',
      note: !field.showDamage ? '' : (!row.inWorld ? `(${t(`${base}.NotInWorld`)})` : (row.baseDamage || `(${t(`${base}.NoDamage`)})`))
    })),
    emptyText: t(`${base}.Empty`),
    moveUp: t(`${base}.MoveUp`),
    moveDown: t(`${base}.MoveDown`),
    remove: t(`${base}.Remove`),
    pick: buildPickList({
      label: t(`${base}.Label`), emptyText: t(`${base}.Empty`), choose: t(`${base}.Choose`),
      lists: [{ list: field.id, stored: ids, entries }]
    })
  };
}

function tagChipsView(field, answers, deps, base) {
  const chosen = new Set(chipSelection(field, answers, deps).map(lower));
  const chips = (CHIP_SOURCES[field.chips]?.chips() ?? []).map((chip) => ({ ...chip, selected: chosen.has(lower(chip.id)) }));
  return {
    chips,
    hasFollow: Boolean(field.follows),
    following: Boolean(field.follows) && !Array.isArray(answers?.[field.id]),
    followNote: word(`${base}.FromSkill`),
    followLink: t('COG.ItemSetup.Follow.UseFirst')
  };
}

/**
 * The view of one field for the partial: its words, its value or options with `selected` flags, and a flag for its type.
 * @param {string} kind the setup kind (its words are under `COG.ItemSetup.Kind.<kind>`)
 * @param {object} field `{ id, type, ...options }` (see `src/data/item-setup/kinds/`)
 * @param {object} answers the answers drafted so far
 * @param {{ resolver?: object, catalogs?: object, openFields?: Set<string>, rootId?: string }} [deps]
 * @returns {object}
 */
export function fieldView(kind, field, answers, deps = {}) {
  const base = wordBase(kind, field);
  const stored = answers?.[field.id];
  const view = {
    id: field.id,
    type: field.type,
    [TYPE_FLAGS[field.type] ?? 'isUnknown']: true,
    inputId: `${deps.rootId ?? 'cog-item-setup'}-${field.id}`,
    label: field.labelKey ? t(field.labelKey) : t(`${base}.Label`),
    hint: word(`${base}.Hint`)
  };
  switch (field.type) {
    case 'text':
    case 'textarea':
      return Object.assign(view, { value: stored ?? '', placeholder: field.placeholder ? t(field.placeholder) : '' });
    case 'number':
      return Object.assign(view, { value: stored ?? '', min: field.min ?? '' });
    case 'checkbox':
      return Object.assign(view, { checked: checked(stored) });
    case 'choice': {
      const options = choiceOptionsFor(kind, field);
      const current = field.follows ? followedChoice(field, answers, options.map((o) => o.value)) : stored;
      return Object.assign(view, { options: selectable(options, current, field.blank), rerender: Boolean(field.rerender) });
    }
    case 'duration': {
      const duration = stored ?? {};
      return Object.assign(view, {
        value: duration.value ?? '',
        valueField: `${field.id}Value`,
        unitField: `${field.id}Unit`,
        unitOptions: unitOptions('duration', String(duration.unit ?? ''))
      });
    }
    case 'baseDamage':
      return Object.assign(view, baseDamageView(kind, field, answers, deps, base));
    case 'catalogPick':
      return Object.assign(view, { options: selectable(identifierEntries(deps.catalogs?.[field.catalog] ?? []), stored, field.blank) });
    case 'catalogList':
      return Object.assign(view, catalogListView(kind, field, answers, deps, base));
    case 'tagChips':
      return Object.assign(view, tagChipsView(field, answers, deps, base));
    default:
      return view;
  }
}

/**
 * Read one field's value off the page. Returns undefined when the control is not on the page or the field's answer is held in
 * the window's state (a list or a chip set), so the caller leaves that answer alone.
 * A `choice` that `follows` another field stays following (`null`) while the control still shows what it follows.
 * @param {ParentNode} root
 * @param {object} field
 * @param {object} [answers] the answers before this read, for a following choice
 * @returns {*}
 */
export function readField(root, field, answers = {}) {
  const control = (key) => root.querySelector(`[data-field="${key}"]`);
  const value = (key) => control(key)?.value ?? '';
  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'number':
    case 'catalogPick':
      return control(field.id) ? value(field.id) : undefined;
    case 'choice': {
      if (!control(field.id)) return undefined;
      if (field.follows && answers[field.id] == null) {
        const values = [...control(field.id).querySelectorAll('option')].map((o) => o.getAttribute('value') ?? '');
        if (value(field.id) === followedChoice(field, answers, values)) return null;
      }
      return value(field.id);
    }
    case 'checkbox':
      return control(field.id) ? checked(control(field.id).checked) : undefined;
    case 'duration':
      return control(`${field.id}Value`) ? { value: value(`${field.id}Value`), unit: value(`${field.id}Unit`) } : undefined;
    case 'baseDamage': {
      const prefix = field.prefix ?? field.id;
      return control(`${prefix}Dice`) ? { dice: value(`${prefix}Dice`), stat: value(`${prefix}Stat`), damageType: value(`${prefix}Type`) } : undefined;
    }
    default:
      return undefined;
  }
}
