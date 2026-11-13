/**
 * Sheet display of gear that is offline in a zero zone (7.17e5). Players never see the words "zero zone": they read
 * "not responding". Only the GM's tooltip names the zone, from `gearOfflineState(actor).label`.
 */
import { DEFAULT_GEAR_CONTRIBUTIONS, gearOfflineState, isGearSuppressed } from '../../utils/effects/gear-suppression.mjs';

import { contributesKind } from './gear-contributions.mjs';

/** English fallback when no i18n catalogue is loaded (headless tests); keys live in `lang/en.json`. */
const TEXT = Object.freeze({
  'COG.GearOffline.Badge': 'OFFLINE',
  'COG.GearOffline.Tip': 'Not responding. Its bonuses are not applied.',
  'COG.GearOffline.GmSource': 'Zero zone: {label}',
  'COG.GearOffline.StatTip': '{amount} gear not responding',
  'COG.GearOffline.AmountTip': '{amount} not responding'
});

function text(key, data = {}) {
  const i18n = globalThis.game?.i18n;
  let out = i18n?.has?.(key) ? i18n.format(key, data) : TEXT[key];
  if (!out || out === key) out = TEXT[key];
  return out.replace(/\{(\w+)\}/g, (m, k) => (k in data ? String(data[k]) : m));
}

const signed = (n) => `${n > 0 ? '+' : ''}${n}`;

/** Does this worn item give any kind of contribution that is off in the zone? */
function isGearOffline(actor, item) {
  const kinds = Object.keys(globalThis.CONFIG?.COG?.gearContributions ?? DEFAULT_GEAR_CONTRIBUTIONS);
  return kinds.some(kind => isGearSuppressed(actor, item, kind) && contributesKind(actor, item, kind));
}

/** The tooltip for an offline item: the player text, plus the zone label for the GM. */
export function offlineTip(actor) {
  let tip = text('COG.GearOffline.Tip');
  if (globalThis.game?.user?.isGM) {
    const label = gearOfflineState(actor).label;
    if (label) tip += ` ${text('COG.GearOffline.GmSource', { label })}`;
  }
  return tip;
}

/** Set `isOffline`, `offlineBadge` and `offlineTip` on each gear item (and on equipped-slot entries, which are the same objects). */
export function decorateOfflineGear(actor, items) {
  let tip = null;
  for (const item of items) {
    if (!item || item.type !== 'gear') continue;
    item.isOffline = isGearOffline(actor, item);
    if (item.isOffline) {
      item.offlineBadge = text('COG.GearOffline.Badge');
      item.offlineTip = tip ??= offlineTip(actor);
    }
  }
}

/** Titles for the five stat boxes, DR and Evade, with the "gear not responding" amount when there is one. */
export function offlineReadouts(system) {
  const stats = {};
  for (const [key, ability] of Object.entries(system?.abilities ?? {})) {
    const base = `Enhanced: ${ability?.unenhanced} base`;
    const gear = Number(ability?.gearBonus) || 0;
    const off = Number(ability?.offlineGearBonus) || 0;
    const parts = [];
    if (gear) parts.push(`${signed(gear)} gear`);
    if (off) parts.push(text('COG.GearOffline.StatTip', { amount: signed(off) }));
    stats[key] = parts.length ? `${base} (${parts.join(', ')})` : base;
  }
  const amountTip = (n, label) => (Number(n) ? `${label} (${text('COG.GearOffline.AmountTip', { amount: signed(Number(n)) })})` : label);
  return {
    stats,
    drItems: amountTip(system?.attributes?.dr?.offline, 'Items / Equipped Gear DR Bonus'),
    evadeItems: amountTip(system?.attributes?.evade?.offline, 'Items / Equipped Gear Bonus')
  };
}
