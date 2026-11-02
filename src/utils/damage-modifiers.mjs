import { getItemAllTags, identityTag, getTagDefinition, isTargetSensitiveTag, SAME_SIZE_SITUATION, USE_TAG_PREFIX, useTagFor } from '../data/tags.mjs';
import { isWeaponGear } from './wield-mode.mjs';
import { floorRowsUsed } from './floor-row-usage.mjs';
import { matchesTagQuery, matchesTagQueryIgnoring, queryReferences } from './tag-query.mjs';
import { MAX_TARGET_ROWS, snapshotTargetRow } from './per-target-damage.mjs';
import { rankBreakRollRows } from './rank-breaks.mjs';
import { hasScale, scaleRow, isApplyScale, deferScale, normalizeScaleSpec, resolveApplyScale, clickTargetsOf } from './scalars.mjs';
import { collectItemSources, appendTagSources } from './tag-behaviour.mjs';
import { CHECK_TAGS, WIELD_TAGS, isTechniqueSkill } from './tag-mechanics.mjs';
import { ROW_ARRAYS, getRowKind, kindOf, rowKindOf, warnRowKindOnce, applyRowKind } from './row-kinds.mjs';

/**
 * Pure, synchronous evaluation engine for conditional damage, attack, check, and defense modifiers.
 * Evaluates structured tags without regex scanning or name parsing.
 */

/**
 * Builds the complete set of action tags describing an action:
 * Unions item tags, matching weapon skill tags, and roll-time wield overrides.
 *
 * @param {object} item - attack, weapon gear, skill, or spell item
 * @param {object} [skill=null] - matching weapon skill if weapon attack
 * @param {object} [options={}] - roll options (e.g. wieldedOneHanded, extraTags, tags)
 * @returns {Set<string>}
 */
export function buildActionTags(item, skill = null, options = {}) {
  const tags = new Set();

  if (item) {
    const itemTags = item.allTags instanceof Set ? item.allTags : getItemAllTags(item);
    for (const t of itemTags) tags.add(t);
  }

  if (skill) {
    const skillTags = skill.allTags instanceof Set ? skill.allTags : getItemAllTags(skill);
    for (const t of skillTags) tags.add(t);
  }

  if (Array.isArray(options.extraTags)) {
    for (const t of options.extraTags) if (t) tags.add(t);
  }

  if (Array.isArray(options.tags)) {
    for (const t of options.tags) if (t) tags.add(t);
  } else if (options.tags instanceof Set) {
    for (const t of options.tags) tags.add(t);
  }

  // Roll-time wield mode override for flexible two-handed weapons (two_handed_disadv_1h)
  if (options.wieldedOneHanded !== undefined && item?.system?.wieldMode === 'two_handed_disadv_1h') {
    if (options.wieldedOneHanded) {
      tags.delete(WIELD_TAGS.twoHanded);
      tags.add(WIELD_TAGS.oneHanded);
    } else {
      tags.delete(WIELD_TAGS.oneHanded);
      tags.add(WIELD_TAGS.twoHanded);
    }
  }

  return tags;
}

/**
 * Collects active modifier sources from an actor:
 * Equipped gear, active buffs, debuffs, skills, race, and class items, then one `tag:<id>` source per behaviour tag
 * carried (E4.1a; `{ tagSources: false }` leaves them out).
 *
 * @param {object} actor
 * @param {object} [ctxItem]
 * @param {{ tagSources?: boolean }} [opts]
 * @returns {Array<object>}
 */
export function getActiveModifierSources(actor, ctxItem = null, { tagSources = true } = {}) {
  const sources = collectItemSources(actor, ctxItem);
  // E4.1a: one synthetic source per behaviour tag the sources or the actor carry (tag-behaviour.mjs).
  return tagSources ? appendTagSources(actor, sources) : sources;
}

/** The typed rows of one kind on a source (schema arrays; `source.system` or a buff-slot entry). */
function rowsOf(source, key) {
  const rows = source?.system?.[key] ?? source?.[key];
  return Array.isArray(rows) ? rows : [];
}

/** Sources whose Rank gates their rows' `minRank` / `maxRank`: skills and spells (E5.1). */
const isRanked = (source) => source.type === 'skill' || source.type === 'spell';

