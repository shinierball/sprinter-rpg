/**
 * Developer hot-reload and window.cog helper API.
 */
import {
  getCurrentFloor,
  setCurrentFloor,
  getFloorTimer,
  setFloorTimer,
  decrementFloorTimer,
  getCrawlerCount,
  setCrawlerCount,
  decrementCrawlerCount,
  incrementCrawlerCount
} from '../documents/actor/actor-environment.mjs';
import { COGSkillManager } from '../apps/skill-manager.mjs';
import { COGSpellManager } from '../apps/spell-manager.mjs';
import { COGItemManager } from '../apps/item-manager.mjs';
import { COGCombatMetrics } from '../documents/combat-metrics.mjs';
import { COGCombatMetricsApp } from '../apps/combat-metrics.mjs';
import { COGDamage } from '../documents/actor/damage-pipeline.mjs';
import { COGCombatArchiveApp } from '../apps/combat-archive.mjs';
import { COGSessionEngine } from '../documents/session/session-engine.mjs';
import { COGSessionManagerApp } from '../apps/session-manager/manager-app.mjs';
import { COGRapidBatchImportApp } from '../apps/rapid-batch-import.mjs';
import { COGRapidTextParser } from '../apps/rapid-text-parser.mjs';
import { COGCrawlerCreatorApp } from '../apps/crawler-creator.mjs';
import { COGClassCreatorApp } from '../apps/class-creator.mjs';
import { COGRaceCreatorApp } from '../apps/race-creator.mjs';
import { COGAchievementManagerApp } from '../apps/achievement-manager.mjs';
import { COGGrindApp } from '../apps/grind-app.mjs';
import { COGContestTrackerApp } from '../apps/contest-tracker.mjs';
import { COGFloorClockHUD } from '../apps/floor-clock-hud.mjs';
import { COGCrawlerClockHUD } from '../apps/crawler-clock-hud.mjs';
import { COGEffectsPanel } from '../apps/effects-panel.mjs';
import { getCrawlerTokenHUD, COGCrawlerHotbarHUD, COGCrawlerActionHUD } from '../apps/crawler-token-hud.mjs';
import { COGTagManager } from '../apps/tag-manager.mjs';
import { rollBackgroundTable } from '../data/rules/background-table-rules.mjs';
import { contentRegistry } from '../content/registry.mjs';
import { openTagSystemJournal } from '../data/journal-tag-system.mjs';
import { setupInitialHotbar } from './hotbar.mjs';
import { openApplications } from '../compat.mjs';
import { COGActorSheetV2 } from '../sheets/base/actor-sheet-v2.mjs';
import { COGToolApp } from '../apps/tool-app.mjs';
import { COGItemSheetV2 } from '../sheets/base/item-sheet-v2.mjs';

/** Every system window: tool apps and the V2 actor / item sheets. */
const isCOGWindow = (app) => app instanceof COGToolApp || app instanceof COGActorSheetV2 || app instanceof COGItemSheetV2;

export function buildDevApi() {
  return {
    combatMetrics: COGCombatMetrics,
    damage: COGDamage,
    sessionEngine: COGSessionEngine,
    backgroundTables: contentRegistry.getBackgroundTables(),
    rollBackgroundTable,
    getCurrentFloor,
    setCurrentFloor,
    getFloorTimer,
    setFloorTimer,
    decrementFloorTimer,
    getCrawlerCount,
    setCrawlerCount,
    decrementCrawlerCount,
    incrementCrawlerCount,
    crawlerClockHUD: COGCrawlerClockHUD,
    floorClockHUD: COGFloorClockHUD,
    effectsPanel: COGEffectsPanel,
    setupInitialHotbar,
    openAchievementManager(options = {}) {
      return COGAchievementManagerApp.open(options);
    },
    openContestTracker(options = {}) {
      return COGContestTrackerApp.open(options);
    },
    openGrindApp(options = {}) {
      return COGGrindApp.open(options);
    },
    openSkillManager(options = {}) {
      return new COGSkillManager(options).render({ force: true });
    },
    openSpellManager(options = {}) {
      return COGSpellManager.open(options);
    },
    openItemManager(options = {}) {
      return COGItemManager.open(options);
    },
    openCombatMetrics(options = {}) {
      return COGCombatMetricsApp.open(options);
    },
    openCombatArchive(options = {}) {
      return COGCombatArchiveApp.open(options);
    },
    openSessionManager(options = {}) {
      return COGSessionManagerApp.open(options);
    },
    openRapidBatchImport(options = {}) {
      return COGRapidBatchImportApp.open(options);
    },
    rapidBatchImport(options = {}) {
      return COGRapidBatchImportApp.open(options);
    },
    rapidTextParser: COGRapidTextParser,
    openCrawlerCreator(options = {}) {
      return COGCrawlerCreatorApp.open(options);
    },
    openClassCreator(options = {}) {
      return new COGClassCreatorApp(options).render({ force: true });
    },
    openRaceCreator(options = {}) {
      return new COGRaceCreatorApp(options).render({ force: true });
    },
    openTagManager(options = {}) {
      return new COGTagManager(options).render({ force: true });
    },
    openTagGuide() {
      return openTagSystemJournal();
    },
    tokenHUD: getCrawlerTokenHUD(),
    openHotbarHUD(actor, token) {
      return new COGCrawlerHotbarHUD(actor, token).render({ force: true });
    },
    openActionHUD(actor, token) {
      return new COGCrawlerActionHUD(actor, token).render({ force: true });
    },
    reloadSheets() {
      for (const app of openApplications()) {
        if (isCOGWindow(app)) {
          app.render(false);
        }
      }
      if (ui.combat) ui.combat.render(false);
      ui.notifications?.info('Sprinter RPG | Re-rendered all open sheets.');
    }
  };
}
