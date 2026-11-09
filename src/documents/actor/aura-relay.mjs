/**
 * Aura writes on actors the caster's user may not own.
 *
 * An aura grants temporary health bars and creates buff/debuff items on its allies, and removes them again
 * when it ends. A player owns the caster but usually not the allies, and Foundry rejects a player's update
 * of an actor they do not own. These helpers write locally when the current user can, and otherwise ask the
 * active GM through the GM relay.
 *
 * GM-side authorization: the requesting user (identified by socketlib, not by the payload) must be a GM or
 * must own the actor that holds the source aura item. Payloads are also narrowed to the aura's own effects:
 * only buff/debuff items stamped with the source item's UUID can be created, and only bars and items
 * stamped with that UUID can be removed.
 *
 * Nothing about what the aura grants comes from the payload. A request names only the target actor and the
 * source aura item; the GM rebuilds temp bars (aura-effects.mjs computeAuraTempBars), effect items
 * (buildAuraEffectItems), healing, cleansing and damage limits from the source item and the actor holding it.
 * The one exception is rolled periodic damage, which is rolled on the caster's client and capped at the
 * formula's maximum. Known limit: the GM cannot confirm the target is inside the aura radius or is an
 * ally/enemy.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { registerRelayAction, dispatchRelay } from '../../utils/gm-relay.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { maxOfDiceFormula } from '../../utils/roll/dice-max.mjs';
import { TIME_UNITS } from '../../utils/time/timing.mjs';
import { durationSpec } from '../../utils/time/durations.mjs';
import { hotRoundsOf } from '../../utils/time/hot-rounds.mjs';
import { computeAuraTempBars, buildAuraEffectItems, buildAuraDebuffItem } from './aura-effects.mjs';

export const AURA_GRANT_TEMP_BARS = 'auraGrantTempBars';
export const AURA_CREATE_EFFECTS = 'auraCreateEffects';
export const AURA_INFLICT_DEBUFF = 'auraInflictDebuff';
export const AURA_CLEAR_EFFECTS = 'auraClearEffects';
export const AURA_HEAL = 'auraHeal';
export const AURA_CLEANSE = 'auraCleanse';
export const AURA_DAMAGE = 'auraDamage';

/** True when the current user can write to this actor directly. */
export function canWriteActor(actor) {
  return Boolean(globalThis.game?.user?.isGM || actor?.isOwner);
}

function itemsOf(actor) {
  if (!actor?.items) return [];
  return Array.from(actor.items ?? []);
}

/** The bars and aura-created items on `actor` that belong to the aura item `auraUuid`. */
export function findAuraEffects(actor, auraUuid) {
  if (!auraUuid) return { hasBars: false, itemIds: [] };
  const hasBars = actor?.system?.attributes?.hp?.tempBars?.sourceUuid === auraUuid;
  const itemIds = itemsOf(actor)
    .filter(it => it.flags?.[SYSTEM_ID]?.auraSourceUuid === auraUuid)
    .map(it => it.id || it._id);
  return { hasBars, itemIds };
}

async function applyGrantTempBars(actor, { count, hpPerSlot, source, sourceItemUuid, element = '' }) {
  await actor.grantTempBars({ count, hpPerSlot, source, sourceUuid: sourceItemUuid, element });
}

async function applyCreateEffects(actor, items) {
  await actor.createEmbeddedDocuments('Item', items);
}

async function applyClearEffects(actor, auraUuid) {
  const { hasBars, itemIds } = findAuraEffects(actor, auraUuid);
  if (hasBars) {
    if (typeof actor.grantTempBars === 'function') {
      await actor.grantTempBars({ count: 0, hpPerSlot: 0 });
    } else if (typeof actor.update === 'function') {
      await actor.update({
        'system.attributes.hp.tempBars.count': 0,
        'system.attributes.hp.tempBars.currentSlotHp': 0,
        'system.attributes.hp.tempBars.source': '',
        'system.attributes.hp.tempBars.sourceUuid': '',
        'system.attributes.hp.temp': 0
      });
    }
  }
  if (itemIds.length > 0) {
    await actor.deleteEmbeddedDocuments('Item', itemIds);
  }
}

/**
 * The requesting user may act on behalf of this aura: a GM, or an owner of the actor holding the item.
 * The item must resolve to an embedded item on an actor (the caster); a missing item or one with no
 * holder is refused.
 */
export function ownsAuraSource(sourceItemUuid, user) {
  const source = typeof sourceItemUuid === 'string' && sourceItemUuid ? globalThis.fromUuidSync?.(sourceItemUuid) : null;
  const holder = source?.parent;
  if (!holder) return false;
  if (user?.isGM) return true;
  return Boolean(holder.testUserPermission?.(user, 'OWNER'));
}

