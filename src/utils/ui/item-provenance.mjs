/**
 * Item provenance: where a copy of an item came from. A pure reader of structured flags (never names or text) that
 * returns display entries for the item header and the inventory chip. A new source (a content-source badge, say) is one
 * more provider in PROVIDERS.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { lootBoxTierDef } from '../../data/loot-box-tiers.mjs';
import { sourceBadge } from '../content-source.mjs';
import { contentRegistry } from '../../content/registry.mjs';
import { isPoop, readReplacedRecord } from '../../data/rules/celestial-ai-poop.mjs';
import { deityGiftOf, deityIdOf } from '../deity/worship-state.mjs';

const isPlain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const text = (v) => (typeof v === 'string' ? v.trim() : '');

function flagOf(item, key) {
  let value;
  try {
    value = typeof item?.getFlag === 'function' ? item.getFlag(SYSTEM_ID, key) : undefined;
  } catch { value = undefined; }
  value ??= item?.flags?.[SYSTEM_ID]?.[key];
  return isPlain(value) ? value : null;
}

const t = (key, data) => {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
};

function dateLabel(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '';
  try { return new Date(n).toLocaleDateString(); } catch { return ''; }
}

/** The loot box the copy was opened from. Shown to the GM, and to the owner at Determine Value Rank 10. */
function lootBoxEntry(item, { gm, originVisible }) {
  const flag = flagOf(item, 'lootBox');
  if (!flag || !(gm || originVisible)) return null;
  const def = lootBoxTierDef(text(flag.tier));
  const box = text(flag.boxName);
  const date = dateLabel(flag.openedAt);
  let tooltip = t('COG.Provenance.LootBoxUnknown');
  if (box) tooltip = date ? t('COG.Provenance.LootBoxFromOn', { box, date }) : t('COG.Provenance.LootBoxFrom', { box });
  return { kind: 'lootBox', icon: def.icon, color: def.color, label: t('COG.Provenance.LootBox', { tier: def.label }), tooltip, gmOnly: false };
}

/** The generator record on a rolled item. GM only. */
function magicItemEntry(item, { gm }) {
  const flag = flagOf(item, 'magicItem');
  if (!flag || !gm) return null;
  const def = lootBoxTierDef(text(flag.tier));
  const rolls = Array.isArray(flag.rolls) ? flag.rolls.length : 0;
  const missed = Math.max(0, Math.trunc(Number(flag.missed) || 0));
  const tooltip = missed
    ? t('COG.Provenance.GeneratedRollsMissed', { rolls, missed })
    : t('COG.Provenance.GeneratedRolls', { rolls });
  return { kind: 'magicItem', icon: 'fa-solid fa-wand-sparkles', color: def.color, label: t('COG.Provenance.Generated', { tier: def.label }), tooltip, gmOnly: true };
}

/** The pre-roll record on a world item. GM only. */
function prerollEntry(item, { gm }) {
  const flag = flagOf(item, 'lootBoxPreroll');
  if (!flag || !gm) return null;
  const box = text(flag.boxName);
  return {
    kind: 'preroll', icon: 'fa-solid fa-dice', color: '',
    label: t('COG.Provenance.Preroll'),
    tooltip: box ? t('COG.Provenance.PrerollFor', { box }) : t('COG.Provenance.PrerollUnknown'),
    gmOnly: true
  };
}

/** The content-source stamp (7.7d): which theme and set the document came from. Everyone sees it. */
function contentSourceEntry(item) {
  const badge = sourceBadge(item);
  if (!badge) return null;
  return { kind: 'source', icon: badge.icon, color: `var(${badge.color})`, label: badge.label, tooltip: badge.tooltip, gmOnly: false, badge };
}

/**
 * What a Celestial AI Poop replaced (7.15). Everyone sees it. A record that cannot be read shows "Replaced (unknown)".
 * The theme and set labels come from the registry, falling back to the stored ids.
 */
