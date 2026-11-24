/**
 * `crawlerNpcTable`: the GM's Table 8 roll for an NPC against NPC row (core p. 83). A real 1d12, whispered to the GM with
 * the band's short summary; the attack card is not changed (the GM may decide otherwise).
 */
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { NPC_TABLE_DIE, npcTableBand, targetRowText } from '../../utils/combat/npc-vs-npc.mjs';
import { getCurrentFloor } from '../../documents/actor/actor-environment.mjs';
import { gmWhisper } from '../../utils/owner-recipients.mjs';

/** Foundry v14's message mode (`CONFIG.ChatMessage.modes`) for a roll only the GMs see. */
const GM_MESSAGE_MODE = 'gm';

/**
 * @returns {Promise<ChatMessage|null>}
 */
export async function handleNpcTable() {
  if (!globalThis.game?.user?.isGM) {
    globalThis.ui?.notifications?.warn(targetRowText('COG.TargetRows.NpcVsNpc.GmOnly'));
    return null;
  }
  const roll = await new Roll(NPC_TABLE_DIE).evaluate();
  const { band, bonus } = npcTableBand(roll.total, { floor: getCurrentFloor() });
  const summary = targetRowText(`COG.TargetRows.NpcVsNpc.Band.${band}`, { bonus });
  // `messageMode` is set because `toMessage` applies the user's message mode, and a public mode would clear the whisper.
  return roll.toMessage({
    speaker: ChatMessage.getSpeaker(),
    flavor: escapeAttr(targetRowText('COG.TargetRows.NpcVsNpc.Flavor', { face: roll.total, summary })),
    whisper: gmWhisper()
  }, { messageMode: GM_MESSAGE_MODE });
}
