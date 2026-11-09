/**
 * Opening loot boxes (7.3c; the loot box spec, D4, D6, D7, D8, D12, D14).
 *
 * The opener's client checks "in a safe room" (D7: a crawler token on a safe room scene). Anywhere else it asks a
 * lightweight Rule Break, never a block. It then asks the GM through one relay action, `lootBoxOpen`, authorized by ownership of the crawler (D8). The GM client does everything else in one batch:
 * 1. resolve and roll every box unit, in tier rank order (the registry), then box name, then item id; a stack of N is N
 *    units, each rolled on its own;
 * 2. create every prize in one `createEmbeddedDocuments` call (if that throws, nothing is spent);
 * 3. add the gold in one update;
 * 4. spend the opened units through `spendConsumableUnit` (each leaves its used form: an Empty Loot Box, D12);
 * 5. post the ceremony chat card (with a Watch button) and, for the GM, a whispered note of the generated entries left
 *    to finish and of every warning.
 * It returns the reveal list for the show. The loot is written before the show starts, so nothing is lost if the window
 * closes. With no GM connected the relay warns and nothing is spent.
 *
 * A box row whose kind asks for a pick (`apply.boxChoose`, the `choice` kind) makes the open two-pass. Before step 1 the
 * GM pre-scans every unit's rows. A pick with no answer, or with an answer not in the freshly computed candidates, is
 * pending: the call returns `{ error: 'needs-choices', pending, blocked }` having rolled, created and spent nothing. The
 * opener's client shows one picker and calls again with `choices: { '<itemId>:<unit>:<rowIndex>': uuid }`. A pick with no
 * candidates blocks its unit: that unit stays sealed (`empty`, not spent) and the GM is told, while the others open.
 *
 * What a box gives is its `system.box.contents` rows, run through each `CONFIG.COG.rowKinds.boxContents` kind's
 * `apply.boxOpen` handler (D4). A box with no rows (D6, 538 d) gives its tier's default: a GM's house table
 * (`lootbox.default.<tier>`) when one resolves, else one item from the tier's generator; when neither works, or the box
 * says `whenEmpty: 'keep'`, the unit is not spent and the GM is told. The session ledger records nothing (D14): the card
 * is the record.
 *
 * Does not import `actor.mjs`; the actor mixin delegates here.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { registerRelayAction, requestRelay, isNoGmReason } from '../../utils/gm-relay.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { runKeyed } from '../../utils/keyed-queue.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { ruleBreakBadgeHtml } from '../../utils/rule-break-visibility.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { promptChoicePicks } from '../../utils/ui/choice-picker.mjs';
import { firstScalar } from '../../utils/first-scalar.mjs';
import { slugifyIdentifier } from '../../utils/identifier.mjs';
import { seededIds } from '../../utils/stable-id.mjs';
import { getRowKind, kindOf, BOX_CHOICE_INVENTORY_TYPES } from '../../utils/row-kinds.mjs';
import { findCrawlerScene, isInSafeRoom } from '../../utils/floor/safe-room.mjs';
import {
  DEFAULT_LOOT_BOX_RANK, DEFAULT_LOOT_BOX_TIER, lootBoxTierDef, lootBoxTierRegistry
} from '../../data/loot-box-tiers.mjs';
import { sanitizeLootBox } from '../../data/loot-box-rows.mjs';
import { tomePayload } from '../../data/tome-payload.mjs';
import { skillPotionPayload } from '../../data/skill-potion-payload.mjs';
import { customItemPayload } from '../../data/custom-item-payload.mjs';
import { buildPayload } from '../../data/builders/item-payload.mjs';
import { startingChoiceCandidates } from '../../data/starting-items.mjs';
import { resolveGrantDocument } from '../../data/race-class-grants.mjs';
import { findCatalogEntry } from '../../content/catalog-lookup.mjs';
import { isUnopenedBox, refuseNamedBoxes, unitsOf } from './gm-only-items.mjs';
import { loadEnchantTable, rollEnchantTable } from '../item/enchant-table.mjs';
import { followTableRef, rollMagicItem } from '../item/magic-item-roll.mjs';
import { spendConsumableUnit } from './used-items.mjs';
import { userOwnsActor } from './personal-space-links.mjs';
import { landItems } from '../../utils/content-source.mjs';

/** The one GM relay action of an open. */
export const RELAY_ACTION_LOOT_BOX_OPEN = 'lootBoxOpen';
/** Provenance on every prize: `flags.sprinter-rpg.lootBox = { tier, boxName, openedAt }` (Determine Value, Rank 10). */
export const LOOT_BOX_FLAG = 'lootBox';
/** The ceremony card's flag: the opener and the reveal list, which the Watch button replays. */
export const LOOT_BOX_OPEN_FLAG = 'lootBoxOpen';
/** The flag on the GM's whispered note. */
const LOOT_BOX_GM_NOTE_FLAG = 'lootBoxGmNote';
/** The `data-action` of the card's Watch button (`src/chat/actions/index.mjs`). */
const LOOT_BOX_WATCH_ACTION = 'lootBoxWatch';

/** Localized open text; the key itself when the lang file has no entry. */
export function boxText(key, data = {}) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.format === 'function') return i18n.format(key, data);
  return key;
}

// --- boxes on an actor -------------------------------------------------------------------------------------------------

/** The actor's unopened loot boxes. */
function unopenedBoxes(actor) {
  return Array.from(actor?.items ?? []).filter(isUnopenedBox);
}

/** How many box units the actor can open (the "Open loot boxes (N)" count). */
export function unopenedBoxUnits(actor) {
  return unopenedBoxes(actor).reduce((sum, item) => sum + unitsOf(item), 0);
}

// --- pure planning and folding -----------------------------------------------------------------------------------------

/**
 * Pure: the open order. One entry per unit: tier rank ascending (ties by registry order), then box name, then item id.
 * An unknown tier reads as bronze.
 * @param {object[]} boxItems box items (anything that is not an unopened box is left out)
 * @param {Record<string, object>} [tierRegistry] the tier registry (default `CONFIG.COG.lootBoxTiers`)
 * @param {Record<string, number>} [unitsById] at most this many units of an item (default: all of its stack)
 * @returns {Array<{ itemId: string, tier: string, unit: number, name: string }>}
 */
