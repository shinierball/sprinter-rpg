/**
 * The "Area placed" chat card: posted after a player or GM places an item's area, with a Dismiss Zone
 * button (action delegate `crawlerDismissArea`, no `name` attribute) that ends the placed group.
 */
import { SYSTEM_ID } from '../constants.mjs';
import { combatText } from '../utils/combat/combat-round-text.mjs';
import { escapeAttr } from '../utils/escape-attr.mjs';


/**
 * @param {{ name: string, flags: object }[]} regions the created regions (core first)
 * @param {{ item?: Item, scene?: Scene }} p
 * @returns {string|null} the card HTML, or null when no placed group is among the regions
 */
export function buildAreaPlacedCard(regions, { item, scene } = {}) {
  const core = regions.find(r => r.flags?.[SYSTEM_ID]?.area?.role === 'core') ?? regions[0];
  const area = core?.flags?.[SYSTEM_ID]?.area;
  if (!area?.groupId) return null;
  let line;
  if (area.kind !== 'zone') line = combatText('COG.ZonePulse.PlacedMarker');
  else if (area.remainingRounds > 0) line = combatText('COG.ZonePulse.PlacedRounds', { rounds: area.remainingRounds });
  else line = combatText('COG.ZonePulse.PlacedUntilDismissed');
  return `<div class="cog-chat-card cog-area-placed-card">
    <header class="cog-card-header"><h3><i class="fa-solid fa-bullseye"></i> ${escapeAttr(combatText('COG.ZonePulse.Placed', { name: core.name }))}</h3></header>
    <div class="cog-card-body">
      <div class="cog-text-muted">${escapeAttr(line)}</div>
      <button type="button" class="cog-btn cog-dismiss-aura-btn" data-action="crawlerDismissArea" data-group-id="${escapeAttr(area.groupId)}" data-scene-uuid="${escapeAttr(scene?.uuid ?? core.parent?.uuid ?? '')}" data-actor-uuid="${escapeAttr(item?.parent?.uuid ?? area.casterUuid ?? '')}">${escapeAttr(combatText('COG.ZonePulse.Dismiss'))}</button>
    </div>
  </div>`;
}

/** Post the card for freshly created regions. @returns {Promise<ChatMessage|null>} */
export async function postAreaPlacedCard(regions, { item, scene } = {}) {
  const content = buildAreaPlacedCard(regions, { item, scene });
  if (!content || typeof globalThis.ChatMessage?.create !== 'function') return null;
  const speaker = globalThis.ChatMessage.getSpeaker?.({ actor: item?.parent }) ?? { alias: item?.parent?.name ?? '' };
  return globalThis.ChatMessage.create({ content, speaker });
}
