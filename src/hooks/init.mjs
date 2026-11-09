/**
 * The init hook orchestration.
 */
import { COGActor } from '../documents/actor.mjs';
import { COGItem } from '../documents/item.mjs';
import { COGCombat } from '../documents/combat.mjs';
import { SECONDS_PER_ROUND } from '../utils/time/timing.mjs';
import { loadQuenchSuite } from '../utils/quench-loader.mjs';
import { COGCrawlerSheet } from '../sheets/crawler-sheet.mjs';
import { COGMobSheet } from '../sheets/mob-sheet.mjs';
import { COGPetSheet } from '../sheets/pet-sheet.mjs';
import { COGMercenarySheet } from '../sheets/mercenary-sheet.mjs';
import { COGVehicleSheet } from '../sheets/vehicle-sheet.mjs';
import { COGPersonalSpaceSheet } from '../sheets/personal-space-sheet.mjs';
import { COGMarkerSheet } from '../sheets/marker-sheet.mjs';
import '../documents/actor/light-marker.mjs'; // registers the marker payload delegate and the createLightMarker relay
import { COGItemSheet } from '../sheets/item-sheet.mjs';
import { BaseActorSheet, BaseItemSheet } from '../compat.mjs';
import { COGCombatTracker } from '../apps/combat-tracker.mjs';
import {
  SkillDataModel,
  AttackDataModel,
  SpellDataModel,
  GearDataModel,
  BuffDataModel,
  DebuffDataModel,
  LootDataModel,
  AchievementDataModel,
  RaceDataModel,
  ClassDataModel,
  DeityDataModel,
  SponsorDataModel,
  SpaceUpgradeDataModel,
  CrawlerDataModel,
  PetDataModel,
  MercenaryDataModel,
  MountVehicleDataModel,
  PersonalSpaceDataModel,
  MarkerDataModel,
  NPCDataModel,
  MobDataModel
} from '../models/index.mjs';
import { registerCompendiumSyncHooks } from '../data/compendium-sync.mjs';
import { SYSTEM_ID } from '../constants.mjs';
import { registerChatMessageHook } from '../chat/register-chat-hook.mjs';
import { registerSettings } from '../settings/register-settings.mjs';
import { registerHandlebarsHelpers, preloadTemplates } from './handlebars.mjs';
import { buildGameNamespace, buildConfigCOG, installEnvironmentAccessors, syncRegistryConfig } from './system-api.mjs';
import { registerKeybindings } from './keybindings.mjs';
import { onGetSceneControlButtons } from './scene-controls.mjs';
import { buildDevApi } from './dev-tools.mjs';
import { onUpdateActorRefreshRelated, onItemChangeRefreshRelated } from '../utils/ui/related-sheets.mjs';
import { onItemChangeSyncVision, onItemUpdateSyncVision } from '../documents/actor/actor-vision.mjs';
import { onLightItemCreate, onLightItemUpdate, onLightItemDelete } from '../documents/actor/light-source.mjs';
import { ZeroZoneBehaviorType } from '../models/region-behaviors/zero-zone-behavior.mjs';
import { registerZeroZoneRegionHooks } from './zero-zone-regions.mjs';
import { onGearAuraItemCreate, onGearAuraItemUpdate, onGearAuraItemDelete } from '../documents/actor/gear-aura.mjs';
import { onRaceClassItemDelete } from '../data/race-class-applier.mjs';
import { onTransformItemDelete } from '../documents/actor/transformations.mjs';
import { onRenderTokenHUD } from './light-hud.mjs';
import { contentRegistry } from '../content/registry.mjs';
import { seedLevelAwardPresets } from '../data/level-awards.mjs';
import { setIdentityNameResolver } from '../data/tag-definitions.mjs';
import { resolveIdentityName } from '../content/identity-names.mjs';

