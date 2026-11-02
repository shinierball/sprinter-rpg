/**
 * Read-only description of what a race or class (or any item with typed rows) grants, for the item
 * sheet, the crawler sheet panel, chat cards and the PDF export.
 *
 * `DESCRIBERS` (wrapped by `describeItem` in `item-describer/`) read only structured fields (`grants`, the `*Modifiers` rows, `senses`,
 * `requires`, `startingItems`, `statCaps`, `movement`, `drBonus`, descriptive tags). Skill and spell names come
 * from the referenced document through `resolveGrantDocument`, never from a row; a distinct row `label`
 * reads "Label: generated text". Text comes from the `COG.Feature.*` templates in `lang/en.json`.
 *
 * Each kind of source is one entry in `DESCRIBERS` (a group plus a function returning lines), so a new
 * row type adds an entry and nothing else. A field that is absent produces no lines.
 */
import { getTagDefinition } from '../data/tags.mjs';
import { describeScale, hasScale, scaleInert } from './scalars.mjs';
import { getRowKind, kindOf } from './row-kinds.mjs';
import { resolveGrantDocument, resolveGrantName } from '../data/race-class-grants.mjs';
import {
  summarizeRow
} from './modifier-summary.mjs';
import { str, signed, humanizeId } from './item-describer/shared.mjs';

/**
 * @typedef {object} FeatureLine
 * @property {string} text Display text ("Label: generated" when the row has a distinct label, else `generated`)
 * @property {string} generated What the row does in words, whatever its label says
 * @property {'stat'|'skill'|'spell'|'mod'|'tag'} kind
 * @property {'STAT'|'SKILL'|'SPELL'|'MOD'|'TAG'} badge
 * @property {string} rowPath Document path of the source row (for reference; the list has no inputs)
 * @property {string} ruleText Rules text shown as a tooltip (descriptive tags only)
 */

/** Default templates, identical to `COG.Feature` in lang/en.json (used when i18n is unavailable). */
export const FEATURE_TEMPLATES = Object.freeze({
  'COG.Feature.Stat': '{value} {stat}',
  'COG.Feature.StatPool': 'Distribute {value} points among {options}',
  'COG.Feature.StatCap': '{stat} cap {value}',
  'COG.Feature.SkillRank': '+{rank} {name}',
  'COG.Feature.SpellRank': '+{rank} {name}',
  'COG.Feature.GearRankBonus': '{value} Rank to {name}',
  'COG.Feature.GearSpellAtRank': '{name} at Rank {rank} if not known',
  'COG.Feature.SkillChoice': 'Choose {count} skill(s) at +{rank}: {options}',
  'COG.Feature.SpellChoice': 'Choose {count} spell(s) at +{rank}: {options}',
  'COG.Feature.RankBonus': '{value} rank to {target}',
  'COG.Feature.RankBonusFloor': '{text}, never below {floor}',
  'COG.Feature.RankBonusOwned': '{text}, only if owned',
  'COG.Feature.RankCap': 'Rank cap {value}: {target}',
  'COG.Feature.RankCapChoice': 'Rank cap {value} for {count} chosen skill(s)',
  'COG.Feature.Dr': '{value} DR',
  'COG.Feature.Walk': '{value} ft Walk speed',
  'COG.Feature.Speed': '{type} speed {value} ft',
  'COG.Feature.Darkvision': 'Darkvision {range} ft',
  'COG.Feature.DarkvisionUnlimited': 'Darkvision (unlimited)',
  'COG.Feature.VisionRange': 'Vision range x{multiplier}',
  'COG.Feature.RequiresAll': 'Requires {tags}',
  'COG.Feature.RequiresAny': 'Requires one of {tags}',
  'COG.Feature.RequiresNone': 'Cannot have {tags}',
  'COG.Feature.StartingItem': 'Starting item: {name} x{quantity}',
  'COG.Feature.StartingChoice': 'Starting item: choose one matching {tags}',
  'COG.Feature.ToHit': '{text} to hit',
  'COG.Feature.Checks': '{text} checks',
  'COG.Feature.ChecksStat': '{text} to checks',
  'COG.Feature.Advantage': 'Advantage on {scope}',
  'COG.Feature.Disadvantage': 'Disadvantage on {scope}',
  'COG.Feature.ScopeChecks': 'checks',
  'COG.Feature.ScopeAttacks': 'attacks',
  'COG.Feature.Scaled': '{text} {per}',
  'COG.Feature.ScaleInert': '{text} (cannot scale: does not apply)',
  'COG.Feature.Vulnerability': 'Double damage{type}',
  'COG.Feature.SuppressDr': 'DR does not apply{type}',
  'COG.Feature.ManaCostAdd': '{value} Mana cost',
  'COG.Feature.ManaCostMultiply': 'x{multiplier} Mana cost',
  'COG.Feature.Recovery': 'x{multiplier} {resource} recovery',
  'COG.Feature.StatSubstitution': 'Use {to} instead of {from} for {scope}',
  'COG.Feature.Popularity': '{value} Popularity on {event}',
  'COG.Feature.AiFavor': 'AI Favor {value}',
  'COG.Feature.PopularityEventCrit': 'a Critical Hit',
  'COG.Feature.PopularityEventCritFail': 'a Critical Fail',
  'COG.Feature.PopularityEventKill': 'a kill',
  'COG.Feature.PopularityOncePerCombat': 'once per combat',
  'COG.Feature.PopularityOncePerFloor': 'once per floor',
  'COG.Feature.MaxRank': 'if Rank ≤ {value}',
  'COG.Feature.MinRank': 'if Rank ≥ {value}',
  'COG.Feature.UsesPerFloor': 'once per floor',
  'COG.Feature.Limits': '{text} ({limits})',
  'COG.Feature.Condition': '{text} (when {tags})'
});

