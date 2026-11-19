/**
 * The flags a race or a class leaves behind: `grantedBy` on every item it created (the value is the kind that made it,
 * `'race'` or `'class'`), `startingItemOf` on the starting items it gave, `appliedRace` / `appliedClass` on the actor (the record removal reverses)
 * and `isAppliedRace` / `isAppliedClass` on the race or class item the applier made. This module is
 * the one place that names these stored keys. A leaf: the applier, the planner, the reverter, the transformation
 * engine and the derivation models all reach it without an import cycle.
 */
import { clearFlag, readFlag, withFlags, withoutFlags } from '../flags.mjs';

const GRANTED_BY_KEY = 'grantedBy';
const STARTING_ITEM_OF_KEY = 'startingItemOf';
const APPLIED_RACE_KEY = 'appliedRace';
const APPLIED_CLASS_KEY = 'appliedClass';
/** The marker on the race or class item an applier made, which tells it from one a GM dragged in. */
const APPLIED_RACE_MARKER_KEY = 'isAppliedRace';
const APPLIED_CLASS_MARKER_KEY = 'isAppliedClass';

/** The kind (`'race'` or `'class'`) that created an item, or `undefined` when no race or class did. */
export function grantedByOf(item) {
  return readFlag(item, GRANTED_BY_KEY);
}

/** `data` stamped as created by a race or a class (`kind`). A copy. */
export function withGrantedBy(data, kind) {
  return withFlags(data, { [GRANTED_BY_KEY]: kind });
}

/** Remove the stamp that says a race or a class created an item. */
export function clearGrantedBy(item) {
  return clearFlag(item, GRANTED_BY_KEY);
}

/** `data` stamped as a starting item given by the race or class recorded under `sourceKey`. A copy. */
export function withStartingItemOf(data, sourceKey) {
  return withFlags(data, { [STARTING_ITEM_OF_KEY]: sourceKey });
}

/** Whether an item's data says a race or a class gave it as a starting item. */
export function isStartingItem(data) {
  return Boolean(readFlag(data, STARTING_ITEM_OF_KEY));
}

/** `data` (a race or class item) marked as made by the applier for `kind`. A copy. */
export function withAppliedMarker(data, kind) {
  return withFlags(data, kind === 'race' ? { [APPLIED_RACE_MARKER_KEY]: true } : { [APPLIED_CLASS_MARKER_KEY]: true });
}

/** `data` (a race or class item) without the applier's marker for `kind`. A copy. */
export function withoutAppliedMarker(data, kind) {
  return kind === 'race' ? withoutFlags(data, [APPLIED_RACE_MARKER_KEY]) : withoutFlags(data, [APPLIED_CLASS_MARKER_KEY]);
}

/** The stored key of the applied record of a kind (`'appliedRace'` for `'race'`); `undefined` for any other kind. */
export function appliedFlagKey(kind) {
  if (kind === 'race') return APPLIED_RACE_KEY;
  return kind === 'class' ? APPLIED_CLASS_KEY : undefined;
}

/**
 * The record the applier stored for a race or a class (`'race'` | `'class'`), or `undefined`. Reads an actor or a plain
 * view that has `flags` and no `getFlag`.
 */
export function appliedRecordOf(actor, kind) {
  if (kind === 'race') return readFlag(actor, APPLIED_RACE_KEY);
  return kind === 'class' ? readFlag(actor, APPLIED_CLASS_KEY) : undefined;
}

/** Remove the applied record of a kind from an actor. */
export function clearAppliedRecord(actor, kind) {
  if (kind === 'race') return clearFlag(actor, APPLIED_RACE_KEY);
  return kind === 'class' ? clearFlag(actor, APPLIED_CLASS_KEY) : Promise.resolve(undefined);
}
