/**
 * The worship cards' buttons: [Boon] and [Smite] (`crawlerDeityGift`) open the GM's gift dialog for the actor and deity the
 * button names; [Apply] (`crawlerDeityFallen`) makes the crawler Fallen from Grace; [Roll smite chance]
 * (`crawlerDeitySmiteChance`) rolls the book's chance of being smitten; [Award Level] (`crawlerDeityInfidels`) gives the
 * once-per-Floor Level of Death to the Infidels. All GM only.
 */
import { openDeityGift } from '../../documents/actor/deity-gifts.mjs';
import { applyFallen } from '../../documents/actor/devotion.mjs';
import { FALLEN_SMITE_CHANCE_PERCENT } from '../../utils/deity/devotion.mjs';
import { gainLevels } from '../../documents/actor/actor-advancement.mjs';
import { settleFloorUses } from '../../utils/floor/floor-row-usage.mjs';
import { useTagFor } from '../../data/tag-vocabulary.mjs';
import { say, speakerOf } from '../../documents/actor/vehicle-drive-common.mjs';

/** The actor and its deity item a button names (`data-actor-uuid`, `data-item-id`); null when either is missing. */
async function targetOf(button) {
  const actor = await globalThis.fromUuid?.(String(button.dataset?.actorUuid ?? ''));
  const deityItem = Array.from(actor?.items ?? []).find((item) => item.id === String(button.dataset?.itemId ?? ''));
  return actor && deityItem?.type === 'deity' ? { actor, deityItem } : null;
}

/**
 * @param {Event} event
 * @param {HTMLElement} button `data-actor-uuid`, `data-item-id`, `data-mode` (`boon` or `smite`), optional `data-filter-tag`
 * @param {ChatMessage} message
 */
export async function handleDeityGift(event, button, message) {
  if (!globalThis.game?.user?.isGM) return null;
  const target = await targetOf(button);
  if (!target) return null;
  return openDeityGift(target.actor, target.deityItem, String(button.dataset?.mode ?? ''), { filterTag: button.dataset?.filterTag ?? '' });
}

/** [Apply]: the crawler falls from grace (the worship ends, the Fallen debuff is applied). */
export async function handleDeityFallen(event, button, message) {
  if (!globalThis.game?.user?.isGM) return null;
  const target = await targetOf(button);
  return target ? applyFallen(target.actor, target.deityItem) : null;
}

/** [Roll smite chance]: 1d100 to chat; the chance or less reads "smitten" (p. 163). The GM then grants the smite. */
export async function handleDeitySmiteChance(event, button, message) {
  if (!globalThis.game?.user?.isGM) return null;
  const target = await targetOf(button);
  if (!target) return null;
  const roll = await new Roll('1d100').evaluate();
  const smitten = roll.total <= FALLEN_SMITE_CHANCE_PERCENT;
  const names = { actor: target.actor.name, deity: target.deityItem.name, percent: FALLEN_SMITE_CHANCE_PERCENT };
  await roll.toMessage({
    speaker: speakerOf(target.actor),
    flavor: smitten
      ? say('COG.Deity.Notice.Smitten', '{actor} is smitten by {deity} ({percent}% chance).', names)
      : say('COG.Deity.Notice.NotSmitten', '{actor} is spared by {deity} ({percent}% chance).', names)
  });
  return { smitten, total: roll.total };
}

/** The once-per-Floor record key of Death to the Infidels (p. 164). */
const INFIDELS_KEY = 'worship-infidels';

/** [Award Level]: one Level. A second award on the same Floor asks a Rule Break first; declining awards nothing. */
export async function handleDeityInfidels(event, button, message) {
  if (!globalThis.game?.user?.isGM) return null;
  const actor = await globalThis.fromUuid?.(String(button.dataset?.actorUuid ?? ''));
  if (!actor) return null;
  const tag = useTagFor(INFIDELS_KEY);
  const labels = new Map([[INFIDELS_KEY, say('COG.Deity.Obligations.InfidelsUsed', 'Death to the Infidels')]]);
  const settled = await settleFloorUses(actor, [tag], { labels });
  if (!settled.situations.includes(tag)) return null;
  return gainLevels(actor, 1, { source: 'award' });
}