/** The Rank a ranked source is judged at: the higher of its modified and base Rank. */
function rankOf(source) {
  return Math.max(
    Number(source.system?.modifiedRank ?? source.modifiedRank ?? source.system?.rank ?? 0),
    Number(source.system?.rank ?? 0)
  );
}

/** A skill's or spell's rows only apply once it reaches the row's `minRank`; other sources ignore it. */
function meetsMinRank(origin, row) {
  // A tag source is judged on its carrier (E4.0 R13).
  const source = origin.carrier ?? origin;
  if (!isRanked(source)) return true;
  return rankOf(source) >= (Number(row.minRank) || 0);
}

/** The row arrays whose rows honour `scope` (E8.7): the roll arrays. Defense, mana cost and the rest are not tied to an action. */
export const SCOPED_ARRAYS = new Set(['damageModifiers', 'attackModifiers', 'checkModifiers']);

/**
 * Sources whose rows can be scoped to themselves (E8.7): skills, spells, attack items, and gear that is a weapon
 * (`isWeaponGear`: the structured weapon fields, never a name). Armour and other gear, buffs, debuffs, races, classes,
 * rank breaks and tag sources are owner-wide.
 */
export function isScopedSource(source) {
  const type = source?.type;
  if (type === 'skill' || type === 'spell' || type === 'attack') return true;
  return type === 'gear' && isWeaponGear(source);
}

/**
 * Is `source` the action the context is for? The context's item or skill (live objects, by identity or id), or a
 * combat technique chosen for the attack: its identity tag is in the damage context's tags (`techniqueInPlayTags`).
 * Other sources are never matched by tag: an Evade context carries the attacker's action tags.
 */
function isActionOf(source, context) {
  for (const live of [context?.item, context?.skill]) {
    if (!live) continue;
    if (live === source) return true;
    const id = live.id || live._id;
    if (id && id === (source.id || source._id) && live.type === source.type) return true;
  }
  if (source.type !== 'skill' || !isTechniqueSkill(source)) return false;
  const identifier = String(source.system?.identifier ?? '').trim();
  if (!identifier) return false;
  const tags = context?.tags instanceof Set ? context.tags : new Set(context?.tags ?? []);
  return tags.has(identityTag('skill', identifier));
}

/**
 * E8.7: does this row's scope allow it on this roll? A row on a scoped source (see `isScopedSource`) applies only
 * when the source is the action, unless `row.scope === 'owner'`. Everything else is owner-wide. Roll time and apply
 * time share this: Stage A snapshots only rows that passed it, and re-judges conditions, never scope.
 * @returns {boolean}
 */
export function rowAppliesToAction(source, row, key, context) {
  if (!SCOPED_ARRAYS.has(key) || row?.scope === 'owner' || !isScopedSource(source)) return true;
  return isActionOf(source, context);
}

/** The key a row is known by in `evaluateRows`, the once-per-floor record and the floor-row choices. */
export function rowKeyOf(source, index) {
  return `${source.id || source._id || source.name}:${index}`;
}

/**
 * A row's `maxRank` ceiling against the skill the roll is for (the context skill, else the source when it is a
 * skill). It is a condition only: with no skill to judge, the row applies.
 */
function meetsMaxRank(source, row, ctxItem) {
  const max = row.maxRank;
  if (max === null || max === undefined || max === '' || !Number.isFinite(Number(max))) return true;
  const carrier = source.carrier ?? source;
  // A spell's or technique's own row is judged on its own Rank (a technique is not the weapon skill the roll is for);
  // any other row on the roll's skill (else the carrying skill).
  const own = carrier.type === 'spell' || (carrier.type === 'skill' && isTechniqueSkill(carrier));
  const skill = own ? carrier : (ctxItem?.type === 'skill' ? ctxItem : (carrier.type === 'skill' ? carrier : null));
  if (!skill) return true;
  return (own ? rankOf(skill) : (Number(skill.system?.rank ?? skill.rank) || 0)) <= Number(max);
}

/**
 * Rows with `usesPer: 'floor'`:
 * - in an End-of-floor roll (the context has CHECK_TAGS.advancementFloorEnd) they apply only to the skill the batch
 *   chose for them (`allowed` holds their keys);
 * - in any other roll they apply only when the roll ticked the row's `use.<rowKey>` toggle (3.12c, Q-E).
 */