export function planOpenOrder(boxItems, tierRegistry = lootBoxTierRegistry(), unitsById = {}) {
  const registry = tierRegistry && typeof tierRegistry === 'object' ? tierRegistry : lootBoxTierRegistry();
  const order = Object.keys(registry);
  const tierOf = (raw) => {
    const id = String(firstScalar(raw)).trim().toLowerCase();
    return Object.hasOwn(registry, id) ? id : DEFAULT_LOOT_BOX_TIER;
  };
  const rankOf = (id) => (Number.isFinite(registry[id]?.rank) ? registry[id].rank : DEFAULT_LOOT_BOX_RANK);
  const indexOf = (id) => {
    const i = order.indexOf(id);
    return i === -1 ? order.length : i;
  };
  const entries = Array.from(boxItems ?? []).filter(isUnopenedBox).map((item) => {
    const tier = tierOf(item.system?.box?.tier);
    const cap = Number(unitsById?.[item.id]);
    const units = Number.isFinite(cap) && cap >= 0 ? Math.min(unitsOf(item), Math.trunc(cap)) : unitsOf(item);
    return { item, tier, rank: rankOf(tier), index: indexOf(tier), name: String(item.name ?? ''), id: String(item.id ?? ''), units };
  });
  entries.sort((a, b) => (a.rank - b.rank) || (a.index - b.index) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return entries.flatMap((e) => Array.from({ length: e.units }, (_, unit) => ({ itemId: e.id, tier: e.tier, unit, name: e.name })));
}

/**
 * Pure: what an unfilled box gives (D6, 538 d): a house table row when the tier's house table resolved, else one
 * generated item when the tier names a generator, else nothing.
 * @param {object} tierDef `lootBoxTierDef(tier)`
 * @param {{ houseTableFound?: boolean }} [found]
 * @returns {object[]} box rows
 */
export function defaultBoxContents(tierDef, { houseTableFound = false } = {}) {
  if (houseTableFound && tierDef?.houseTableKey) return [{ kind: 'table', tableKey: tierDef.houseTableKey, quantity: 1 }];
  if (tierDef?.generator) return [{ kind: 'magicItem', generator: '', tier: '', quantity: 1 }];
  return [];
}

/**
 * Pure: fold resolved units into one write: the item creates (each with the `lootBox` provenance flag), one gold delta,
 * and the reveal list (each item prize points at its create by `createIndex`).
 * @param {object[]} resolved units `{ itemId, name, tier, unit, empty, prizes }`
 * @param {{ openedAt?: number }} [opts]
 * @returns {{ creates: object[], goldDelta: number, reveals: object[] }}
 */
export function foldPrizes(resolved, { openedAt = Date.now() } = {}) {
  const creates = [];
  let goldDelta = 0;
  const reveals = Array.from(resolved ?? []).map((unit) => {
    const prizes = [];
    let gold = 0;
    for (const prize of unit?.prizes ?? []) {
      if (prize?.type === 'item') {
        const data = structuredClone(prize.data ?? {});
        delete data._id;
        const own = data.flags?.[SYSTEM_ID] ?? {};
        data.flags = { ...(data.flags ?? {}), [SYSTEM_ID]: { ...own, [LOOT_BOX_FLAG]: { tier: unit.tier, boxName: unit.name, openedAt } } };
        const createIndex = creates.push(data) - 1;
        prizes.push({
          type: 'item',
          name: prize.name || data.name || '',
          img: prize.img || data.img || '',
          itemType: data.type || '',
          quantity: Number(prize.quantity) || Number(data.system?.quantity) || 1,
          label: prize.label || '',
          lines: Array.isArray(prize.lines) ? [...prize.lines] : [],
          pendingLines: Array.isArray(prize.pendingLines) ? prize.pendingLines.filter((i) => Number.isInteger(i) && i >= 0) : [],
          pending: Number(prize.pending) || 0,
          generated: prize.generated === true,
          chosen: prize.chosen === true,
          createIndex
        });
      } else if (prize?.type === 'gold') {
        const amount = Math.max(0, Math.floor(Number(prize.amount) || 0));
        gold += amount;
        prizes.push({ type: 'gold', amount, label: prize.label || '' });
      } else if (prize?.type === 'line') {
        prizes.push({ type: 'line', text: String(prize.text ?? ''), notice: prize.notice === true });
      }
    }
    goldDelta += gold;
    return { itemId: unit.itemId, name: unit.name, tier: unit.tier, unit: unit.unit, empty: unit.empty === true, prizes, gold };
  });
  return { creates, goldDelta, reveals };
}

/**
 * Pure: the view both renderers share (the ceremony card here, the show window in 7.3e): per box its tier's label,
 * colour and icon, and its prizes as display entries.
 * @param {{ actorName?: string, reveals?: object[], ruleBreak?: boolean, gold?: number }} result
 */
export function lootBoxRevealView(result = {}) {
  const reveals = Array.isArray(result.reveals) ? result.reveals : [];
  const boxes = reveals.map((r) => {
    const def = lootBoxTierDef(r.tier);
    return {
      name: r.name || '', tier: def.id, tierLabel: def.label, color: def.color, icon: def.icon, fx: def.fx,
      empty: r.empty === true, gold: Number(r.gold) || 0,
      prizes: (r.prizes ?? []).map((p) => ({ ...p }))
    };
  });
  return {
    actorName: result.actorName || '',
    ruleBreak: result.ruleBreak === true,
    gold: Number(result.gold) || 0,
    opened: boxes.filter((b) => !b.empty).length,
    total: boxes.length,
    boxes
  };
}

// --- the services the boxOpen handlers read (GM side) -----------------------------------------------------------------

const asPlain = (doc) => (typeof doc?.toObject === 'function' ? doc.toObject() : structuredClone(doc));

/** A prize document by uuid, else by identifier (world, packs, then the catalogs), as plain data. */
async function resolvePrizeDocument(ref, type = '') {
  const uuid = typeof ref?.uuid === 'string' ? ref.uuid.trim() : '';
  const identifier = typeof ref?.identifier === 'string' ? ref.identifier.trim() : '';
  if (!uuid && !identifier) return null;
  let doc = await resolveGrantDocument({ uuid, identifier }, type || undefined);
  if (!doc && identifier && type !== 'spell' && type !== 'skill') {
    const entry = findCatalogEntry('items', identifier);
    if (entry && (!type || entry.type === type)) doc = entry;
  }
  if (!doc) return null;
  const plain = asPlain(doc);
  const source = typeof doc.uuid === 'string' && doc.uuid.startsWith('Compendium.') ? doc.uuid : '';
  if (source) plain._stats = { ...(plain._stats ?? {}), compendiumSource: source };
  return plain;
}

/** Create data from a document's data: no id, folder, sort or ownership; gear arrives unequipped. */
function prizeData(data) {
  const out = structuredClone(data ?? {});
  for (const key of ['_id', 'id', 'folder', 'sort', 'ownership', 'uuid']) delete out[key];
  out.system = out.system ?? {};
  if ('equipped' in out.system) out.system.equipped = false;
  return out;
}

/** `quantity` units of a document: a loot item as one stack, anything else as that many items. */
function itemPrizes(data, quantity) {
  const q = Math.max(1, Math.trunc(Number(quantity)) || 1);
  const clean = prizeData(data);
  const base = { type: 'item', name: clean.name ?? '', img: clean.img ?? '' };
  if (clean.type === 'loot') {
    clean.system.quantity = q;
    return [{ ...base, data: clean, quantity: q }];
  }
  return Array.from({ length: q }, () => ({ ...base, data: structuredClone(clean), quantity: 1 }));
}

/** A spell prize: a Tome of the spell (537 a). */
function tomePrize(spell, rank = 1) {
  const name = String(spell?.name ?? '').trim() || 'Spell';
  const identifier = String(spell?.system?.identifier ?? spell?.identifier ?? '').trim() || slugifyIdentifier(name);
  const data = tomePayload({ name, identifier }, rank);
  return { type: 'item', data, name: data.name, img: data.img ?? '', quantity: 1 };
}

/** A skill prize: a skill potion of `ranks` Ranks; `stem` names it ("<stem>: <Skill>") when the row names one. */
function skillPotionPrize(skill, ranks = 1, stem = '') {
  const name = String(skill?.name ?? '').trim() || 'Skill';
  const identifier = String(skill?.system?.identifier ?? skill?.identifier ?? '').trim() || slugifyIdentifier(name);
  const cleanStem = String(stem ?? '').trim();
  const data = skillPotionPayload({ name, identifier }, ranks, { name: cleanStem ? `${cleanStem}: ${name}` : '' });
  return { type: 'item', data, name: data.name, img: data.img ?? '', quantity: 1 };
}

/**
 * A skill potion of a custom (write-in) Skill named `name`: the Skill is built the way an experience write-in is
 * (`customItemPayload`), and its identifier is the potion's; using the potion makes the Skill on the crawler.
 */
function customSkillPotionPrize(name, ranks = 1, stem = '') {
  const skill = customItemPayload('skill', String(name ?? '').trim() || 'Skill');
  return skillPotionPrize({ name: skill.name, identifier: skill.system?.identifier ?? '' }, ranks, stem);
}

/** A placeholder loot item the GM renames to the real thing: `name`, with `description` (plain text) as its description. */
function placeholderItemPrize(name, description = '') {
  const itemName = String(name ?? '').trim() || 'Item';
  const words = String(description ?? '').trim();
  const data = buildPayload('loot', {
    name: itemName,
    system: { quantity: 1, lootType: 'treasure', ...(words ? { description: `<p>${escapeAttr(words)}</p>` } : {}) }
  });
  return { type: 'item', data, name: data.name, img: data.img ?? '', quantity: 1 };
}

/** Candidates in a `choice` list: more than this are cut. */
export const CHOICE_CANDIDATE_CAP = 500;

/**
 * The picks of a `choice` row: TagIndex matches of its query and item type, deduplicated by identifier (first wins), with
 * pre-rolled world items dropped, non-inventory types dropped when the row names no type, sorted by name, capped.
 * @param {{ query?: object, itemType?: string }} spec
 * @returns {Array<{ uuid: string, identifier: string, name: string, img: string, type: string }>}
 */
export function choiceCandidates(spec = {}) {
  const itemType = String(spec?.itemType ?? '');
  const seen = new Set();
  const out = [];
  for (const entry of startingChoiceCandidates({ query: spec?.query ?? null, itemType })) {
    if (!entry?.uuid) continue;
    if (!itemType && !BOX_CHOICE_INVENTORY_TYPES.includes(entry.type)) continue;
    if (entry.document?.flags?.[SYSTEM_ID]?.lootBoxPreroll) continue;
    const key = entry.identifier || entry.uuid;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ uuid: entry.uuid, identifier: entry.identifier || '', name: entry.name || '', img: entry.img || '', type: entry.type || '' });
  }
  out.sort((a, b) => a.name.localeCompare(b.name) || a.uuid.localeCompare(b.uuid));
  if (out.length > CHOICE_CANDIDATE_CAP) {
    console.warn(`Sprinter RPG | A loot box choice offers ${out.length} candidates; only the first ${CHOICE_CANDIDATE_CAP} are listed.`);
    out.length = CHOICE_CANDIDATE_CAP;
  }
  return out;
}

