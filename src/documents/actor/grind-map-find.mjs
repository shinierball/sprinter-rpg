/**
 * The City Boss Map's find (the human's homebrew ruling 1184): a crawler holding an item tagged `rule.grind-map-city` is offered
 * a Silver box on its own card after the party Grind card, once per Grind app submission. The session grants nothing; the card carries one line and
 * one button per holder, and the click grants the box (`crawlerGrindMapFind`). The rows come from `GRIND_MAP_FINDS`.
 */
import { grindMapFindFor } from '../../data/rules/grinding-rules.mjs';
import { lootBoxTierDef } from '../../data/loot-box-tiers.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { flagPath, withFlags } from '../../utils/flags.mjs';
import { getItemAllTags } from '../active-tags.mjs';

/** The flag on the map-find card: `{ offers: [{ actorId, actorUuid, name, tier, itemName }], applied: { [actorId]: { ruleBreak } } }`. */
export const MAP_FINDS_FLAG = 'mapFinds';
/** The chat action of an offer's button. */
const MAP_FIND_ACTION = 'crawlerGrindMapFind';

const TEXT = Object.freeze({
  'COG.GrindMapFind.Line': '{name} holds {item}: finds a {tier} box.',
  'COG.GrindMapFind.Button': 'Grant {tier} box',
  'COG.GrindMapFind.Found': 'Found',
  'COG.GrindMapFind.AlreadyTitle': 'Already Found',
  'COG.GrindMapFind.AlreadyMessage': '{name} already found this session\'s box. Grant another as a Rule Break?',
  'COG.GrindMapFind.AlreadyReason': '{name} found a map box twice in one grinding session.'
});

export const grindMapFindText = (key, data = {}) => {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.format === 'function') return i18n.format(key, data);
  return (TEXT[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? ''));
};

/**
 * What a crawler's maps find: the map's name and the box tier, or null when no owned item carries a find tag.
 * @param {object} actor
 * @returns {{ itemName: string, boxTier: string }|null}
 */
export function mapFindOf(actor) {
  const owned = [...(actor?.items ?? [])].map((item) => ({ item, tags: item.allTags instanceof Set ? item.allTags : getItemAllTags(item) }));
  const find = grindMapFindFor(owned.map((o) => o.tags));
  if (!find) return null;
  const holder = owned.find((o) => o.tags.has(find.tag));
  return { itemName: String(holder?.item?.name ?? ''), boxTier: find.boxTier };
}

/**
 * The offers of a session: one per crawler result that has a find.
 * @param {Array<{ actorId: string, actor?: object, name: string, mapFind?: { itemName: string, boxTier: string }|null }>} results
 */
export function mapFindOffers(results) {
  return results.filter((r) => r.mapFind).map((r) => ({
    actorId: r.actorId, actorUuid: r.actor?.uuid ?? '', name: r.name, tier: r.mapFind.boxTier, itemName: r.mapFind.itemName
  }));
}

/**
 * The offers' markup. A granted offer shows a badge in place of its button.
 * @param {object[]} offers from `mapFindOffers`
 * @param {Record<string, { ruleBreak?: boolean }>} [applied]
 * @returns {string}
 */
function renderMapFindOffers(offers, applied = {}) {
  const rows = offers.map((o) => {
    const tier = lootBoxTierDef(o.tier).label;
    const line = escapeAttr(grindMapFindText('COG.GrindMapFind.Line', { name: o.name, item: o.itemName, tier }));
    const control = applied?.[o.actorId]
      ? `<span class="cog-state-badge">${escapeAttr(grindMapFindText('COG.GrindMapFind.Found'))}</span>`
      : `<button type="button" class="cog-btn cog-btn-primary" data-action="${MAP_FIND_ACTION}" data-target-uuid="${escapeAttr(o.actorUuid)}" data-actor-id="${escapeAttr(o.actorId)}" data-tier="${escapeAttr(o.tier)}" data-item-name="${escapeAttr(o.itemName)}"><i class="fa-solid fa-gift"></i> ${escapeAttr(grindMapFindText('COG.GrindMapFind.Button', { tier }))}</button>`;
    return `<div class="cog-grind-map-find"><span>${line}</span> ${control}</div>`;
  }).join('');
  return `<div class="cog-chat-card cog-grind-map-find-card">${rows}</div>`;
}

/**
 * Post the map-find card after a party Grind card: one line and one button per holder. Nothing is granted. No offers, no card.
 * @param {object[]} offers from `mapFindOffers`
 * @returns {Promise<object|null>}
 */
export async function postMapFindCard(offers) {
  if (!offers?.length || typeof globalThis.ChatMessage?.create !== 'function') return null;
  return globalThis.ChatMessage.create(withFlags({
    speaker: { alias: 'Dungeon Grinding Master' },
    content: renderMapFindOffers(offers)
  }, { [MAP_FINDS_FLAG]: { offers, applied: {} } }));
}

/** Rewrite a map-find card from its flag's offers and what was granted (content and flag together). */
export async function updateMapFindCard(message, offers, applied) {
  await message.update({ content: renderMapFindOffers(offers, applied), [flagPath(`${MAP_FINDS_FLAG}.applied`)]: applied });
}