function passesFloorLimit(tags, row, source, index, allowed) {
  if (row.usesPer !== 'floor') return true;
  const set = tags instanceof Set ? tags : new Set(tags ?? []);
  const key = rowKeyOf(source, index);
  if (!set.has(CHECK_TAGS.advancementFloorEnd)) return set.has(useTagFor(key));
  return allowed instanceof Set && allowed.has(key);
}

/** True (with one console warning per kind) when the array enforces kinds and the row's is unknown or has an undeclared option. */
function rowKindRejected(key, row) {
  if (!ROW_ARRAYS[key]?.enforce) return false;
  const { id, error } = rowKindOf(key, row);
  if (!error) return false;
  warnRowKindOnce(key, id, error === 'option' ? 'option' : 'unknown', error === 'option' ? `"${String(row.option)}"` : '');
  return true;
}

/**
 * Every row of one array on the actor's active modifier sources, judged against a context. The single filter every
 * collector uses: skip list, row kind, `minRank`, `maxRank`, condition, once-per-floor choice. For `checkModifiers` and
 * `attackModifiers` the reached rank-break bonuses of the context's item and skill join as synthetic sources
 * (`rankbreak:<item id>`).
 *
 * @param {object} actor
 * @param {string} key row array name (`damageModifiers`, `checkModifiers`, `manaCostModifiers`, ...)
 * @param {{ tags: Iterable<string>, item?: object|null, skill?: object|null }} context a RollContext
 * @param {object} [opts]
 * @param {Set<string>} [opts.floorRows] `usesPer: 'floor'` keys chosen for this skill
 * @param {Iterable<string>} [opts.skip] row keys to leave out (already applied, or unticked optional rows)
 * @param {boolean} [opts.explain=false] also return the rejected rows, with a reason
 * @returns {Array<{ source: object, row: object, rawRow: object, scale: ({ source: string, n: number, note: string }|null), index: number, key: string, matched: boolean, reason?: 'skipped'|'kind'|'minRank'|'maxRank'|'scope'|'scale'|'deferred'|'condition'|'floorLimit'|'disabled' }>}
 *   the matched rows, or every row when `explain`
 */
export function evaluateRows(actor, key, context, opts = {}) {
  const tags = context.tags instanceof Set ? context.tags : new Set(context.tags);
  const skip = new Set(opts.skip ?? []);
  const sources = [...getActiveModifierSources(actor, context.item)];
  if (key === 'checkModifiers' || key === 'attackModifiers') {
    const seen = new Set();
    for (const rbItem of [context.item, context.skill]) {
      if (!rbItem || seen.has(rbItem)) continue;
      seen.add(rbItem);
      const rows = rankBreakRollRows(rbItem)[key];
      if (rows?.length) {
        sources.push({ id: `rankbreak:${rbItem.id || rbItem._id || rbItem.name}`, type: 'rankbreak', name: `${rbItem.name} (Rank Break)`, carrier: rbItem, system: { [key]: rows } });
      }
    }
  }
  const out = [];
  for (const source of sources) {
    rowsOf(source, key).forEach((row, index) => {
      if (!row || typeof row !== 'object') return;
      const rowKey = rowKeyOf(source, index);
      let reason;
      if (row.disabled === true) reason = 'disabled';
      else if (skip.has(rowKey)) reason = 'skipped';
      else if (rowKindRejected(key, row)) reason = 'kind';
      else if (!meetsMinRank(source, row)) reason = 'minRank';
      else if (!meetsMaxRank(source, row, context.item)) reason = 'maxRank';
      else if (!rowAppliesToAction(source, row, key, context)) reason = 'scope';
      let useRow = row;
      let scale = null;
      let deferred = false;
      if (!reason && hasScale(row)) {
        if (isApplyScale(row)) {
          // E3.5: the number waits for the target. The raw row stays; Stage A at apply works the number out.
          const waiting = deferScale(key, row);
          if (waiting.scale) { scale = waiting.scale; deferred = true; } else reason = 'scale';
        } else {
          // Scale before the condition: a row that fails only its condition (an E2 candidate) carries scaled numbers too.
          const scaled = scaleRow(key, row, { actor, source, carrier: source.carrier ?? source, row, context, phase: context.phase });
          if (scaled.row) { useRow = scaled.row; scale = scaled.scale; } else reason = 'scale';
        }
      }
      if (!reason && !matchesTagQuery(tags, row.condition)) reason = 'condition';
      else if (!reason && !passesFloorLimit(tags, row, source, index, opts.floorRows)) reason = 'floorLimit';
      if (!reason && deferred) reason = 'deferred';
      if (reason && !opts.explain) return;
      out.push({ source, row: useRow, rawRow: row, scale, index, key: rowKey, matched: !reason, ...(reason ? { reason } : {}) });
    });
  }
  return out;
}