registerRelayAction(AURA_GRANT_TEMP_BARS, {
  authorize(p, user) {
    if (!p?.sourceItemUuid || !resolveActorByUuid(p?.actorUuid) || !ownsAuraSource(p.sourceItemUuid, user)) return false;
    const { source } = auraConfigOf(p.sourceItemUuid);
    return computeAuraTempBars(source.parent, source).slots > 0;
  },
  async apply(p) {
    const actor = resolveActorByUuid(p.actorUuid);
    if (!actor) throw new Error(`Aura relay: actor ${p.actorUuid} not found.`);
    const { source } = auraConfigOf(p.sourceItemUuid);
    const { slots, hpPerSlot, element } = computeAuraTempBars(source.parent, source);
    await applyGrantTempBars(actor, { count: slots, hpPerSlot, source: source.name, sourceItemUuid: source.uuid, element });
  }
});

registerRelayAction(AURA_CREATE_EFFECTS, {
  authorize(p, user) {
    if (!p?.sourceItemUuid || !resolveActorByUuid(p.actorUuid) || !ownsAuraSource(p.sourceItemUuid, user)) return false;
    const { source } = auraConfigOf(p.sourceItemUuid);
    return buildAuraEffectItems(source.parent, source).length > 0;
  },
  async apply(p) {
    const actor = resolveActorByUuid(p.actorUuid);
    if (!actor) throw new Error(`Aura relay: actor ${p.actorUuid} not found.`);
    const { source } = auraConfigOf(p.sourceItemUuid);
    await applyCreateEffects(actor, buildAuraEffectItems(source.parent, source));
  }
});

registerRelayAction(AURA_INFLICT_DEBUFF, {
  authorize(p, user) {
    if (!p?.sourceItemUuid || !resolveActorByUuid(p.actorUuid) || !ownsAuraSource(p.sourceItemUuid, user)) return false;
    const { source } = auraConfigOf(p.sourceItemUuid);
    return typeof p.debuff === 'string' && buildAuraDebuffItem(source, p.debuff) !== null;
  },
  async apply(p) {
    const actor = resolveActorByUuid(p.actorUuid);
    if (!actor) throw new Error(`Aura relay: actor ${p.actorUuid} not found.`);
    const { source } = auraConfigOf(p.sourceItemUuid);
    await applyCreateEffects(actor, [buildAuraDebuffItem(source, p.debuff)]);
  }
});

registerRelayAction(AURA_CLEAR_EFFECTS, {
  authorize: (p, user) => Boolean(p?.sourceItemUuid && resolveActorByUuid(p?.actorUuid) && ownsAuraSource(p.sourceItemUuid, user)),
  async apply(p) {
    const actor = resolveActorByUuid(p.actorUuid);
    if (!actor) throw new Error(`Aura relay: actor ${p.actorUuid} not found.`);
    await applyClearEffects(actor, p.sourceItemUuid);
  }
});

/**
 * Grant an aura's temporary health bars to an ally. The amounts are derived from the source item and
 * the actor holding it; the relay carries only the references.
 * @returns {Promise<boolean>} false when a non-owner could not reach a GM
 */
export async function grantAllyTempBars(actor, sourceItem) {
  const { slots, hpPerSlot, element } = computeAuraTempBars(sourceItem.parent, sourceItem);
  if (slots <= 0 || hpPerSlot <= 0) return true;
  const params = { count: slots, hpPerSlot, source: sourceItem.name, sourceItemUuid: sourceItem.uuid || '', element };
  if (canWriteActor(actor) || !actor.uuid) {
    await applyGrantTempBars(actor, params);
    return true;
  }
  return dispatchRelay(AURA_GRANT_TEMP_BARS, { actorUuid: actor.uuid, sourceItemUuid: params.sourceItemUuid }, { direct: false });
}

/**
 * Create an aura's buff items on an ally. The items are built from the source item and the actor holding
 * it (buildAuraEffectItems); the relay carries only the references.
 * @returns {Promise<boolean>} false when a non-owner could not reach a GM
 */
export async function createAllyEffects(actor, sourceItem) {
  const items = buildAuraEffectItems(sourceItem.parent, sourceItem);
  if (items.length === 0) return true;
  if (canWriteActor(actor) || !actor.uuid) {
    await applyCreateEffects(actor, items);
    return true;
  }
  return dispatchRelay(AURA_CREATE_EFFECTS, { actorUuid: actor.uuid, sourceItemUuid: sourceItem.uuid || '' }, { direct: false });
}

