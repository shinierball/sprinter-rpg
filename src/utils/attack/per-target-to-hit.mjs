import { isTargetSensitiveTag } from '../../data/tag-vocabulary.mjs';
import { matchesTagQuery, matchesTagQueryIgnoring, queryReferences } from '../tag/tag-query.mjs';
import { collectCheckModifiers, collectToHitModifiers, evaluateRows } from '../roll/damage-modifiers.mjs';
import { escapeAttr } from '../escape-attr.mjs';
import { applyRowKind, getRowKind, kindOf } from '../row-kinds.mjs';
import { MAX_TARGET_ROWS } from '../damage/per-target-damage.mjs';
import { retargetContext } from '../roll/roll-context.mjs';
import { droppedTickText } from '../roll/ticked-subject.mjs';
import { clickTargetsOf, normalizeScaleSpec, resolveApplyScale } from '../roll/scalars.mjs';

/**
 * Per-target to-hit rows. An attack is one d20.
 * Its `checkModifiers` / `attackModifiers` rows whose condition mentions `subject.*` are not in the d20 total when the
 * attack has targets: each target's comparison adds the ones that match that target's own tags. Advantage rows keep
 * being judged against the first target (`collectRollAdvantage`); this module never touches them.
 */

const MAX_LABEL_LENGTH = 80;

/**
 * @typedef {object} ToHitTargetRow
 * @property {string} key row key
 * @property {string} label
 * @property {number} flat value + the stat modifier, at roll time
 * @property {string} dice dice formula ('' when none)
 * @property {*} condition the row's tag query
 * @property {number} [rolled] the dice total, rolled once at roll time and reused for every target
 * @property {object} [applyScale] normalised scale spec worked out per target at the roll (E3.5c); `flat` then holds only the stat part
 * @property {number} [value] the row's own number, scaled for each target when `applyScale` is set
 * @property {string} [scaleNote] the recipe note ("per Health Bar slot the target has lost")
 */

/**
 * Splits the attacker's to-hit rows (Q-B2: check rows plus attack rows) into the ones frozen into the d20 total and
 * the ones that depend on the target.
 * @param {object} actor the attacker
 * @param {object} context the attack's `toHit` RollContext (after the first target's tags and situations)
 * @param {object} [opts]
 * @param {string[]} [opts.keys] row arrays to read (default check rows plus attack rows)
 * @returns {{ frozen: { flatBonus: number, diceParts: string[], breakdown: string[] }, targetRows: ToHitTargetRow[] }}
 */
export function splitToHitRows(actor, context, { keys = ['checkModifiers', 'attackModifiers'] } = {}) {
  const frozen = { flatBonus: 0, diceParts: [], breakdown: [] };
  const targetRows = [];
  for (const key of keys) {
    for (const { source, row, scale, key: rowKey, matched, reason } of evaluateRows(actor, key, context, { explain: true })) {
      const deferred = Boolean(scale?.deferred);
      const isTarget = queryReferences(row.condition, isTargetSensitiveTag) || deferred;
      if (isTarget) {
        if (!matched && reason !== 'condition' && reason !== 'deferred') continue;
        if (!matched && !matchesTagQueryIgnoring(context.tags, row.condition, isTargetSensitiveTag)) continue;
      } else if (!matched) continue;

      // Only kinds with a rollBonus handler have a number to add; advantage rows stay first-target.
      const def = getRowKind(key, kindOf(key, row));
      if (!def?.apply?.rollBonus) continue;
      const label = row.label || source.name || (key === 'checkModifiers' ? 'Check Mod' : 'Attack Mod');
      const acc = { flatBonus: 0, diceParts: [], breakdown: [] };
      // A row scaled by the target keeps only its stat part and dice here; its value is worked out for each target.
      applyRowKind(key, def, 'rollBonus', acc, deferred ? { ...row, value: 0 } : row, { actor, source, scale: deferred ? null : scale, context, label });
      const flat = acc.flatBonus;
      const dice = acc.diceParts.join('+');
      if (isTarget) {
        if (!deferred && !flat && !dice) continue;
        if (targetRows.length >= MAX_TARGET_ROWS) continue;
        targetRows.push({
          key: rowKey, label, flat, dice, condition: row.condition,
          ...(deferred ? { applyScale: normalizeScaleSpec(row.scaleBy), value: Number(row.value) || 0, scaleNote: scale.note } : {})
        });
        continue;
      }
      frozen.flatBonus += acc.flatBonus;
      frozen.diceParts.push(...acc.diceParts);
      frozen.breakdown.push(...acc.breakdown);
    }
  }
  return { frozen, targetRows };
}