const STATS = ['str', 'dex', 'con', 'int', 'cha'];
const STAT_KEYS = { str: 'COG.Ability.Str', dex: 'COG.Ability.Dex', con: 'COG.Ability.Con', int: 'COG.Ability.Int', cha: 'COG.Ability.Cha' };
const STAT_NAMES = { 'COG.Ability.Str': 'Strength', 'COG.Ability.Dex': 'Dexterity', 'COG.Ability.Con': 'Constitution', 'COG.Ability.Int': 'Intelligence', 'COG.Ability.Cha': 'Charisma' };
const MOVE_TYPES = ['climb', 'swim', 'fly', 'burrow'];

/** Localize a key with `{name}` data: Foundry's i18n when it has the key, else the bundled template. */
function t(key, data = {}) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.format === 'function') return i18n.format(key, data);
  return String(FEATURE_TEMPLATES[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? ''));
}

/**
 * Fallback labels for the row editor's choice values (`COG.Rows.Choice.<field>.<value>`), used when Foundry has no
 * such key (headless tests). Identical to the `scope` and `resource` entries of `lang/en.json`.
 */
const CHOICE_FALLBACK = Object.freeze({
  scope: Object.freeze({ item: 'Only when this item is used', owner: 'Every roll of the owner', damage: 'Damage', check: 'Skill check', healthBar: 'Health Bar', lift: 'Lift limit' }),
  resource: Object.freeze({ mana: 'Mana', hp: 'Hit points' })
});

/** A row-editor choice value shown as its label ("healthBar" reads "Health Bar"); an unknown value reads as itself. */
export function choiceLabel(field, value) {
  const id = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  if (!id) return '';
  const key = `COG.Rows.Choice.${field}.${id}`;
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.localize === 'function') return i18n.localize(key);
  return CHOICE_FALLBACK[field]?.[id] ?? id;
}

const rows = (value) => (Array.isArray(value) ? value.filter((r) => r && typeof r === 'object') : []);
const tagList = (value) => (Array.isArray(value) ? value.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : []);

export function statName(key) {
  const loc = STAT_KEYS[key];
  if (!loc) return String(key || '').toUpperCase();
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(loc) && typeof i18n.localize === 'function') return i18n.localize(loc);
  return STAT_NAMES[loc];
}

const tagLabels = (tags) => tagList(tags).map((id) => getTagDefinition(id)?.label || id).join(', ');

/**
 * A line; the row's `label` rides along as `pendingLabel` until `withLabels` (which knows the item's name) folds it into
 * `text`. `subject` is the resolved name of the thing the line is about (a granted skill, spell, buff, item, table);
 * a label equal to it adds nothing and is left out (decision 334 a).
 */
function line(kind, text, rowPath, row, ruleText = '', subject = '') {
  const out = { text, generated: text, kind, badge: kind.toUpperCase(), rowPath, ruleText };
  const label = str(row?.label);
  if (label) out.pendingLabel = label;
  if (str(subject)) out.subject = str(subject);
  return out;
}

