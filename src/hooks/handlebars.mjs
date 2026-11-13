/**
 * Handlebars helpers and template preloading. Register new partials in TEMPLATE_PATHS.
 */
import { SYSTEM_PATH } from '../constants.mjs';
import { sameDebuffRef } from '../utils/identifier.mjs';
import { htmlSnippet } from '../utils/ui/html-snippet.mjs';
import { collectSheetTemplates } from '../sheets/base/templates.mjs';
import { COGCrawlerSheet } from '../sheets/crawler-sheet.mjs';
import { COGPetSheet } from '../sheets/pet-sheet.mjs';
import { COGMercenarySheet } from '../sheets/mercenary-sheet.mjs';
import { COGMobSheet } from '../sheets/mob-sheet.mjs';
import { COGVehicleSheet } from '../sheets/vehicle-sheet.mjs';
import { COGPersonalSpaceSheet } from '../sheets/personal-space-sheet.mjs';
import { COGMarkerSheet } from '../sheets/marker-sheet.mjs';
import { COGItemSheet } from '../sheets/item-sheet.mjs';
import { COGStashApp } from '../apps/stash-app.mjs';
import { COGBuffDebuffManager } from '../apps/buff-manager.mjs';
import { COGTagManager } from '../apps/tag-manager.mjs';
import { COGAchievementManagerApp } from '../apps/achievement-manager.mjs';
import { COGSkillManager } from '../apps/skill-manager.mjs';
import { COGItemSetupApp } from '../apps/item-setup-app.mjs';
import { COGWeaponBuilderApp } from '../apps/weapon-builder/weapon-builder-app.mjs';
import { COGSpellManager } from '../apps/spell-manager.mjs';
import { COGItemManager } from '../apps/item-manager.mjs';
import { COGDeityPicker } from '../apps/deity-picker.mjs';
import { COGPatronPicker } from '../apps/patron-picker.mjs';
import { COGGrindApp } from '../apps/grind-app.mjs';
import { COGCraftingApp } from '../apps/crafting-app.mjs';
import { COGAwardLevelsApp } from '../apps/award-levels-app.mjs';
import { COGAuthorshipApp } from '../apps/authorship-dialog.mjs';
import { COGItemFromWordsApp } from '../apps/item-from-words-app.mjs';
import { COGDraftReviewApp } from '../apps/draft-review-app.mjs';
import { COGThemeCleanupApp } from '../apps/theme-cleanup.mjs';
import { COGSpacePricesApp } from '../apps/space-prices-app.mjs';
import { COGRapidBatchImportApp } from '../apps/rapid-batch-import.mjs';
import { COGMercenaryGuildApp } from '../apps/mercenary-guild.mjs';
import { COGCombatArchiveApp } from '../apps/combat-archive.mjs';
import { COGCombatMetricsApp } from '../apps/combat-metrics.mjs';
import { COGSessionManagerApp } from '../apps/session-manager/manager-app.mjs';
import { COGClassCreatorApp } from '../apps/class-creator.mjs';
import { COGRaceCreatorApp } from '../apps/race-creator.mjs';
import { COGCrawlerCreatorApp } from '../apps/crawler-creator.mjs';
import { COGContestTrackerApp } from '../apps/contest-tracker.mjs';
import { COGMobCreatorApp } from '../apps/mob-creator/mob-creator-app.mjs';
import { COGFloorClockHUD } from '../apps/floor-clock-hud.mjs';
import { COGCrawlerClockHUD } from '../apps/crawler-clock-hud.mjs';
import { COGEffectsPanel } from '../apps/effects-panel.mjs';
import { COGSourceryImporterApp } from '../apps/sourcery-importer.mjs';
import { COGCrawlerHotbarHUD, COGCrawlerActionHUD } from '../apps/crawler-token-hud.mjs';
import { COGLootBoxShowApp } from '../apps/loot-box-show.mjs';
import { COGDeityGiftDialog } from '../apps/deity-gift-dialog.mjs';
import { COGOfferingDialog } from '../apps/offering-dialog.mjs';

