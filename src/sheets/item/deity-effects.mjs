/**
 * The deity sheet's effect editor: the buffs and debuffs a god hands out (`signatureEffects`) and per worship tier
 * (`tierEffects`). Each entry is a frozen copy of the buff or debuff, `{ type, name, img, system, tier? }`, the shape a race
 * or class keeps its granted effects in. Handlers run with `this` = the item sheet.
 */
import { grantedEffectErrors } from '../../models/items/grant-validation.mjs';
import { getAvailableBuffs, getAvailableDebuffs } from './catalogs.mjs';
import { EFFECT_ITEM_TYPES } from '../../utils/document-types.mjs';

/** The effect lists of a deity, as the sheet names them. */
const LISTS = Object.freeze({ signature: 'signatureEffects', tier: 'tierEffects' });
const TIERS = Object.freeze({ min: 1, max: 3 });
const EFFECT_TYPES = EFFECT_ITEM_TYPES;

const notify = (level, key, fallback, data) => {
  const i18n = globalThis.game?.i18n;
  const text = i18n?.has?.(key) ? i18n.format(key, data) : fallback;
  globalThis.ui?.notifications?.[level]?.(text);
};

/** A document's (or a catalog row's) system data as plain data. */
function systemOf(doc) {
  const sys = doc?.system;
  if (typeof sys?.toObject === 'function') return sys.toObject();
  return sys && typeof sys === 'object' ? structuredClone(sys) : {};
}

const storedList = (item, key) => (Array.isArray(item.system?.[key]) ? item.system[key].map((entry) => foundry.utils.deepClone(entry)) : []);

/**
 * Add a buff or debuff to a deity's signature effects or to one worship tier. An entry that is not a buff or a debuff,
 * or that has no name or identifier, is refused with a notification. A signature list holds one buff and one debuff, so
 * a second of the same type replaces the first.
 * @param {object} item the deity item
 * @param {object} effectDoc a buff or debuff item, or a catalog row of one
 * @param {{ list: 'signature'|'tier', tier?: number }} target
 * @returns {Promise<boolean>} true when the item changed
 */
async function addDeityEffect(item, effectDoc, { list, tier = TIERS.min } = {}) {
  const key = LISTS[list];
  if (!key) return false;
  const entry = { type: effectDoc?.type, name: String(effectDoc?.name ?? ''), img: String(effectDoc?.img ?? ''), system: systemOf(effectDoc) };
  const errors = grantedEffectErrors(entry);
  if (errors.length) {
    notify('warn', 'COG.Deity.Sheet.EffectRefused', `Not added: ${errors.join('; ')}`, { reason: errors.join('; ') });
    return false;
  }
  const entries = storedList(item, key);
  if (list === 'tier') {
    entries.push({ ...entry, tier: Math.min(TIERS.max, Math.max(TIERS.min, Math.round(Number(tier) || TIERS.min))) });
  } else {
    const at = entries.findIndex((e) => e.type === entry.type);
    if (at >= 0) entries[at] = entry; else entries.push(entry);
  }
  await item.update({ [`system.${key}`]: entries });
  return true;
}

/** Remove the entry at `index` from a list. */
async function removeDeityEffect(item, list, index) {
  const key = LISTS[list];
  const entries = storedList(item, key);
  if (!key || !Number.isInteger(index) || index < 0 || index >= entries.length) return false;
  entries.splice(index, 1);
  await item.update({ [`system.${key}`]: entries });
  return true;
}

/** Move a tier entry to `tier`, held between the lowest and the highest tier. */
async function setDeityEffectTier(item, index, tier) {
  const entries = storedList(item, LISTS.tier);
  if (!Number.isInteger(index) || index < 0 || index >= entries.length) return false;
  const next = Math.min(TIERS.max, Math.max(TIERS.min, Math.round(Number(tier) || TIERS.min)));
  if (entries[index].tier === next) return false;
  entries[index].tier = next;
  await item.update({ [`system.${LISTS.tier}`]: entries });
  return true;
}

/**
 * A buff or debuff dropped on a zone (`data-deity-drop`: `signature`, or a tier number). Anything else, or a drop
 * outside a zone, adds nothing.
 */
export async function dropDeityEffect(item, effectDoc, zone) {
  if (!EFFECT_TYPES.includes(effectDoc?.type)) return false;
  if (zone === 'signature') return addDeityEffect(item, effectDoc, { list: 'signature' });
  const tier = Number(zone);
  return Number.isInteger(tier) && tier >= TIERS.min && tier <= TIERS.max ? addDeityEffect(item, effectDoc, { list: 'tier', tier }) : false;
}

/** The catalog row a select names (`<type>:<id>`) among the sheet's buffs and debuffs. */
async function chosenEffect(value) {
  const [type, ...rest] = String(value ?? '').split(':');
  const id = rest.join(':');
  const rows = type === 'buff' ? await getAvailableBuffs() : type === 'debuff' ? await getAvailableDebuffs() : [];
  return rows.find((row) => row.id === id) ?? null;
}

export const DEITY_EFFECT_ACTIONS = {
  /** Change action on an unnamed select (`data-zone`: `signature` or a tier number; option values are `<type>:<id>`). */
  async addDeityEffect(event, target) {
    if (!this.isEditable) return;
    const effect = await chosenEffect(target?.value);
    if (effect) await dropDeityEffect(this.item, effect, target.dataset.zone);
    if (target) target.value = '';
  },
  async removeDeityEffect(event, target) {
    if (!this.isEditable) return;
    await removeDeityEffect(this.item, target.dataset.list, Number(target.dataset.index));
  },
  async deityEffectTierUp(event, target) {
    if (!this.isEditable) return;
    const index = Number(target.dataset.index);
    await setDeityEffectTier(this.item, index, Number(this.item.system?.tierEffects?.[index]?.tier) + 1);
  },
  async deityEffectTierDown(event, target) {
    if (!this.isEditable) return;
    const index = Number(target.dataset.index);
    await setDeityEffectTier(this.item, index, Number(this.item.system?.tierEffects?.[index]?.tier) - 1);
  }
};
