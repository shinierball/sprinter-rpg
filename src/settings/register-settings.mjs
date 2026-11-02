/**
 * World/client settings registration.
 */
import { refreshEnvironmentDisplays } from '../documents/actor/actor-environment.mjs';
import { SYSTEM_ID } from '../constants.mjs';
import { RULE_BREAK_MODES } from '../utils/rule-break.mjs';
import { contentRegistry } from '../content/registry.mjs';
import { COGSourceryImporterLauncher } from '../apps/sourcery-importer.mjs';
import { invalidateTagBehaviour } from '../utils/tag-behaviour.mjs';

export function registerSettings() {
  // Register System Settings
  game.settings.register(SYSTEM_ID, 'archivedCombats', {
    name: 'Archived Combats',
    hint: 'Stores permanently archived combat encounters and round-by-round action history.',
    scope: 'world',
    config: false,
    type: Array,
    default: []
  });

  game.settings.register(SYSTEM_ID, 'sessions', {
    name: 'Party Sessions',
    hint: 'Stores active and historical crawler party session records.',
    scope: 'world',
    config: false,
    type: Array,
    default: []
  });

  game.settings.register(SYSTEM_ID, 'actionHudPosition', {
    name: 'Action HUD Position',
    hint: 'Where this client dragged the crawler Action HUD. Empty means docked below the scene navigation.',
    scope: 'client',
    config: false,
    type: Object,
    default: null
  });

  game.settings.register(SYSTEM_ID, 'activeSessionId', {
    name: 'Active Session ID',
    hint: 'Current active session ID for live party progression.',
    scope: 'world',
    config: false,
    type: String,
    default: ''
  });

  game.settings.register(SYSTEM_ID, 'currentFloor', {
    onChange: refreshEnvironmentDisplays,
    name: 'Current Dungeon Floor',
    hint: 'The active dungeon floor (1-18) where all crawlers and encounters currently reside.',
    scope: 'world',
    config: true,
    type: Number,
    default: 1
  });

  game.settings.register(SYSTEM_ID, 'floorTimer', {
    onChange: refreshEnvironmentDisplays,
    name: 'Floor Timer Clock',
    hint: 'Remaining in-game hours before Floor Collapse.',
    scope: 'world',
    config: true,
    type: Number,
    default: 100
  });

  // How many scene (combat) boundaries have passed; "once per scene" cooldowns compare it. Bumped by the GM on combat
  // start, combat end and the floor clock's New Scene button (3.12). Not a Foundry scene.
  game.settings.register(SYSTEM_ID, 'sceneEpoch', {
    onChange: refreshEnvironmentDisplays,
    scope: 'world',
    config: false,
    type: Number,
    default: 0
  });

  game.settings.register(SYSTEM_ID, 'crawlerCount', {
    onChange: refreshEnvironmentDisplays,
    name: 'Surviving Crawler Count',
    hint: 'Total number of surviving crawlers in the dungeon.',
    scope: 'world',
    config: true,
    type: Number,
    default: 1000000
  });

  // The GM's own copy of the fillable character sheet; "Save to PDF" fills it (src/apps/pdf-exporter.mjs).
  game.settings.register(SYSTEM_ID, 'characterSheetPdfPath', {
    name: 'COG.Content.SheetPdfName',
    hint: 'COG.Content.SheetPdfHint',
    scope: 'world',
    config: true,
    type: String,
    default: '',
    filePicker: 'any'
  });

  // A tag definition changed (rows or flags): rebuild the behaviour index and re-prepare actors. Fires on every client.
  game.settings.register(SYSTEM_ID, 'customTags', {
    name: 'Custom Tags',
    hint: 'Stores user-defined custom tag definitions across the world.',
    scope: 'world',
    config: false,
    type: Array,
    default: [],
    onChange: () => invalidateTagBehaviour()
  });

  // World overrides of a tag's behaviour { [tagId]: { rows?, flags? } }; the Tag Manager edits them (E7.5), the engine only reads.
  game.settings.register(SYSTEM_ID, 'tagOverrides', {
    name: 'Tag Behaviour Overrides',
    hint: 'House-rule replacements for the rows and flags a tag carries. Wins over the system and modules.',
    scope: 'world',
    config: false,
    type: Object,
    default: {},
    onChange: () => invalidateTagBehaviour()
  });

  game.settings.register(SYSTEM_ID, 'unpauseByDefault', {
    name: 'Unpause Game by Default',
    hint: 'Automatically unpause the game when loading into the world.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true
  });

  // How the system treats an action that exceeds a rulebook limit (see utils/rule-break.mjs).
  game.settings.register(SYSTEM_ID, 'ruleBreakMode', {
    name: 'Rule Breaks',
    hint: 'What happens when an action exceeds an official rule (over-budget builds, insufficient mana, extra actions). '
      + 'Ask: players confirm each Rule Break in a dialog. Allow and flag: proceed at once, flag it as a Rule Break and show a warning. '
      + 'Refuse: enforce the limit and stop the action.',
    scope: 'world',
    config: true,
    type: String,
    choices: {
      [RULE_BREAK_MODES.ASK]: 'Ask before proceeding',
      [RULE_BREAK_MODES.ALLOW]: 'Allow and flag',
      [RULE_BREAK_MODES.REFUSE]: 'Refuse'
    },
    default: RULE_BREAK_MODES.ASK
  });

  // Whether players see the Rule Breaks a GM makes (utils/rule-break-visibility.mjs).
  game.settings.register(SYSTEM_ID, 'showGmRuleBreaks', {
    name: 'Show GM Rule Breaks to players',
    hint: 'On: the [RULE BREAK] badge on cards a GM produces is visible to everyone. Off: it shows to GMs only and Rule Break chat lines a GM produces are whispered to GMs. Players always see their own Rule Breaks.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true
  });

  // Set by the active GM when a user pauses the world, cleared on unpause. While set, the default
  // unpause on load is skipped so a reload or restart keeps a deliberate pause.
  game.settings.register(SYSTEM_ID, 'deliberatePause', {
    scope: 'world',
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.register(SYSTEM_ID, 'activeTheme', {
    name: 'Active Content Theme',
    hint: 'Determines the active lore, species, background tables, and the default compendium packs used across character creation and managers.',
    scope: 'world',
    config: true,
    requiresReload: true,
    type: String,
    choices: Object.fromEntries(
      Object.entries(contentRegistry.getThemes()).map(([id, theme]) => [id, theme.label || id])
    ),
    default: 'shiny'
  });

  // Sourcery importer: a button in Configure Settings; the catalog setting itself is registered by the provider.
  game.settings.registerMenu?.(SYSTEM_ID, 'sourceryImporter', {
    name: 'Sourcery Importer',
    label: 'Open Sourcery Importer',
    hint: 'Fill the system content text from the official rulebook PDFs you own.',
    icon: 'fa-solid fa-file-import',
    type: COGSourceryImporterLauncher,
    restricted: true
  });
}