/**
 * Collects all matching outgoing damage modifiers for a damage context.
 *
 * @param {object} actor - The actor performing the action
 * @param {object} context - a `damage` RollContext
 * @param {object} [opts]
 * @param {string} [opts.primaryType='Physical'] - Action's primary damage type
 * @param {boolean} [opts.split=false] - Leave the target rows (conditions on `subject.*` or
 *   `situation.critical_hit`) out of the frozen numbers and return them as `targetRows`, with `targetAddParts` for
 *   the candidate `add` rows (each a standby part). Off, every matched row is frozen (today's behaviour).
 * @returns {{
 *   addParts: Array<object>,
 *   multipliers: { all: number, byType: Record<string, number> },
 *   multiplierSources: Array<string>,
 *   suppressStat: boolean,
 *   suppressStatTypes: Set<string>,
 *   appliedKeys: Array<string>,
 *   targetRows: Array<object>,
 *   targetAddParts: Array<object>
 * }} `appliedKeys` lists the frozen rows whose effect is in the result; each `addParts` entry carries its `rowKey`
 */
export function collectDamageModifiers(actor, context, { primaryType: primary, split = false } = {}) {
  const primaryType = primary || 'Physical';

  const acc = { addParts: [], multipliers: { all: 1, byType: {} }, multiplierSources: [], suppressStat: false, suppressStatTypes: new Set() };
  const appliedKeys = [];
  const targetRows = [];
  const targetAddParts = [];
  let warnedCap = false;

  const evaluated = evaluateRows(actor, 'damageModifiers', context, split ? { explain: true } : {});
  for (const { source, row, scale, key: rowKey, matched, reason } of evaluated) {
    const kindId = kindOf('damageModifiers', row);
    const def = getRowKind('damageModifiers', kindId);
    if (!def) continue;
    const ctx = { actor, source, rowKey, context, tags: context.tags, primaryType, scale, label: row.label || source.name || '' };
    let asTarget = split && (queryReferences(row.condition, isTargetSensitiveTag) || Boolean(scale?.deferred));
    if (asTarget && !def.apply.target) {
      // A kind with no Stage A handler cannot be judged per target: it is judged against the roll subject.
      warnRowKindOnce('damageModifiers', kindId, 'no-target');
      asTarget = false;
    }
    if (asTarget) {
      // A target row: its truth depends on the target (or the apply button), so it is not in the frozen numbers.
      if (!matched && reason !== 'condition' && reason !== 'deferred') continue;
      if (!matched && !matchesTagQueryIgnoring(context.tags, row.condition, isTargetSensitiveTag)) continue;
      const scratch = { addParts: [], multipliers: { all: 1, byType: {} }, multiplierSources: [], suppressStat: false, suppressStatTypes: new Set() };
      if (def.apply.damage && !applyRowKind('damageModifiers', def, 'damage', scratch, row, { ...ctx, serial: targetAddParts.length })) continue;
      const snap = snapshotTargetRow({ source, row, key: rowKey, scale });
      if (!snap) continue;
      if (targetRows.length >= MAX_TARGET_ROWS) {
        if (!warnedCap) console.warn(`Sprinter RPG | more than ${MAX_TARGET_ROWS} per-target damage rows; the rest are ignored for this roll.`);
        warnedCap = true;
        continue;
      }
      targetRows.push(snap);
      for (const part of scratch.addParts) targetAddParts.push({ ...part, standby: true });
      continue;
    }
    if (!matched) continue;
    if (applyRowKind('damageModifiers', def, 'damage', acc, row, { ...ctx, serial: acc.addParts.length })) appliedKeys.push(rowKey);
  }

  const { addParts, multipliers, multiplierSources, suppressStat, suppressStatTypes } = acc;
  return { addParts, multipliers, multiplierSources, suppressStat, suppressStatTypes, appliedKeys, targetRows, targetAddParts };
}

