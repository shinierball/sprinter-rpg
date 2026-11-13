/**
 * Sprinter RPG - Transformation engine.
 *
 * An affliction (a debuff with a `transform` block) changes its victim by laying an **overlay** over them: the
 * original race item stays embedded and `appliedRace` stays as written; the form race item is embedded beside it,
 * flagged `transformationOf`, and derivation reads it instead (`raceInForce`, `models/actors/transform-overlay.mjs`).
 * Nothing the original race wrote is touched, so the revert is deleting what the change created and unpausing what it
 * paused. Only a person fires a change (589 d); there is no timer.
 *
 * Writes are ordered so that nothing is written before every prompt is answered and every document is resolved.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { COGRaceClassApplier } from '../../data/race-class-applier.mjs';
import { planRaceClassKind, raceClassView, prefetchKindDocuments } from '../../data/race-class-plan.mjs';
import { findCatalogEntry } from '../../content/catalog-lookup.mjs';
import { getCurrentFloor } from '../../utils/floor/current-floor.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { transformText } from '../../utils/character/transform-text.mjs';
import { carrySourceStamp, landItems } from '../../utils/content-source.mjs';
import { calculateItemHandsRequired } from '../../utils/gear/wielding.mjs';
import {
  isAffliction, afflictionStage, transformState, formAt, formEntries, overlayOf as overlayOfItems, transformationOfItem, heldByCure
} from '../../utils/character/transform-rules.mjs';
import { reveal } from '../pending-secrets.mjs';
import { syncTokenVision } from './actor-vision.mjs';
import { isEffectItem } from '../../utils/document-types.mjs';
import { clearFlag } from '../../utils/flags.mjs';

const FLAG = 'transformation';
const PERMANENT = Object.freeze({ type: 'permanent', value: 0, scaleBy: null, endsWithCombat: false, remainingRounds: 0, expiresAt: null });

/** Actors a transformation is writing right now (a counter per actor id, since the calls nest). */
const working = new Map();

async function whileTransforming(actor, fn) {
  const id = actor?.id;
  if (id) working.set(id, (working.get(id) ?? 0) + 1);
  try {
    return await fn();
  } finally {
    if (id) {
      const left = (working.get(id) ?? 1) - 1;
      if (left > 0) working.set(id, left); else working.delete(id);
    }
    // The item hooks sync vision while the affliction is still pending, so a form's senses count only from here
    if (!isTransforming(actor)) await syncVision(actor);
  }
}

async function syncVision(actor) {
  try {
    await syncTokenVision(actor);
  } catch (err) {
    console.warn('Sprinter RPG | Could not sync token vision after a transformation:', err);
  }
}

/** Whether this client is in the middle of writing a transformation on the actor (the delete hook stays out of it). */
const isTransforming = (actor) => working.has(actor?.id);

/** The overlay of an actor: its changed affliction with a form, or null. */
export function overlayOf(actor) {
  return overlayOfItems(Array.from(actor?.items ?? []));
}

/**
 * Stamp the landing on an affliction's creation data: pending, when (world time) and on which floor.
 * @param {object} debuffData creation data (mutated)
 * @returns {object} the same data
 */
export function stampLanding(debuffData) {
  const flags = debuffData.flags ?? (debuffData.flags = {});
  const own = flags[SYSTEM_ID] ?? (flags[SYSTEM_ID] = {});
  own[FLAG] = { stage: 'pending', landedAt: Number(globalThis.game?.time?.worldTime) || 0, landedFloor: getCurrentFloor() };
  return debuffData;
}

const idOf = (doc) => doc?.id ?? doc?._id ?? '';

const cleanClone = (value) => {
  try { return structuredClone(value); } catch { return JSON.parse(JSON.stringify(value)); }
};

/** A plain confirmation (never a Rule Break). Headless, with no dialog API, it proceeds. */
async function confirmPlain(message, options = {}) {
  if (options.confirm === false) return true;
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.confirm !== 'function') return true;
  try {
    return Boolean(await DialogV2.confirm({ window: { title: 'Transformation' }, content: `<p>${message}</p>`, modal: true }));
  } catch {
    return false;
  }
}

async function postCard(actor, lines) {
  const ChatMessage = globalThis.ChatMessage;
  if (typeof ChatMessage?.create !== 'function') return;
  try {
    const content = lines.map((line) => `<p>${line}</p>`).join('');
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker?.({ actor }), content });
  } catch (err) {
    console.warn('Sprinter RPG | Could not post the transformation card:', err);
  }
}