/** An integer or a Roll formula, floored at 0; null when it cannot be rolled. */
async function rollGoldFormula(raw) {
  const val = firstScalar(raw);
  const formula = typeof val === 'number' ? String(val) : (typeof val === 'string' ? val.trim() : '');
  if (!formula) return null;
  const flat = Number(formula);
  if (Number.isFinite(flat)) return Math.max(0, Math.floor(flat));
  const RollClass = globalThis.Roll;
  if (typeof RollClass !== 'function') return null;
  if (typeof RollClass.validate === 'function' && !RollClass.validate(formula)) return null;
  try {
    const roll = await new RollClass(formula).evaluate();
    const total = Number(roll?.total);
    return Number.isFinite(total) ? Math.max(0, Math.floor(total)) : null;
  } catch {
    return null;
  }
}

/** The services object a boxOpen handler reads (`row-kinds.mjs` documents it). */
export function boxOpenServices({ actor = null, sources, rng, floor } = {}) {
  return {
    resolveDocument: resolvePrizeDocument,
    itemPrizes,
    tomePrize,
    skillPotionPrize,
    customSkillPotionPrize,
    placeholderItemPrize,
    choiceCandidates,
    rollGold: rollGoldFormula,
    loadTable: (ref) => loadEnchantTable(ref, { sources }),
    followTableRef: (uuid) => followTableRef(uuid, { sources }),
    rollTable: (snapshot) => rollEnchantTable(snapshot),
    rollMagicItem: (spec) => rollMagicItem(spec, { actor, sources, rng, floor }),
    text: boxText
  };
}