/**
 * Zeroes the stat modifier on every part a `suppress_stat` row covers: all parts when a row has no
 * damageType, otherwise the parts of that type (case-insensitive; an empty part type is Physical).
 * Mutates and returns `parts`.
 *
 * @param {Array<object>} parts
 * @param {{ suppressStat?: boolean, suppressStatTypes?: Set<string> }} dmod - collectDamageModifiers result
 * @returns {Array<object>}
 */
export function applyStatSuppression(parts, dmod) {
  if (!dmod?.suppressStat && !(dmod?.suppressStatTypes?.size > 0)) return parts;
  for (const p of parts) {
    const type = String(p.type || 'Physical').toLowerCase().trim();
    if (dmod.suppressStat || dmod.suppressStatTypes.has(type)) p.statMod = 0;
  }
  return parts;
}

/**
 * A damage multiplier from a button, a caller or a row (E6.4, E8.5): a missing or non-numeric value is 1, and a genuine 0 stays 0
 * (`Number(x) || 1` turned a ×0 into ×1). Never negative.
 * @param {*} raw
 * @returns {number}
 */
export function multiplierOf(raw) {
  if (raw === null || raw === undefined || raw === '') return 1;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, n) : 1;
}

/**
 * Calculates the combined multiplier for a specific damage type:
 * multipliers.all * (multipliers.byType[damageType] ?? 1).
 *
 * @param {{ all: number, byType: Record<string, number> }} multipliers
 * @param {string} [damageType='']
 * @returns {number}
 */
export function multiplierFor(multipliers, damageType = '') {
  const all = multiplierOf(multipliers?.all);
  if (!damageType) return all;
  const dt = String(damageType).toLowerCase().trim();
  let typeMult = 1;
  if (multipliers?.byType) {
    for (const [k, v] of Object.entries(multipliers.byType)) {
      if (String(k).toLowerCase().trim() === dt) {
        typeMult *= multiplierOf(v);
      }
    }
  }
  return all * typeMult;
}

/**
 * @typedef {object} DeferredRollRow a roll row scaled by the target that the fold could not add (E3.5c)
 * @property {string} key row key
 * @property {string} label
 * @property {string} note the recipe note ("per Health Bar slot the target has lost")
 * @property {'no-target'|'cannot-scale'} reason
 */

/**
 * Shared evaluator for `attackModifiers` / `checkModifiers` rows: flat value (+ stat mod) and optional dice.
 * A row scaled by the target is worked out here against the context's subject (the one targeted token); with no
 * subject it adds nothing and is reported in `deferred` and the breakdown (E3.5c, R4).
 * @returns {{ flatBonus: number, diceParts: Array<string>, breakdown: Array<string>, deferred: DeferredRollRow[] }}
 */
function collectRollRows(actor, key, context, fallbackLabel, floorRows = null) {
  const acc = { flatBonus: 0, diceParts: [], breakdown: [] };
  const deferred = [];
  const subject = context.otherRole === 'subject' ? (context.other ?? null) : null;
  for (const { source, row, scale, key: rowKey, matched, reason } of evaluateRows(actor, key, context, { floorRows, explain: true })) {
    if (!matched && reason !== 'deferred') continue;
    const def = getRowKind(key, kindOf(key, row));
    if (!def) continue;
    const label = row.label || source.name || fallbackLabel;
    if (reason === 'deferred') {
      const note = scale.note;
      if (!subject) {
        acc.breakdown.push(`${label} (no target, ${note})`);
        deferred.push({ key: rowKey, label, note, reason: 'no-target' });
        continue;
      }
      const res = resolveApplyScale(normalizeScaleSpec(row.scaleBy), row.value, 'whole',
        { subject, targets: clickTargetsOf([subject]), context, row, phase: context.phase });
      if (!res.ok) {
        acc.breakdown.push(`${label} (cannot scale)`);
        deferred.push({ key: rowKey, label, note, reason: 'cannot-scale' });
        continue;
      }
      applyRowKind(key, def, 'rollBonus', acc, { ...row, value: res.value }, { actor, source, scale: { source: row.scaleBy.source, n: res.n, note: res.note }, context, label });
      continue;
    }
    applyRowKind(key, def, 'rollBonus', acc, row, { actor, source, scale, context, label });
  }
  return { ...acc, deferred };
}