/**
 * Decision 332 (a): a labelled row reads "Label: what it does". The label is left out when it is empty, equals the
 * item's own name, equals the generated text or (334 a) equals the line's `subject`, the resolved name of the skill,
 * spell, buff, debuff, item or table it grants (all trimmed, case-insensitive). Comparing the two structured strings is
 * display de-duplication, not a mechanic, so it does not break CONTRIBUTING §2.
 * @param {FeatureLine[]} lines
 * @param {string} [itemName]
 */
export function applyRowLabels(lines, itemName = '') {
  const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const name = str(itemName);
  for (const l of lines) {
    const label = l.pendingLabel;
    delete l.pendingLabel;
    if (!label || (name && same(label, name)) || same(label, l.generated) || (l.subject && same(label, l.subject))) continue;
    l.text = `${label}: ${l.generated}`;
  }
  return lines;
}

/** Wrap a describer so its lines carry their row labels as "Label: text" (the item's name is the de-duplication key). */
const withLabels = (describe) => async (item, ...rest) => applyRowLabels(await describe(item, ...rest), item?.name);

/** Append the row's tag-query condition to generated text. */
function withCondition(text, condition) {
  const parts = [];
  const all = tagLabels(condition?.all);
  const any = tagLabels(condition?.any);
  const none = tagLabels(condition?.none);
  if (all) parts.push(all);
  if (any) parts.push(`any of ${any}`);
  if (none) parts.push(`not ${none}`);
  return parts.length ? t('COG.Feature.Condition', { text, tags: parts.join('; ') }) : text;
}

/** Name of the document a skill/spell row references; falls back to its stable identifier. */
async function referencedName(row, type) {
  return (await resolveGrantName(row, type)) || humanizeId(row.identifier);
}

function choiceOptions(row) {
  if (Array.isArray(row.options) && row.options.length) return row.options.join(', ');
  const q = row.query;
  if (q && typeof q === 'object') {
    return [tagLabels(q.all), tagLabels(q.any) && `any of ${tagLabels(q.any)}`].filter(Boolean).join('; ');
  }
  return str(row.category);
}

async function targetOf(row, type = 'skill') {
  if (row.identifier) return referencedName(row, type);
  if (row.tag) return tagLabels([row.tag]);
  return choiceOptions(row);
}

/* -------------------------------------------- */
/*  Describers (one per kind of source)         */
/* -------------------------------------------- */

async function describeStatGrants(item) {
  const grants = rows(item.system?.grants);
  const out = [];
  const statGrants = grants.map((g, i) => ({ g, i })).filter(({ g }) => g.kind === 'stat');
  for (const { g, i } of statGrants) {
    const path = `system.grants.${i}`;
    if (g.mode === 'pool') {
      const options = (Array.isArray(g.options) ? g.options : []).map(statName).join(', ');
      out.push(line('stat', t('COG.Feature.StatPool', { value: Number(g.value) || 0, options }), path, g));
    } else {
      const value = Number(g.value) || 0;
      out.push(line('stat', t('COG.Feature.Stat', { value: signed(value), stat: statName(g.stat) }), path, g));
    }
  }
  return out;
}

async function describeStatCaps(item) {
  const out = [];
  for (const key of STATS) {
    const cap = item.system?.statCaps?.[key];
    if (cap === null || cap === undefined || cap === '') continue;
    out.push(line('stat', t('COG.Feature.StatCap', { stat: statName(key), value: Number(cap) }), `system.statCaps.${key}`, null));
  }
  return out;
}