// --- one unit ----------------------------------------------------------------------------------------------------------

/** Run every row of one unit through its kind's handler; `answers` (row index to uuid) give each picked row `ctx.choice`. */
async function runRows(rows, ctx, answers = new Map()) {
  const acc = { prizes: [], warnings: [] };
  for (const [rowIndex, row] of rows.entries()) {
    const id = kindOf('boxContents', row);
    const def = getRowKind('boxContents', id);
    const handler = def?.apply?.boxOpen;
    if (typeof handler !== 'function') {
      const text = boxText('COG.LootBoxOpen.UnknownKind', { kind: id });
      acc.warnings.push(text);
      acc.prizes.push({ type: 'line', text, notice: true });
      continue;
    }
    try {
      const choice = answers.has(rowIndex) ? { choice: { uuid: answers.get(rowIndex) } } : {};
      await handler(acc, row, { ...ctx, arrayKey: 'boxContents', stage: 'boxOpen', ...choice });
    } catch (err) {
      const text = boxText('COG.LootBoxOpen.KindFailed', { kind: id, error: String(err?.message ?? err) });
      console.warn(`Sprinter RPG | ${text}`, err);
      acc.warnings.push(text);
      acc.prizes.push({ type: 'line', text, notice: true });
    }
  }
  return acc;
}

const givesSomething = (prizes) => prizes.some((p) => p?.type === 'item' || p?.type === 'gold');

/**
 * Resolve one unit: its rows, or the tier's default when it has none. A default that gave nothing (no generator, no
 * generator tables, a homebrew tier with neither), a box kept sealed and a unit whose pick has no candidates
 * (`blocked`, the labels of those picks) are `empty`: not spent, the GM told. `answers` are the unit's picks by row index.
 */
async function resolveUnit(actor, item, entry, { services, houseTables, answers, blocked = [] }) {
  const box = sanitizeLootBox(item.system?.box);
  const tierDef = lootBoxTierDef(entry.tier);
  const where = { box: entry.name || item.name || '', actor: actor.name ?? '' };
  if (blocked.length) {
    return {
      itemId: item.id, name: entry.name, tier: tierDef.id, unit: entry.unit, empty: true,
      prizes: [{ type: 'line', text: boxText('COG.LootBoxOpen.ChoiceEmptyReveal'), notice: true }],
      warnings: blocked.map((label) => boxText('COG.LootBoxOpen.ChoiceEmptyWarn', { ...where, label }))
    };
  }
  let rows = box.contents;
  let defaulted = false;
  let kept = false;
  if (!rows.length) {
    defaulted = true;
    if (box.whenEmpty === 'keep') {
      kept = true;
      rows = [];
    } else {
      if (!houseTables.has(tierDef.id)) {
        const found = tierDef.houseTableKey ? await services.loadTable({ key: tierDef.houseTableKey }) : null;
        houseTables.set(tierDef.id, Boolean(found));
      }
      rows = defaultBoxContents(tierDef, { houseTableFound: houseTables.get(tierDef.id) });
    }
  }
  const ctx = { actor, box: { itemId: item.id, name: entry.name, tier: tierDef.id }, tierDef, depth: 1, services };
  const acc = await runRows(rows, ctx, answers);
  const fromHouseTable = defaulted && rows[0]?.kind === 'table';
  const empty = defaulted && !fromHouseTable && !givesSomething(acc.prizes);
  if (empty) {
    acc.warnings.push(boxText(kept ? 'COG.LootBoxOpen.KeptWarn' : 'COG.LootBoxOpen.EmptyWarn', where));
    acc.prizes = [{ type: 'line', text: boxText('COG.LootBoxOpen.EmptyReveal'), notice: true }];
  }
  return { itemId: item.id, name: entry.name, tier: tierDef.id, unit: entry.unit, empty, prizes: acc.prizes, warnings: acc.warnings };
}

// --- the chat cards ----------------------------------------------------------------------------------------------------

function prizeHtml(prize) {
  if (prize.type === 'item') {
    const qty = prize.quantity > 1 ? ` x${prize.quantity}` : '';
    const label = prize.label ? ` <em>(${escapeAttr(prize.label)})</em>` : '';
    const chosen = prize.chosen ? ` <span class="cog-state-badge cog-lootbox-chosen">${escapeAttr(boxText('COG.LootBoxOpen.CardChosen'))}</span>` : '';
    const lines = prize.lines?.length ? `<br><small>${prize.lines.map((l) => escapeAttr(l)).join('<br>')}</small>` : '';
    return `<li class="cog-lootbox-prize"><strong>${escapeAttr(prize.name)}</strong>${qty}${chosen}${label}${lines}</li>`;
  }
  if (prize.type === 'gold') {
    const label = prize.label ? ` <em>(${escapeAttr(prize.label)})</em>` : '';
    return `<li class="cog-lootbox-prize cog-lootbox-gold">${escapeAttr(boxText('COG.LootBoxOpen.CardGold', { amount: prize.amount }))}${label}</li>`;
  }
  return `<li class="cog-lootbox-line${prize.notice ? ' cog-lootbox-notice' : ''}"><em>${escapeAttr(prize.text)}</em></li>`;
}

