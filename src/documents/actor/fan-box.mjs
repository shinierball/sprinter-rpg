/**
 * Fan Boxes (core p. 280). A box is one trophy and one tier box that waits for the GM to fill it (the audience's vote).
 */
import { lootBoxTierDef } from '../../data/loot-box-tiers.mjs';
import { COG_ACHIEVEMENT_TIERS } from '../../data/rules/achievement-tiers.mjs';
import { FAN_BOX_VOTE_HOURS } from '../../data/rules/popularity-changes.mjs';
import { formatDayClock, SECONDS_PER_HOUR } from '../../utils/time/timing.mjs';
import { checklistText as text } from '../../chat/popularity-checklist-card.mjs';
import { COGSessionEngine } from '../session/session-engine.mjs';
import { getCurrentFloor } from './actor-environment.mjs';
import { awardAchievement } from './achievement-award.mjs';
import { updateChecklistState } from './popularity-checklist.mjs';

const KEY = 'COG.PopularityChecklist';
const worldNow = () => Number(globalThis.game?.time?.worldTime) || 0;

/**
 * Give a crawler a Fan Box: one trophy and one tier box that waits for the GM to fill it (the audience's vote), through
 * the one award path, then the ledger line and the crawler's latest Fan Box floor. GM side.
 * @param {Actor} actor
 * @param {{ tier: string, reason: string }} box
 * @returns {Promise<{ item: Item|null, boxes: Item[] }|null>} null on a non-GM client
 */
export async function grantFanBox(actor, { tier }) {
  if (!actor) return null;
  const label = lootBoxTierDef(tier).label;
  const id = lootBoxTierDef(tier).id;
  const name = text(`${KEY}.BoxTrophy`, { tier: label });
  const quote = text(`${KEY}.BoxQuote`, { time: formatDayClock(worldNow() + FAN_BOX_VOTE_HOURS * SECONDS_PER_HOUR) });
  const result = await awardAchievement(actor, {
    name,
    img: 'icons/svg/upgrade.svg',
    system: {
      quote,
      reward: text(`${KEY}.BoxReward`, { tier: label }),
      tier: id in COG_ACHIEVEMENT_TIERS ? id : 'special',
      rewardBoxes: [{ tier: id, quantity: 1, whenEmpty: 'keep' }]
    }
  }, { repeatable: true });
  if (!result) return null;
  await COGSessionEngine.recordLootBox({ actorId: actor.id, tier: id, title: name, defaultQuote: quote, award: false }).catch(() => {});
  const floor = getCurrentFloor();
  await updateChecklistState((state) => ({ ...state, fanBoxes: { ...state.fanBoxes, lastFloor: { ...state.fanBoxes?.lastFloor, [actor.id]: floor } } }));
  return result;
}