/**
 * Inflict one of the aura's configured debuffs on an enemy. The item is built from the source item;
 * the relay carries only the references and the debuff's name, which the GM checks against the config.
 * @returns {Promise<boolean>} false when the aura does not list the debuff or a non-owner could not reach a GM
 */
export async function inflictAuraDebuff(actor, sourceItem, debuffName) {
  const item = buildAuraDebuffItem(sourceItem, debuffName);
  if (!item) return false;
  if (canWriteActor(actor) || !actor.uuid) {
    await applyCreateEffects(actor, [item]);
    return true;
  }
  return dispatchRelay(AURA_INFLICT_DEBUFF, { actorUuid: actor.uuid, sourceItemUuid: sourceItem.uuid || '', debuff: debuffName }, { direct: false });
}

/**
 * Remove an aura's bars and created items from an actor. Does nothing when the actor has none.
 * @returns {Promise<boolean>} false when a non-owner could not reach a GM
 */
export async function clearAllyAuraEffects(actor, sourceItem) {
  const auraUuid = sourceItem.uuid || '';
  const { hasBars, itemIds } = findAuraEffects(actor, auraUuid);
  if (!hasBars && itemIds.length === 0) return true;
  if (canWriteActor(actor) || !actor.uuid) {
    await applyClearEffects(actor, auraUuid);
    return true;
  }
  return dispatchRelay(AURA_CLEAR_EFFECTS, { actorUuid: actor.uuid, sourceItemUuid: auraUuid }, { direct: false });
}

/**
 * True when an effect item carries a duration of its own (its `durationConfig`: a length in time or rounds, a
 * scene/floor period or a rest, or "ends with combat"). The stamps a pulse adds (`appliedRound`, `appliedCombatId`,
 * `remainingRounds`, `expiresAt`) never change the config's type or value, so they do not count. An aura or zone
 * effect with none is cleared on leaving; one with a duration runs it out.
 */
export function hasAuthoredDuration(item) {
  const cfg = item?.system?.durationConfig;
  if (!cfg) return false;
  if (cfg.endsWithCombat) return true;
  const spec = durationSpec(cfg);
  const kind = TIME_UNITS[spec.unit]?.kind;
  return Boolean(kind) && kind !== 'state' && Number(cfg.value) > 0;
}

/**
 * Remove some of an aura's effects from an actor the current user can write: its stamped 'buff' items, its
 * stamped 'debuff' items, and/or its temporary health bars ('tempBars'). Local only, no relay: the GM-side
 * membership sync (aura-pulse.mjs) is the only caller.
 * @param {Actor} actor
 * @param {Item} sourceItem the aura item
 * @param {{ types: Array<'buff'|'debuff'|'tempBars'>, keepTimed?: boolean }} options `keepTimed`: debuffs with an
 *   authored duration stay and run it out (the leave rule); buffs are not affected
 * @returns {Promise<boolean>} false when the current user cannot write the actor
 */
export async function removeAuraItems(actor, sourceItem, { types = [], keepTimed = false } = {}) {
  if (!actor || !(canWriteActor(actor) || !actor.uuid)) return false;
  const auraUuid = sourceItem?.uuid || '';
  if (!auraUuid) return true;
  const itemIds = itemsOf(actor)
    .filter(it => types.includes(it.type) && it.flags?.[SYSTEM_ID]?.auraSourceUuid === auraUuid)
    .filter(it => !(keepTimed && it.type === 'debuff' && hasAuthoredDuration(it)))
    .map(it => it.id || it._id);
  if (itemIds.length > 0) {
    await actor.deleteEmbeddedDocuments('Item', itemIds);
  }
  if (types.includes('tempBars') && actor.system?.attributes?.hp?.tempBars?.sourceUuid === auraUuid) {
    await actor.grantTempBars({ count: 0, hpPerSlot: 0 });
  }
  return true;
}

/** The source aura item and its structured aura config, resolved from a UUID. */
function auraConfigOf(sourceItemUuid) {
  const source = typeof sourceItemUuid === 'string' && sourceItemUuid ? globalThis.fromUuidSync?.(sourceItemUuid) : null;
  return { source, area: source?.system?.area || null };
}

const cleanseList = (area) => (Array.isArray(area?.cleanseDebuffs) ? area.cleanseDebuffs.filter(Boolean) : []);

