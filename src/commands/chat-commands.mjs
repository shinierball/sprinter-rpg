/**
 * Chat slash-command interceptor.
 */
import { COGMercenaryGuildApp } from '../apps/mercenary-guild.mjs';
import { COGSessionEngine } from '../apps/session-manager.mjs';
import { COGRapidBatchImportApp } from '../apps/rapid-batch-import.mjs';
import { COGRapidTextParser } from '../apps/rapid-text-parser.mjs';

/**
 * Quick Chat Command Interceptor for Rapid In-Person Roll Logging
 * - /rapidlog, /batchlog, /rlog: Opens the Rapid Batch Import window
 * - /rapidlog <shorthand>, /log <shorthand>, /rlog <shorthand>: Parses a single line and directly logs it to active session
 * - /r is deliberately left to Foundry core (Fate dice, @ references, pools).
 */
export function onChatMessageCommand(chatLog, message, chatData) {
  const msg = (message || '').trim();
  const lower = msg.toLowerCase();

  // Standalone rapidlog triggers: /rapidlog, /batchlog, /rlog
  if (lower === '/rapidlog' || lower === '/batchlog' || lower === '/rlog') {
    COGRapidBatchImportApp.open();
    return false;
  }

  // Standalone Mercenary Guild triggers: /guild, /mercs, /mercenaries, /mercenary
  if (lower === '/guild' || lower === '/mercs' || lower === '/mercenaries' || lower === '/mercenary') {
    COGMercenaryGuildApp.open();
    return false;
  }

  // Explicit log commands with text: /rapidlog <text>, /batchlog <text>, /rlog <text>, /log <text>
  const explicitPrefixes = ['/rapidlog ', '/batchlog ', '/rlog ', '/log '];
  const matchedPrefix = explicitPrefixes.find(p => lower.startsWith(p));
  if (matchedPrefix) {
    const raw = msg.slice(matchedPrefix.length).trim();
    if (!raw) {
      COGRapidBatchImportApp.open();
      return false;
    }
    const crawlers = COGSessionEngine.getPartyCrawlers();
    const event = COGRapidTextParser.parseLine(raw, crawlers);
    if (event) {
      COGSessionEngine.batchCreateEvents([event]).then(() => {
        const actorName = crawlers.find(c => c.id === event.actorId)?.name || 'Crawler';
        if (typeof ui !== 'undefined' && ui.notifications?.info) {
          ui.notifications.info(`⚡ Sprinter RPG | Logged: ${event.name} (${event.total ?? ''}) for ${actorName}`);
        }
        COGSessionEngine._refreshOpenWindows();
      });
    } else {
      if (typeof ui !== 'undefined' && ui.notifications?.warn) {
        ui.notifications.warn(`Sprinter RPG | Could not parse roll log: "${raw}"`);
      }
    }
    return false;
  }
}

export function registerChatCommands() {
  Hooks.on('chatMessage', onChatMessageCommand);
}
