/**
 * World/client settings registration.
 */
import { refreshEnvironmentDisplays } from '../documents/actor/actor-environment.mjs';
import { SYSTEM_ID } from '../constants.mjs';
import { HUD_HIDDEN_SETTING, refreshHudVisibility } from '../utils/effects/hud-visibility.mjs';
import { ZERO_ZONE_SETTING, onZeroZoneChange } from '../utils/effects/zero-zone.mjs';
import { RULE_BREAK_MODES } from '../utils/rule-break.mjs';
import { contentRegistry } from '../content/registry.mjs';
import { COGSourceryImporterLauncher } from '../apps/sourcery-importer.mjs';
import { COGThemeCleanupLauncher } from '../apps/theme-cleanup.mjs';
import { onAiContentChange } from '../hooks/ai-content.mjs';
import { invalidateTagBehaviour } from '../utils/tag/tag-behaviour.mjs';
import { PERCENT_STAT_SETTING, PERCENT_STAT_MODES } from '../utils/character/stat-percent.mjs';
import { lockOwnedPercentRows } from '../documents/actor/percent-lock.mjs';
import { registerLootBoxShowSettings } from '../apps/loot-box-show.mjs';
import { ACTION_HUD_POSITION_SETTING } from '../apps/crawler-token-hud.mjs';
import { PENDING_SECRETS_SETTING } from '../documents/pending-secrets.mjs';

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

  game.settings.register(SYSTEM_ID, PENDING_SECRETS_SETTING, {
    name: 'Pending Secrets',
    hint: 'Secret debuffs held GM-side until the GM reveals them or fires the change.',
    scope: 'world',
    config: false,
    type: Array,
    default: []
  });

  game.settings.register(SYSTEM_ID, ACTION_HUD_POSITION_SETTING, {
    name: 'Action HUD Position',
    hint: 'Where this client dragged the crawler Action HUD. Empty means docked below the scene navigation.',
    scope: 'client',
    config: false,
    type: Object,
    default: null
  });

  game.settings.register(SYSTEM_ID, HUD_HIDDEN_SETTING, {
    name: 'COG.Hud.SettingName',
    hint: 'COG.Hud.SettingHint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: false,
    onChange: () => refreshHudVisibility()
  });

  game.settings.register(SYSTEM_ID, ZERO_ZONE_SETTING, {
    name: 'COG.Hud.ZeroZoneSettingName',
    hint: 'COG.Hud.ZeroZoneSettingHint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
    onChange: () => onZeroZoneChange()
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

  // When a percent Stat bonus (+10% STR) is worked out.
  game.settings.register(SYSTEM_ID, PERCENT_STAT_SETTING, {
    name: 'Percent Stat Bonuses',
    hint: 'Fixed (book): a percent bonus is worked out once, rounded down, when the item lands on a character, and kept. '
      + 'Live (house rule): it is recalculated from the current Stat every time. Buffs and debuffs are always live.',
    scope: 'world',
    config: true,
    type: String,
    choices: {
      [PERCENT_STAT_MODES.FIXED]: 'Fixed when the item is gained (book)',
      [PERCENT_STAT_MODES.LIVE]: 'Live (house rule)'
    },
    default: PERCENT_STAT_MODES.FIXED,
    onChange: (mode) => { lockOwnedPercentRows(mode).catch((err) => console.error('COG | locking percent Stat bonuses failed', err)); }
  });

  game.settings.register(SYSTEM_ID, 'primaryTheme', {
    name: 'Primary Content Theme',
    hint: "Every installed theme's content is in the pickers and compendiums. The primary theme supplies the crawler creator's species, backgrounds and story tables and the other setting data, and it comes first when two themes offer the same thing.",
    scope: 'world',
    config: true,
    requiresReload: true,
    type: String,
    choices: Object.fromEntries(
      Object.entries(contentRegistry.getThemes()).map(([id, theme]) => [id, theme.label || id])
    ),
    default: 'shiny'
  });

  // Themes turned off (classic mode): their content leaves the pickers, creators, managers and compendium sidebar. A set of
  // theme ids, so a theme a module adds later starts on. The primary is always on (the registry ignores it here).
  const { SetField, StringField } = foundry.data.fields;
  game.settings.register(SYSTEM_ID, 'disabledThemes', {
    name: 'Themes Turned Off',
    hint: 'Content of a theme that is turned off leaves the pickers, creators, managers and compendium sidebar. The primary theme is always on. Documents already on actors are not changed.',
    scope: 'world',
    config: true,
    requiresReload: true,
    type: new SetField(new StringField({
      required: true,
      choices: Object.fromEntries(Object.entries(contentRegistry.getThemes()).map(([id, theme]) => [id, theme.label || id])),
    })),
    default: []
  });

  // AI-written content (7.16f): hides documents stamped with an AI authorship from every picker, creator, manager and
  // compendium directory, and offers the cleanup that replaces the AI-written documents on actors with Celestial AI Poop.
  game.settings.register(SYSTEM_ID, 'aiContent', {
    name: 'AI-Written Content',
    hint: 'Show all content, hide content written with AI, or also hide AI-written content a person edited. Hidden documents leave the pickers, creators, managers and compendium lists, and the theme cleanup offers to replace those already on actors with Celestial AI Poop. With nothing human-written installed, the race and class lists are empty until you import your own books or make your own.',
    scope: 'world',
    config: true,
    requiresReload: false,
    type: String,
    choices: {
      show: 'Show all content',
      'hide-ai': 'Hide AI-written content',
      'hide-ai-edited': 'Hide AI-written and human-edited content'
    },
    default: 'show',
    onChange: onAiContentChange
  });

  // The sorted off list the theme cleanup last asked about (empty until it exists), so it asks again only when the list changes.
  game.settings.register(SYSTEM_ID, 'themeCleanupSeen', {
    scope: 'world',
    config: false,
    type: Array,
    default: []
  });

  // The cleanup window for documents of a theme that is off (also opened at ready and by /themes).
  game.settings.registerMenu?.(SYSTEM_ID, 'themeCleanup', {
    name: 'Theme Cleanup',
    label: 'Open Theme Cleanup',
    hint: 'List the documents of a turned-off theme on actors and in the world, replace them with Celestial AI Poop, or restore them.',
    icon: 'fa-solid fa-broom',
    type: COGThemeCleanupLauncher,
    restricted: true
  });

  // The Loot Box Showcase (7.3e): client settings `lootBoxShow` (full / reduced / summary) and `lootBoxShowSound`.
  registerLootBoxShowSettings(game.settings);

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

