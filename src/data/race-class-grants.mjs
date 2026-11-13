/**
 * Sprinter RPG - Race & Class grant helpers
 * The per-kind profile and the stage functions `COGRaceClassApplier.applyKind` runs for a race or a class: grant
 * document resolution, choice resolution, skill / spell grants, the embedded race / class item and its applied record.
 * Stages take the applier as an argument (it is where tests patch `findRace`, `promptChoicesDialog` and the like),
 * so this module never imports it.
 */

import { catalogEntries } from '../content/catalog-lookup.mjs';
import { contentRegistry } from '../content/registry.mjs';
import { SYSTEM_ID } from '../constants.mjs';
import { normalizeBaseDamage } from '../utils/damage/base-damage.mjs';
import { normalizeTiming } from '../utils/time/timing.mjs';
import { cleanRankLimits } from '../utils/skill/advancement-routes.mjs';
import { isSameOwnedEntry } from '../utils/character/owned-entry.mjs';
import { landItems } from '../utils/content-source.mjs';
import { isEffectItem } from '../utils/document-types.mjs';

/** The cooldown a merged skill row carries: the row's own when it has one, else the catalog skill's, else none. */
const pickCooldown = (own, fallback) => (normalizeTiming(own).unit ? own : (normalizeTiming(fallback).unit ? fallback : { value: 0, unit: '' }));

/**
 * All Item compendiums: the registry's content packs first by priority (an imported Sourcery pack, then a content
 * module's, then the bundled one), so the hydrated copy of a document wins over the redacted bundled copy. The rest follow,
 * the system's own before others, so a duplicate identifier resolves the same way every time.
 * @returns {object[]}
 */
function itemPacks() {
  const packs = Array.from(globalThis.game?.packs?.values?.() || [])
    .filter(pack => (pack.documentName || pack.metadata?.type || pack.metadata?.entity) === 'Item');
  const idOf = (pack) => String(pack.collection || pack.metadata?.id || '');
  const own = (pack) => idOf(pack).startsWith(`${SYSTEM_ID}.`);
  const rank = new Map(contentRegistry.getPackIdsByPriority().map((id, i) => [id, i]));
  const registered = packs.filter(pack => rank.has(idOf(pack))).sort((a, b) => rank.get(idOf(a)) - rank.get(idOf(b)));
  const rest = packs.filter(pack => !rank.has(idOf(pack)));
  return [...registered, ...rest.filter(own), ...rest.filter(pack => !own(pack))];
}

/**
 * The compendium document whose `system.identifier` is `identifier`, found through each pack's
 * index (never by loading every document).
 * @param {string} identifier
 * @param {string} [expectedType]
 * @returns {Promise<{pack: object, entry: object}|null>}
 */
async function findPackIndexEntry(identifier, expectedType) {
  for (const pack of itemPacks()) {
    let index;
    try {
      index = await pack.getIndex({ fields: ['system.identifier'] });
    } catch (_) {
      index = pack.index;
    }
    const entries = index?.values ? Array.from(index.values()) : Array.from(index || []);
    const entry = entries.find(e => e?.system?.identifier === identifier && (!expectedType || !e.type || e.type === expectedType));
    if (entry) return { pack, entry };
  }
  return null;
}

/** The compendium document whose `system.identifier` is `identifier`; loads only the one matching document. */
async function findPackDocumentByIdentifier(identifier, expectedType) {
  const found = await findPackIndexEntry(identifier, expectedType);
  if (!found) return null;
  return (await found.pack.getDocument?.(found.entry._id ?? found.entry.id)) ?? null;
}

/**
 * The name of the item a grant row references, for display only. Same lookup order as {@link resolveGrantDocument},
 * but a compendium match reads the name from the pack index instead of loading the full document.
 * @param {{uuid?: string, identifier?: string}} grant
 * @param {'skill'|'spell'} [expectedType]
 * @returns {Promise<string>} The name, or '' when nothing resolves
 */
export async function resolveGrantName(grant, expectedType) {
  if (!grant || typeof grant !== 'object') return '';
  const uuid = typeof grant.uuid === 'string' ? grant.uuid.trim() : '';
  if (uuid && typeof globalThis.fromUuidSync === 'function') {
    let hit = null;
    try { hit = globalThis.fromUuidSync(uuid); } catch (_) { /* falls through to the full lookup */ }
    if (hit?.name && (!expectedType || !hit.type || hit.type === expectedType)) return hit.name;
  }
  const identifier = typeof grant.identifier === 'string' ? grant.identifier.trim() : '';
  if (!uuid && identifier) {
    const world = Array.from(globalThis.game?.items ?? []);
    const worldDoc = world.find(i => i?.system?.identifier === identifier && (!expectedType || !i.type || i.type === expectedType));
    if (worldDoc) return worldDoc.name || '';
    const found = await findPackIndexEntry(identifier, expectedType);
    if (found?.entry?.name) return found.entry.name;
  }
  return (await resolveGrantDocument(grant, expectedType))?.name || '';
}

