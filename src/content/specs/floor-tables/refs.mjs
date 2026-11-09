/**
 * src/content/specs/floor-tables/refs.mjs
 * Option and reference helpers for the example Floor Simulator tables. Each helper returns one option
 * in the shape `buildRollTablePayload` takes (see src/data/builders/rolltable-payload.mjs). Catalog references carry
 * the catalog item's `_id` (for the compendium UUID) and its `system.identifier` (what the compiler matches on);
 * tests/content/floor-tables-examples-3-25c.test.mjs checks both against the shipped catalogs.
 */
import { SYSTEM_ID } from '../../../constants.mjs';
import { isHiddenId } from '../../visibility.mjs';

const packUuid = (pack, documentName, id) => `Compendium.${SYSTEM_ID}.${pack}.${documentName}.${id}`;

/** The example tables' own ids. The first ten characters differ per table, so result ids built from them do too. */
export const FLOOR_TABLE_IDS = Object.freeze({
  'floor.index.tutorial': 'dccflt0100000000',
  'floor.experience.crawlers': 'dccflt0200000000',
  'floor.experience.fate': 'dccflt0300000000',
  'floor.experience.mobs': 'dccflt0400000000',
  'floor.experience.places': 'dccflt0500000000',
  'floor.experience.traps': 'dccflt0600000000',
  'floor.experience.interview': 'dccflt0700000000',
  'floor.experience.floor3': 'dccflt0800000000',
  'floor.experience.floor4': 'dccflt0900000000',
  'floor.loot.starting': 'dccflt1000000000',
  'floor.loot.upgrade': 'dccflt1100000000',
  'floor.loot.spells': 'dccflt1200000000',
  'floor.loot.braceletRace': 'dccflt1300000000'
});

/** The compendium UUID of an example table, by its tableKey. */
export const floorTableUuid = (key) => packUuid('floor-tables', 'RollTable', FLOOR_TABLE_IDS[key]);

/** A named Skill option: a document result pointing at the catalog skill. A hidden (book) id gives no uuid: the option resolves by identifier. */
export const skill = (id, identifier, name) => (isHiddenId(id)
  ? { kind: 'named', docKind: 'skill', identifier, name }
  : { kind: 'named', docKind: 'skill', identifier, name, uuid: packUuid('skills', 'Item', id) });

/** A named Spell option on an experience row: a document result pointing at the catalog spell. */
export const namedSpell = (id, identifier, name) => (isHiddenId(id)
  ? { kind: 'named', docKind: 'spell', identifier, name }
  : { kind: 'named', docKind: 'spell', identifier, name, uuid: packUuid('spells', 'Item', id) });

/** A choice option: the player picks any catalog entry the tag query matches. */
export const choice = (docKind, query, label) => ({ kind: 'choice', docKind, query, label });

/** The `*` entry: a skill the player writes. The label is a suggested name only. */
export const custom = (label) => ({ kind: 'custom', label });

/** A Starting Loot slot at a tier; `spellsAllowed` offers "Spells instead". */
export const lootSlot = (slot, tier, spellsAllowed, label) => ({ kind: 'lootSlot', slot, tier, spellsAllowed, label });

/** A Scroll of Upgrade result: the Amazing Success trigger and the weapon's name addition. */
export const debuffTrigger = (identifier, nameAddition, label) =>
  ({ kind: 'asTrigger', trigger: { type: 'debuff', identifier }, nameAddition, extraTags: [], label });
export const narrativeTrigger = (text, nameAddition, label) =>
  ({ kind: 'asTrigger', trigger: { type: 'narrative', text }, nameAddition, extraTags: [], label });

/** A random-spell result: a document result pointing at the catalog spell. */
export const lootSpell = (id, identifier, name) => (isHiddenId(id)
  ? { kind: 'spell', identifier, name }
  : { kind: 'spell', identifier, name, uuid: packUuid('spells', 'Item', id) });

/** A race result: a named option that carries the race's `system.identifier` and no uuid (it resolves by identifier). */
export const raceResult = (identifier, name) => ({ kind: 'named', docKind: 'race', identifier, name });

/** Tag queries the choice options use. */
export const QUERIES = Object.freeze({
  weaponSkill: { all: ['kind.skill', 'skillGroup.weapon'] },
  unarmedSkill: { all: ['kind.skill', 'weaponClass.unarmed'] },
  movementSkill: { all: ['kind.skill', 'skillGroup.movement'] },
  trapSkill: { all: ['kind.skill', 'skillGroup.trap'] },
  attackSpell: { all: ['kind.spell', 'action.attack'] },
  utilitySpell: { all: ['kind.spell', 'action.passive'] },
  anySpell: { all: ['kind.spell'] }
});