/** Equipped items held in hands that no longer fit once the body has changed (D6: listed, never unequipped). */
function misfits(actor) {
  const limbs = actor.system?.attributes?.limbs;
  if (!limbs?.exceededHands) return [];
  return Array.from(actor.items ?? []).filter((i) => calculateItemHandsRequired(i) > 0).map((i) => i.name);
}

const writeState = (affliction, state) => affliction.setFlag(SYSTEM_ID, FLAG, state);

const formLabel = (affliction, index, def) => formAt(affliction, index)?.label || def?.name || 'a new form';

/**
 * The creation data of a form: its race item, its traits and the skills and spells the victim does not own, all flagged
 * `transformationOf`. Planned by the race planner with the starting items, floor gate and prerequisites left out;
 * ranks of skills the victim owns are NOT written (the form's fixed rows raise them in derivation).
 */
function planForm(actor, affliction, def, selections, lookup) {
  const view = raceClassView(actor);
  // The original race's traits would hide a form trait with the same identifier; the form brings its own.
  view.items = view.items.filter((i) => !(isEffectItem(i) && i.flags?.[SYSTEM_ID]?.grantedBy === 'race'));
  const plan = planRaceClassKind(view, 'race', def, selections, { lookup, worldFloor: getCurrentFloor(), startingItems: false });
  const owner = idOf(affliction);
  const creates = plan.itemCreates.map((data) => {
    const own = { ...(data.flags?.[SYSTEM_ID] ?? {}), transformationOf: owner };
    if (data.type === 'race') delete own.isAppliedRace;
    return { ...data, flags: { ...(data.flags ?? {}), [SYSTEM_ID]: own } };
  });
  return { plan, creates };
}

/** Create the planned documents (an off theme arrives as its replacement, which keeps the flag and the id). */
async function createForm(actor, creates) {
  const landed = landItems(creates).map((data, i) => (data === creates[i] ? data : {
    ...data,
    _id: creates[i]._id,
    flags: { ...(data.flags ?? {}), [SYSTEM_ID]: { ...(data.flags?.[SYSTEM_ID] ?? {}), transformationOf: creates[i].flags[SYSTEM_ID].transformationOf } }
  }));
  const out = Array.from(await actor.createEmbeddedDocuments('Item', landed, { keepId: true }) ?? []);
  const race = out.find((d) => d.type === 'race');
  return { formItemId: race ? idOf(race) : null, createdIds: out.filter((d) => d.type !== 'race').map(idOf) };
}

/** The original race's traits get paused (`pausedBy` names the affliction). A trait already off stays as it was. */
async function pauseOriginalTraits(actor, affliction) {
  const paused = [];
  for (const item of actor.items ?? []) {
    if (item.flags?.[SYSTEM_ID]?.grantedBy !== 'race' || transformationOfItem(item)) continue;
    if (item.flags?.[SYSTEM_ID]?.pausedBy) continue;
    if (item.type === 'buff' && item.system?.active !== false) paused.push({ item, change: { 'system.active': false } });
    else if (item.type === 'debuff' && item.system?.paused !== true) paused.push({ item, change: { 'system.paused': true } });
  }
  for (const { item, change } of paused) {
    await item.update(change);
    await item.setFlag(SYSTEM_ID, 'pausedBy', idOf(affliction));
  }
}

async function unpauseTraits(actor, afflictionId) {
  for (const item of Array.from(actor.items ?? [])) {
    if (item.flags?.[SYSTEM_ID]?.pausedBy !== afflictionId) continue;
    await item.update(item.type === 'buff' ? { 'system.active': true } : { 'system.paused': false });
    await item.setFlag(SYSTEM_ID, 'pausedBy', '');
  }
}

/** A buff or debuff by reference: the catalog, then the world's items. As creation data, or null. */
function resolveEffect(ref) {
  const debuff = findCatalogEntry('debuffs', ref);
  const buff = debuff ? null : findCatalogEntry('buffs', ref);
  let def = debuff ?? buff;
  let type = debuff ? 'debuff' : 'buff';
  if (!def) {
    const world = [...(globalThis.game?.items ?? [])].find((i) => isEffectItem(i)
      && (i.id === ref || i.uuid === ref || i.system?.identifier === ref));
    if (world) { def = world.toObject ? world.toObject() : world; type = world.type; }
  }
  if (!def) return null;
  const system = cleanClone(def.system ?? {});
  system.duration = 'Permanent';
  system.durationConfig = cleanClone(PERMANENT);
  if (type === 'buff') system.active = true;
  const data = { name: def.name, type, img: def.img, system, flags: {} };
  return carrySourceStamp(data, def);
}

