/**
 * The ready hook orchestration.
 */
import { COGFloorClockHUD } from '../apps/floor-clock-hud.mjs';
import { COGCrawlerClockHUD } from '../apps/crawler-clock-hud.mjs';
import { COGEffectsPanel } from '../apps/effects-panel.mjs';
import { initCrawlerTokenHUD, getCrawlerTokenHUD } from '../apps/crawler-token-hud.mjs';
import { COGCombatMetricsApp } from '../apps/combat-metrics.mjs';
import { tagIndex } from '../utils/tag/tag-index.mjs';
import { injectActorDirectoryButtons } from './directory.mjs';
import { setupInitialHotbar } from './hotbar.mjs';
import { runGMWorldSetup } from './world-setup.mjs';
import { checkDefaultUnpause } from './pause.mjs';
import { registerSceneEpochHooks } from '../documents/actor/dungeon-time.mjs';
import { registerDurationHooks } from '../documents/actor/duration-expiry.mjs';
import { registerLightExpiry } from '../documents/actor/light-source.mjs';
import { registerCameraHooks } from '../chat/actions/cameras.mjs';
import { registerContestHooks } from '../chat/contest-ingest.mjs';
import { registerVehicleDriveHooks } from '../documents/actor/vehicle-drive.mjs';
import { getActiveGM, isActiveGM } from '../utils/gm-relay.mjs';
import { COGThemeCleanupApp } from '../apps/theme-cleanup.mjs';
import { maybePromptCleanup } from '../content/theme-cleanup.mjs';
import { noteAiContentAtReady } from './ai-content.mjs';
import { clearPopularityUsage } from '../documents/actor/actor-popularity.mjs';
import { reconcilePersonalSpaceOwnership } from '../documents/actor/personal-space-links.mjs';
import { reconcileVehicleOwnership } from '../documents/actor/vehicle-crew.mjs';
import { sourceryCatalogsReady } from '../content/sourcery-content-provider.mjs';
import { refreshHudVisibility } from '../utils/effects/hud-visibility.mjs';
import { reconcileAllOnReady, refreshOnCanvasReady } from '../utils/effects/gear-offline-refresh.mjs';
import { contentRegistry } from '../content/registry.mjs';

/**
 * The primary theme is always on. When the off list names it, the GM is told once at ready that it was ignored.
 * @returns {boolean} true when a notice was shown
 */
export function noticePrimaryListedOff(registry = contentRegistry) {
  const primary = registry.getPrimaryThemeId();
  if (!registry.getDisabledThemeIds().includes(primary)) return false;
  const label = registry.getThemes()[primary]?.label || primary;
  ui.notifications?.warn(game.i18n.format('COG.ThemesOff.PrimaryStaysOn', { theme: label }));
  return true;
}

export async function onReady() {
  // The crawler token HUD listens for token control before the awaits below: a token controlled while ready is still
  // running must get its HUD, so the listener cannot wait for the end of this hook.
  const crawlerHud = initCrawlerTokenHUD();
  // On a page load the canvas is drawn (and a player's character token controlled) before `ready`, so the first
  // `canvasReady` and `controlToken` have already fired: pick up the token that is controlled now.
  if (globalThis.canvas?.ready) crawlerHud.syncControlledToken();
  // A scene here is bounded by a combat starting or ending (or the GM's New Scene button), not by a Foundry scene.
  registerSceneEpochHooks();
  // Timed effects end on the world clock and at the end of a combat (the active GM only).
  registerDurationHooks();
  registerLightExpiry();
  // The Playing to the Cameras award settles on the active GM's client as camera cards are created and updated.
  registerCameraHooks();
  // A leg roll reaches its contest card on the active GM's client; a contest card asks before it is deleted.
  registerContestHooks();
  // A vehicle check card reaches its vehicle (Table 6, braking) on the active GM's client.
  registerVehicleDriveHooks();
  // Imported Sourcery text joins the registry catalogs (built sync from the redacted specs; the world packs are async). The
  // refresh began at `setup`; this only waits for it.
  await sourceryCatalogsReady().catch(err => console.warn('Sprinter RPG | Sourcery catalog refresh failed:', err));
  if (game.user.isGM) await runGMWorldSetup();
  if (game.user.isGM) noticePrimaryListedOff();
  noteAiContentAtReady();
  // The active GM is offered the cleanup of a turned-off theme (or hidden AI content) once per change of the off list.
  await maybePromptCleanup({ isActiveGM, open: () => COGThemeCleanupApp.open() }).catch(err => console.warn('Sprinter RPG | Theme cleanup prompt failed:', err));
  // Repair space access that was written while no GM was connected (the active GM only).
  if (getActiveGM()?.id === game.user.id) {
    await reconcilePersonalSpaceOwnership();
    await reconcileVehicleOwnership();
  }
  await checkDefaultUnpause();
  await setupInitialHotbar(game.user);
  if (ui.actors?.element?.length) injectActorDirectoryButtons(ui.actors, ui.actors.element);
  if (ui.combat) ui.combat.render(false);
  initHuds();
  refreshHudVisibility();
  // Moves made while no GM was connected: the active GM brings token vision and gear auras in line with the zone.
  await reconcileAllOnReady().catch(err => console.warn('Sprinter RPG | Zero zone reconcile failed:', err));
  await initTagIndex();
}