/**
 * Advantage / Disadvantage granted by matching `checkModifiers` rows (every roll, attacks included) and, for
 * attacks, `attackModifiers` rows. One entry per matching row, labelled `row.label || source.name`.
 *
 * @param {object} actor
 * @param {object} context - the roll's RollContext (its item's own rows count when unequipped, like the other collectors)
 * @param {object} [opts]
 * @param {boolean} [opts.isAttack=false] - also read `attackModifiers`
 * @param {Set<string>} [opts.floorRows]
 * @returns {{ advantages: Array<string>, disadvantages: Array<string> }}
 */
export function collectRollAdvantage(actor, context, { isAttack = false, floorRows } = {}) {
  const keys = isAttack ? ['checkModifiers', 'attackModifiers'] : ['checkModifiers'];
  const acc = { advantages: [], disadvantages: [] };
  for (const key of keys) {
    for (const { source, row, scale } of evaluateRows(actor, key, context, { floorRows })) {
      const def = getRowKind(key, kindOf(key, row));
      if (!def) continue;
      applyRowKind(key, def, 'rollAdvantage', acc, row, { actor, source, scale, context, label: row.label || source.name || 'Modifier' });
    }
  }
  return acc;
}

/** True for a `situation.*` tag a roll dialog may offer (engine situations are set by the engine). */
function isOfferableSituation(tag, withSubjects = true) {
  if (typeof tag !== 'string') return false;
  if (tag.startsWith('subject.')) return withSubjects && tag.length > 'subject.'.length;
  // Same size is the target's too: a targeted roll answers it per target, only an untargeted roll offers the toggle.
  if (tag === SAME_SIZE_SITUATION) return withSubjects;
  return tag.startsWith('situation.') && getTagDefinition(tag)?.engine !== true;
}

/**
 * The `situation.*` (and, unless `opts.subjects === false`, `subject.*`) toggles a roll dialog should offer: only tags that a matching row on the actor
 * references (condition `all` / `any`) and whose other conditions already match this roll. A row that only needs
 * the situation is offered; a row whose other tags don't match the roll never is.
 *
 * @param {object} actor
 * @param {object} context - the roll's RollContext (any already-ticked situations included)
 * @param {object} [opts]
 * @param {boolean} [opts.isAttack=false] - also read attack rows
 * @param {Array<string>} [opts.keys] - extra row arrays to read (e.g. `damageModifiers`)
 * @param {boolean} [opts.exclusive=false] - read only `opts.keys` (a rest or spell-cost dialog, not a roll)
 * @param {Set<string>} [opts.floorRows] - `usesPer: 'floor'` keys chosen for this skill (End-of-floor rolls)
 * @param {boolean} [opts.withRows=false] - also return the first referencing row (`row`, `arrayKey`) and the item or tag it sits on (`sourceRef`), for the Attack Options model
 * @returns {Array<{ tag: string, label: string, source: string, used?: boolean, rowLabel?: string, row?: object, arrayKey?: string, sourceRef?: object }>} label is the first referencing row's label, else the tag's registry label;
 *   source is the name of the item that row sits on (shown small, after the label)
 */