/** The ceremony card's HTML from the shared view. */
export function lootBoxCardHtml(view) {
  const badge = view.ruleBreak ? ` ${ruleBreakBadgeHtml()}` : '';
  const boxes = view.boxes.map((b) => {
    const chip = `<span class="cog-tier-chip cog-fg-dyn" style="--cog-fg-dyn: ${escapeAttr(b.color)};"><i class="${escapeAttr(b.icon)}"></i> ${escapeAttr(b.tierLabel)}</span>`;
    const kept = b.empty ? ` <span class="cog-state-badge">${escapeAttr(boxText('COG.LootBoxOpen.CardKept'))}</span>` : '';
    return `<div class="cog-lootbox-card-box" data-tier="${escapeAttr(b.tier)}">${chip} <strong>${escapeAttr(b.name)}</strong>${kept}`
      + `<ul class="cog-lootbox-prizes">${b.prizes.map(prizeHtml).join('')}</ul></div>`;
  }).join('');
  const gold = view.gold > 0 ? `<p class="cog-lootbox-gold-total"><strong>${escapeAttr(boxText('COG.LootBoxOpen.CardGoldTotal', { amount: view.gold }))}</strong></p>` : '';
  const opened = escapeAttr(boxText('COG.LootBoxOpen.CardOpened', { actor: view.actorName, count: view.opened, total: view.total }));
  return `<div class="cog-chat-card cog-lootbox-card"><header><strong>${escapeAttr(boxText('COG.LootBoxOpen.CardTitle'))}</strong>${badge}</header>`
    + `<p>${opened}</p>${boxes}${gold}`
    + `<button type="button" data-action="${LOOT_BOX_WATCH_ACTION}"><i class="fa-solid fa-play"></i> ${escapeAttr(boxText('COG.LootBoxOpen.Watch'))}</button></div>`;
}

/** The GM's note: generated items with entries to finish (with a link to each) and every warning. '' when there is none. */
export function lootBoxGmNoteHtml(reveals, warnings) {
  const pending = [];
  for (const r of reveals ?? []) {
    for (const p of r.prizes ?? []) {
      if (p.type !== 'item' || !(p.pending > 0)) continue;
      const link = p.uuid ? ` @UUID[${p.uuid}]{${boxText('COG.LootBoxOpen.OpenItem')}}` : '';
      pending.push(`<li><strong>${escapeAttr(p.name)}</strong>: ${escapeAttr(boxText('COG.LootBoxOpen.GmPending', { count: p.pending }))}${link}</li>`);
    }
  }
  const warned = [...new Set(warnings ?? [])].map((w) => `<li>${escapeAttr(w)}</li>`);
  if (!pending.length && !warned.length) return '';
  return `<div class="cog-chat-card cog-lootbox-gm-note"><header><strong>${escapeAttr(boxText('COG.LootBoxOpen.GmTitle'))}</strong></header>`
    + (pending.length ? `<ul>${pending.join('')}</ul>` : '') + (warned.length ? `<ul class="cog-lootbox-warnings">${warned.join('')}</ul>` : '') + '</div>';
}

/** Post the ceremony card (public, authored by the opener) and the GM's whispered note. Returns the card. */
async function postCards(actor, result, user) {
  const ChatMessageClass = globalThis.ChatMessage;
  if (typeof ChatMessageClass?.create !== 'function') return null;
  const view = lootBoxRevealView(result);
  const speaker = ChatMessageClass.getSpeaker?.({ actor }) ?? {};
  const author = user?.id && !user.isGM ? { author: user.id } : {};
  const flags = {
    [SYSTEM_ID]: {
      [LOOT_BOX_OPEN_FLAG]: {
        actorUuid: result.actorUuid, actorName: result.actorName, reveals: result.reveals,
        ruleBreak: result.ruleBreak, gold: result.gold, openedAt: result.openedAt
      },
      ...(result.ruleBreak ? { ruleBreak: true } : {})
    }
  };
  const card = await ChatMessageClass.create({ speaker, content: lootBoxCardHtml(view), flags, ...author });
  const note = lootBoxGmNoteHtml(result.reveals, result.warnings);
  if (note) {
    const whisper = ChatMessageClass.getWhisperRecipients?.('GM')?.map((u) => u.id) ?? [];
    await ChatMessageClass.create({ speaker, content: note, whisper, flags: { [SYSTEM_ID]: { [LOOT_BOX_GM_NOTE_FLAG]: true } } });
  }
  return card;
}

// --- the GM side -------------------------------------------------------------------------------------------------------

function notify(level, message) {
  globalThis.ui?.notifications?.[level]?.(message);
}

/** The boxes and unit caps a request names; every unopened box when it names none. */
function requestedBoxes(actor, request) {
  if (!Array.isArray(request?.boxes)) return { items: unopenedBoxes(actor), caps: {} };
  const items = [];
  const caps = {};
  for (const entry of request.boxes) {
    const id = String(firstScalar(entry?.itemId ?? '')).trim();
    const item = id ? actor.items.get(id) : null;
    if (!item || !isUnopenedBox(item) || items.includes(item)) continue;
    items.push(item);
    const units = Number(entry?.units);
    if (Number.isFinite(units) && units >= 0) caps[id] = Math.trunc(units);
  }
  return { items, caps };
}

/** Spend the opened units of each box, one at a time (each leaves its used form). */
async function spendUnits(actor, reveals) {
  const counts = new Map();
  for (const r of reveals) if (!r.empty) counts.set(r.itemId, (counts.get(r.itemId) ?? 0) + 1);
  for (const [itemId, count] of counts) {
    for (let i = 0; i < count; i += 1) {
      const item = actor.items.get(itemId);
      if (!item) break;
      const quantity = unitsOf(item);
      await spendConsumableUnit(item, actor, { quantity, leaveForm: false });
      if (quantity <= 1) break;
    }
  }
}