/**
 * A combat was deleted: the effects panel re-renders, and `popularityTriggers` rows with `oncePer: 'combat'` reset.
 * The reset writes to the combatants, so only the active GM runs it (two connected GMs would both write).
 * @param {Combat} combat
 */
export function onDeleteCombat(combat) {
  COGEffectsPanel.get().render({ force: true });
  if (game.users?.activeGM?.isSelf) {
    const actors = [...(combat?.combatants ?? [])].map(c => c.actor).filter(Boolean);
    clearPopularityUsage(actors, 'combat').catch(() => {});
  }
}

export function initHuds() {
  // Initialize Crawler Token Action HUDs (Hotbar above macros bar & Actions on left)
  initCrawlerTokenHUD();

  // Initialize Scene Floor Timer Clock HUD
  COGFloorClockHUD.get().render({ force: true });

  // Initialize Scene Crawler Countdown Clock HUD
  COGCrawlerClockHUD.get().render({ force: true });

  // Initialize PF2e-Style Active Effects & Auras Panel
  COGEffectsPanel.get().render({ force: true });

  Hooks.on('controlToken', () => {
    refreshHudVisibility(); // a region zero zone follows the controlled token (7.17d)
    COGEffectsPanel.get().render({ force: true });
  });

  Hooks.on('updateCombat', () => {
    COGEffectsPanel.get().render({ force: true });
  });

  // Marking a combatant defeated changes the metrics XP pool and roster: re-render any open Combat Metrics window.
  Hooks.on('updateCombatant', (combatant, changes) => {
    if (changes && 'defeated' in changes) COGCombatMetricsApp.refreshOpen();
  });

  // Engines below the layering line (GEMINI 🧱 1) never import a window: they fire a hook and the windows are
  // re-rendered here. Combat metrics writes, the zero-zone switch and gear-offline refreshes.
  Hooks.on('cogCombatMetricsUpdated', () => COGCombatMetricsApp.refreshOpen());
  Hooks.on('cogZeroZoneChanged', () => COGFloorClockHUD.get().render({ force: true }));
  Hooks.on('cogGearOfflineRefreshed', (actor) => {
    const hud = getCrawlerTokenHUD();
    if (hud?.activeActor && hud.activeActor.id === actor?.id) hud.render();
  });

  Hooks.on('deleteCombat', onDeleteCombat);

  Hooks.on('updateActor', (actor) => {
    const active = COGEffectsPanel.get().getControlledActor()?.actor;
    if (active && active.id === actor.id) {
      COGEffectsPanel.get().render({ force: true });
    }
  });

  // A badge must follow its item: switching an aura off, or adding/removing a buff, refreshes the panel.
  for (const hook of ['createItem', 'updateItem', 'deleteItem']) {
    Hooks.on(hook, (item) => COGEffectsPanel.onItemChange(item));
  }

  Hooks.on('renderSceneNavigation', () => {
    COGFloorClockHUD.get().render({ force: true });
    COGCrawlerClockHUD.get().render({ force: true });
  });

  Hooks.on('canvasReady', () => {
    refreshOnCanvasReady().catch(err => console.warn('Sprinter RPG | Zero zone refresh failed:', err));
    refreshHudVisibility();
    COGFloorClockHUD.get().render({ force: true });
    COGCrawlerClockHUD.get().render({ force: true });
  });
}

async function initTagIndex() {
  // Initialize TagIndex across compendiums and world items
  try {
    await tagIndex.buildIndex();
  } catch (err) {
    console.warn('Sprinter RPG | Failed to build initial TagIndex:', err);
  }

  // Reactive tag index updates on world item mutations
  Hooks.on('createItem', (item) => {
    if (!item?.isEmbedded) tagIndex.indexItem(item);
  });
  Hooks.on('updateItem', (item) => {
    if (!item?.isEmbedded) tagIndex.updateItem(item);
  });
  Hooks.on('deleteItem', (item) => {
    if (!item?.isEmbedded) tagIndex.removeItem(item?.uuid || item?.id);
  });
}