export function registerHandlebarsHelpers() {
  // Register Handlebars Helpers
  // Whether a stored debuff reference (an identifier, or a `condition.*` tag) names the debuff with this identifier.
  Handlebars.registerHelper('sameDebuff', sameDebuffRef);
  Handlebars.registerHelper('eq', (a, b) => a === b);
  Handlebars.registerHelper('ne', (a, b) => a !== b);
  Handlebars.registerHelper('and', (...args) => {
    const last = args[args.length - 1];
    const terms = (last && typeof last === 'object' && 'hash' in last) ? args.slice(0, -1) : args;
    return terms.every(Boolean);
  });
  Handlebars.registerHelper('or', (...args) => {
    const last = args[args.length - 1];
    const terms = (last && typeof last === 'object' && 'hash' in last) ? args.slice(0, -1) : args;
    for (const term of terms) {
      if (term) return term;
    }
    return false;
  });
  Handlebars.registerHelper('not', (a) => !a);
  Handlebars.registerHelper('gte', (a, b) => Number(a) >= Number(b));
  Handlebars.registerHelper('numberFormat', (value, options) => {
    const num = Number(value) || 0;
    if (options?.hash?.sign && num > 0) return `+${num}`;
    return String(num);
  });
  Handlebars.registerHelper('upper', str => (str ? String(str).toUpperCase() : ''));
  // An HTML field (an item's description) shown as a line of text: the words without the markup.
  Handlebars.registerHelper('plainText', html => htmlSnippet(html));
  Handlebars.registerHelper('add', (a, b) => Number(a) + Number(b));
  Handlebars.registerHelper('sub', (a, b) => Number(a) - Number(b));
  Handlebars.registerHelper('modulo', (a, b) => Number(a) % Number(b));
}

export const TEMPLATE_PATHS = Object.freeze([
  `${SYSTEM_PATH}/templates/actors/parts/companions.hbs`,
  `${SYSTEM_PATH}/templates/shared/tab-nav.hbs`,
  `${SYSTEM_PATH}/templates/shared/content-hint.hbs`,
  `${SYSTEM_PATH}/templates/shared/source-badge.hbs`,
  `${SYSTEM_PATH}/templates/actors/parts/page1-core.hbs`,
  `${SYSTEM_PATH}/templates/actors/parts/identity-pet.hbs`,
  `${SYSTEM_PATH}/templates/actors/parts/identity-mercenary.hbs`,
  `${SYSTEM_PATH}/templates/actors/parts/vehicle-role-select.hbs`,
  `${SYSTEM_PATH}/templates/actors/parts/hotlist.hbs`,
  `${SYSTEM_PATH}/templates/actors/parts/sex-select.hbs`,
  `${SYSTEM_PATH}/templates/actors/parts/page3-skills.hbs`,
  `${SYSTEM_PATH}/templates/actors/parts/spells.hbs`,
  `${SYSTEM_PATH}/templates/actors/parts/page4-inventory.hbs`,
  `${SYSTEM_PATH}/templates/actors/parts/conditions.hbs`,
  `${SYSTEM_PATH}/templates/actors/parts/transformation-banner.hbs`,
  `${SYSTEM_PATH}/templates/actors/parts/story-extras.hbs`,
  `${SYSTEM_PATH}/templates/actors/parts/deity-block.hbs`,
  `${SYSTEM_PATH}/templates/actors/parts/patron-row.hbs`,
  `${SYSTEM_PATH}/templates/actors/parts/achievements.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/header.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/provenance-badges.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/attack.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/spell.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/base-damage.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/gear.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/gear/basics.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/gear/weapon.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/gear/weapon-skills.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/gear/weapon-type.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/gear/weapon-hands.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/gear/weapon-damage.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/gear/weapon-readout.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/gear/weapon-to-hit.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/gear/weapon-techniques.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/gear/stat-bonuses.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/gear/skill-spell-grants.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/aura.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/gear/ability.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/gear/persistent-effects.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/gear/healing.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/gear/notes.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/gear/datalists.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/findings.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/buff.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/debuff.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/limb-modifiers.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/stat-grant-rows.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/transform.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/achievement.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/space-upgrade.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/skill.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/loot.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/traits.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/race.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/class.hbs`,
  `${SYSTEM_PATH}/templates/apps/add-event-dialog.hbs`,
  // Shared GM advancement controls (Session Hub, Grind app)
  `${SYSTEM_PATH}/templates/apps/partials/advancement-controls.hbs`,
  `${SYSTEM_PATH}/templates/apps/partials/point-build-params.hbs`,
  `${SYSTEM_PATH}/templates/apps/point-builder/skill-rows.hbs`,
  `${SYSTEM_PATH}/templates/apps/point-builder/perk-rows.hbs`,
  `${SYSTEM_PATH}/templates/apps/point-builder/perk-mechanics.hbs`,
  `${SYSTEM_PATH}/templates/apps/point-builder/effect-rows.hbs`,
  `${SYSTEM_PATH}/templates/apps/point-builder/spec-grant-rows.hbs`,
  `${SYSTEM_PATH}/templates/apps/point-builder/spec-requirements.hbs`,
  `${SYSTEM_PATH}/templates/apps/point-builder/custom-text.hbs`,
  `${SYSTEM_PATH}/templates/apps/partials/cooldown-badge.hbs`,
  `${SYSTEM_PATH}/templates/apps/attack-options.hbs`,
  `${SYSTEM_PATH}/templates/apps/item-setup/field.hbs`,
  `${SYSTEM_PATH}/templates/shared/attack-options-line.hbs`,
  // Combat tracker parts: its footer is a core template, so the class is not collected below.
  `${SYSTEM_PATH}/templates/apps/combat-tracker/header.hbs`,
  `${SYSTEM_PATH}/templates/apps/combat-tracker/tracker.hbs`,
  `${SYSTEM_PATH}/templates/shared/tag-pills.hbs`,
  `${SYSTEM_PATH}/templates/shared/requirement-badges.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/tags.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/interrupt.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/on-hit.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/contest.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/rank-break-extras.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/ability/healing.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/ability/rank-breaks.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/ability/rank-break-card.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/ability/rank-damage-parts.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/area-shape.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/tag-query-editor.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/modifier-rows.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/skill-order-list.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/identity-rows.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/grant-rows.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/starting-item-rows.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/identity-scalars.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/grant-row.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/requirement-rows.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/row-scale-editor.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/timing.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/usage-readout.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/feature-list.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/pick-list.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/as-triggers.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/blueprint.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/loot-box.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/outcome-cure-filter.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/outcome-spell-damage.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/reward-boxes.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/craft-materials.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/enchantment-ledger.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/enchantment-template.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/enchantment-templates.hbs`,
  `${SYSTEM_PATH}/templates/items/parts/copy-blueprint.hbs`,
  // The Loot Box Showcase's prize card (its stage and summary parts share it)
  `${SYSTEM_PATH}/templates/apps/loot-box-show/prize.hbs`
]);