// --- picks before the open (the two-pass protocol) ---------------------------------------------------------------------

/** The key of one pick: the box item, the unit within its stack (`planOpenOrder`'s), the row's index in its contents. */
export const choiceKey = (itemId, unit, rowIndex) => `${itemId}:${unit}:${rowIndex}`;
const CHOICE_KEY_PATTERN = /^[A-Za-z0-9]{16}:\d{1,4}:\d{1,4}$/;
/** At most this many answers are read from one request. */
export const CHOICE_ANSWER_LIMIT = 200;
const CHOICE_VALUE_MAX = 256;

/**
 * Pure: a request's `choices` as a plain `{ key: uuid }` object. Keys must be pick keys, values non-empty strings of at most
 * 256 characters; at most 200 answers are kept. Anything else is dropped.
 * @param {*} raw
 * @returns {Record<string, string>}
 */
export function sanitizeLootBoxChoices(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  let count = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (count >= CHOICE_ANSWER_LIMIT) break;
    if (!CHOICE_KEY_PATTERN.test(key) || typeof value !== 'string') continue;
    const uuid = value.trim();
    if (!uuid || uuid.length > CHOICE_VALUE_MAX) continue;
    out[key] = uuid;
    count += 1;
  }
  return out;
}

/** The kind's pick for one row (`apply.boxChoose`), or null when the row needs none. A throw reads as nothing to pick. */
function askRow(choose, row, ctx) {
  let res;
  try {
    res = choose(row, ctx);
  } catch (err) {
    console.warn('Sprinter RPG | A loot box pick could not list its candidates.', err);
    return { label: String(row?.label ?? ''), itemType: '', rank: 1, candidates: [] };
  }
  if (!res || typeof res !== 'object') return null;
  const candidates = (Array.isArray(res.candidates) ? res.candidates : [])
    .filter((c) => typeof c?.uuid === 'string' && c.uuid)
    .map((c) => ({ uuid: c.uuid, name: String(c.name ?? ''), img: String(c.img ?? ''), type: String(c.type ?? '') }));
  const rank = Math.trunc(Number(res.rank));
  return { label: String(res.label ?? ''), itemType: String(res.itemType ?? ''), rank: Number.isFinite(rank) && rank > 0 ? rank : 1, candidates };
}

/**
 * The pre-scan: every row of every planned unit whose kind has `apply.boxChoose`. Rolls nothing and writes nothing.
 * A pick with no candidates blocks its unit (its other picks are not asked); one whose answer is a fresh candidate is
 * answered; any other is pending. The candidates of a row are computed once for every unit of its stack.
 * @returns {{ pending: object[], blocked: object[], answers: Map<string, Map<number, string>>, blockedUnits: Map<string, string[]> }}
 */
function scanChoices(actor, plan, choices, services) {
  const pending = [];
  const blocked = [];
  const answers = new Map();
  const blockedUnits = new Map();
  const asked = new Map();
  const units = new Map();
  for (const entry of plan) units.set(entry.itemId, (units.get(entry.itemId) ?? 0) + 1);
  for (const entry of plan) {
    const item = actor.items.get(entry.itemId);
    if (!item) continue;
    const rows = sanitizeLootBox(item.system?.box).contents;
    const tierDef = lootBoxTierDef(entry.tier);
    const ctx = { actor, box: { itemId: item.id, name: entry.name, tier: tierDef.id }, tierDef, depth: 1, services, arrayKey: 'boxContents', stage: 'boxChoose' };
    const unitKey = `${entry.itemId}:${entry.unit}`;
    const unitPending = [];
    const unitBlocked = [];
    const unitAnswers = new Map();
    for (const [rowIndex, row] of rows.entries()) {
      const choose = getRowKind('boxContents', kindOf('boxContents', row))?.apply?.boxChoose;
      if (typeof choose !== 'function') continue;
      const rowKey = `${entry.itemId}:${rowIndex}`;
      if (!asked.has(rowKey)) asked.set(rowKey, askRow(choose, row, ctx));
      const ask = asked.get(rowKey);
      if (!ask) continue;
      const key = choiceKey(entry.itemId, entry.unit, rowIndex);
      if (!ask.candidates.length) {
        unitBlocked.push(ask.label);
        blocked.push({ key, itemId: entry.itemId, unit: entry.unit, boxName: entry.name, label: ask.label });
        continue;
      }
      const picked = choices[key];
      if (picked && ask.candidates.some((c) => c.uuid === picked)) {
        unitAnswers.set(rowIndex, picked);
        continue;
      }
      unitPending.push({
        key, itemId: entry.itemId, unit: entry.unit, units: units.get(entry.itemId), row: rowIndex, boxName: entry.name,
        tier: tierDef.id, label: ask.label, itemType: ask.itemType, rank: ask.rank, candidates: ask.candidates
      });
    }
    if (unitBlocked.length) blockedUnits.set(unitKey, unitBlocked);
    else pending.push(...unitPending);
    answers.set(unitKey, unitAnswers);
  }
  return { pending, blocked, answers, blockedUnits };
}