/** Create the affliction's added effects the victim lacks. Returns the new ids and the names skipped. */
async function addEffects(actor, affliction) {
  const refs = (affliction.system?.transform?.effects ?? []).map(String);
  const owner = idOf(affliction);
  const data = [];
  const skipped = [];
  for (const ref of refs) {
    const effect = resolveEffect(ref);
    if (!effect) { skipped.push(`${ref} (not found)`); continue; }
    const identifier = effect.system?.identifier;
    const owned = identifier && Array.from(actor.items ?? []).some((i) => i.type === effect.type && i.system?.identifier === identifier);
    if (owned) { skipped.push(`${effect.name} (already there)`); continue; }
    effect.flags = { ...effect.flags, [SYSTEM_ID]: { ...(effect.flags?.[SYSTEM_ID] ?? {}), transformationOf: owner } };
    data.push(effect);
  }
  const made = data.length ? Array.from(await actor.createEmbeddedDocuments('Item', landItems(data)) ?? []) : [];
  return { ids: made.map(idOf), skipped };
}

/** Resolve the form definition and the answers to its prompts, or a refusal (`null`). Writes nothing. */
async function prepareForm(actor, affliction, formIndex, options) {
  const row = formAt(affliction, formIndex);
  if (!row) return null;
  const def = COGRaceClassApplier.findRace(row.race, { actor });
  if (!def) {
    globalThis.ui?.notifications?.warn?.(`${affliction.name}: the form "${row.race}" was not found, so ${actor.name} was not changed.`);
    return null;
  }
  const collected = await COGRaceClassApplier.collectSelections(def, options);
  if (!collected) return null;
  const lookup = await prefetchKindDocuments('race', def, collected.selections);
  return { def, selections: collected.selections, lookup };
}

const permanentUpdate = (affliction) => affliction.update({ 'system.duration': 'Permanent', 'system.durationConfig': cleanClone(PERMANENT) });

/**
 * Fire a pending affliction: lay the first form over the victim and add the affliction's effects.
 * Idempotent (a changed affliction does nothing). Only crawlers change race; anyone else gets the effects only.
 * @param {Actor} actor
 * @param {Item} affliction an embedded affliction of `actor`
 * @param {{ confirm?: boolean, ruleBreak?: boolean, interactive?: boolean, choices?: object }} [options]
 *   `confirm: false` skips the plain confirmation; the rest go to the prompts and the Rule Break
 * @returns {Promise<boolean>} whether the actor changed
 */
export async function changeVictim(actor, affliction, options = {}) {
  if (!actor || !isAffliction(affliction)) return false;
  if (afflictionStage(affliction) === 'changed') return false;
  const forms = formEntries(affliction);
  const raceChange = forms.length > 0 && actor.type === 'crawler';

  return whileTransforming(actor, async () => {
    // 1-2. Confirm; a second overlay needs a Rule Break and reverts the first
    const target = raceChange ? formLabel(affliction, 0, COGRaceClassApplier.findRace(forms[0].race, { actor })) : affliction.name;
    const question = raceChange
      ? transformText('COG.Transform.ConfirmChangeInto', { actor: actor.name, form: target })
      : transformText('COG.Transform.ConfirmChangeBy', { actor: actor.name, affliction: affliction.name });
    if (!(await confirmPlain(question, options))) return false;
    const other = raceChange ? overlayOf(actor) : null;
    if (other && idOf(other) !== idOf(affliction)) {
      const gate = await confirmRuleBreak({
        title: 'Second transformation',
        reason: `${actor.name} is already changed by ${other.name}. Revert it and change into ${target} as a Rule Break?`,
        options
      });
      if (!gate.confirmed) return false;
    }

    // 3-4. Resolve the form and answer its prompts: nothing is written yet
    let prepared = null;
    if (raceChange) {
      prepared = await prepareForm(actor, affliction, 0, options);
      if (!prepared) return false;
    }

    // 5. Revert the other overlay, then create the form
    if (other && idOf(other) !== idOf(affliction)) await revertTransformation(actor, other, { ruleBreak: true });
    let formItemId = null;
    let createdIds = [];
    if (prepared) {
      const { creates } = planForm(actor, affliction, prepared.def, prepared.selections, prepared.lookup);
      ({ formItemId, createdIds } = await createForm(actor, creates));
      await pauseOriginalTraits(actor, affliction);
    }

    // 6. Added effects
    const effects = await addEffects(actor, affliction);

    // 7. State
    const previous = transformState(affliction);
    await writeState(affliction, {
      ...previous,
      stage: 'changed',
      changedAt: Number(globalThis.game?.time?.worldTime) || 0,
      changedBy: globalThis.game?.user?.id ?? '',
      formIndex: prepared ? 0 : -1,
      selections: prepared?.selections ?? {},
      ruleBreak: Boolean(options.ruleBreak) || Boolean(other),
      formItemId,
      createdIds,
      effectIds: effects.ids,
      deathCards: previous.deathCards ?? []
    });
    await permanentUpdate(affliction);
    actor.prepareData?.();

    // 8. Card
    const lines = [prepared ? `${actor.name} changed into ${formLabel(affliction, 0, prepared.def)}.` : `${actor.name} is changed by ${affliction.name}.`];
    if (forms.length && !raceChange) lines.push('Only crawlers change race; the added effects still apply.');
    for (const note of effects.skipped) lines.push(`Not added: ${note}.`);
    const fit = misfits(actor);
    if (fit.length) lines.push(`No longer fit: ${fit.join(', ')}.`);
    await postCard(actor, lines);
    return true;
  });
}

