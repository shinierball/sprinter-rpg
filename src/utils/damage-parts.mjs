/**
 * Damage parts: the one shape an attack or a gear weapon stores its damage in.
 * Leaf module with no imports.
 *
 * Part shape: { dice, stat, type, value }. `dice` is a dice formula or ''; `stat` is the ability whose
 * modifier is added ('' for none); `type` is a damage type where '' means Physical at runtime;
 * `value` is a flat bonus. Runtime part ids are computed, never stored.
 */

/** Returned by primaryDamagePart when an item has no parts: no dice, no stat, no damage. */
export const EMPTY_DAMAGE_PART = Object.freeze({ dice: '', stat: '', type: '', value: 0 });

/**
 * sys.damageParts as an array (array or {0:..,1:..} object; anything else -> []).
 * @param {object} sys an item's system data
 * @returns {object[]}
 */
export function getDamageParts(sys) {
  const raw = sys?.damageParts;
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (raw && typeof raw === 'object') return Object.values(raw).filter(Boolean);
  return [];
}

/**
 * The first damage part, or the frozen empty part when the item has none.
 * @param {object} sys an item's system data
 * @returns {object}
 */
export function primaryDamagePart(sys) {
  return getDamageParts(sys)[0] || EMPTY_DAMAGE_PART;
}

/**
 * '1d8 + STR'; with { withType: true } -> '1d8 + STR (Slashing)'. An empty part formats as ''.
 * @param {object} part a damage part
 * @param {{withType?: boolean}} [options]
 * @returns {string}
 */
export function formatDamagePart(part, { withType = false } = {}) {
  const tokens = [];
  if (part?.dice) tokens.push(part.dice);
  if (part?.stat) tokens.push(String(part.stat).toUpperCase());
  const formula = tokens.join(' + ');
  return withType && formula && part?.type ? `${formula} (${part.type})` : formula;
}

/**
 * The damage formula a roll shows for resolved roll parts (`actor.getAttackDamageParts`):
 * '1d8 +4 + 1d4 +2'. Each part is its dice, its stat modifier and its flat value; empty parts are dropped.
 * A part with no dice (a flat gear bonus) is appended as its signed number: '1d8 +4 +1'.
 * Used by both the chat card and the sheet's attack row so they cannot diverge.
 * @param {object[]} parts resolved roll parts ({ dice, statMod, value })
 * @returns {string}
 */
export function formatDamageFormula(parts) {
  const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);
  let out = '';
  for (const p of Array.isArray(parts) ? parts : []) {
    const mod = p.statMod ? signed(p.statMod) : '';
    const val = p.value ? signed(p.value) : '';
    const text = [p.dice || '', mod, val].filter(Boolean).join(' ');
    if (!text) continue;
    // A dice part starts a new ' + ' term; a flat-only part is already signed, so it follows with a space
    out = !out ? text : out + (p.dice ? ' + ' : ' ') + text;
  }
  return out;
}

/**
 * The damage cell for an attack row. When the actor can resolve roll parts this is the same
 * formula the damage roll and chat card use (matching skill base damage, rank dice, stat modifier,
 * gear and technique parts), so a weapon with no `damageParts` of its own still shows its damage.
 * Without an actor that resolves parts, falls back to the item's own damage parts.
 */
export function attackDamageDisplay(item, actor) {
  const sys = item.system || {};
  if (typeof actor?.getAttackDamageParts === 'function') {
    const rollParts = actor.getAttackDamageParts(item);
    const formula = formatDamageFormula(rollParts);
    if (!formula) return '';
    const type = (rollParts.find(p => p.dice) || rollParts[0])?.type;
    return type ? `${formula} (${type})` : formula;
  }
  const parts = getDamageParts(sys);
  const extra = parts.length > 1 ? ` (+${parts.length - 1} parts)` : '';
  return `${formatDamagePart(primaryDamagePart(sys), { withType: true })}${extra}`;
}