async function performNow(actor, request, user, { sources, rng, floor, now }) {
  const ruleBreak = request?.ruleBreak === true;
  const base = { actorUuid: actor.uuid ?? '', actorName: actor.name ?? '', ruleBreak };
  const { items, caps } = requestedBoxes(actor, request);
  const plan = planOpenOrder(items, lootBoxTierRegistry(), caps);
  if (!plan.length) return { ...base, error: 'no-boxes', reveals: [] };

  const services = boxOpenServices({ actor, sources, rng, floor });
  // The first pass: nothing is rolled, created or spent until every pick is answered.
  const scan = scanChoices(actor, plan, sanitizeLootBoxChoices(request?.choices), services);
  if (scan.pending.length) {
    for (const b of scan.blocked) {
      notify('warn', boxText('COG.LootBoxOpen.ChoiceEmptyWarn', { box: b.boxName, actor: actor.name ?? '', label: b.label || boxText('COG.LootBoxOpen.ChoiceDefaultLabel') }));
    }
    return { ...base, error: 'needs-choices', pending: scan.pending, blocked: scan.blocked, reveals: [] };
  }

  const houseTables = new Map();
  const resolved = [];
  for (const entry of plan) {
    const item = actor.items.get(entry.itemId);
    if (!item) continue;
    const unitKey = `${entry.itemId}:${entry.unit}`;
    const blocked = (scan.blockedUnits.get(unitKey) ?? []).map((label) => label || boxText('COG.LootBoxOpen.ChoiceDefaultLabel'));
    resolved.push(await resolveUnit(actor, item, entry, { services, houseTables, answers: scan.answers.get(unitKey), blocked }));
  }
  const openedAt = Number.isFinite(now) ? now : Date.now();
  const { creates, goldDelta, reveals } = foldPrizes(resolved, { openedAt });
  const warnings = [...new Set(resolved.flatMap((u) => u.warnings))];

  // Foundry does not promise to return created documents in input order, so each create carries its own id
  const nextId = typeof globalThis.foundry?.utils?.randomID === 'function'
    ? () => globalThis.foundry.utils.randomID()
    : seededIds(`${actor.uuid ?? actor.id}:${openedAt}`);
  const createIds = creates.map((data) => (data._id = nextId()));
  let created = [];
  if (creates.length) {
    try {
      created = Array.from((await actor.createEmbeddedDocuments('Item', landItems(creates), { keepId: true })) ?? []);
    } catch (err) {
      const message = boxText('COG.LootBoxOpen.CreateFailed', { error: String(err?.message ?? err) });
      console.error(`Sprinter RPG | ${message}`, err);
      notify('error', message);
      return { ...base, error: 'create-failed', reveals: [] };
    }
  }
  for (const reveal of reveals) {
    for (const prize of reveal.prizes) {
      if (prize.type !== 'item') continue;
      const id = createIds[prize.createIndex];
      const doc = created.find((d) => d?.id === id) ?? actor.items?.get(id) ?? null;
      prize.uuid = doc?.uuid ?? '';
      prize.itemId = doc?.id ?? '';
    }
  }
  if (goldDelta > 0) {
    const current = Number(actor.system?.currency?.gold) || 0;
    await actor.update({ 'system.currency.gold': current + goldDelta });
  }
  await spendUnits(actor, reveals);
  for (const w of warnings) notify('warn', w);

  const result = { ...base, reveals, gold: goldDelta, warnings, openedAt };
  const card = await postCards(actor, result, user);
  return { ...result, messageId: card?.id ?? '' };
}

/**
 * GM side (the relay's apply, or a GM opener directly): pre-scan the picks, then resolve, write, spend, post the cards.
 * With a pick unanswered it returns `{ error: 'needs-choices', pending, blocked, reveals: [] }` and writes nothing.
 * @param {Actor} actor the opener
 * @param {{ boxes?: Array<{ itemId: string, units?: number }>|null, ruleBreak?: boolean, choices?: Record<string, string> }} request
 *   `boxes` null = every unopened box; `choices` the picks by `choiceKey`
 * @param {User|null} [user] the requesting user (the card's author when a player)
 * @param {{ sources?: object, rng?: *, floor?: number, now?: number }} [opts] table sources, the generator's rng and floor
 *   (tests; the relay passes none), and the open time
 * @returns {Promise<{ reveals: object[], ruleBreak: boolean, gold?: number, warnings?: string[], error?: string,
 *   pending?: object[], blocked?: object[] }>}
 */
export async function performLootBoxOpen(actor, request = {}, user = null, opts = {}) {
  if (!actor) return { error: 'no-actor', reveals: [], ruleBreak: false };
  return runKeyed(`loot-box-open:${actor.uuid ?? actor.id ?? ''}`, () => performNow(actor, request, user, opts));
}

registerRelayAction(RELAY_ACTION_LOOT_BOX_OPEN, {
  authorize: (payload, requester) => {
    const actor = resolveActorByUuid(payload?.actorUuid);
    return Boolean(actor) && userOwnsActor(actor, requester);
  },
  apply: async (payload, requester) => {
    const actor = resolveActorByUuid(payload?.actorUuid);
    if (!actor) return { error: 'no-actor', reveals: [], ruleBreak: false };
    return performLootBoxOpen(actor, {
      boxes: Array.isArray(payload?.boxes) ? payload.boxes : null,
      ruleBreak: payload?.ruleBreak === true,
      choices: sanitizeLootBoxChoices(payload?.choices)
    }, requester);
  }
});

// --- the show (7.3e: apps/loot-box-show.mjs registers itself as the player on import) ---------------------------------------------------------------------------------------------------

let showPlayer = null;

/**
 * Set the function that plays a reveal list (the Loot Box Showcase registers itself in 7.3e). Null restores the stand-in.
 * @param {((data: object, opts: { replay: boolean }) => (Promise<void>|void))|null} fn
 */
export function setLootBoxShowPlayer(fn) {
  showPlayer = typeof fn === 'function' ? fn : null;
}

/**
 * Play the show for a result (the opener) or a card's flags (Watch). With no player registered (a headless import) it
 * logs instead; the ceremony card already has the results.
 * @param {object} data a performLootBoxOpen result, or a card's `lootBoxOpen` flag
 * @param {{ replay?: boolean }} [opts]
 * @returns {Promise<boolean>} whether a show was played
 */
export async function showLootBoxReveals(data, { replay = false } = {}) {
  if (showPlayer) {
    await showPlayer(data, { replay });
    return true;
  }
  console.info(`Sprinter RPG | ${boxText('COG.LootBoxOpen.ShowNotBuilt')}`);
  return false;
}

// --- the client entry --------------------------------------------------------------------------------------------------

/** Whether any of these boxes holds a row whose kind asks for a pick before the open (`apply.boxChoose`). */
export function boxesNeedChoices(boxes) {
  return Array.from(boxes ?? []).some((item) => sanitizeLootBox(item?.system?.box).contents
    .some((row) => typeof getRowKind('boxContents', kindOf('boxContents', row))?.apply?.boxChoose === 'function'));
}