/** Delete the form race item and everything created for it (not the added effects). */
async function deleteFormItems(actor, state) {
  const ids = [state.formItemId, ...(state.createdIds ?? [])].filter(Boolean).filter((id) => actor.items.get(id));
  if (ids.length) await actor.deleteEmbeddedDocuments('Item', ids);
}

/**
 * Change a changed affliction to another form: delete the current form's items, create the new form's, record the
 * index. `-1` is the original body, where the original race's traits are back on (631 a); any form pauses them (D7).
 * @param {Actor} actor
 * @param {Item} affliction
 * @param {number} formIndex
 * @param {object} [options] as {@link changeVictim}
 * @returns {Promise<boolean>}
 */
export async function switchForm(actor, affliction, formIndex, options = {}) {
  if (!actor || afflictionStage(affliction) !== 'changed') return false;
  const next = Number(formIndex);
  const state = transformState(affliction);
  if (!Number.isInteger(next) || next < -1 || next >= formEntries(affliction).length || next === state.formIndex) return false;
  if (actor.type !== 'crawler') return false;

  return whileTransforming(actor, async () => {
    let prepared = null;
    if (next >= 0) {
      prepared = await prepareForm(actor, affliction, next, options);
      if (!prepared) return false;
    }
    await deleteFormItems(actor, state);
    let formItemId = null;
    let createdIds = [];
    if (prepared) {
      const { creates } = planForm(actor, affliction, prepared.def, prepared.selections, prepared.lookup);
      ({ formItemId, createdIds } = await createForm(actor, creates));
    }
    // The original body has its race traits back; a form pauses them again (631 a)
    if (next === -1) await unpauseTraits(actor, idOf(affliction));
    else if (state.formIndex === -1) await pauseOriginalTraits(actor, affliction);
    await writeState(affliction, { ...state, formIndex: next, selections: prepared?.selections ?? {}, formItemId, createdIds });
    actor.prepareData?.();
    await postCard(actor, [prepared ? `${actor.name} changed into ${formLabel(affliction, next, prepared.def)}.` : `${actor.name} returned to their own body.`]);
    return true;
  });
}

/**
 * Undo a transformation: delete the form race item, its traits and created skills, the added effects; unpause the
 * original race's traits; delete the affliction. Nothing is restored because nothing was removed. Safe to call twice.
 * @param {Actor} actor
 * @param {Item} affliction
 * @param {{ ruleBreak?: boolean, deleteAffliction?: boolean }} [options]
 * @returns {Promise<boolean>} whether anything was reverted
 */
export async function revertTransformation(actor, affliction, { ruleBreak = false, deleteAffliction = true } = {}) {
  if (!actor || !affliction) return false;
  const afflictionId = idOf(affliction);
  return whileTransforming(actor, async () => {
    const state = transformState(affliction);
    const wasChanged = state.stage === 'changed';
    const ids = new Set([state.formItemId, ...(state.createdIds ?? []), ...(state.effectIds ?? [])].filter(Boolean));
    // Anything still flagged to this affliction goes too (a skill created after a state write that failed)
    for (const item of actor.items ?? []) if (transformationOfItem(item) === afflictionId) ids.add(idOf(item));
    const present = [...ids].filter((id) => actor.items.get(id));
    if (present.length) await actor.deleteEmbeddedDocuments('Item', present);
    await unpauseTraits(actor, afflictionId);
    const hadAffliction = Boolean(actor.items.get(afflictionId));
    if (deleteAffliction && hadAffliction) await actor.deleteEmbeddedDocuments('Item', [afflictionId]);
    actor.prepareData?.();
    const reverted = present.length > 0 || (deleteAffliction && hadAffliction);
    if (wasChanged && reverted) await postCard(actor, [`${actor.name} is back to normal.${ruleBreak ? ' (Rule Break)' : ''}`]);
    return reverted;
  });
}