function replacedEntry(item) {
  if (!isPoop(item)) return null;
  const base = { kind: 'replaced', icon: 'fa-solid fa-poo', color: '', gmOnly: false };
  const record = readReplacedRecord(item);
  if (!record) return { ...base, label: t('COG.Provenance.ReplacedUnknown'), tooltip: t('COG.Provenance.ReplacedUnknown') };
  const { theme, set } = record.source;
  const themeLabel = contentRegistry.getThemes?.()[theme]?.label || theme;
  const setLabel = contentRegistry.getSourceSet?.(theme, set)?.label || set;
  const name = record.name || t('COG.Provenance.ReplacedNoName');
  const date = dateLabel(record.replacedAt);
  const where = theme ? t('COG.Provenance.ReplacedWhere', { theme: themeLabel, set: setLabel }) : '';
  const label = where ? t('COG.Provenance.ReplacedWithSource', { name, where }) : t('COG.Provenance.Replaced', { name });
  return { ...base, label, tooltip: date ? t('COG.Provenance.ReplacedOn', { label, date }) : label };
}

/** The gift kinds' label keys: a boon, a smite, and the tier and standing gifts of a worshipped god. */
const GIFT_LABELS = Object.freeze({ boon: 'COG.Provenance.GiftBoon', smite: 'COG.Provenance.GiftSmite', tier: 'COG.Provenance.GiftTier', standing: 'COG.Provenance.GiftTier' });

/** The god's name from the owner's deity item (by identifier), else the identifier. */
function giftGodName(item, identifier) {
  const god = Array.from(item?.parent?.items ?? []).find((i) => i?.type === 'deity' && deityIdOf(i) === identifier);
  return text(god?.name) || identifier;
}

/** A gift from a god (tier, standing, boon or smite). Everyone sees it. */
function deityGiftEntry(item) {
  const gift = deityGiftOf(item);
  if (!gift) return null;
  const label = t(GIFT_LABELS[gift.kind], { god: giftGodName(item, gift.deity) });
  return { kind: 'deityGift', icon: 'fa-solid fa-hands-praying', color: '', label, tooltip: label, gmOnly: false };
}

const PROVIDERS = [contentSourceEntry, lootBoxEntry, magicItemEntry, prerollEntry, replacedEntry, deityGiftEntry];

/**
 * @param {Item} item
 * @param {{ gm?: boolean, originVisible?: boolean }} [viewer]
 * @returns {{ entries: Array<{ kind: string, icon: string, color: string, label: string, tooltip: string, gmOnly: boolean }> }}
 */
export function itemProvenance(item, viewer = {}) {
  const view = { gm: Boolean(viewer?.gm), originVisible: Boolean(viewer?.originVisible) };
  const entries = [];
  for (const provider of PROVIDERS) {
    try {
      const entry = provider(item, view);
      if (entry) entries.push(entry);
    } catch { /* a malformed flag gives no entry */ }
  }
  return { entries };
}

/**
 * Sets `context.provenance` (null when there is nothing to show) for an item. The origin gate is the owning actor's
 * Determine Value Rank; an unowned item shows its origin only to the GM.
 * @param {object} context
 * @param {Item} item
 * @returns {object} the context
 */
export function buildItemProvenanceContext(context, item) {
  if (!item || item.documentName !== 'Item') { context.provenance = null; return context; }
  const gm = Boolean(globalThis.game?.user?.isGM);
  const owner = item.parent;
  const originVisible = typeof owner?.canSeeItemOrigin === 'function' ? owner.canSeeItemOrigin() : false;
  const { entries } = itemProvenance(item, { gm, originVisible });
  context.provenance = entries.length ? { entries } : null;
  // The GM's Restore button on a Celestial AI Poop that sits on an actor and has a readable record.
  context.canRestorePoop = gm && Boolean(owner) && readReplacedRecord(item) !== null;
  return context;
}
