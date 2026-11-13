/**
 * World/client settings registration.
 */
import { refreshEnvironmentDisplays, onCurrentFloorChange, CRAWLER_COUNT_SETTING, FLOOR_TIMER_SETTING } from '../documents/actor/actor-environment.mjs';
import { SYSTEM_ID } from '../constants.mjs';
import { HUD_HIDDEN_SETTING, refreshHudVisibility } from '../utils/effects/hud-visibility.mjs';
import { ZERO_ZONE_SETTING, onZeroZoneChange } from '../utils/effects/zero-zone.mjs';
import { RULE_BREAK_MODES, RULE_BREAK_MODE_SETTING } from '../utils/rule-break.mjs';
import { WORSHIP_TRACKING, WORSHIP_TRACKING_SETTING } from '../utils/deity/devotion.mjs';
import { contentRegistry } from '../content/registry.mjs';
import { SPACE_PRICES_SETTING } from '../data/rules/space-rank-rules.mjs';
import { refreshOpenActorSheets } from '../utils/ui/related-sheets.mjs';
import { invalidateTagBehaviour, TAG_OVERRIDES_SETTING } from '../utils/tag/tag-behaviour.mjs';
import { PERCENT_STAT_SETTING, PERCENT_STAT_MODES } from '../utils/character/stat-percent.mjs';
import { lockOwnedPercentRows } from '../documents/actor/percent-lock.mjs';
import { ACTION_HUD_POSITION_SETTING } from '../utils/ui/action-hud-position.mjs';
import { PENDING_SECRETS_SETTING } from '../documents/pending-secrets.mjs';
import { ACTIVE_SESSION_SETTING, SESSIONS_SETTING } from '../documents/session/session-store.mjs';
import { ARCHIVED_COMBATS_SETTING } from '../documents/combat/archive.mjs';
import { CURRENT_FLOOR_SETTING } from '../utils/floor/current-floor.mjs';
import { SCENE_EPOCH_SETTING } from '../documents/actor/dungeon-time.mjs';
import { SHOW_GM_RULE_BREAKS_SETTING } from '../utils/rule-break-visibility.mjs';
import { CUSTOM_TAGS_SETTING } from '../data/tag-definitions.mjs';
import { PRIMARY_THEME_SETTING, DISABLED_THEMES_SETTING } from '../content/registry/themes.mjs';
import { AI_CONTENT_SETTING } from '../content/registry/authorship.mjs';
import { THEME_CLEANUP_SEEN_SETTING } from '../content/theme-cleanup.mjs';
import { STANDING_DIFFICULTY_SETTING } from '../utils/roll/check-difficulty.mjs';
import { DELIBERATE_PAUSE_SETTING, UNPAUSE_BY_DEFAULT_SETTING } from '../utils/time/pause-settings.mjs';
import { XP_CONFIG_SETTING, DEFAULT_XP_WEIGHTS } from '../utils/combat/xp-config.mjs';
import { SHEET_PDF_SETTING } from '../utils/ui/sheet-pdf-setting.mjs';
import { LIVE_FLAGS, registerLiveFlags } from '../utils/live-flags.mjs';

/**
 * Register the system settings. `src/hooks` hands in what lives above this layer: the menu launcher classes
 * (`launchers.themeCleanup`, `.spacePrices`, `.sourceryImporter`) and the `aiContent` `onChange` handler.
 */