/**
 * `deleteItem` handler for transformation items. A form race item, a created skill or an added effect deleted from
 * a sheet reverts the whole transformation; so does deleting a changed affliction. Never blocks (the delete already
 * happened) and stays out of the engine's own deletes. Returns null when the item is not a transformation's, so the
 * caller falls through to the race and class handler.
 * @param {Item} item
 * @param {object} [_options]
 * @param {string} [userId]
 * @returns {Promise<boolean|null>} true reverted, false nothing to revert, null not a transformation item
 */
export async function onTransformItemDelete(item, _options, userId) {
  const actor = item?.parent;
  if (!actor) return null;
  const owner = transformationOfItem(item);
  const isChangedAffliction = isAffliction(item) && afflictionStage(item) === 'changed';
  if (!owner && !isChangedAffliction) return null;
  if (userId && globalThis.game?.user?.id && userId !== globalThis.game.user.id) return false;
  if (isTransforming(actor)) return false;
  const affliction = isChangedAffliction ? item : actor.items.get(owner);
  if (!affliction) return false;
  try {
    return await revertTransformation(actor, affliction, { deleteAffliction: !isChangedAffliction, ruleBreak: takeRuleBreak(idOf(affliction)) });
  } catch (err) {
    console.error('Sprinter RPG | Could not revert the transformation after an item was deleted:', err);
    globalThis.ui?.notifications?.warn?.(`${item.name} was deleted, but the transformation could not be fully reverted. Check ${actor.name}.`);
    return false;
  }
}

/** Afflictions whose revert was confirmed as a Rule Break by this client, until the revert's card is posted. */
const confirmedBreaks = new Set();

/** Remember that a Rule Break was confirmed for this affliction's revert (the delete hook reads it once). */
const markRuleBreak = (afflictionId) => { if (afflictionId) confirmedBreaks.add(afflictionId); };

/** Whether a Rule Break was marked for this affliction; clears the mark. */
function takeRuleBreak(afflictionId) {
  return confirmedBreaks.delete(afflictionId);
}

/** The affliction a buff, debuff or form item belongs to (itself when it is one), or null when it is no transformation's. */
function transformationOwner(actor, item) {
  const owner = transformationOfItem(item);
  const affliction = owner ? actor?.items.get(owner) : (isAffliction(item) ? item : null);
  return affliction && isAffliction(affliction) ? affliction : null;
}

/** Whether a form race is laid over the victim (an affliction with no form, or back in the original body, has none). */
function formInForce(actor, affliction) {
  const state = transformState(affliction);
  return Boolean(formAt(affliction, state.formIndex) || actor.items.get(state.formItemId));
}

/** What the body is called in a Rule Break question: the form's label, the form race's name, or the affliction's. */
function changedLabel(actor, affliction) {
  const state = transformState(affliction);
  const row = formAt(affliction, state.formIndex);
  return row?.label || actor.items.get(state.formItemId)?.name || affliction.name;
}

/**
 * Whether reverting a changed affliction needs a Rule Break answer: its cure window is closed (D9). A pending one,
 * or a changed one with an open window, never asks. Asking is a confirmation, not a block (rule 2): confirmed
 * proceeds with `ruleBreak: true`; a refusal (cancel, policy, or no way to ask) leaves it held.
 * @param {Actor} actor
 * @param {Item} affliction
 * @param {object} [options] `ruleBreak: true` pre-confirms; `interactive: false` never opens a dialog
 * @returns {Promise<{ proceed: boolean, ruleBreak: boolean, refusal?: string, reason?: string }>}
 */
export async function confirmHeldRevert(actor, affliction, options = {}) {
  if (!heldByCure(affliction, { floor: getCurrentFloor() })) return { proceed: true, ruleBreak: false };
  const gate = await confirmRuleBreak({
    title: 'Transformation',
    message: formInForce(actor, affliction)
      ? transformText('COG.Transform.HeldRevertInto', { actor: actor.name, form: changedLabel(actor, affliction) })
      : transformText('COG.Transform.HeldRevertBy', { actor: actor.name, affliction: affliction.name }),
    options
  });
  return { proceed: gate.confirmed, ruleBreak: gate.confirmed, refusal: gate.refusal, reason: gate.reason };
}