async function describeSkillGrants(item) {
  const out = [];
  const grants = rows(item.system?.grants);
  for (let i = 0; i < grants.length; i++) {
    const g = grants[i];
    const path = `system.grants.${i}`;
    const rank = Number(g.rank) || 1;
    if ((g.kind === 'skill' || g.kind === 'spell') && item.type === 'gear' && g.mode !== 'choice') {
      // Gear works through `value`: it adds to the owned skill or spell. A spell row's `rank` is only the Rank an unowned
      // spell is granted at (see gear-grants.mjs).
      const name = await referencedName(g, g.kind);
      const value = Number(g.value) || 0;
      const text = g.kind === 'spell' && value === 0 && Number(g.rank) > 0
        ? t('COG.Feature.GearSpellAtRank', { name, rank: Math.floor(Number(g.rank)) })
        : t('COG.Feature.GearRankBonus', { value: signed(value), name });
      out.push(line(g.kind, text, path, g, '', name));
    } else if (g.kind === 'skill' || g.kind === 'spell') {
      const isSkill = g.kind === 'skill';
      if (g.mode === 'choice') {
        const key = isSkill ? 'COG.Feature.SkillChoice' : 'COG.Feature.SpellChoice';
        out.push(line(g.kind, t(key, { count: Number(g.count) || 1, rank, options: choiceOptions(g) }), path, g));
      } else {
        const key = isSkill ? 'COG.Feature.SkillRank' : 'COG.Feature.SpellRank';
        const name = await referencedName(g, g.kind);
        out.push(line(g.kind, t(key, { rank, name }), path, g, '', name));
      }
    } else if (g.kind === 'rank_bonus') {
      const target = await targetOf(g);
      let text = t('COG.Feature.RankBonus', { value: signed(Number(g.value) || 0), target });
      if (Number(g.floor) > 0) text = t('COG.Feature.RankBonusFloor', { text, floor: Number(g.floor) });
      if (g.onlyIfOwned) text = t('COG.Feature.RankBonusOwned', { text });
      out.push(line('skill', text, path, g, '', target));
    } else if (g.kind === 'rank_cap') {
      const target = g.mode === 'choice' ? '' : await targetOf(g);
      const text = g.mode === 'choice'
        ? t('COG.Feature.RankCapChoice', { value: Number(g.value) || 0, count: Number(g.count) || 1 })
        : t('COG.Feature.RankCap', { value: Number(g.value) || 0, target });
      out.push(line('skill', text, path, g, '', target));
    }
  }
  return out;
}

/* ---- One row to its generated text (sync: the row editor's "Reads as" line and the async describers share it) ---- */

/** "<text> per Health Bar slot lost", with " (base 1, 0.1 each)" when the row sets `base` or `per` (E3). */
function withScale(text, row, arrayKey) {
  if (!hasScale(row)) return text;
  if (arrayKey && scaleInert(arrayKey, row)) return t('COG.Feature.ScaleInert', { text });
  const spec = row.scaleBy;
  const detail = [];
  if (spec.base !== null && spec.base !== undefined && spec.base !== '') detail.push(`base ${Number(spec.base)}`);
  if (spec.per !== null && spec.per !== undefined && spec.per !== '') detail.push(`${Number(spec.per)} each`);
  return t('COG.Feature.Scaled', { text, per: describeScale(spec) }) + (detail.length ? ` (${detail.join(', ')})` : '');
}

/** "(if Rank <= 9, once per floor)" for a roll row's `maxRank` ceiling and `usesPer` limit; the text unchanged without either. */
function withRowLimits(text, row) {
  const limits = [];
  const max = row.maxRank;
  if (max !== null && max !== undefined && max !== '' && Number.isFinite(Number(max))) limits.push(t('COG.Feature.MaxRank', { value: Number(max) }));
  if (row.usesPer === 'floor') limits.push(t('COG.Feature.UsesPerFloor'));
  return limits.length ? t('COG.Feature.Limits', { text, limits: limits.join(', ') }) : text;
}

const cap = (word) => word.charAt(0).toUpperCase() + word.slice(1);

function defenseText(row) {
  const type = row.damageType ? ` (${row.damageType})` : '';
  let text;
  if (row.kind === 'vulnerability') text = t('COG.Feature.Vulnerability', { type });
  else if (row.kind === 'suppress_dr') text = t('COG.Feature.SuppressDr', { type });
  else text = withScale(summarizeRow('defenseModifiers', row), row, 'defenseModifiers');
  return [withCondition(text, row.condition)];
}

function damageText(row) {
  return [withCondition(withScale(summarizeRow('damageModifiers', row), row, 'damageModifiers'), row.condition)];
}

/** attackModifiers / checkModifiers rows: by kind, the amount (`bonus`) or the advantage line (`advantage`). */
function rollTexts(field, amountKey, scopeKey, statKey = amountKey) {
  return (row) => {
    const out = [];
    // The row's kind says what it does: a kind with a rollBonus handler adds an amount, one with rollAdvantage grants it.
    const def = getRowKind(field, kindOf(field, row));
    if (def?.apply?.rollBonus) {
      // A bare stat reads "+INT to checks", an amount "+2 checks"
      const key = str(row.stat) ? statKey : amountKey;
      out.push(withRowLimits(withCondition(withScale(t(key, { text: summarizeRow(field, row) }), row, field), row.condition), row));
    }
    if (def?.apply?.rollAdvantage && (row.advantage === 'advantage' || row.advantage === 'disadvantage')) {
      const key = row.advantage === 'advantage' ? 'COG.Feature.Advantage' : 'COG.Feature.Disadvantage';
      out.push(withRowLimits(withCondition(withScale(t(key, { scope: t(scopeKey) }), row, field), row.condition), row));
    }
    return out;
  };
}

