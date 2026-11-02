/**
 * Sprinter RPG system entry point (system.json `esmodules`).
 * The only module with import-time side effects: it registers hooks and nothing else.
 */
import { onInit } from './hooks/init.mjs';
import { onReady } from './hooks/ready.mjs';
import { registerDirectoryHooks } from './hooks/directory.mjs';
import { registerCombatHooks } from './hooks/combat.mjs';
import { registerTokenHooks } from './hooks/tokens.mjs';
import { registerAuraMovementHooks } from './hooks/aura-movement.mjs';
import { registerMovementOffersHooks } from './hooks/movement-offers.mjs';
import { registerAreaZoneHooks } from './hooks/area-zones.mjs';
import { registerLightFollowHooks } from './hooks/light-follow.mjs';
import { registerVehicleCrewHooks } from './hooks/vehicle-crew.mjs';
import { registerPauseHooks } from './hooks/pause.mjs';
import { installEnvironmentGlobals, syncRegistryConfig } from './hooks/system-api.mjs';
import { registerChatMessageHook } from './chat/register-chat-hook.mjs';
import { registerChatCommands } from './commands/chat-commands.mjs';
import { installBundledContentHook } from './content/default-content-provider.mjs';
import { installSourceryContentHook } from './content/sourcery-content-provider.mjs';
import { installExampleContentHook } from './content/examples-content-provider.mjs';
import { installCreationSamplesHook } from './content/creation-samples-provider.mjs';
import { initGMRelay } from './utils/gm-relay.mjs';

installBundledContentHook(); // must be listening before onInit fires sprinter-rpg.registerContent
installExampleContentHook(); // the example buffs and debuffs, under their own theme
installCreationSamplesHook(); // sample species, backgrounds and story tables for the default `shiny` theme
installSourceryContentHook({ onCatalogsRefreshed: syncRegistryConfig }); // after the bundled provider: imported packs register at a higher priority; their text joins the catalogs at ready
Hooks.once('init', onInit);
initGMRelay(); // socketlib fires `socketlib.ready` during its own init, before ours
registerDirectoryHooks();
registerCombatHooks();
installEnvironmentGlobals();
registerChatMessageHook();
registerChatCommands();
registerTokenHooks();
registerAuraMovementHooks();
registerMovementOffersHooks();
registerAreaZoneHooks();
registerLightFollowHooks();
registerVehicleCrewHooks();
registerPauseHooks();
Hooks.once('ready', onReady);