export async function onInit() {
  console.log('Sprinter RPG | Initializing Sprinter RPG System');

  // Dev-only integration suite; a no-op unless the Quench module is active.
  loadQuenchSuite();

  // Register compendium synchronization and token link guard hooks
  registerCompendiumSyncHooks();

  // Ensure chat message hook is registered with canonical version detection
  registerChatMessageHook();

  game.cog = buildGameNamespace();
  game.sprinterRpg = game.cog;

  CONFIG.COG = buildConfigCOG();
  CONFIG.COG.content = contentRegistry;
  // Level award presets are rows modules can extend (push onto this array in the registerContent hook)
  CONFIG.COG.levelAwardPresets = seedLevelAwardPresets();
  if (globalThis.game?.cog) globalThis.game.cog.content = contentRegistry;

  // Register document classes
  registerDocumentClasses();

  // Register sheet & UI classes
  registerSheets();

  // Call content registration hook (before settings: the primaryTheme choices come from registered themes)
  globalThis.Hooks?.callAll?.('sprinter-rpg.registerContent', contentRegistry);

  // Register System Settings
  registerSettings();
  registerKeybindings();
  syncRegistryConfig();
  setIdentityNameResolver(resolveIdentityName);

  // Expose environment helpers on COGActor and CONFIG.COG
  installEnvironmentAccessors();

  // Register Handlebars Helpers
  registerHandlebarsHelpers();

  // Preload Handlebars templates
  await preloadTemplates();

  // A companion's update (pilot, rider, owner, employers) refreshes the related crawlers' open sheets
  Hooks.on('updateActor', onUpdateActorRefreshRelated);
  for (const hook of ['createItem', 'updateItem', 'deleteItem']) Hooks.on(hook, onItemChangeRefreshRelated);

  // Senses on race, class, gear and buffs drive the actor's token vision
  for (const hook of ['createItem', 'deleteItem']) Hooks.on(hook, onItemChangeSyncVision);
  Hooks.on('updateItem', onItemUpdateSyncVision);

  // Light sources (3.16c): buffs and equipped gear light a marker token; the HUD puts it out
  Hooks.on('createItem', onLightItemCreate);
  Hooks.on('updateItem', onLightItemUpdate);
  Hooks.on('deleteItem', onLightItemDelete);
  Hooks.on('renderTokenHUD', onRenderTokenHUD);
  Hooks.on('getSceneControlButtons', onGetSceneControlButtons);

  // Gear auras (3.17-6): equipped or switched-on gear emits an aura from its wielder
  Hooks.on('createItem', onGearAuraItemCreate);
  Hooks.on('updateItem', onGearAuraItemUpdate);
  Hooks.on('deleteItem', onGearAuraItemDelete);

  // Zero zone Region behavior (7.17d): behavior and region changes re-prepare the affected actors
  registerZeroZoneRegionHooks();

  // Deleting a race or class item reverts it (3.78 j)
  // One dispatcher, so the order of registration is not a contract: a transformation's items revert the transformation,
  // anything else is a race or class delete
  Hooks.on('deleteItem', async (item, options, userId) => {
    if ((await onTransformItemDelete(item, options, userId)) !== null) return;
    await onRaceClassItemDelete(item, options, userId);
  });

  // Global Developer Helper
  window.cog = buildDevApi();

  // Register or re-verify chat message hook on Foundry init
  registerChatMessageHook();
}

/** Index fields the compendium badge (7.7e) reads from, appended to whatever Foundry or a module already lists. */
export const SOURCE_INDEX_FIELD = `flags.${SYSTEM_ID}.source`;

export function registerCompendiumIndexFields() {
  for (const cls of ['Item', 'Actor', 'RollTable']) {
    const config = CONFIG[cls];
    if (!config) continue;
    const fields = Array.isArray(config.compendiumIndexFields) ? config.compendiumIndexFields : [];
    if (!fields.includes(SOURCE_INDEX_FIELD)) config.compendiumIndexFields = [...fields, SOURCE_INDEX_FIELD];
  }
}