/**
 * Cure by window (D9). Debuffs a cure matched are sorted three ways: ordinary ones (`plain`, the caller removes them
 * as before), transformations reverted (`reverted`, affliction items) and changed ones held by a closed window (`held`).
 * An added effect or form trait that a cure matches stands for its whole affliction, so a cure-all cannot dodge the
 * window by removing one part. A pending affliction is an ordinary debuff: nothing was changed, so nothing is held.
 * @param {Actor} actor
 * @param {Item[]} matched debuffs the cure matched
 * @param {object} [options] as {@link confirmHeldRevert}
 * @returns {Promise<{ plain: Item[], reverted: Item[], held: Item[] }>}
 */
export async function cureByWindow(actor, matched, options = {}) {
  const plain = [];
  const reverted = [];
  const held = [];
  const seen = new Set();
  for (const debuff of matched) {
    const affliction = transformationOwner(actor, debuff);
    if (!affliction || afflictionStage(affliction) !== 'changed') { plain.push(debuff); continue; }
    const id = idOf(affliction);
    if (seen.has(id)) continue;
    seen.add(id);
    const gate = await confirmHeldRevert(actor, affliction, options);
    if (!gate.proceed) { held.push(affliction); continue; }
    await revertTransformation(actor, affliction, { ruleBreak: gate.ruleBreak });
    reverted.push(affliction);
  }
  return { plain, reverted, held };
}

/**
 * The sheet's delete gate (D9): deleting any part of a changed transformation reverts the whole thing, so a closed
 * window asks the Rule Break first. Returns whether to go ahead with the delete. Anything else is never asked.
 * A confirmed break is remembered so the revert's card records it.
 * @param {Actor} actor
 * @param {Item} item the row being deleted
 * @param {object} [options] as {@link confirmHeldRevert}
 * @returns {Promise<boolean>}
 */
export async function confirmTransformDelete(actor, item, options = {}) {
  const affliction = transformationOwner(actor, item);
  if (!affliction || afflictionStage(affliction) !== 'changed') return true;
  const gate = await confirmHeldRevert(actor, affliction, options);
  if (gate.proceed) {
    if (gate.ruleBreak) markRuleBreak(idOf(affliction));
    return true;
  }
  if (gate.refusal === 'policy' && gate.reason) globalThis.ui?.notifications?.warn?.(gate.reason);
  return false;
}

/**
 * The debuff sheet's edits that undo a changed affliction's body: "Not a transformation" and deleting the form row in
 * force. They take the same gate as a cure (D9): a closed window asks the Rule Break, and a confirmed edit reverts the
 * change first (the form race and what it made go, the original race's traits come back) so nothing stays paused under
 * what is then an ordinary debuff or a pending affliction. A pending affliction is edited freely. Returns whether to
 * go ahead with the edit; a refusal changes nothing.
 * @param {Actor|null} actor the carrier of the affliction (null for a world item)
 * @param {Item} affliction
 * @param {object} [options] as {@link confirmHeldRevert}, plus `keep`: `'plain'` (the debuff stops being an affliction,
 *   its change state is cleared) or `'pending'` (it stays one, landed and unchanged)
 * @returns {Promise<boolean>}
 */
export async function confirmAfflictionEdit(actor, affliction, { keep = 'pending', ...options } = {}) {
  if (!actor || afflictionStage(affliction) !== 'changed') return true;
  const gate = await confirmHeldRevert(actor, affliction, options);
  if (!gate.proceed) {
    if (gate.refusal === 'policy' && gate.reason) globalThis.ui?.notifications?.warn?.(gate.reason);
    return false;
  }
  const { landedAt, landedFloor } = transformState(affliction);
  await revertTransformation(actor, affliction, { ruleBreak: gate.ruleBreak, deleteAffliction: false });
  if (keep === 'plain') await clearFlag(affliction, FLAG);
  else await writeState(affliction, { stage: 'pending', landedAt, landedFloor });
  return true;
}

/** Reveal a held secret and fire its change in one step (a plain debuff just lands). Returns the created debuff. */
export async function changeNow(id) {
  const created = await reveal(id, { cue: false });
  if (created && isAffliction(created)) await changeVictim(created.parent, created, { confirm: false });
  return created;
}