/** The base context as the plain card shape `retargetContext` reads. */
function asCard(context) {
  return {
    phase: context.phase,
    tags: [...context.tags],
    actorUuid: context.actor?.uuid ?? context.actorUuid ?? null,
    otherUuid: context.other?.uuid ?? context.otherUuid ?? null,
    appliedRowKeys: context.appliedRowKeys ?? []
  };
}

/** The base context re-aimed at one target actor. */
function targetContextOf(context, targetActor) {
  return retargetContext(asCard(context), { other: targetActor, attacker: context.actor ?? null });
}

/** The target rows whose condition holds for one target actor (judged against retargetContext-style tags). */
function rowsFor(rows, context, targetActor) {
  const target = targetContextOf(context, targetActor);
  return rows.filter(r => matchesTagQuery(target.tags, r.condition));
}

/**
 * Rolls each target row's dice once (only rows that match at least one target), for reuse on every target's comparison.
 * @param {ToHitTargetRow[]} rows
 * @param {object} context the attack's RollContext
 * @param {object[]} targetActors
 * @param {(formula: string) => Promise<number>} [rollDice] defaults to Foundry's Roll
 * @returns {Promise<ToHitTargetRow[]>} copies with `rolled` set
 */
export async function rollTargetToHitDice(rows, context, targetActors, rollDice = async (f) => (await new Roll(f).evaluate()).total) {
  const out = [];
  for (const row of rows) {
    let rolled = 0;
    if (row.dice && targetActors.some(a => rowsFor([row], context, a).length > 0)) rolled = Number(await rollDice(row.dice)) || 0;
    out.push({ ...row, rolled });
  }
  return out;
}

/**
 * What one target's comparison gains from the target rows. A row scaled by the target (E3.5c) is worked out here with
 * this target as the subject and `targets` as the batch; its dice are rolled once and never scaled.
 * @param {ToHitTargetRow[]} rows from `rollTargetToHitDice`
 * @param {object} context the attack's RollContext
 * @param {object} targetActor
 * @param {object} [opts]
 * @param {Array<object>} [opts.targets] the click's batch (`clickTargetsOf`); a direct call is a batch of one
 * @returns {{ bonus: number, lines: Array<{ label: string, amount: number, dice: string, note?: string, unresolved?: string }> }}
 */
export function toHitForTarget(rows, context, targetActor, { targets } = {}) {
  const lines = [];
  let bonus = 0;
  const target = targetContextOf(context, targetActor);
  // A ticked subject tag the target contradicts was dropped (E8.14): the hit list says so.
  for (const d of target.droppedTicks ?? []) lines.push({ label: droppedTickText(d), amount: 0, dice: '', warning: true });
  let batch = targets;
  for (const r of rows.filter(row => matchesTagQuery(target.tags, row.condition))) {
    const label = String(r.label).slice(0, MAX_LABEL_LENGTH);
    if (!r.applyScale) {
      const amount = r.flat + (r.rolled || 0);
      bonus += amount;
      lines.push({ label, amount, dice: r.dice });
      continue;
    }
    batch ??= clickTargetsOf([targetActor]);
    const res = resolveApplyScale(r.applyScale, r.value, 'whole', { subject: targetActor, targets: batch, context: target, row: r, phase: context.phase });
    if (!res.ok) {
      lines.push({ label, amount: 0, dice: '', unresolved: res.reason });
      continue;
    }
    const amount = r.flat + res.value + (r.rolled || 0);
    if (amount === 0 && !r.dice) continue;
    bonus += amount;
    lines.push({ label, amount, dice: r.dice, note: res.note });
  }
  return { bonus, lines };
}

/** One hit-list line as text: `+2 Label (note)`, or `Label: cannot scale` for a row that could not be worked out. */
export function toHitLineText(line) {
  if (line.warning) return line.label;
  if (line.unresolved) return `${line.label}: cannot scale`;
  const base = `${line.amount >= 0 ? '+' : ''}${line.amount} ${line.label}`;
  return line.note ? `${base} (${line.note})` : base;
}