export function getOfferedSituations(actor, context, opts = {}) {
  const base = context.tags instanceof Set ? context.tags : new Set(context.tags ?? []);
  const keys = opts.exclusive
    ? [...(opts.keys ?? [])]
    : ['checkModifiers', ...(opts.isAttack ? ['attackModifiers'] : []), ...(opts.keys ?? [])];
  const offered = new Map();
  const isFloorEnd = base.has(CHECK_TAGS.advancementFloorEnd);
  const used = floorRowsUsed(actor);
  for (const key of keys) {
    // A row is offered when only its condition fails (minRank, maxRank, skip and the floor limit all hold)
    // and it would match once the situations it references were ticked.
    for (const { source, row, index, matched, reason, key: rowKey } of evaluateRows(actor, key, context, { explain: true, floorRows: opts.floorRows })) {
      // A once-per-floor row on an ordinary roll is an opt-in toggle: "Use: <label> (once per floor)" (3.12c, Q-E)
      const limited = row.usesPer === 'floor' && !isFloorEnd;
      if (limited && (matched || reason === 'floorLimit' || reason === 'condition')) {
        const useTag = useTagFor(rowKey);
        const refsNeeded = [...(row.condition?.all ?? []), ...(row.condition?.any ?? [])].filter(tag => isOfferableSituation(tag, opts.subjects !== false) && !base.has(tag));
        if (!base.has(useTag) && !offered.has(useTag) && matchesTagQuery(new Set([...base, ...refsNeeded]), row.condition)) {
          offered.set(useTag, { rowLabel: row.label || source.name || 'Modifier', label: `${row.label || source.name || 'Modifier'} (once per floor)`, source: source.name || '', used: used.has(rowKey) });
        }
      }
      if (!matched && reason !== 'condition') continue;
      const cond = row.condition;
      const refs = [...(cond?.all ?? []), ...(cond?.any ?? [])].filter(tag => isOfferableSituation(tag, opts.subjects !== false) && !base.has(tag));
      if (refs.length === 0) continue;
      const withSituations = new Set([...base, ...refs]);
      if (!matchesTagQuery(withSituations, cond)) continue;
      if (!limited && !passesFloorLimit(withSituations, row, source, index, opts.floorRows)) continue; // a limited row also needs its use toggle (offered above)
      for (const tag of refs) {
        if (!offered.has(tag)) offered.set(tag, { label: row.label || getTagDefinition(tag)?.label || tag, source: source.name || '', used: false, ...(opts.withRows ? { row, arrayKey: key, sourceRef: source } : {}) });
      }
    }
  }
  return [...offered].map(([tag, { label, source, used: wasUsed, rowLabel, row, arrayKey, sourceRef }]) => ({
    tag, label, source,
    ...(tag.startsWith(USE_TAG_PREFIX) ? { used: wasUsed, rowLabel } : {}),
    ...(opts.withRows && row ? { row, arrayKey, sourceRef } : {})
  }));
}

/**
 * Collects matching `attackModifiers` rows: bonuses that apply to attack rolls only.
 * To-hit total for an attack = check rows (collectCheckModifiers) + these rows; see collectToHitModifiers.
 *
 * @param {object} actor
 * @param {object} context - a `toHit` RollContext
 * @returns {{ flatBonus: number, diceParts: Array<string>, breakdown: Array<string> }}
 */
export function collectAttackModifiers(actor, context) {
  return collectRollRows(actor, 'attackModifiers', context, 'Attack Mod');
}

/**
 * Collects matching `checkModifiers` rows: bonuses that apply to every roll of the skill, attacks included.
 *
 * @param {object} actor
 * @param {object} context - a RollContext
 * @param {object} [opts]
 * @param {Set<string>} [opts.floorRows]
 * @returns {{ flatBonus: number, diceParts: Array<string>, breakdown: Array<string> }}
 */
export function collectCheckModifiers(actor, context, { floorRows } = {}) {
  return collectRollRows(actor, 'checkModifiers', context, 'Check Mod', floorRows);
}

/**
 * Everything that adds to an attack's to-hit roll (Q-B2): `checkModifiers` rows (every roll of the skill,
 * attacks included) plus `attackModifiers` rows (attacks only). Every attack path uses this one rule.
 *
 * @param {object} actor
 * @param {object} context - a `toHit` RollContext
 * @returns {{ flatBonus: number, diceParts: Array<string>, breakdown: Array<string> }}
 */
export function collectToHitModifiers(actor, context) {
  const check = collectCheckModifiers(actor, context);
  const attack = collectAttackModifiers(actor, context);
  return {
    flatBonus: check.flatBonus + attack.flatBonus,
    diceParts: [...check.diceParts, ...attack.diceParts],
    breakdown: [...check.breakdown, ...attack.breakdown],
    deferred: [...check.deferred, ...attack.deferred]
  };
}

/** True when a tag query has no conditions at all. */
function isEmptyQuery(query) {
  if (!query) return true;
  return !(query.all?.length || query.any?.length || query.none?.length);
}