export function registerDocumentClasses() {
  registerCompendiumIndexFields();
  // Register document classes
  CONFIG.Actor.documentClass = COGActor;
  CONFIG.Item.documentClass = COGItem;

  // Register Actor Type Data Models (Foundry System Data Models)
  CONFIG.Actor.dataModels = {
    crawler: CrawlerDataModel,
    pet: PetDataModel,
    mercenary: MercenaryDataModel,
    mount_vehicle: MountVehicleDataModel,
    personal_space: PersonalSpaceDataModel,
    marker: MarkerDataModel,
    npc: NPCDataModel,
    mob: MobDataModel
  };

  // Register trackable attributes for tokens
  CONFIG.Actor.trackableAttributes = {
    crawler: {
      bar: ['attributes.hp', 'attributes.mana'],
      value: ['attributes.evade.total', 'attributes.dr.total', 'details.level']
    },
    pet: {
      bar: ['attributes.hp', 'attributes.mana'],
      value: ['attributes.evade.total', 'attributes.dr.total', 'details.level']
    },
    mercenary: {
      bar: ['attributes.hp', 'attributes.mana'],
      value: ['attributes.evade.total', 'attributes.dr.total', 'details.level']
    },
    mount_vehicle: {
      bar: ['attributes.hp'],
      value: ['attributes.dr.total', 'attributes.move', 'drive.currentMove']
    },
    personal_space: {
      bar: ['defenseRating', 'stashCapacity'],
      value: ['tier', 'size']
    },
    npc: {
      bar: ['attributes.hp', 'attributes.mana'],
      value: ['attributes.evade.total', 'attributes.dr.total', 'details.level']
    },
    mob: {
      bar: ['attributes.hp'],
      value: ['attributes.effectiveEvadeDC', 'attributes.effectiveSurpriseDC', 'details.level', 'attributes.xp']
    }
  };

  // Region behavior subtypes (7.17d)
  CONFIG.RegionBehavior ??= {};
  CONFIG.RegionBehavior.dataModels = { ...(CONFIG.RegionBehavior.dataModels ?? {}), zeroZone: ZeroZoneBehaviorType };

  // Register Item Type Data Models (Foundry System Data Models)
  CONFIG.Item.dataModels = {
    skill: SkillDataModel,
    attack: AttackDataModel,
    spell: SpellDataModel,
    gear: GearDataModel,
    buff: BuffDataModel,
    debuff: DebuffDataModel,
    loot: LootDataModel,
    achievement: AchievementDataModel,
    race: RaceDataModel,
    class: ClassDataModel,
    deity: DeityDataModel,
    sponsor: SponsorDataModel,
    space_upgrade: SpaceUpgradeDataModel
  };

  CONFIG.Combat.documentClass = COGCombat;
  CONFIG.Combat.initiative = {
    formula: null,
    decimals: 0
  };
  // A round is 10 seconds: core's Combat#nextRound adds rounds x roundTime to world time (the dungeon clock, 3.12).
  CONFIG.time.roundTime = SECONDS_PER_ROUND;
}

function registerSheets() {
  // Register sheet & UI classes
  CONFIG.ui.combat = COGCombatTracker;

  const ActorsClass = globalThis.foundry?.documents?.collections?.Actors ?? globalThis.Actors;
  const ItemsClass = globalThis.foundry?.documents?.collections?.Items ?? globalThis.Items;

  if (ActorsClass) {
    ActorsClass.unregisterSheet('core', BaseActorSheet);
    ActorsClass.registerSheet(SYSTEM_ID, COGCrawlerSheet, {
      types: ['crawler', 'npc'],
      makeDefault: true,
      label: 'COG.CrawlerSheet'
    });
    ActorsClass.registerSheet(SYSTEM_ID, COGMobSheet, {
      types: ['mob'],
      makeDefault: true,
      label: 'COG.MobSheet'
    });
    ActorsClass.registerSheet(SYSTEM_ID, COGPetSheet, {
      types: ['pet'],
      makeDefault: true,
      label: 'COG.PetSheet'
    });
    ActorsClass.registerSheet(SYSTEM_ID, COGMercenarySheet, {
      types: ['mercenary'],
      makeDefault: true,
      label: 'COG.MercenarySheet'
    });
    ActorsClass.registerSheet(SYSTEM_ID, COGVehicleSheet, {
      types: ['mount_vehicle'],
      makeDefault: true,
      label: 'COG.VehicleSheet'
    });
    ActorsClass.registerSheet(SYSTEM_ID, COGPersonalSpaceSheet, {
      types: ['personal_space'],
      makeDefault: true,
      label: 'COG.PersonalSpaceSheet'
    });
    ActorsClass.registerSheet(SYSTEM_ID, COGMarkerSheet, {
      types: ['marker'],
      makeDefault: true,
      label: 'COG.MarkerSheet'
    });
  }

  if (ItemsClass) {
    ItemsClass.unregisterSheet('core', BaseItemSheet);
    ItemsClass.registerSheet(SYSTEM_ID, COGItemSheet, {
      types: ['skill', 'attack', 'spell', 'gear', 'race', 'class', 'deity', 'sponsor', 'loot', 'buff', 'debuff', 'achievement', 'space_upgrade'],
      makeDefault: true,
      label: 'COG.ItemSheet'
    });
  }
}
