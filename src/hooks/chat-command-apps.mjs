/** The apps the chat slash commands open, handed to `src/commands/chat-commands.mjs` (which sits below the apps layer). */
import { COGMercenaryGuildApp } from '../apps/mercenary-guild.mjs';
import { COGRapidBatchImportApp } from '../apps/rapid-batch-import.mjs';
import { COGRapidTextParser } from '../apps/rapid-text-parser.mjs';
import { COGThemeCleanupApp } from '../apps/theme-cleanup.mjs';

export const chatCommandApps = Object.freeze({
  openRapidBatchImport: () => COGRapidBatchImportApp.open(),
  openMercenaryGuild: () => COGMercenaryGuildApp.open(),
  openThemeCleanup: () => COGThemeCleanupApp.open(),
  parseRapidLine: (raw, crawlers) => COGRapidTextParser.parseLine(raw, crawlers)
});
