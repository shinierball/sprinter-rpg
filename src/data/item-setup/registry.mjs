/**
 * src/data/item-setup/registry.mjs
 * The item setup modal's kinds. Each kind registers itself from its own file under `kinds/` (as rule files call
 * `registerItemRule` and row kinds call `registerRowKind`), so a step that changes one kind's questions touches only that
 * kind's file. A kind is data: `{ id, icon, order, createType?, studio?, fields?, start?, toSpec? }`. Pure.
 */

/** Where a kind with no `order` sorts: after every numbered one. */
const LAST = Number.MAX_SAFE_INTEGER;

/** @type {Map<string, object>} */
const KINDS = new Map();

/**
 * Add or replace a kind. A def with no id or icon, or a studio kind that also has fields, is refused (a studio asks nothing).
 * @param {{ id: string, icon: string, order?: number, createType?: string, studio?: string, fields?: ReadonlyArray<object>, start?: Function, toSpec?: Function }} def
 * @throws {Error}
 */
export function registerSetupKind(def) {
  if (typeof def?.id !== 'string' || !def.id.trim()) throw new Error('registerSetupKind: a kind needs an id');
  if (typeof def.icon !== 'string' || !def.icon.trim()) throw new Error(`registerSetupKind: kind "${def.id}" needs an icon`);
  if (def.studio && Array.isArray(def.fields) && def.fields.length) {
    throw new Error(`registerSetupKind: kind "${def.id}" has a studio, so it asks no fields`);
  }
  KINDS.set(def.id, Object.freeze({ ...def, order: Number.isFinite(def.order) ? def.order : LAST }));
}

/** @param {string} id @returns {object|null} the registered def */
export function setupKindDef(id) {
  return KINDS.get(id) ?? null;
}

/** @returns {object[]} every registered kind, sorted by `order` */
export function registeredSetupKinds() {
  return [...KINDS.values()].sort((a, b) => a.order - b.order);
}