/**
 * Resolves the item document a typed grant row references. Resolution is by reference only; names
 * are never matched.
 * 1. `grant.uuid` through `fromUuid`.
 * 2. `grant.identifier` against `system.identifier` on world items, then each Item compendium's index
 *    (the system's packs first), then the bundled catalogs.
 *
 * @param {{uuid?: string, identifier?: string}} grant
 * @param {'skill'|'spell'} [expectedType]
 * @returns {Promise<object|null>} The resolved item document or catalog entry, or null
 */
export async function resolveGrantDocument(grant, expectedType) {
  if (!grant || typeof grant !== 'object') return null;

  const uuid = typeof grant.uuid === 'string' ? grant.uuid.trim() : '';
  if (uuid && typeof globalThis.fromUuid === 'function') {
    let doc = null;
    try { doc = await globalThis.fromUuid(uuid); } catch (_) { /* unresolvable uuid falls through to identifier */ }
    if (doc && (!expectedType || !doc.type || doc.type === expectedType)) return doc;
  }

  const identifier = typeof grant.identifier === 'string' ? grant.identifier.trim() : '';
  if (!identifier) return null;

  const world = Array.from(globalThis.game?.items ?? []);
  const worldDoc = world.find(i => i?.system?.identifier === identifier && (!expectedType || !i.type || i.type === expectedType));
  if (worldDoc) return worldDoc;

  const packDoc = await findPackDocumentByIdentifier(identifier, expectedType);
  if (packDoc) return packDoc;

  const catalog = expectedType === 'spell' ? catalogEntries('spells') : (expectedType === 'skill' ? catalogEntries('skills') : []);
  return catalog.find(d => d?.system?.identifier === identifier) || null;
}

/**
 * Resolves a typed grant row without waiting: `grant.uuid` through `fromUuidSync` (an unloaded compendium document
 * does not resolve), else `grant.identifier` against world items, then the bundled catalogs. A pack document is only
 * found by the async {@link resolveGrantDocument}; {@link prefetchGrantDocuments} runs that ahead of a plan.
 * @param {{uuid?: string, identifier?: string}} grant
 * @param {'skill'|'spell'} [expectedType]
 * @returns {object|null}
 */
export function resolveGrantDocumentSync(grant, expectedType) {
  if (!grant || typeof grant !== 'object') return null;
  const uuid = typeof grant.uuid === 'string' ? grant.uuid.trim() : '';
  if (uuid && typeof globalThis.fromUuidSync === 'function') {
    let doc = null;
    try { doc = globalThis.fromUuidSync(uuid); } catch (_) { /* falls through to the identifier */ }
    if (doc && (!expectedType || !doc.type || doc.type === expectedType)) return doc;
  }
  const identifier = typeof grant.identifier === 'string' ? grant.identifier.trim() : '';
  if (!identifier) return null;
  const world = Array.from(globalThis.game?.items ?? []);
  const worldDoc = world.find(i => i?.system?.identifier === identifier && (!expectedType || !i.type || i.type === expectedType));
  if (worldDoc) return worldDoc;
  const catalog = expectedType === 'spell' ? catalogEntries('spells') : (expectedType === 'skill' ? catalogEntries('skills') : []);
  return catalog.find(d => d?.system?.identifier === identifier) || null;
}

const lookupKey = (row, itemType) => `${itemType ?? ''}|${String(row?.uuid ?? '').trim()}|${String(row?.identifier ?? '').trim()}`;

/**
 * Resolves every `{ row, itemType }` the planner will look up, with the async {@link resolveGrantDocument} (world items,
 * then the pack indexes, then the catalog), and returns the sync `lookup(row, itemType)` the planner takes. A row that
 * was not prefetched falls back to {@link resolveGrantDocumentSync} and is recorded in `lookup.misses`.
 * @param {Array<{row: object, itemType: 'skill'|'spell'}>} wanted
 * @returns {Promise<((row: object, itemType: string) => object|null) & {misses: string[]}>}
 */
export async function prefetchGrantDocuments(wanted) {
  const found = new Map();
  for (const { row, itemType } of wanted || []) {
    const key = lookupKey(row, itemType);
    if (!found.has(key)) found.set(key, (await resolveGrantDocument(row, itemType)) ?? null);
  }
  const lookup = (row, itemType) => {
    const key = lookupKey(row, itemType);
    if (found.has(key)) return found.get(key);
    lookup.misses.push(key);
    return resolveGrantDocumentSync(row, itemType);
  };
  lookup.misses = [];
  return lookup;
}