function manaCostText(row) {
  const text = row.mode === 'multiply'
    ? t('COG.Feature.ManaCostMultiply', { multiplier: Number(row.multiplier) })
    : t('COG.Feature.ManaCostAdd', { value: signed(Number(row.value) || 0) });
  return [withCondition(withScale(text, row, 'manaCostModifiers'), row.condition)];
}

function recoveryText(row) {
  return [withCondition(withScale(t('COG.Feature.Recovery', { multiplier: Number(row.multiplier), resource: choiceLabel('resource', row.resource) }), row, 'recoveryModifiers'), row.condition)];
}

function substitutionText(row) {
  return [withCondition(t('COG.Feature.StatSubstitution', { to: statName(row.to), from: statName(row.from), scope: choiceLabel('scope', row.scope) }), row.condition)];
}

/** Popularity triggers (spec 3.9a Q6): "+1 Popularity on a Critical Hit (once per combat)". */
function popularityText(row) {
  const event = t(`COG.Feature.PopularityEvent${cap(String(row.event))}`);
  const once = row.oncePer ? ` (${t(`COG.Feature.PopularityOncePer${cap(String(row.oncePer))}`)})` : '';
  let text = withScale(t('COG.Feature.Popularity', { value: signed(Math.trunc(Number(row.value) || 0)), event }) + once, row, 'popularityTriggers');
  // The Rank gate (3.13-4): a skill's row applies only from its `minRank` (`evaluateRows`).
  const min = Math.trunc(Number(row.minRank) || 0);
  if (min > 0) text = t('COG.Feature.Limits', { text, limits: t('COG.Feature.MinRank', { value: min }) });
  return [withCondition(text, row.condition)];
}

/** AI Favor rating rows (3.25d): "AI Favor 2" plus the condition text. */
function aiFavorText(row) {
  return [withCondition(t('COG.Feature.AiFavor', { value: Math.trunc(Number(row.value) || 0) }), row.condition)];
}

const ROW_TEXTS = Object.freeze({
  defenseModifiers: defenseText,
  damageModifiers: damageText,
  attackModifiers: rollTexts('attackModifiers', 'COG.Feature.ToHit', 'COG.Feature.ScopeAttacks'),
  checkModifiers: rollTexts('checkModifiers', 'COG.Feature.Checks', 'COG.Feature.ScopeChecks', 'COG.Feature.ChecksStat'),
  manaCostModifiers: manaCostText,
  recoveryModifiers: recoveryText,
  statSubstitutions: substitutionText,
  popularityTriggers: popularityText,
  aiFavorRatings: aiFavorText
});

/**
 * The generated text of one modifier row, ignoring its `label` and `disabled` flag: what the row does, in words. A roll
 * row can read as two lines (an amount and an advantage); a row that does nothing reads as none.
 * @param {string} arrayKey a modifier array key (`damageModifiers`, ...)
 * @param {object} row
 * @returns {string[]}
 */
export function describeRow(arrayKey, row) {
  const fn = ROW_TEXTS[arrayKey];
  if (!fn || !row || typeof row !== 'object') return [];
  return fn(row);
}

/** Describer for one row array: a line per generated text of each enabled row (a row's `label` prefixes the text). */
function rowArrayDescriber(arrayKey) {
  return async (item) => {
    const out = [];
    rows(item.system?.[arrayKey]).forEach((row, i) => {
      if (row.disabled === true) return;
      for (const generated of describeRow(arrayKey, row)) out.push(line('mod', generated, `system.${arrayKey}.${i}`, row));
    });
    return out;
  };
}

const describeDefenses = async (item) => {
  const out = [];
  if (Number(item.system?.drBonus)) out.push(line('mod', t('COG.Feature.Dr', { value: signed(Number(item.system.drBonus)) }), 'system.drBonus', null));
  out.push(...await rowArrayDescriber('defenseModifiers')(item));
  return out;
};

async function describeMovement(item) {
  const move = item.system?.movement;
  const out = [];
  if (Number(move?.walkDelta)) out.push(line('mod', t('COG.Feature.Walk', { value: signed(Number(move.walkDelta)) }), 'system.movement.walkDelta', null));
  for (const type of MOVE_TYPES) {
    if (Number(move?.[type])) {
      const label = type.charAt(0).toUpperCase() + type.slice(1);
      out.push(line('mod', t('COG.Feature.Speed', { type: label, value: Number(move[type]) }), `system.movement.${type}`, null));
    }
  }
  return out;
}