/** Escape a JSON string for a single-quoted HTML data attribute. */
function jsonDataAttr(value) {
  return JSON.stringify(value).replaceAll('&', '&amp;').replaceAll("'", '&#39;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * @typedef {object} CardPart one part of a damage card (`data-damage-parts`)
 * @property {string} type damage type
 * @property {number} amount the roll subject's amount (what the card shows and a plain apply uses)
 * @property {number} [base] the rolled total before multipliers (with `statMod`, `mult`: lets a target recompute `amount`)
 * @property {number} [statMod] the stat modifier inside `base` (0 when none or suppressed)
 * @property {number} [mult] the frozen multiplier for the type times the effect multiplier
 * @property {boolean} [exempt] not scaled by a Critical Hit multiplier (the Rank damage die)
 * @property {string} [rowKey] the target row a standby part belongs to
 * @property {boolean} [standby] counts for a target only when its row matches that target
 */

/**
 * The card form of one evaluated damage part. A part without a rolled `baseTotal` keeps only
 * `{ type, amount, exempt? }`, which is the shape older cards have.
 * @param {object} evaluatedPart `{ type, finalDamage, baseTotal?, statMod?, stat?, multiplier?, excludeFromCrit?, rowKey?, standby? }`
 * @returns {CardPart}
 */
export function cardPartOf(evaluatedPart) {
  const p = evaluatedPart ?? {};
  const out = { type: String(p.type || 'Physical'), amount: Number(p.finalDamage) || 0 };
  const base = Number(p.baseTotal);
  if (p.baseTotal !== undefined && p.baseTotal !== null && Number.isFinite(base)) {
    out.base = base;
    out.statMod = p.stat ? (Number(p.statMod) || 0) : 0;
    const mult = Number(p.multiplier);
    out.mult = Number.isFinite(mult) ? mult : 1;
  }
  // `excludeFromCrit` (the Rank damage die, Table 37) rides as `exempt`: a Critical Hit apply multiplies the rest only
  if (p.excludeFromCrit) out.exempt = true;
  if (p.standby) {
    out.standby = true;
    if (typeof p.rowKey === 'string' && p.rowKey) out.rowKey = p.rowKey;
  }
  return out;
}

/**
 * Read `data-damage-parts` back (a JSON string or an array). Pure; [] on anything malformed. A part without a finite
 * `base` keeps only `{ type, amount, exempt? }`, which makes a per-target recompute take its fast path.
 * @param {string|Array<object>|null} raw
 * @returns {CardPart[]}
 */
export function parseCardParts(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(data)) return [];
  return data.filter(p => p && typeof p === 'object').map(p => {
    const out = { type: String(p.type || 'Physical'), amount: Math.max(0, Number(p.amount) || 0) };
    if (p.exempt) out.exempt = true;
    if (p.base !== undefined && p.base !== null && p.base !== '' && Number.isFinite(Number(p.base))) {
      out.base = Number(p.base);
      out.statMod = Number(p.statMod) || 0;
      out.mult = Number.isFinite(Number(p.mult)) ? Number(p.mult) : 1;
      if (p.standby) out.standby = true;
      if (typeof p.rowKey === 'string' && p.rowKey) out.rowKey = p.rowKey;
    }
    return out;
  });
}

/**
 * The "Ignore Evade" sub-button of a damage card (E6.3): the primary button's numbers without the target's Evade. Only
 * cards that know their attack message and whose attacker can be evaded (not a crawler or mercenary) have it.
 * @param {{ sourceId: string|null, attackerType: string, multiplier: number, isCrit: boolean, armorPiercing: boolean }} input
 * @returns {string} HTML, '' when the card has no Evade to ignore
 */
export function ignoreEvadeButtonHtml({ sourceId, attackerType, multiplier, isCrit, armorPiercing }) {
  if (!sourceId || attackerType === 'crawler' || attackerType === 'mercenary') return '';
  return `<button type="button" class="cog-apply-damage-btn" data-action="crawlerApplyDamage" data-multiplier="${multiplier}" data-crit="${Boolean(isCrit)}" data-evade="ignore"${armorPiercing ? ' data-ignore-dr="true"' : ''} title="Apply without the target's Evade">Ignore Evade</button>`;
}

/**
 * The `data-damage-parts`, `data-roll-context`, `data-crit-debuffs` (and, when the roll has target rows,
 * `data-target-rows`) attributes of a damage chat card. The parts are the rolled card parts (`cardPartOf`); the
 * context is the damage roll's serialized RollContext (with the frozen rows already in the numbers as
 * `appliedRowKeys`), which the target's conditional `defenseModifiers` are matched against when the damage is
 * applied (including on the GM's copy of the card); the crit debuffs are the ones only a Critical Hit apply inflicts.
 *
 * @param {Array<object>} evaluatedParts
 * @param {string} rollContextAttr the damage roll's `rollContextDataAttr(...)` (this module stays a leaf)
 * @param {string[]} [critDebuffs]
 * @param {string} [targetRowsAttr] the roll's `targetRowsDataAttr(...)`, or ''
 * @param {string|null} [sourceMessageId] the attack message this damage answers (E6.3): the apply finds each target's Evade by it
 * @returns {string} attribute text, starting with a space
 */
export function damageCardDataAttrs(evaluatedParts, rollContextAttr, critDebuffs = [], targetRowsAttr = '', sourceMessageId = null) {
  const parts = (evaluatedParts || []).map(cardPartOf);
  const crit = [...(critDebuffs || [])].filter(t => typeof t === 'string' && t);
  const sourceAttr = typeof sourceMessageId === 'string' && sourceMessageId
    ? ` data-source-message-id="${sourceMessageId.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}"`
    : '';
  return ` data-damage-parts='${jsonDataAttr(parts)}'${rollContextAttr} data-crit-debuffs='${jsonDataAttr(crit)}'${targetRowsAttr || ''}${sourceAttr}`;
}
