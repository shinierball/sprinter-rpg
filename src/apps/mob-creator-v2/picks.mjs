/**
 * The glue every stage of the new Mob Creator shares for documents that already exist: open a catalog manager in pick mode,
 * take a dropped item, open the item setup page for a new one, and hand plain creation data to the draft. The draft below the
 * layering line never sees a document, a manager or the setup page; this file is the only one that imports them (the setup
 * page lazily, since it reaches the item sheets, which reach the managers).
 */
import { COGBuffDebuffManager } from '../buff-manager.mjs';
import { COGItemManager } from '../item-manager.mjs';
import { COGSkillManager } from '../skill-manager.mjs';
import { COGSpellManager } from '../spell-manager.mjs';
import { resolveFullItemData } from '../../content/catalog-source.mjs';
import { dropCreateData } from '../../sheets/crawler/drop.mjs';
import { tr } from './words.mjs';

const WORDS = 'COG.MobCreator.Picks';

/** The manager and its starting options for each kind a GM can pick: `[Manager, options]`. */
const MANAGERS = Object.freeze({
  spell: [COGSpellManager, {}],
  buff: [COGBuffDebuffManager, { activeTab: 'buffs' }],
  skill: [COGSkillManager, {}],
  weapon: [COGItemManager, { activeCategory: 'weapons' }],
  item: [COGItemManager, {}]
});

const notify = (level, message) => globalThis.ui?.notifications?.[level]?.(message);
const isWeapon = (data) => data?.type === 'gear' && Boolean(data.system?.isWeapon);

/**
 * Add a document's creation data to the draft: a weapon equipped and, when it has no Base Damage of its own and the mob
 * owns none of its listed Skills, with the first of those the Skill catalog has (the Skill's Rank starts where the draft says);
 * anything else as it is. A duplicate is refused with a note.
 * @param {import('../../data/mob-creator/draft.mjs').MobDraft} draft
 * @param {object} data creation data of an item
 * @returns {Promise<{ added: boolean, reason?: string, index?: number, skillAdded?: boolean }>}
 */
async function addDocument(draft, data) {
  let result;
  if (isWeapon(data)) {
    const need = draft.weaponSkillNeed(data);
    const skill = need?.definition ? await resolveFullItemData(need.definition, 'skills') : null;
    result = draft.addWeapon(data, skill);
  } else {
    result = draft.addPicked(data);
  }
  if (result.reason === 'duplicate') notify('info', tr(`${WORDS}.Duplicate`, { name: data.name }));
  else if (result.reason === 'invalid') notify('warn', tr(`${WORDS}.Invalid`, { name: data?.name ?? '' }));
  return result;
}

/**
 * Open the catalog manager of a kind in pick mode: its Add buttons hand the full document to the draft, and it stays open for
 * more. Rows already picked are marked.
 * @param {'spell'|'buff'|'skill'|'weapon'|'item'} kind
 * @param {import('../../data/mob-creator/draft.mjs').MobDraft} draft
 * @param {() => void} [after] runs after each pick (the stage shows it)
 */
export function openPicker(kind, draft, after) {
  const [Manager, options] = MANAGERS[kind];
  const manager = new Manager({
    ...options,
    onPick: async (data) => {
      await addDocument(draft, data);
      after?.();
    },
    picked: () => draft.spec.items
  });
  return manager.render({ force: true });
}

/** The Item a drag event carries, as a document (a uuid or inline data), or null. */
const defaultResolve = (data) => globalThis.Item?.implementation?.fromDropData?.(data) ?? null;

/**
 * Take an item dropped on the creator (from a compendium, the sidebar or a mob's sheet): a copy with its source link goes to
 * the draft. Drops that are not items are ignored.
 * @param {import('../../data/mob-creator/draft.mjs').MobDraft} draft
 * @param {object} dragData the parsed drag payload
 * @param {{ resolve?: (data: object) => Promise<object|null> }} [options] `resolve` turns the payload into an item document
 * @returns {Promise<{ added: boolean, reason?: string }|null>} null when the drop was not an item
 */
export async function dropOnto(draft, dragData, { resolve = defaultResolve } = {}) {
  if (dragData?.type !== 'Item') return null;
  const item = await resolve(dragData);
  if (!item) return null;
  return addDocument(draft, dropCreateData(item));
}

/**
 * Make a new item of a kind on the item setup page: it is created in the world the normal way and a copy goes to the draft.
 * @param {'spell'|'buff'|'skill'|'weapon'|'loot'} kind the setup page's kind
 * @param {import('../../data/mob-creator/draft.mjs').MobDraft} draft
 * @param {() => void} [after]
 */
export async function createNew(kind, draft, after) {
  const { COGItemSetupApp } = await import('../item-setup-app.mjs');
  return COGItemSetupApp.open({
    kind,
    onCreated: async (item) => {
      await addDocument(draft, dropCreateData(item));
      after?.();
    }
  });
}