/**
 * Is this defense row part of the actor's derived stats (`prepareDerivedData`), so it must not be applied again
 * per hit? It follows the row kind's `static` policy: `derived` kinds (`tempHp`, `evade`) count when the row's
 * condition matches the defender's own (`self.*`) tags; `unconditional` kinds (`resistance`, `immunity`, `dr`) count
 * only when the row has no condition (and, for a typed kind, a specific `damageType`: an untyped or `all` row is decided per hit); `never` kinds (`reduction`, `vulnerability`, `suppress_dr`) never do. A scaled
 * row is decided per hit, and so is a row whose kind is not registered.
 *
 * @param {object} row - a defenseModifiers row
 * @param {{ tags: Iterable<string> }} derivedContext - a `derived` RollContext of the defender
 * @returns {boolean}
 */
export function isStaticDefenseRow(row, derivedContext) {
  if (hasScale(row)) return false;
  const { id, def, error } = rowKindOf('defenseModifiers', row);
  if (!def || error) {
    warnRowKindOnce('defenseModifiers', id, error === 'option' ? 'option' : 'unknown');
    return false;
  }
  if (def.static === 'derived') return matchesTagQuery(derivedContext.tags, row.condition);
  if (def.static === 'unconditional') {
    if (!isEmptyQuery(row.condition)) return false;
    // An untyped (blank or 'all') row of a typed kind has no single type to derive, so it is decided per hit.
    if (def.fields?.includes('damageType')) {
      const dt = String(row.damageType ?? '').toLowerCase().trim();
      return dt !== '' && dt !== 'all';
    }
    return true;
  }
  return false;
}

/**
 * Collects matching defensive modifier rows. Each row's condition is matched against the `defense` context:
 * `self.*` is the defender, `attacker.*` the one hitting it, and the unprefixed tags are the incoming attack's. The
 * kind's `defense` handler (see `getDamageReduction`) turns the rows into numbers; this only filters and labels them.
 *
 * @param {object} actor
 * @param {object} context - a `defense` RollContext
 * @param {object} [opts]
 * @param {boolean} [opts.perHit=false] - only the rows `prepareDerivedData` did not already apply (see
 *   isStaticDefenseRow) and only kinds with a `defense` handler
 * @returns {{ rows: Array<{ kind: string, def: object, row: object, source: object, label: string, damageType: string, value: number, percent: number, flat: number, rounding: string }> }}
 *   every matching row, for per-damage-type evaluation
 */
export function collectDefenseModifiers(actor, context, { perHit = false } = {}) {
  const rows = [];

  for (const { source, row, scale } of evaluateRows(actor, 'defenseModifiers', context)) {
    const kind = kindOf('defenseModifiers', row);
    const def = getRowKind('defenseModifiers', kind);
    if (!def) continue;
    if (perHit && (!def.apply.defense || isStaticDefenseRow(row, context))) continue;

    const label = `${row.label || source.name || 'Defense Modifier'}${scale ? ` (${scale.note})` : ''}`;
    rows.push({
      kind, def, row, source, label,
      damageType: row.damageType || '',
      value: Number(row.value) || 0,
      percent: Number(row.percent) || 0,
      flat: Number(row.flat) || 0,
      rounding: row.rounding || 'up'
    });
  }

  return { rows };
}

/**
 * The Area Evade outcome the defender's `evadeOutcome` rows decide. Rows are judged against the
 * Evade's own context; when they disagree the worse outcome for the defender wins (`none` > `half` > `full`).
 *
 * @param {object} actor - the defender
 * @param {object} context - the Evade's `check` RollContext
 * @returns {{ areaOutcome: 'full'|'half'|'none'|null, sources: Array<string> }} `null` when no row matches
 */
export function collectEvadeOutcome(actor, context) {
  const acc = { areaOutcome: null, sources: [] };
  for (const { source, row } of evaluateRows(actor, 'defenseModifiers', context)) {
    const def = getRowKind('defenseModifiers', kindOf('defenseModifiers', row));
    if (!def?.apply?.evade) continue;
    applyRowKind('defenseModifiers', def, 'evade', acc, row, { actor, source, context, label: row.label || source.name || 'Area Evade' });
  }
  return acc;
}