/** The skill / spell data a grant row creates: `resolvedSys` is the resolved document's system data. */
export const GRANT_SYSTEM = {
  skill: (s, resolvedSys) => ({
    ...resolvedSys,
    rank: s.rank ?? resolvedSys.rank ?? 1,
    stat: s.stat || resolvedSys.stat || 'str',
    checkType: s.checkType || resolvedSys.checkType || 'stat',
    checkNote: s.checkNote ?? resolvedSys.checkNote ?? '',
    baseDamage: normalizeBaseDamage(s.baseDamage?.dice ? s.baseDamage : resolvedSys.baseDamage),
    rankLimits: cleanRankLimits(s.rankLimits !== undefined ? s.rankLimits : resolvedSys.rankLimits),
    cooldown: pickCooldown(s.cooldown, resolvedSys.cooldown),
    notes: s.notes || resolvedSys.notes || '',
    upgrades: s.upgrades || resolvedSys.upgrades || ''
  }),
  spell: (sp, resolvedSys) => ({
    ...resolvedSys,
    rank: sp.rank ?? resolvedSys.rank ?? 1,
    stat: sp.stat || resolvedSys.stat || 'int',
    manaCost: (sp.mpCost ? sp.mpCost : resolvedSys.manaCost) ?? 0,
    range: sp.range || resolvedSys.range || 'Self',
    duration: sp.duration || resolvedSys.duration || 'Instantaneous',
    checkType: sp.checkType || resolvedSys.checkType || 'attack',
    description: sp.description || resolvedSys.description || '',
    baseDamage: normalizeBaseDamage(sp.baseDamage?.dice ? sp.baseDamage : resolvedSys.baseDamage)
  })
};

/** Image a granted item gets when neither its resolved document nor its grant row names one. */
export const GRANT_DEFAULT_IMG = { skill: 'icons/svg/sword.svg', spell: 'icons/svg/lightning.svg' };

/**
 * What differs between applying a race and applying a class. `find` / `parse` / `remove` take the applier so a test
 * that patches `COGRaceClassApplier.findRace` (and the rest) is seen.
 */
export const RACE_CLASS_KINDS = {
  race: {
    label: 'Race',
    detailsKey: 'race',
    flagKey: 'appliedRace',
    markerFlag: 'isAppliedRace',
    createdKey: 'createdByRace',
    itemType: 'race',
    defaultImg: 'icons/svg/mystery-man.svg',
    hasSize: true,
    find: (applier, id, actor, options) => applier.findRace(id, { actor, ...options }),
    parse: (applier, def) => applier.parseRaceBonuses(def),
    remove: (applier, actor) => applier.removeRace(actor),
    itemSystem: (bonuses) => ({
      heritage: bonuses.heritage,
      size: bonuses.size,
      drBonus: bonuses.drBonus,
      movement: bonuses.movement
    })
  },
  class: {
    label: 'Class',
    detailsKey: 'class',
    flagKey: 'appliedClass',
    markerFlag: 'isAppliedClass',
    createdKey: 'createdByClass',
    itemType: 'class',
    defaultImg: 'icons/svg/book.svg',
    hasSize: false,
    find: (applier, id) => applier.findClass(id),
    parse: (applier, def) => applier.parseClassBonuses(def),
    remove: (applier, actor) => applier.removeClass(actor),
    itemSystem: (bonuses) => ({
      archetypes: bonuses.archetypes,
      drBonus: bonuses.drBonus,
      movement: bonuses.movement
    })
  }
};

/**
 * Whether a race or class apply may open its choice and stat pool dialogs: an explicit `interactive: false` never does
 * (a headless re-apply, a floor simulation), `interactive: true` always does, and with neither it does when a browser
 * document exists and `skipDialog` is not set.
 * @param {{ interactive?: boolean, skipDialog?: boolean }} [options]
 * @returns {boolean}
 */
export function mayOpenDialogs(options = {}) {
  if (options.interactive === false) return false;
  return Boolean(options.interactive || (typeof document !== 'undefined' && !options.skipDialog));
}

/**
 * What a granted effect's item gets on top of its stored copy: a racial or class trait does not wear off, so it is
 * untimed (and a buff is on). This overrides a catalog buff's own timer. A debuff has no `active` field.
 */