async function describeSenses(item) {
  const senses = item.system?.senses;
  const out = [];
  if (!senses || typeof senses !== 'object') return out;
  if (senses.darkvisionUnlimited) out.push(line('mod', t('COG.Feature.DarkvisionUnlimited'), 'system.senses.darkvisionUnlimited', null));
  else if (Number(senses.darkvision) > 0) out.push(line('mod', t('COG.Feature.Darkvision', { range: Number(senses.darkvision) }), 'system.senses.darkvision', null));
  const mult = Number(senses.rangeMultiplier);
  if (Number.isFinite(mult) && mult !== 1) out.push(line('mod', t('COG.Feature.VisionRange', { multiplier: mult }), 'system.senses.rangeMultiplier', null));
  return out;
}

async function describeRequires(item) {
  const q = item.system?.requires;
  const out = [];
  if (!q || typeof q !== 'object') return out;
  if (tagList(q.all).length) out.push(line('mod', t('COG.Feature.RequiresAll', { tags: tagLabels(q.all) }), 'system.requires.all', null));
  if (tagList(q.any).length) out.push(line('mod', t('COG.Feature.RequiresAny', { tags: tagLabels(q.any) }), 'system.requires.any', null));
  if (tagList(q.none).length) out.push(line('mod', t('COG.Feature.RequiresNone', { tags: tagLabels(q.none) }), 'system.requires.none', null));
  return out;
}

async function describeStartingItems(item) {
  const out = [];
  const entries = rows(item.system?.startingItems);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const path = `system.startingItems.${i}`;
    const quantity = Number(entry.quantity) || 1;
    if (entry.mode === 'choice') {
      out.push(line('mod', t('COG.Feature.StartingChoice', { tags: tagLabels(entry.query?.all) || tagLabels(entry.query?.any) }), path, entry));
      continue;
    }
    const isActor = typeof entry.itemType === 'string' && entry.itemType.startsWith('actor:');
    const doc = !isActor && (entry.uuid || entry.identifier) ? await resolveGrantDocument(entry, entry.itemType || undefined) : null;
    const name = doc?.name || humanizeId(str(entry.identifier) || str(entry.itemType));
    out.push(line('mod', t('COG.Feature.StartingItem', { name, quantity }), path, entry, '', name));
  }
  return out;
}

async function describeDescriptiveTags(item) {
  const out = [];
  for (const id of tagList(item.system?.tags)) {
    const def = getTagDefinition(id);
    if (def?.descriptive !== true) continue;
    out.push({ text: def.label || id, generated: def.label || id, kind: 'tag', badge: 'TAG', rowPath: 'system.tags', ruleText: def.description || '' });
  }
  return out;
}

/** The kinds of source, each with the group its lines sort into (rulebook order: stats, skills, defenses, other, descriptive). */
export const DESCRIBERS = Object.freeze([
  { group: 'stat', describe: withLabels(describeStatGrants) },
  { group: 'stat', describe: withLabels(describeStatCaps) },
  { group: 'skill', describe: withLabels(describeSkillGrants) },
  { group: 'defense', describe: withLabels(describeDefenses) },
  { group: 'other', describe: withLabels(rowArrayDescriber('damageModifiers')) },
  { group: 'other', describe: withLabels(rowArrayDescriber('attackModifiers')) },
  { group: 'other', describe: withLabels(rowArrayDescriber('checkModifiers')) },
  { group: 'other', describe: withLabels(rowArrayDescriber('manaCostModifiers')) },
  { group: 'other', describe: withLabels(rowArrayDescriber('recoveryModifiers')) },
  { group: 'other', describe: withLabels(rowArrayDescriber('statSubstitutions')) },
  { group: 'other', describe: withLabels(rowArrayDescriber('popularityTriggers')) },
  { group: 'other', describe: withLabels(rowArrayDescriber('aiFavorRatings')) },
  { group: 'other', describe: withLabels(describeMovement) },
  { group: 'other', describe: withLabels(describeSenses) },
  { group: 'other', describe: withLabels(describeRequires) },
  { group: 'other', describe: withLabels(describeStartingItems) },
  { group: 'descriptive', describe: withLabels(describeDescriptiveTags) }
]);
