/**
 * Declared mob attacks: pure record helpers.
 *
 * A mob attack never rolls to hit. In combat, its card (Step 1) is recorded on the Combat under
 * `flags.sprinter-rpg.declaredAttacks.<attack message id>`. Step 2 interrupts change the record (an Evade, a Taunt
 * that redirects the attack, a Catcher that intercepts it) and Step 3 resolves it through the damage card's apply.
 * The chat log stays the truth for each target's Evade (evade-link.mjs); the record says who the attack lands on.
 *
 * Imports nothing from documents, so the combat, actor and chat modules may all use it.
 */
import { SYSTEM_ID } from '../../constants.mjs';

export const DECLARED_ATTACKS_FLAG = 'declaredAttacks';

/** A declaration is open until Step 3 resolves it. */
export const DECLARATION_STATUS = Object.freeze({ DECLARED: 'declared', RESOLVED: 'resolved' });

/** How a target entry changed hands in Step 2. */
export const TARGET_VIA = Object.freeze({ REDIRECT: 'redirect', INTERCEPT: 'intercept' });

/** A target's Step 2 standing (the spec's `declared` / `evaded` / `evaded-half`, plus a failed Evade). */
export const TARGET_STATUS = Object.freeze({
  PENDING: 'declared',
  EVADED: 'evaded',
  EVADED_HALF: 'evaded-half',
  HIT: 'hit',
  /** Step 3 ran and the target took the hit with no recorded Evade (nothing is left to wait for). */
  RESOLVED: 'resolved'
});

/** Why a target got no damage at resolution. */
export const SKIP_REASONS = Object.freeze({ EVADED: 'evaded', APPLIED_BEFORE: 'applied-before', MISSING: 'missing', UNTRUSTED: 'untrusted' });

const MAX_TARGETS = 50;
const MAX_TEXT = 120;
const EVADE_OUTCOMES = new Set(['hit', 'avoided', 'area_half', 'area_none']);
const ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/** English fallbacks of the `COG.MobAttack.*` lang keys (lang/en.json holds the same text). */
export const MOB_ATTACK_TEXT = Object.freeze({
  'COG.MobAttack.Header': 'Mob Attack Declared — Hits Automatically',
  'COG.MobAttack.SpellHeader': 'Mob Spell Declared — Hits Automatically',
  'COG.MobAttack.FloorBadge': 'Floor {floor}',
  'COG.MobAttack.EvadeLabel': 'Target Evade Difficulty:',
  'COG.MobAttack.EvadeDC': 'Evade DC {dc}',
  'COG.MobAttack.EvadeBreakdown': 'Base {base} + Floor {floor}',
  'COG.MobAttack.EvadeShift': '{sign}{n} ({label})',
  'COG.MobAttack.FlatLabel': 'Check modifiers',
  'COG.MobAttack.EvadeButton': 'Roll Evade vs Attack (DC {dc})',
  'COG.MobAttack.EvadeButtonFree': 'Roll Evade vs Attack (DC {dc}): first Evade free',
  'COG.MobAttack.FreeEvadeLine': 'Free Evade: the attacker is at Disadvantage',
  'COG.MobAttack.EvadeCoveredLine': 'Evade Action already spent this round: no Action',
  'COG.MobAttack.SaveShift': 'Save Difficulty {sign}{n} ({label})',
  'COG.MobAttack.EvadeHint': 'Crawler rolls 1d20 + Dex Mod + Evade gear/buffs. Roll ≥ {dc} succeeds.',
  'COG.MobAttack.AreaBadge': 'AREA ATTACK: Successful evade takes 50% damage.',
  'COG.MobAttack.TauntButton': 'Taunt: redirect this attack to your crawler',
  'COG.MobAttack.ResolveButton': 'Resolve now (Step 3)',
  'COG.MobAttack.RollEvadeFor': 'Roll Evade: {name} (DC {dc})',
  'COG.MobAttack.Redirected': 'REDIRECTED: {from} → {to}. The attack hits automatically; {to} may Evade (DC {dc}) or take it.',
  'COG.MobAttack.Intercepted': 'INTERCEPTED: {to} takes the hit meant for {from}.',
  'COG.MobAttack.RuleBreakTitle': 'Rule Break',
  'COG.MobAttack.EvadeTwice': '{name} already rolled Evade against this attack. Roll again as a Rule Break?',
  'COG.MobAttack.TauntNoTag': '{name} has no Taunt interrupt. Taunt anyway as a Rule Break?',
  'COG.MobAttack.TauntNoRedirect': 'This attack cannot be redirected. Taunt anyway as a Rule Break?',
  'COG.MobAttack.CatchEvaded': '{name} already evaded this attack. Catch it anyway as a Rule Break?',
  'COG.MobAttack.ResolvePending': 'Crawlers can still Interrupt (Step {step}). Resolve the declared attacks now as a Rule Break?',
  'COG.MobAttack.PickCrawler': 'Taunt with which crawler?',
  'COG.MobAttack.PickCrawlerHint': 'No crawler is selected. Choose who taunts.',
  'COG.MobAttack.PickTarget': 'Redirect the attack aimed at whom?',
  'COG.MobAttack.NoCrawler': 'Sprinter RPG | Select or assign a crawler first.',
  'COG.MobAttack.NoTarget': 'Sprinter RPG | This attack has no other target to taunt away from.',
  'COG.MobAttack.GmOnly': 'Sprinter RPG | Only the GM resolves declared attacks.',
  'COG.MobAttack.NoDeclaration': 'Sprinter RPG | This attack is not declared in the active combat.',
  'COG.MobAttack.ResolvedCount': 'Sprinter RPG | Resolved {count} declared attack(s).',
  'COG.MobAttack.TauntName': 'Taunt'
});

