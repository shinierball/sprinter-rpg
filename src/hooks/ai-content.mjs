/**
 * The Foundry side of the `aiContent` setting (7.16f): the onChange handler `register-settings` installs. It supplies the
 * dialogs and the redraws to `applyAiContentChange`; the logic is in `src/content/ai-content.mjs`.
 */
import { SYSTEM_ID } from '../constants.mjs';
import { contentRegistry } from '../content/registry.mjs';
import { applyAiContentChange, noteAppliedAiLevel } from '../content/ai-content.mjs';
import { maybePromptCleanup } from '../content/theme-cleanup.mjs';
import { COGThemeCleanupApp } from '../apps/theme-cleanup.mjs';
import { syncRegistryConfig, refreshOfferedContent } from './system-api.mjs';

const t = (key, data) => {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data && typeof i18n.format === 'function' ? i18n.format(key, data) : i18n.localize(key);
};

/** The confirmation of a hide level that leaves races or classes empty. Permissive: the GM may go ahead. */
async function confirmEmpty(empty) {
  const lists = empty.map((kind) => t(`COG.AiContent.List.${kind}`)).join(', ');
  return Boolean(await globalThis.foundry.applications.api.DialogV2.confirm({
    window: { title: t('COG.AiContent.ConfirmTitle') },
    content: `<p>${t('COG.AiContent.ConfirmBody', { lists })}</p>`,
    modal: true
  }));
}

/** The `onChange` of the `aiContent` setting. `userId` is the user who changed it; only that client asks and offers the cleanup. */
export async function onAiContentChange(value, _options, userId) {
  const mine = !userId || userId === globalThis.game?.user?.id;
  await applyAiContentChange({
    level: value,
    ask: mine && Boolean(globalThis.game?.user?.isGM),
    confirm: confirmEmpty,
    revert: (previous) => globalThis.game.settings.set(SYSTEM_ID, 'aiContent', previous),
    sync: syncRegistryConfig,
    refresh: refreshOfferedContent,
    prompt: () => maybePromptCleanup({ isActiveGM: () => true, open: () => COGThemeCleanupApp.open() })
  }).catch((err) => console.warn('Sprinter RPG | AI-content change failed:', err));
}

/** At ready: the level in force is the one a declined change goes back to. */
export function noteAiContentAtReady() {
  noteAppliedAiLevel(contentRegistry.getAiContentLevel());
}