/** Pure: the picker spec for a `needs-choices` result: one entry per pending pick, grouped by box unit; one note per blocked unit. */
export function lootBoxChoicePickerSpec(actor, result, { stale = false } = {}) {
  const fallback = boxText('COG.LootBoxOpen.ChoiceDefaultLabel');
  const entries = (Array.isArray(result?.pending) ? result.pending : []).map((p) => {
    const tier = lootBoxTierDef(p.tier).label;
    const units = Math.max(1, Number(p.units) || 1);
    const group = units > 1
      ? boxText('COG.LootBoxOpen.ChoiceGroupUnit', { tier, box: p.boxName ?? '', unit: (Number(p.unit) || 0) + 1, units })
      : boxText('COG.LootBoxOpen.ChoiceGroup', { tier, box: p.boxName ?? '' });
    const hint = p.itemType === 'skill' ? boxText('COG.LootBoxOpen.ChoiceHintSkill', { rank: p.rank ?? 1 })
      : (p.itemType === 'spell' ? boxText('COG.LootBoxOpen.ChoiceHintSpell', { rank: p.rank ?? 1 }) : '');
    const candidates = (Array.isArray(p.candidates) ? p.candidates : []).map((c) => ({ value: String(c?.uuid ?? ''), label: String(c?.name || c?.uuid || '') }));
    return { key: String(p.key ?? ''), label: p.label || fallback, hint, group, candidates };
  });
  const notes = (Array.isArray(result?.blocked) ? result.blocked : [])
    .map((b) => boxText('COG.LootBoxOpen.ChoiceBlocked', { box: b.boxName ?? '', label: b.label || fallback }));
  return {
    title: boxText('COG.LootBoxOpen.ChoiceTitle'),
    intro: stale ? boxText('COG.LootBoxOpen.ChoiceStale') : boxText('COG.LootBoxOpen.ChoiceIntro', { name: actor?.name ?? '' }),
    entries,
    notes,
    confirmLabel: boxText('COG.LootBoxOpen.ChoiceOpen'),
    cancelLabel: boxText('COG.LootBoxOpen.ChoiceCancel')
  };
}

/** How many times one open shows the picker: the first list, then once more when the GM's list changed meanwhile. */
const PICKER_ROUNDS = 2;

/**
 * Open loot boxes: the safe-room check (a Rule Break confirm when not in one), the relay to the GM, then the show. When the
 * GM answers `needs-choices`, an interactive open shows the picker and asks again with the picks (cancel ends the open
 * with nothing spent); a list that changed meanwhile is shown once more. A non-interactive open returns the
 * `needs-choices` result.
 * @param {Actor} actor the opener
 * @param {Item[]|null} [items] the boxes to open; null = every unopened box (the "Open loot boxes" button)
 * @param {{ scene?: object|null, interactive?: boolean, ruleBreak?: boolean, show?: boolean,
 *   choices?: Record<string, string>|null }} [options]
 *   `scene`: the scene to judge (default: the crawler's token's); `ruleBreak`: already confirmed; `choices`: headless picks by `choiceKey`
 * @returns {Promise<object>} the GM's result (`reveals`, `ruleBreak`, `gold`), or `{ error }` (`needs-choices` with
 *   `pending` and `blocked`)
 */
export async function openLootBoxes(actor, items = null, { scene, interactive = true, ruleBreak = false, show = true, choices = null } = {}) {
  if (!actor) return { error: 'no-actor' };
  if (items && refuseNamedBoxes()) return { error: 'open-all-only' }; // players open every box at once
  const boxes = (items ? Array.from(items) : unopenedBoxes(actor)).filter(isUnopenedBox);
  if (!boxes.length) {
    notify('info', boxText('COG.LootBoxOpen.NoBoxes', { name: actor.name ?? '' }));
    return { error: 'no-boxes' };
  }
  let broke = ruleBreak === true;
  const where = { scene: scene !== undefined ? scene : findCrawlerScene(actor) };
  if (!broke && !isInSafeRoom(actor, where)) {
    const verdict = await confirmRuleBreak({
      title: boxText('COG.LootBoxOpen.NotSafeTitle'),
      message: boxText('COG.LootBoxOpen.NotSafeMessage', { name: actor.name ?? '' }),
      options: { interactive }
    });
    if (!verdict.confirmed) return { error: 'cancelled', refusal: verdict.refusal };
    broke = true;
  }
  const payload = { actorUuid: actor.uuid, boxes: boxes.map((b) => ({ itemId: b.id, units: unitsOf(b) })), ruleBreak: broke };
  let answers = sanitizeLootBoxChoices(choices);
  if (boxesNeedChoices(boxes)) payload.choices = answers;
  const ask = async (body) => {
    const reply = await requestRelay(RELAY_ACTION_LOOT_BOX_OPEN, body);
    if (reply?.ok) return { result: reply.result ?? {} };
    if (!isNoGmReason(reply?.reason)) notify('warn', boxText('COG.LootBoxOpen.Refused'));
    return { failed: { error: reply?.reason ?? 'error' } };
  };
  let sent = await ask(payload);
  if (sent.failed) return sent.failed;
  let result = sent.result;
  for (let round = 0; round < PICKER_ROUNDS && result.error === 'needs-choices' && interactive; round += 1) {
    const picks = await promptChoicePicks(lootBoxChoicePickerSpec(actor, result, { stale: round > 0 }));
    if (!picks) return { error: 'cancelled' };
    answers = sanitizeLootBoxChoices({ ...answers, ...picks });
    sent = await ask({ ...payload, choices: answers });
    if (sent.failed) return sent.failed;
    result = sent.result;
  }
  if (result.error) {
    if (result.error === 'no-boxes') notify('info', boxText('COG.LootBoxOpen.NoBoxes', { name: actor.name ?? '' }));
    return result;
  }
  if (show) await showLootBoxReveals(result);
  return result;
}
