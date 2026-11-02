/**
 * The ready hook orchestration.
 */
import { COGFloorClockHUD } from '../apps/floor-clock-hud.mjs';
import { COGCrawlerClockHUD } from '../apps/crawler-clock-hud.mjs';
import { COGEffectsPanel } from '../apps/effects-panel.mjs';
import { initCrawlerTokenHUD } from '../apps/crawler-token-hud.mjs';
import { COGCombatMetricsApp } from '../apps/combat-metrics.mjs';
import { tagIndex } from '../apps/tag-index.mjs';
import { injectActorDirectoryButtons } from './directory.mjs';
import { setupInitialHotbar } from './hotbar.mjs';
import { runGMWorldSetup } from './world-setup.mjs';
import { checkDefaultUnpause } from './pause.mjs';
import { registerSceneEpochHooks } from '../documents/actor/dungeon-time.mjs';
import { registerDurationHooks } from '../documents/actor/duration-expiry.mjs';
import { registerLightExpiry } from '../documents/actor/light-source.mjs';
import { registerCameraHooks } from '../chat/actions/cameras.mjs';
import { registerContestHooks } from '../chat/contest-ingest.mjs';
import { getActiveGM } from '../utils/gm-relay.mjs';
import { clearPopularityUsage } from '../documents/actor/actor-popularity.mjs';
import { reconcilePersonalSpaceOwnership } from '../documents/actor/personal-space-links.mjs';
import { reconcileVehicleOwnership } from '../documents/actor/vehicle-crew.mjs';
import { sourceryCatalogsReady } from '../content/sourcery-content-provider.mjs';

export async function onReady() {
  // A scene here is bounded by a combat starting or ending (or the GM's New Scene button), not by a Foundry scene.
  registerSceneEpochHooks();
  // Timed effects end on the world clock and at the end of a combat (the active GM only).
  registerDurationHooks();
  registerLightExpiry();
  // The Playing to the Cameras award settles on the active GM's client as camera cards are created and updated.
  registerCameraHooks();
  // A leg roll reaches its contest card on the active GM's client; a contest card asks before it is deleted.
  registerContestHooks();
  // Imported Sourcery text joins the registry catalogs (built sync from the redacted specs; the world packs are async). The
  // refresh began at `setup`; this only waits for it.
  await sourceryCatalogsReady().catch(err => console.warn('Sprinter RPG | Sourcery catalog refresh failed:', err));
  if (game.user.isGM) await runGMWorldSetup();
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
    COGEffectsPanel.get().render({ force: true });
  });

  Hooks.on('updateCombat', () => {
    COGEffectsPanel.get().render({ force: true });
  });

  // Marking a combatant defeated changes the metrics XP pool and roster: re-render any open Combat Metrics window.
  Hooks.on('updateCombatant', (combatant, changes) => {
    if (changes && 'defeated' in changes) COGCombatMetricsApp.refreshOpen();
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
    COGFloorClockHUD.get().render({ force: true });
    COGCrawlerClockHUD.get().render({ force: true });
  });
}

export async function initTagIndex() {
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