export const GRANTED_EFFECT_STATE = Object.freeze({
  buff: Object.freeze({
    active: true,
    duration: 'Permanent',
    durationConfig: Object.freeze({ type: 'permanent', value: 0, scaleBy: null, endsWithCombat: false, remainingRounds: 0, expiresAt: null })
  }),
  debuff: Object.freeze({
    duration: 'Permanent',
    durationConfig: Object.freeze({ type: 'permanent', value: 0, scaleBy: null, endsWithCombat: false, remainingRounds: 0, expiresAt: null })
  })
});

/** The creates of a plan that make up one write call, in write order: skills, spells, granted effects, the race or class item, starting items. */
function createGroups(plan) {
  const startingOf = (d) => Boolean(d?.flags?.[SYSTEM_ID]?.startingItemOf);
  const creates = plan.itemCreates || [];
  const pick = (test) => creates.filter(test);
  return [
    pick(d => d.type === 'skill' && !startingOf(d)),
    pick(d => d.type === 'spell' && !startingOf(d)),
    pick(d => isEffectItem(d) && !startingOf(d)),
    pick(d => d.type === RACE_CLASS_KINDS[plan.kind].itemType && !startingOf(d)),
    pick(startingOf)
  ].filter(group => group.length > 0);
}

/**
 * The thin writer for a {@link KindPlan}: the rank updates of items the actor already had, the creates (one call for the
 * skills, one for the spells, one for the granted effects, one for the race or class item, each with the planned ids),
 * the applied-record flag, then one actor update. The removal that comes before it is not part of the plan.
 * If Foundry returns another item than a planned create (a duplicate its own dedupe caught), the record's ids are
 * patched to the item that is really there and a warning is shown.
 * @param {object} actor
 * @param {object} plan a plan from `planRaceClassKind`
 * @returns {Promise<void>}
 */
export async function writeKindPlan(actor, plan, { allowOffTheme = false, createOptions = {} } = {}) {
  const profile = RACE_CLASS_KINDS[plan.kind];
  for (const update of plan.itemUpdates || []) {
    const item = actor.items?.get(update._id);
    await item?.update?.({ 'system.rank': update['system.rank'] });
  }

  const idMap = new Map();
  if (typeof actor.createEmbeddedDocuments === 'function') {
    for (const group of createGroups(plan)) {
      // What the grants name from a turned-off theme arrives as Celestial AI Poop (it keeps the planned id); the race or
      // class item itself is the player's explicit pick, and a restore passes `allowOffTheme`.
      const lands = allowOffTheme || group.some(d => d.type === profile.itemType) ? group : landItems(group);
      const returned = Array.from(await actor.createEmbeddedDocuments('Item', lands, { keepId: true, ...createOptions }) ?? []);
      const planned = new Set(group.map(d => d._id));
      const strays = returned.filter(doc => !planned.has(doc?.id));
      for (const data of group) {
        if (returned.some(doc => doc?.id === data._id)) continue;
        const stand = strays.find(doc => isSameOwnedEntry(doc, data));
        if (stand) idMap.set(data._id, stand.id);
      }
    }
  }
  if (idMap.size) {
    globalThis.ui?.notifications?.warn?.(`${plan.def?.name ?? profile.label}: some granted items already existed, so their ranks were kept.`);
  }

  const swap = (entries) => (entries || []).map(e => (idMap.has(e.id) ? { ...e, id: idMap.get(e.id) } : e));
  for (const [key, value] of Object.entries(plan.flagUpdates || {})) {
    if (typeof actor.setFlag !== 'function') break;
    const patched = key === profile.flagKey
      ? { ...value, skills: swap(value.skills), spells: swap(value.spells), itemId: idMap.get(value.itemId) ?? value.itemId }
      : value;
    await actor.setFlag(SYSTEM_ID, key, patched);
  }

  if (Object.keys(plan.actorUpdate || {}).length > 0 && typeof actor.update === 'function') {
    await actor.update(plan.actorUpdate);
  }
}

/**
 * The applied record the actor's `appliedRace` / `appliedClass` flag stores (what removal reverses).
 * @param {'race'|'class'} kind
 * @param {object} stage
 * @returns {object}
 */
export function appliedKindRecord(kind, { def, bonuses, appliedSkills, appliedSpells, resolvedChoices, embeddedId, originalSize }) {
  return {
    name: def.name,
    stats: bonuses.stats,
    drBonus: bonuses.drBonus,
    movement: bonuses.movement,
    skills: appliedSkills,
    spells: appliedSpells,
    chosenSkills: resolvedChoices.chosenSkills || [],
    chosenSpells: resolvedChoices.chosenSpells || [],
    ...(RACE_CLASS_KINDS[kind].hasSize ? { size: bonuses.size, originalSize } : {}),
    itemId: embeddedId
  };
}
