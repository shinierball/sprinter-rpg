/**
 * The mechanics line of an attack, generated at display time from the structured
 * fields so it never goes stale after a live edit. Pure: no document reads, no text parsing. Nothing generated is
 * stored; `effects` keeps only the human prose.
 *
 * Strings live in `lang/en.json` under `COG.AttackMechanics`; the table below is the fallback when no i18n catalogue
 * is loaded (headless tests), the way `attack-text.mjs` does it.
 */
import { resolveAreaShape, getTagDefinition } from '../../data/tag-definitions.mjs';
import { formatTiming, normalizeTiming } from '../time/timing.mjs';

const TEXT = Object.freeze({
  'COG.AttackMechanics.ToHit': '{n}+F to hit',
  'COG.AttackMechanics.Range': '{n}ft range',
  'COG.AttackMechanics.AreaRadius': '{n}ft {label} radius',
  'COG.AttackMechanics.AreaSized': '{n}ft {label}',
  'COG.AttackMechanics.AreaWide': '{n}ft by {w}ft {label}',
  'COG.AttackMechanics.Splash': '+{n}ft Splash',
  'COG.AttackMechanics.OnHit': 'On hit{rank}: {list}.',
  'COG.AttackMechanics.OnEvadeFail': 'On a failed Evade{rank}: {list}.',
  'COG.AttackMechanics.OnEvadeMajorFail': 'On an Evade Major Fail or worse{rank}: {list}.',
  'COG.AttackMechanics.OnEvadeCriticalFail': 'On an Evade Critical Fail{rank}: {list}.',
  'COG.AttackMechanics.OnSlotLoss': 'On losing a Health Bar slot{rank}: {list}.',
  'COG.AttackMechanics.OnSlotLossMany': 'On losing {n}+ Health Bar slots{rank}: {list}.',
  'COG.AttackMechanics.Save': '{stat} check DC {n}+F.',
  'COG.AttackMechanics.SaveNoDC': '{stat} check.',
  'COG.AttackMechanics.SaveOpposed': 'Opposed {stat} check.',
  'COG.AttackMechanics.SaveFail': '{save} On a fail: {list}.',
  'COG.AttackMechanics.Rank': ' (Rank {n}+)',
  'COG.AttackMechanics.OneOf': 'one of {list}',
  'COG.AttackMechanics.Or': ' or '
});

function mechText(key, data = {}) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.format === 'function') return i18n.format(key, data);
  return (TEXT[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? ''));
}

const wholeFeet = (v) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Parts printed together as one comma-joined sentence. */
const FIRST_SENTENCE = new Set(['toHit', 'range', 'area']);

/** The area clause, or '' when the shape has no size. The label and size kind come from the shape tag registry. */
function areaText(area) {
  if (!area || typeof area !== 'object') return '';
  const { id, def } = resolveAreaShape(area.shape);
  const label = getTagDefinition(`shape.${id}`)?.label || id;
  const isLength = def?.size === 'length';
  const size = wholeFeet(isLength ? area.lineLength : area.radius);
  if (!size) return '';
  // A line, wall or rect also has a width; an unset one falls back to the shape's default, as the template does
  const width = isLength ? wholeFeet(area.lineWidth ?? def?.defaults?.width ?? 5) : 0;
  let base;
  if (width) base = mechText('COG.AttackMechanics.AreaWide', { n: size, w: width, label });
  else if (isLength || def?.region === 'cone') base = mechText('COG.AttackMechanics.AreaSized', { n: size, label });
  else base = mechText('COG.AttackMechanics.AreaRadius', { n: size, label });
  const splash = wholeFeet(area.splash);
  return splash ? `${base} ${mechText('COG.AttackMechanics.Splash', { n: splash })}` : base;
}

const titleCase = (ref) => String(ref ?? '').replace(/^(condition|id\.debuff)\./, '').replace(/[-_.]+/g, ' ')
  .replace(/\b\w/g, (c) => c.toUpperCase());

/** The debuff list as text: `A, B`, or for `pickOne` `one of A, B or C` (a lone entry reads as itself). */
function listText(refs, mode, labelOf) {
  const labels = refs.map((r) => String(labelOf(r) || titleCase(r)));
  if (mode !== 'pickOne' || labels.length < 2) return labels.join(', ');
  const last = labels[labels.length - 1];
  const list = `${labels.slice(0, -1).join(', ')}${mechText('COG.AttackMechanics.Or')}${last}`;
  return mechText('COG.AttackMechanics.OneOf', { list });
}

const cleanRefs = (list) => (Array.isArray(list) ? list.filter((r) => typeof r === 'string' && r.trim()).map((r) => r.trim()) : []);

const EVADE_KEYS = Object.freeze({
  fail: 'COG.AttackMechanics.OnEvadeFail',
  major_fail: 'COG.AttackMechanics.OnEvadeMajorFail',
  critical_fail: 'COG.AttackMechanics.OnEvadeCriticalFail'
});