/** Sheet classes whose PARTS declare their own templates (CONTRIBUTING §5: sheets register themselves). */
const SHEET_CLASSES = [COGCrawlerSheet, COGPetSheet, COGMercenarySheet, COGVehicleSheet, COGMobSheet, COGPersonalSpaceSheet, COGMarkerSheet, COGItemSheet];

/**
 * Tool app classes whose PARTS declare their own templates (the token HUDs are AppV2 apps too). Templates rendered by hand (the add-event dialog) stay in TEMPLATE_PATHS.
 */
export const TOOL_APP_CLASSES = [
  COGStashApp, COGBuffDebuffManager, COGTagManager, COGAchievementManagerApp, COGSkillManager,
  COGSpellManager, COGItemManager, COGDeityPicker, COGPatronPicker, COGDeityGiftDialog, COGOfferingDialog, COGGrindApp, COGCraftingApp, COGAwardLevelsApp, COGRapidBatchImportApp, COGMercenaryGuildApp,
  COGCombatArchiveApp, COGCombatMetricsApp, COGSessionManagerApp, COGClassCreatorApp,
  COGRaceCreatorApp, COGCrawlerCreatorApp, COGMobCreatorApp, COGContestTrackerApp,
  COGFloorClockHUD, COGCrawlerClockHUD, COGEffectsPanel,
  COGCrawlerHotbarHUD, COGCrawlerActionHUD, COGSourceryImporterApp, COGLootBoxShowApp, COGAuthorshipApp, COGThemeCleanupApp, COGSpacePricesApp, COGItemFromWordsApp, COGDraftReviewApp, COGItemSetupApp, COGWeaponBuilderApp
];

export function preloadTemplates() {
  const loadTemplatesFn = globalThis.foundry?.applications?.handlebars?.loadTemplates
    ?? globalThis.foundry?.utils?.loadTemplates
    ?? globalThis.loadTemplates;
  return loadTemplatesFn([...new Set([...TEMPLATE_PATHS, ...collectSheetTemplates([...SHEET_CLASSES, ...TOOL_APP_CLASSES])])]);
}