/** Localized text with a built-in English fallback (the test harness has no i18n). */
export function mobAttackText(key, data = {}) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.format === 'function') return i18n.format(key, data);
  return (MOB_ATTACK_TEXT[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? ''));
}

const str = (v, max = MAX_TEXT) => (typeof v === 'string' ? v.slice(0, max) : '');
const strOrNull = (v) => (typeof v === 'string' && v ? v.slice(0, 256) : null);
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** True for a usable declaration id (a chat message id). */
export function isDeclarationId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

/** The sanitized evade summary of a target entry, or null. */
function sanitizeEvade(raw) {
  if (!isPlainObject(raw) || !EVADE_OUTCOMES.has(raw.outcome)) return null;
  return {
    outcome: raw.outcome,
    multiplier: Math.min(1, Math.max(0, num(raw.multiplier, 1))),
    messageId: strOrNull(raw.messageId),
    ruleBreak: raw.ruleBreak === true,
    free: raw.free === true
  };
}

function sanitizeTarget(key, raw) {
  if (!isPlainObject(raw) || typeof raw.uuid !== 'string' || !raw.uuid) return null;
  const via = Object.values(TARGET_VIA).includes(raw.via) ? raw.via : null;
  return {
    key,
    uuid: raw.uuid,
    actorId: strOrNull(raw.actorId),
    tokenId: strOrNull(raw.tokenId),
    name: str(raw.name),
    originalUuid: typeof raw.originalUuid === 'string' && raw.originalUuid ? raw.originalUuid : raw.uuid,
    originalName: str(raw.originalName ?? raw.name),
    via,
    interrupterUuid: via ? strOrNull(raw.interrupterUuid) : null,
    ruleBreak: raw.ruleBreak === true,
    evade: sanitizeEvade(raw.evade)
  };
}

function sanitizeResolution(raw) {
  if (!isPlainObject(raw)) return null;
  const results = Array.isArray(raw.results) ? raw.results.slice(0, MAX_TARGETS).filter(isPlainObject).map(r => ({
    uuid: str(r.uuid, 256),
    name: str(r.name),
    damage: num(r.damage, 0),
    skipped: Object.values(SKIP_REASONS).includes(r.skipped) ? r.skipped : null
  })) : [];
  return {
    at: num(raw.at, 0),
    damageMessageId: strOrNull(raw.damageMessageId),
    ruleBreak: raw.ruleBreak === true,
    results
  };
}

/**
 * The sanitized declaration, targets as an array in key order; null when unusable.
 * @param {object} raw
 * @returns {object|null}
 */
export function sanitizeDeclaration(raw) {
  if (!isPlainObject(raw) || !isDeclarationId(raw.messageId) || typeof raw.attackerUuid !== 'string' || !raw.attackerUuid) return null;
  const targetEntries = isPlainObject(raw.targets) ? Object.entries(raw.targets) : [];
  const targets = targetEntries
    .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
    .slice(0, MAX_TARGETS)
    .map(([key, t]) => sanitizeTarget(key, t))
    .filter(Boolean);
  return {
    messageId: raw.messageId,
    round: num(raw.round, 0),
    createdAt: num(raw.createdAt, 0),
    attackerUuid: raw.attackerUuid,
    attackerName: str(raw.attackerName),
    itemId: strOrNull(raw.itemId),
    itemUuid: strOrNull(raw.itemUuid),
    itemName: str(raw.itemName),
    isSpell: raw.isSpell === true,
    evadeDC: num(raw.evadeDC, 0),
    floor: num(raw.floor, 1),
    isArea: raw.isArea === true,
    status: raw.status === DECLARATION_STATUS.RESOLVED ? DECLARATION_STATUS.RESOLVED : DECLARATION_STATUS.DECLARED,
    ruleBreak: raw.ruleBreak === true,
    targets,
    resolution: sanitizeResolution(raw.resolution)
  };
}