/** The rider sentences of an `onHit` block: any hit, Evade fail, slot loss (each `(Rank N+)` when `debuffMinRank` is set). */
function riderParts(block, labelOf) {
  if (!block || typeof block !== 'object') return [];
  const minRank = wholeFeet(block.debuffMinRank);
  const rank = minRank ? mechText('COG.AttackMechanics.Rank', { n: minRank }) : '';
  const out = [];
  const hit = cleanRefs(block.debuffs);
  if (hit.length) out.push({ key: 'onHit', text: mechText('COG.AttackMechanics.OnHit', { rank, list: listText(hit, block.debuffMode, labelOf) }) });
  const fail = cleanRefs(block.evadeFail?.debuffs);
  if (fail.length) {
    const key = EVADE_KEYS[block.evadeFail?.degree] ?? EVADE_KEYS.major_fail;
    out.push({ key: 'evadeFail', text: mechText(key, { rank, list: listText(fail, block.evadeFail?.mode, labelOf) }) });
  }
  const loss = cleanRefs(block.slotLoss?.debuffs);
  if (loss.length) {
    const n = wholeFeet(block.slotLoss?.minSlotsLost) || 1;
    const key = n > 1 ? 'COG.AttackMechanics.OnSlotLossMany' : 'COG.AttackMechanics.OnSlotLoss';
    out.push({ key: 'slotLoss', text: mechText(key, { n, rank, list: listText(loss, block.slotLoss?.mode, labelOf) }) });
  }
  return out;
}

/** The stat-check save of the `contest` block (3.48-9): `DEX check DC 12+F. On a fail: Poisoned.`, or '' when it has none. */
function saveText(contest, labelOf) {
  if (!contest?.hasContest) return '';
  const stat = String(contest.targetStat || 'dex').toUpperCase();
  const dc = wholeFeet(contest.customDC);
  const opposed = contest.contestType === 'opposed';
  const save = opposed
    ? mechText('COG.AttackMechanics.SaveOpposed', { stat })
    : mechText(dc ? 'COG.AttackMechanics.Save' : 'COG.AttackMechanics.SaveNoDC', { stat, n: dc });
  const fail = cleanRefs([contest.onFailDebuff]);
  return fail.length ? mechText('COG.AttackMechanics.SaveFail', { save, list: listText(fail, 'all', labelOf) }) : save;
}

/**
 * @param {object} system attack `system` (an item is accepted too)
 * @param {{ tags?: Set<string>, labelOf?: (ref: string) => string }} [opts] labelOf names a debuff ref (callers pass
 *   `conditionLabel`); the default title-cases the identifier
 * @returns {{ parts: Array<{ key: 'toHit'|'range'|'area'|'cooldown'|'save'|'onHit'|'evadeFail'|'slotLoss', text: string }>, text: string }}
 */
export function describeAttackMechanics(system, opts = {}) {
  const sys = system?.system && typeof system.system === 'object' ? system.system : (system ?? {});
  const parts = [];
  const push = (key, text) => { if (text) parts.push({ key, text }); };

  const hit = sys.hitDifficulty;
  if (hit !== null && hit !== undefined && hit !== '' && Number.isFinite(Number(hit))) {
    push('toHit', mechText('COG.AttackMechanics.ToHit', { n: Math.max(0, Math.floor(Number(hit))) }));
  }
  const range = wholeFeet(sys.rangeFeet);
  if (range) push('range', mechText('COG.AttackMechanics.Range', { n: range }));
  push('area', areaText(sys.area));
  if (normalizeTiming(sys.cooldown).unit) push('cooldown', `${formatTiming(sys.cooldown)}.`);
  const labelOf = typeof opts?.labelOf === 'function' ? opts.labelOf : titleCase;
  push('save', saveText(sys.contest, labelOf));
  for (const p of riderParts(sys.onHit, labelOf)) push(p.key, p.text);

  const first = parts.filter((p) => FIRST_SENTENCE.has(p.key)).map((p) => p.text);
  const sentences = [];
  if (first.length) sentences.push(`${first.join(', ')}.`);
  for (const p of parts) if (!FIRST_SENTENCE.has(p.key)) sentences.push(p.text);
  return { parts, text: sentences.join(' ') };
}

/**
 * The display text of an attack: the mechanics line, then the stored prose (`effects`, falling back to `notes`).
 * A gear weapon has no Difficulty, range or save of its own and its area and cooldown have their own displays, so its
 * generated line is its on-hit riders only. Other item types show their prose only.
 * @param {object} item an item, or an attack `system`
 * @param {object} [opts] as `describeAttackMechanics`
 * @returns {string}
 */
export function attackEffectsText(item, opts = {}) {
  const sys = item?.system && typeof item.system === 'object' ? item.system : (item ?? {});
  const prose = String(sys.effects || sys.notes || '');
  if (item?.type && !['attack', 'gear'].includes(item.type)) return prose;
  const line = describeAttackMechanics(item?.type === 'gear' ? { onHit: sys.onHit } : sys, opts).text;
  return [line, prose].filter(Boolean).join(' ');
}