/**
 * The to-hit rows for an attack roll. With targets, the rows that depend on the target are held back for each target's
 * comparison; without, every matching row is in the d20 total as always (the ticked `subject.*` situations count).
 * @param {object} actor
 * @param {object} context the attack's `toHit` RollContext
 * @param {boolean} hasTargets
 * @returns {{ toHit: { flatBonus: number, diceParts: string[], breakdown: string[] }, targetRows: ToHitTargetRow[] }}
 */
export function collectAttackToHit(actor, context, hasTargets) {
  if (!hasTargets) return { toHit: collectToHitModifiers(actor, context), targetRows: [] };
  const { frozen, targetRows } = splitToHitRows(actor, context);
  return { toHit: frozen, targetRows };
}

/**
 * The roll rows of a skill or stat check (E3.5c). With two or more targets the rows that depend on a target are held
 * back for the "Totals by target" box (`targetRows`); with none or one, everything is folded into the check.
 * @param {object} actor
 * @param {object} context the check's RollContext
 * @param {object} [opts]
 * @param {string[]} [opts.keys] `['checkModifiers']`, or both arrays for an attack skill
 * @param {object[]} [opts.targetActors] the roller's targeted actors
 * @returns {{ mods: { flatBonus: number, diceParts: string[], breakdown: string[], deferred: object[] }, targetRows: ToHitTargetRow[] }}
 */
export function collectCheckToHit(actor, context, { keys = ['checkModifiers'], targetActors = [] } = {}) {
  if (targetActors.length >= 2) {
    const { frozen, targetRows } = splitToHitRows(actor, context, { keys });
    return { mods: { ...frozen, deferred: [] }, targetRows };
  }
  const mods = keys.includes('attackModifiers') ? collectToHitModifiers(actor, context) : collectCheckModifiers(actor, context);
  return { mods, targetRows: [] };
}

/**
 * Each target's total for a check rolled once.
 * @param {object} roll the evaluated check
 * @param {ToHitTargetRow[]} rows from `rollTargetToHitDice`
 * @param {object} context
 * @param {object[]} targetActors
 * @param {Array<object>} [batch] `clickTargetsOf(targetActors)`
 * @returns {Array<{ actorId: string, actorName: string, bonus: number, total: number, lines: object[] }>}
 */
function checkTargetResults(roll, rows, context, targetActors, batch = clickTargetsOf(targetActors)) {
  return targetActors.map((actor) => {
    const { bonus, lines } = toHitForTarget(rows, context, actor, { targets: batch });
    return { actorId: actor.id, actorName: actor.name, bonus, total: (roll?.total ?? 0) + bonus, lines };
  });
}

/** The "Totals by target" box of a several-target check. All content is escaped. */
function checkTargetsBoxHtml(results) {
  if (!results?.length) return '';
  const rows = results.map((r) => {
    const detail = r.lines.length ? ` (${r.lines.map(toHitLineText).join(', ')})` : '';
    return `<div class="cog-check-target-row cog-text-secondary" data-target-id="${escapeAttr(r.actorId)}" style="font-size: 10px;"><strong>${escapeAttr(r.actorName)}</strong>: ${r.total}${escapeAttr(detail)}</div>`;
  }).join('');
  return `<div class="cog-check-targets-container" style="margin-top: 6px; font-family: var(--font-primary, 'Oswald', sans-serif);"><div class="cog-text-gold" style="font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;"><i class="fa-solid fa-crosshairs"></i> Totals by target</div>${rows}</div>`;
}

/**
 * After a check is rolled: the per-target totals, their box and the card flag. Empty when the check had no per-target rows.
 * @returns {Promise<{ results: object[], html: string, flags: object }>}
 */
export async function rollCheckTargets(roll, targetRows, context, targetActors) {
  if (targetActors.length < 2 || targetRows.length === 0) return { results: [], html: '', flags: {} };
  const rows = await rollTargetToHitDice(targetRows, context, targetActors);
  const results = checkTargetResults(roll, rows, context, targetActors, clickTargetsOf(targetActors));
  return {
    results,
    html: checkTargetsBoxHtml(results),
    flags: { checkTargetResults: results.map(({ actorId, actorName, bonus, total }) => ({ actorId, actorName, bonus, total })) }
  };
}
