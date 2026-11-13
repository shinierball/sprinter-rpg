/**
 * Chat slash-command interceptor.
 */
import { COGSessionEngine } from '../documents/session/session-engine.mjs';
import { htmlSnippet } from '../utils/ui/html-snippet.mjs';

/**
 * Quick Chat Command Interceptor for Rapid In-Person Roll Logging
 * - /rapidlog, /batchlog, /rlog: Opens the Rapid Batch Import window
 * - /rapidlog <shorthand>, /log <shorthand>, /rlog <shorthand>: Parses a single line and directly logs it to active session
 * - /r is deliberately left to Foundry core (Fate dice, @ references, pools).
 * `apps` is what `src/hooks/chat-command-apps.mjs` hands in: `openRapidBatchImport`, `openMercenaryGuild`, `openThemeCleanup`, `parseRapidLine`.
 */
export function onChatMessageCommand(chatLog, message, chatData, apps) {
  // Foundry 14's chat input is ProseMirror: the hook receives `<p>text</p>` with `<` and `&` entity-escaped, before Foundry parses commands.
  const msg = htmlSnippet(message);
  const lower = msg.toLowerCase();

  // Standalone rapidlog triggers: /rapidlog, /batchlog, /rlog
  if (lower === '/rapidlog' || lower === '/batchlog' || lower === '/rlog') {
    apps.openRapidBatchImport();
    return false;
  }

  // Standalone Mercenary Guild triggers: /guild, /mercs, /mercenaries, /mercenary
  if (lower === '/guild' || lower === '/mercs' || lower === '/mercenaries' || lower === '/mercenary') {
    apps.openMercenaryGuild();
    return false;
  }

  // Theme cleanup window (GM): /themes
  if (lower === '/themes') {
    if (!globalThis.game?.user?.isGM) {
      globalThis.ui?.notifications?.warn?.(globalThis.game?.i18n?.localize?.('COG.ThemeCleanup.GMOnly') ?? 'COG.ThemeCleanup.GMOnly');
    } else {
      apps.openThemeCleanup();
    }
    return false;
  }

  // Explicit log commands with text: /rapidlog <text>, /batchlog <text>, /rlog <text>, /log <text>
  const explicitPrefixes = ['/rapidlog ', '/batchlog ', '/rlog ', '/log '];
  const matchedPrefix = explicitPrefixes.find(p => lower.startsWith(p));
  if (matchedPrefix) {
    const raw = msg.slice(matchedPrefix.length).trim();
    if (!raw) {
      apps.openRapidBatchImport();
      return false;
    }
    const crawlers = COGSessionEngine.getPartyCrawlers();
    const event = apps.parseRapidLine(raw, crawlers);
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

export function registerChatCommands(apps) {
  Hooks.on('chatMessage', (chatLog, message, chatData) => onChatMessageCommand(chatLog, message, chatData, apps));
}