export function registerSettings({ launchers, onAiContentChange }) {
  // Register System Settings
  game.settings.register(SYSTEM_ID, ARCHIVED_COMBATS_SETTING, {
    name: 'Archived Combats',
    hint: 'Stores permanently archived combat encounters and round-by-round action history.',
    scope: 'world',
    config: false,
    type: Array,
    default: []
  });

  game.settings.register(SYSTEM_ID, SESSIONS_SETTING, {
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

  game.settings.register(SYSTEM_ID, ACTIVE_SESSION_SETTING, {
    name: 'Active Session ID',
    hint: 'Current active session ID for live party progression.',
    scope: 'world',
    config: false,
    type: String,
    default: ''
  });

  game.settings.register(SYSTEM_ID, CURRENT_FLOOR_SETTING, {
    onChange: onCurrentFloorChange,
    name: 'Current Dungeon Floor',
    hint: 'The active dungeon floor (1-18) where all crawlers and encounters currently reside.',
    scope: 'world',
    config: true,
    type: Number,
    default: 1
  });

  game.settings.register(SYSTEM_ID, STANDING_DIFFICULTY_SETTING, {
    scope: 'world',
    config: false,
    type: Object,
    default: null
  });

  game.settings.register(SYSTEM_ID, FLOOR_TIMER_SETTING, {
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
  game.settings.register(SYSTEM_ID, SCENE_EPOCH_SETTING, {
    onChange: refreshEnvironmentDisplays,
    scope: 'world',
    config: false,
    type: Number,
    default: 0
  });

  game.settings.register(SYSTEM_ID, CRAWLER_COUNT_SETTING, {
    onChange: refreshEnvironmentDisplays,
    name: 'Surviving Crawler Count',
    hint: 'Total number of surviving crawlers in the dungeon.',
    scope: 'world',
    config: true,
    type: Number,
    default: 1000000
  });

  // The GM's own copy of the fillable character sheet; "Save to PDF" fills it (src/apps/pdf-exporter.mjs).
  game.settings.register(SYSTEM_ID, SHEET_PDF_SETTING, {
    name: 'COG.Content.SheetPdfName',
    hint: 'COG.Content.SheetPdfHint',
    scope: 'world',
    config: true,
    type: String,
    default: '',
    filePicker: 'any'
  });

  // A tag definition changed (rows or flags): rebuild the behaviour index and re-prepare actors. Fires on every client.
  game.settings.register(SYSTEM_ID, CUSTOM_TAGS_SETTING, {
    name: 'Custom Tags',
    hint: 'Stores user-defined custom tag definitions across the world.',
    scope: 'world',
    config: false,
    type: Array,
    default: [],
    onChange: () => invalidateTagBehaviour()
  });

  // World overrides of a tag's behaviour { [tagId]: { rows?, flags? } }; the Tag Manager edits them (E7.5), the engine only reads.
  game.settings.register(SYSTEM_ID, TAG_OVERRIDES_SETTING, {
    name: 'Tag Behaviour Overrides',
    hint: 'House-rule replacements for the rows and flags a tag carries. Wins over the system and modules.',
    scope: 'world',
    config: false,
    type: Object,
    default: {},
    onChange: () => invalidateTagBehaviour()
  });

  // The XP split the combat archive's "Save Defaults" stores; the tracker merges it over its own defaults.
  game.settings.register(SYSTEM_ID, XP_CONFIG_SETTING, {
    name: 'XP Weights',
    hint: 'How an encounter\'s XP pool is split between damage dealt, damage taken, defensive, tactical and support play.',
    scope: 'world',
    config: false,
    type: Object,
    default: { ...DEFAULT_XP_WEIGHTS }
  });

  game.settings.register(SYSTEM_ID, UNPAUSE_BY_DEFAULT_SETTING, {
    name: 'Unpause Game by Default',
    hint: 'Automatically unpause the game when loading into the world.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true
  });

  // How a worshipper's offerings are counted (see documents/actor/devotion.mjs).
  game.settings.register(SYSTEM_ID, WORSHIP_TRACKING_SETTING, {
    name: 'Worship Offerings',
    hint: 'How offerings to a deity are tracked. Each day: a missed day withholds the deity\'s benefits and the GM is prompted on the world clock. Each Floor: offerings are counted per Floor. By hand: the GM tracks the days and the system only records the Offering.',
    scope: 'world',
    config: true,
    type: String,
    choices: {
      [WORSHIP_TRACKING.day]: 'Each day',
      [WORSHIP_TRACKING.floor]: 'Each Floor',
      [WORSHIP_TRACKING.manual]: 'By hand'
    },
    default: WORSHIP_TRACKING.day
  });

  // How the system treats an action that exceeds a rulebook limit (see utils/rule-break.mjs).
  game.settings.register(SYSTEM_ID, RULE_BREAK_MODE_SETTING, {
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
  game.settings.register(SYSTEM_ID, SHOW_GM_RULE_BREAKS_SETTING, {
    name: 'Show GM Rule Breaks to players',
    hint: 'On: the [RULE BREAK] badge on cards a GM produces is visible to everyone. Off: it shows to GMs only and Rule Break chat lines a GM produces are whispered to GMs. Players always see their own Rule Breaks.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true
  });

  // Set by the active GM when a user pauses the world, cleared on unpause. While set, the default
  // unpause on load is skipped so a reload or restart keeps a deliberate pause.
  game.settings.register(SYSTEM_ID, DELIBERATE_PAUSE_SETTING, {
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

  game.settings.register(SYSTEM_ID, PRIMARY_THEME_SETTING, {
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
  game.settings.register(SYSTEM_ID, DISABLED_THEMES_SETTING, {
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
  game.settings.register(SYSTEM_ID, AI_CONTENT_SETTING, {
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
  game.settings.register(SYSTEM_ID, THEME_CLEANUP_SEEN_SETTING, {
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
    type: launchers.themeCleanup,
    restricted: true
  });

  // The GM's personal space prices (coupon price per rank, connector, new table), edited in the Personal Space Prices menu and read by `spaceRules()`.
  game.settings.register(SYSTEM_ID, SPACE_PRICES_SETTING, {
    scope: 'world',
    config: false,
    type: Object,
    default: {},
    // Open space sheets show the prices on their buttons
    onChange: () => refreshOpenActorSheets('personal_space')
  });
  game.settings.registerMenu?.(SYSTEM_ID, 'spacePrices', {
    name: 'Personal Space Prices',
    label: 'Open Personal Space Prices',
    hint: 'Set what a personal space Rank Up, a joining connector and a new crafting table cost in gold.',
    icon: 'fa-solid fa-coins',
    type: launchers.spacePrices,
    restricted: true
  });

  // Sourcery importer: a button in Configure Settings; the catalog setting itself is registered by the provider.
  game.settings.registerMenu?.(SYSTEM_ID, 'sourceryImporter', {
    name: 'Sourcery Importer',
    label: 'Open Sourcery Importer',
    hint: 'Fill the system content text from the official rulebook PDFs you own.',
    icon: 'fa-solid fa-file-import',
    type: launchers.sourceryImporter,
    restricted: true
  });

  // One world Boolean per live flag in LIVE_FLAGS (empty while no change waits for a live check).
  registerLiveFlags(game.settings, LIVE_FLAGS);
}