/** Heal an actor per the aura config: a heal-over-time buff, or an instant number of health bars. */
async function applyAuraHeal(actor, sourceName, area) {
  const bars = Number(area?.healingBars) || 0;
  if (bars <= 0) return;
  if (area.isHoT && typeof actor.applyHoT === 'function') {
    await actor.applyHoT({ name: `${sourceName} HoT`, healBars: bars, rounds: hotRoundsOf(area) });
  } else if (typeof actor.applyHealingBars === 'function') {
    await actor.applyHealingBars(bars);
  }
}

async function applyAuraCleanse(actor, debuff) {
  if (typeof actor.cleanseDebuff === 'function') {
    await actor.cleanseDebuff(debuff);
  }
}

async function applyAuraDamage(actor, amount, damageType) {
  if (typeof actor.applyDamage === 'function') await actor.applyDamage(amount, { damageType });
}

registerRelayAction(AURA_HEAL, {
  authorize(p, user) {
    if (!resolveActorByUuid(p?.actorUuid) || !ownsAuraSource(p?.sourceItemUuid, user)) return false;
    return (Number(auraConfigOf(p.sourceItemUuid).area?.healingBars) || 0) > 0;
  },
  async apply(p) {
    const actor = resolveActorByUuid(p.actorUuid);
    if (!actor) throw new Error(`Aura relay: actor ${p.actorUuid} not found.`);
    const { source, area } = auraConfigOf(p.sourceItemUuid);
    await applyAuraHeal(actor, source.name, area);
  }
});

registerRelayAction(AURA_CLEANSE, {
  authorize(p, user) {
    if (!resolveActorByUuid(p?.actorUuid) || !ownsAuraSource(p?.sourceItemUuid, user)) return false;
    return typeof p.debuff === 'string' && p.debuff.trim() !== '' && cleanseList(auraConfigOf(p.sourceItemUuid).area).includes(p.debuff);
  },
  async apply(p) {
    const actor = resolveActorByUuid(p.actorUuid);
    if (!actor) throw new Error(`Aura relay: actor ${p.actorUuid} not found.`);
    await applyAuraCleanse(actor, p.debuff);
  }
});

registerRelayAction(AURA_DAMAGE, {
  authorize(p, user) {
    if (!resolveActorByUuid(p?.actorUuid) || !ownsAuraSource(p?.sourceItemUuid, user)) return false;
    const { area } = auraConfigOf(p.sourceItemUuid);
    if (!area?.hasPeriodicDamage || !area.periodicDamageFormula) return false;
    const max = maxOfDiceFormula(area.periodicDamageFormula);
    const amount = Number(p.amount);
    return max !== null && Number.isFinite(amount) && amount >= 0 && amount <= max;
  },
  async apply(p) {
    const actor = resolveActorByUuid(p.actorUuid);
    if (!actor) throw new Error(`Aura relay: actor ${p.actorUuid} not found.`);
    const { area } = auraConfigOf(p.sourceItemUuid);
    await applyAuraDamage(actor, Number(p.amount), area.periodicDamageType || 'Physical');
  }
});

/**
 * Apply an aura's healing (health bars or heal-over-time, per its config) to an ally.
 * @returns {Promise<boolean>} false when a non-owner could not reach a GM
 */
export async function healAllyFromAura(actor, sourceItem) {
  if (canWriteActor(actor) || !actor.uuid) {
    await applyAuraHeal(actor, sourceItem.name, sourceItem.system?.area);
    return true;
  }
  return dispatchRelay(AURA_HEAL, { actorUuid: actor.uuid, sourceItemUuid: sourceItem.uuid || '' }, { direct: false });
}

/**
 * Remove one debuff the aura's config lists from an ally.
 * @returns {Promise<boolean>} false when a non-owner could not reach a GM
 */
export async function cleanseAllyFromAura(actor, sourceItem, debuff) {
  if (canWriteActor(actor) || !actor.uuid) {
    await applyAuraCleanse(actor, debuff);
    return true;
  }
  return dispatchRelay(AURA_CLEANSE, { actorUuid: actor.uuid, sourceItemUuid: sourceItem.uuid || '', debuff }, { direct: false });
}

/**
 * Apply rolled periodic aura damage to a target.
 * @returns {Promise<boolean>} false when a non-owner could not reach a GM
 */
export async function damageTargetFromAura(actor, sourceItem, amount) {
  const damageType = sourceItem.system?.area?.periodicDamageType || 'Physical';
  if (canWriteActor(actor) || !actor.uuid) {
    await applyAuraDamage(actor, amount, damageType);
    return true;
  }
  return dispatchRelay(AURA_DAMAGE, { actorUuid: actor.uuid, sourceItemUuid: sourceItem.uuid || '', amount }, { direct: false });
}
