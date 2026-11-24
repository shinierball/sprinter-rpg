/**
 * The lean tables' context: which columns the Spells, Skills and Inventory tables show for this user and this sheet, and the
 * Columns menu's text. The column logic is the pure registry in `src/utils/ui/sheet-columns.mjs`; this file reads the setting
 * and shapes what the templates print.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { langText } from '../../utils/lang-text.mjs';
import { SHEET_COLUMNS_SETTING, readColumnPrefs, tableView } from '../../utils/ui/sheet-columns.mjs';
import { itemDefinitionContext } from '../../utils/item-describer/definition-context.mjs';

/** The tables this context builds. */
const LEAN_TABLES = Object.freeze(['spells', 'quickSpells', 'skills', 'inventory']);

const text = langText({
  'COG.SheetTables.Menu.Columns': 'Columns',
  'COG.SheetTables.Menu.TitleActor': 'Columns: {table}, this sheet',
  'COG.SheetTables.Menu.TitleAll': 'Columns: {table}, all my sheets',
  'COG.SheetTables.Menu.StateDefault': 'Follows your default.',
  'COG.SheetTables.Menu.StateOwn': 'This sheet has its own columns.',
  'COG.SheetTables.Menu.Locked': 'Always shown',
  'COG.SheetTables.Menu.ResetSheet': 'Reset this sheet',
  'COG.SheetTables.Menu.UseDefault': 'Use as my default',
  'COG.SheetTables.Menu.ResetDefault': 'Reset my default',
  'COG.SheetTables.Table.spells': 'Spells',
  'COG.SheetTables.Table.quickSpells': 'Spells & Magic',
  'COG.SheetTables.Table.skills': 'Skills',
  'COG.SheetTables.Table.inventory': 'Inventory'
});

/** The signed-in user's stored column choices, sanitised; `{}` when the setting is not registered or unreadable. */
export function readSheetColumnPrefs() {
  let raw;
  try { raw = globalThis.game?.settings?.get(SYSTEM_ID, SHEET_COLUMNS_SETTING); } catch { raw = undefined; }
  return readColumnPrefs(raw);
}

/**
 * The key of this sheet's layer: the actor id, or `null` for a compendium actor (it has no stable world id, so its menu
 * edits the user-wide layer). A synthetic token actor's `id` is its base actor's.
 * @param {Actor} actor
 * @returns {string|null}
 */
export function columnActorId(actor) {
  return actor?.pack ? null : (actor?.id ?? null);
}

/** One table's view with the Columns menu's text added. */
function leanTable(id, prefs, actorId, menuOpen) {
  const view = tableView(id, prefs, actorId, { menuOpen });
  const { menu } = view;
  const own = menu.scope === 'actor';
  menu.buttonLabel = text('COG.SheetTables.Menu.Columns');
  menu.title = text(own ? 'COG.SheetTables.Menu.TitleActor' : 'COG.SheetTables.Menu.TitleAll', { table: text(`COG.SheetTables.Table.${id}`) });
  menu.state = own ? text(menu.ownEntry ? 'COG.SheetTables.Menu.StateOwn' : 'COG.SheetTables.Menu.StateDefault') : '';
  menu.lockedTip = text('COG.SheetTables.Menu.Locked');
  menu.showResetSheet = own && menu.ownEntry;
  menu.showUseDefault = own;
  menu.showResetDefault = menu.hasDefault;
  menu.resetSheetLabel = text('COG.SheetTables.Menu.ResetSheet');
  menu.useDefaultLabel = text('COG.SheetTables.Menu.UseDefault');
  menu.resetDefaultLabel = text('COG.SheetTables.Menu.ResetDefault');
  return view;
}

/**
 * The definition an open row prints: `itemDefinitionContext` over the row's lines (the description enriched as the item sheet
 * enriches it, read-only, links resolved). A gear-granted row reads its catalog entry (`definitionSource`) and has no sheet to open.
 * @param {object} row a spell, skill, gear or loot row with `summaryLines`
 * @returns {Promise<object>}
 */
async function buildDefinition(row) {
  return itemDefinitionContext(row.definitionSource ?? row, { lines: row.summaryLines ?? [], itemId: row.id, canEdit: !row.isGranted });
}

/** The open-set key of a spell's definition in the page-1 quick table (the Spells table on page 3 keys by the bare id). */
const quickDefinitionKey = (id) => `quick:${id}`;

/**
 * Sets `context.tables.{spells,quickSpells,skills,inventory}` and, on every spell, skill, gear and loot row, `definitionOpen`
 * and (open rows only) `definition`; every spell row also gets `quick` ({ id, definitionOpen, definition }) for the page-1
 * table, whose rows open and close apart from page 3's. An open id that no longer matches a row is dropped.
 * @param {object} context the sheet's render context
 * @param {{ actor: Actor, _columnMenu: string|null, _openDefinitions: Set<string> }} sheet
 */
export async function prepareSheetTables(context, sheet) {
  const prefs = readSheetColumnPrefs();
  const actorId = columnActorId(sheet.actor);
  context.tables = Object.fromEntries(LEAN_TABLES.map((id) => [id, leanTable(id, prefs, actorId, sheet._columnMenu === id)]));
  const rows = [...(context.spells ?? []), ...(context.skills ?? []), ...(context.gear ?? []), ...(context.loot ?? [])];
  const seen = new Set();
  await Promise.all(rows.map(async (row) => {
    seen.add(row.id);
    row.definitionOpen = sheet._openDefinitions.has(row.id);
    if (row.definitionOpen) row.definition = await buildDefinition(row);
  }));
  await Promise.all((context.spells ?? []).map(async (row) => {
    const key = quickDefinitionKey(row.id);
    seen.add(key);
    row.quick = { id: row.id, definitionOpen: sheet._openDefinitions.has(key) };
    if (row.quick.definitionOpen) row.quick.definition = await buildDefinition(row);
  }));
  for (const id of [...sheet._openDefinitions]) if (!seen.has(id)) sheet._openDefinitions.delete(id);
}