/**
 * The declaration a mob's auto-hit card describes, built from the card's own flags (never from a relay payload).
 * Null when the message is not an auto-hit card or names no attacker.
 * @param {object} message the attack ChatMessage
 * @param {{ round?: number, now?: number }} [opts]
 * @returns {object|null} a storable record (targets keyed `t0`, `t1`, ...)
 */
export function declarationFromMessage(message, { round = 0, now = Date.now() } = {}) {
  const f = message?.flags?.[SYSTEM_ID];
  if (!f || f.isAutoHit !== true || !isDeclarationId(message?.id)) return null;
  const attackerUuid = typeof f.attackerUuid === 'string' && f.attackerUuid ? f.attackerUuid : null;
  if (!attackerUuid) return null;
  const targets = {};
  const rows = Array.isArray(f.targetResults) ? f.targetResults.slice(0, MAX_TARGETS) : [];
  rows.forEach((tr, i) => {
    const uuid = typeof tr?.actorUuid === 'string' && tr.actorUuid ? tr.actorUuid : null;
    if (!uuid) return;
    targets[`t${i}`] = {
      uuid, actorId: strOrNull(tr.actorId), tokenId: strOrNull(tr.tokenId), name: str(tr.actorName),
      originalUuid: uuid, originalName: str(tr.actorName), via: null, interrupterUuid: null, ruleBreak: false, evade: null
    };
  });
  return {
    messageId: message.id,
    round: num(round, 0),
    createdAt: num(now, 0),
    attackerUuid,
    attackerName: str(f.attackerName),
    itemId: strOrNull(f.attackItemId),
    itemUuid: strOrNull(f.attackItemUuid),
    itemName: str(f.attackItemName),
    isSpell: f.isSpellAttack === true,
    evadeDC: num(f.effectiveEvadeDC ?? f.targetDC, 0),
    floor: num(f.currentFloor, 1),
    isArea: f.isArea === true,
    status: DECLARATION_STATUS.DECLARED,
    ruleBreak: false,
    targets,
    resolution: null
  };
}

/**
 * Every sanitized declaration in a combat's flag value, oldest first.
 * @param {object} flagValue `flags.sprinter-rpg.declaredAttacks`
 * @param {{ round?: number|null, status?: string|null }} [filter]
 * @returns {object[]}
 */
export function listDeclarations(flagValue, { round = null, status = null } = {}) {
  if (!isPlainObject(flagValue)) return [];
  return Object.values(flagValue)
    .map(sanitizeDeclaration)
    .filter(d => d && (round === null || d.round === Number(round)) && (status === null || d.status === status))
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** The target entry now aimed at `uuid` (falling back to its actor id, which unlinked tokens share), or null. */
export function findDeclarationTarget(declaration, { uuid = null, actorId = null, tokenId = null } = {}) {
  const targets = declaration?.targets ?? [];
  if (uuid) {
    const byUuid = targets.find(t => t.uuid === uuid);
    if (byUuid) return byUuid;
  }
  if (actorId) {
    return targets.find(t => t.actorId === actorId && (!tokenId || !t.tokenId || t.tokenId === tokenId)) ?? null;
  }
  return null;
}

/**
 * A target entry's standing from its recorded Evade; with the declaration, a resolved attack settles targets that
 * recorded no Evade (they are no longer "awaiting" anything).
 */
export function targetStatus(target, declaration = null) {
  const evade = target?.evade;
  if (!evade) {
    if (declaration?.status !== DECLARATION_STATUS.RESOLVED) return TARGET_STATUS.PENDING;
    const row = declaration.resolution?.results?.find(r => r.uuid === target?.uuid);
    return row?.skipped === SKIP_REASONS.EVADED ? TARGET_STATUS.EVADED : TARGET_STATUS.RESOLVED;
  }
  if (evade.outcome === 'avoided' || evade.multiplier === 0) return TARGET_STATUS.EVADED;
  if (evade.outcome === 'area_half') return TARGET_STATUS.EVADED_HALF;
  return TARGET_STATUS.HIT;
}

/** The evade summary to store from an evade-link record (`readEvadeRecord`). */
export function evadeSummaryOf(record, { ruleBreak = false } = {}) {
  if (!record) return null;
  return sanitizeEvade({ outcome: record.outcome, multiplier: record.multiplier, messageId: record.messageId, ruleBreak, free: record.free === true });
}
