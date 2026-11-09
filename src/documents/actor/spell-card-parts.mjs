/**
 * Pieces of a spell's chat card that more than one card shares (3.47-1b): the cast card of a non-attack spell and the
 * hit card of an attack spell both inflict the spell's conditions and show the Inflict block.
 */
import { getTagDefinition } from '../../data/tag-definitions.mjs';
import { registerRelayAction, requestRelay, isNoGmReason } from '../../utils/gm-relay.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { canWriteTarget, messageAuthorId, parseMessageContent } from '../../chat/chat-relay.mjs';
import { rankBreakConditionRounds } from '../../utils/time/durations.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { ownsAuraSource } from './aura-relay.mjs';
import { cardSummary, OMIT_ALL } from '../../utils/item-describer/card-summary.mjs';
import { firstScalar } from '../../utils/first-scalar.mjs';
import { getItemInflictedConditions } from './inflicted-conditions.mjs';

export const SPELL_CONDITION_RELAY = 'spellApplyCondition';

const AREA_TARGET_LABELS = Object.freeze({ allies: 'Allies', enemies: 'Enemies', both: 'Allies and enemies', self: 'Self only' });

/** The words for a target filter id (`allies`, `both`); an unknown id is shown made readable, never raw. */
export function targetFilterLabel(filter) {
  const id = String(filter ?? '').trim();
  if (!id) return '';
  return AREA_TARGET_LABELS[id] ?? (id.charAt(0).toUpperCase() + id.slice(1).replaceAll('_', ' ').replaceAll('-', ' '));
}

/** The condition tags a spell may inflict (normal and crit), read from its structured data. */
function inflictableTags(spell) {
  const holder = spell?.parent;
  if (!holder) return new Set();
  return new Set([
    ...getItemInflictedConditions(holder, spell, { isCrit: false }),
    ...getItemInflictedConditions(holder, spell, { isCrit: true })
  ]);
}

function warn(message) {
  globalThis.ui?.notifications?.warn?.(message);
}

/** Holds the "Applied to" notice on a card, so the notice can be rewritten once the GM has applied the rest. An element, because Foundry's sanitizer drops comments from stored content. */
const NOTICE_SLOT = 'cog-applied-slot';

/** A flag id read defensively as a trimmed string (arrays take the first entry, comma strings the first part). */
function idString(raw) {
  const val = firstScalar(raw);
  return typeof val === 'string' ? val.trim() : '';
}

/**
 * The card-based authority for the relay (the rule `chatCardApply` follows): a cast card or spell hit card the requester
 * (or a GM) wrote, whose flags name this spell and its caster and list the target.
 */
function cardAuthorizes(message, spell, targetUuid, user) {
  const f = message?.flags?.[SYSTEM_ID];
  if (!f || typeof f !== 'object') return false;
  const authorId = messageAuthorId(message);
  const author = authorId ? globalThis.game?.users?.get?.(authorId) : null;
  if (!(user?.isGM || (authorId && authorId === user?.id) || author?.isGM)) return false;
  const holderId = spell?.parent?.id;
  if (!holderId) return false;
  const isCast = f.isSpellCast === true && idString(f.conditionSpellId) === spell.id && idString(f.conditionCasterId) === holderId;
  const isHit = f.isSpellAttack === true && idString(f.attackItemUuid) === spell.uuid && idString(f.attackerId) === holderId;
  if (!isCast && !isHit) return false;
  return Array.isArray(f.conditionTargetUuids) && f.conditionTargetUuids.includes(targetUuid);
}

// A player's spell hit lands on targets they do not own. The GM writes it, on the requester's authority over the
// spell's holder and a cast or hit card that names the spell and lists the target; the tag must be one the spell
// inflicts, and the rounds are computed here from the spell itself. No number from the payload is used (3.47a F1, 3.56a).
registerRelayAction(SPELL_CONDITION_RELAY, {
  authorize(p, user) {
    if (!p?.spellUuid || typeof p.conditionTag !== 'string' || typeof p.messageId !== 'string' || !p.messageId) return false;
    if (typeof p.targetUuid !== 'string' || !resolveActorByUuid(p.targetUuid)) return false;
    if (!ownsAuraSource(p.spellUuid, user)) return false;
    const spell = globalThis.fromUuidSync?.(p.spellUuid);
    if (!inflictableTags(spell).has(p.conditionTag)) return false;
    return cardAuthorizes(globalThis.game?.messages?.get?.(p.messageId), spell, p.targetUuid, user);
  },
  async apply(p) {
    const target = resolveActorByUuid(p.targetUuid);
    const spell = globalThis.fromUuidSync?.(p.spellUuid);
    if (!target || !spell) throw new Error('Spell condition relay: target or spell no longer resolves.');
    await target.applyCondition(p.conditionTag, {
      source: spell.name,
      sourceItem: spell,
      duration: spell.system?.duration || '1 scene',
      durationRounds: rankBreakConditionRounds(spell)
    });
    // The GM can write the card, so a player who cannot still gets the applied list kept (3.81 retry).
    const message = globalThis.game?.messages?.get?.(p.messageId);
    await recordSpellApplied(message, [target], spellCardFlagKey(message));
    return { ok: true };
  }
});

/**
 * Apply one condition to one target: directly where this client may write it, through the GM otherwise.
 * Through the GM needs the card that names the spell and the target (`relay.messageId`); with `relay.pending` the request is
 * held until the card is posted, since the conditions apply while the card is built.
 * @returns {Promise<boolean|'deferred'>}
 */
async function applyOne(targetActor, spell, tag, options, relay) {
  if (typeof targetActor.applyCondition !== 'function') return false;
  if (canWriteTarget(targetActor)) {
    await targetActor.applyCondition(tag, options);
    return true;
  }
  if (!targetActor.uuid || !spell?.uuid) {
    warn(`Sprinter RPG | Could not apply [${tag}] to ${targetActor.name}: only the GM can change it.`);
    return false;
  }
  if (!relay?.messageId) {
    if (relay?.pending) {
      relay.pending.push({ targetActor, tag });
      return 'deferred';
    }
    warn(`Sprinter RPG | Could not apply [${tag}] to ${targetActor.name}: the spell card is needed to ask the GM.`);
    return false;
  }
  return relayOne(targetActor, spell, tag, relay.messageId);
}

async function relayOne(targetActor, spell, tag, messageId) {
  const res = await requestRelay(SPELL_CONDITION_RELAY, {
    targetUuid: targetActor.uuid, spellUuid: spell.uuid, conditionTag: tag, messageId
  }, { direct: false });
  if (!res.ok && !isNoGmReason(res.reason)) warn(`Sprinter RPG | The GM did not apply [${tag}] to ${targetActor.name}.`);
  return res.ok;
}

/** The "Applied to" notice for these actors ('' for none). */
function appliedNoticeInner(actors) {
  return actors.length > 0
    ? `<div class="cog-condition-applied-notice cog-text-success" style="font-size: 11px; margin-bottom: 4px; font-weight: bold;"><i class="fa-solid fa-check"></i> Applied to: ${actors.map(a => a.name).join(', ')}</div>`
    : '';
}

/**
 * After the card is posted: ask the GM for the conditions held back for targets this client may not write, naming the
 * card, then bring the card's applied list and notice up to date.
 * @param {object} message the posted cast or hit card
 * @param {object} spell
 * @param {Array<{ targetActor: object, tag: string }>} pending from `applySpellConditions`
 * @param {object[]} applied the actors already applied
 * @param {string} flagKey where the card lists the applied actor ids: `appliedTargets` or `conditionsApplied.targets`
 * @returns {Promise<object[]>} all applied actors, including the ones the GM applied
 */
export async function relayPendingSpellConditions(message, spell, pending, applied, flagKey) {
  const all = [...applied];
  if (!pending?.length || !message?.id) return all;
  for (const { targetActor, tag } of pending) {
    try {
      if (await relayOne(targetActor, spell, tag, message.id) && !all.some(a => a.id === targetActor.id)) all.push(targetActor);
    } catch (err) {
      console.warn(`Sprinter RPG | Could not apply [${tag}] to ${targetActor.name}:`, err);
      warn(`Sprinter RPG | Could not apply [${tag}] to ${targetActor.name}.`);
    }
  }
  if (all.length === applied.length) return all;
  await recordSpellApplied(message, all, flagKey);
  return all;
}

/** Where a spell card lists its applied actor ids: `appliedTargets` on a cast card, `conditionsApplied.targets` on a hit card; null for any other card. */
export function spellCardFlagKey(message) {
  const f = message?.flags?.[SYSTEM_ID];
  if (!f || typeof f !== 'object') return null;
  if (f.isSpellAttack === true) return 'conditionsApplied.targets';
  if (f.isSpellCast === true) return 'appliedTargets';
  return null;
}

/**
 * Add these actors to a spell card's applied list (merged with what it already lists) and rewrite its "Applied to" notice.
 * A write this client may not make fails softly.
 * @param {object} message
 * @param {object[]} actors the actors the condition now sits on
 * @param {string} flagKey from `spellCardFlagKey`
 * @returns {Promise<boolean>} true when the card was updated
 */
export async function recordSpellApplied(message, actors, flagKey) {
  if (!message || !flagKey || typeof message.update !== 'function') return false;
  const f = message.flags?.[SYSTEM_ID] ?? {};
  const listed = globalThis.foundry?.utils?.getProperty?.(f, flagKey);
  const ids = Array.isArray(listed) ? listed.filter(id => typeof id === 'string') : [];
  const merged = [...ids];
  for (const a of actors ?? []) if (a?.id && !merged.includes(a.id)) merged.push(a.id);
  if (merged.length === ids.length) return false;
  const byId = new Map();
  for (const uuid of Array.isArray(f.conditionTargetUuids) ? f.conditionTargetUuids : []) {
    const a = resolveActorByUuid(uuid);
    if (a?.id) byId.set(a.id, a);
  }
  for (const a of actors ?? []) if (a?.id) byId.set(a.id, a);
  const named = merged.map(id => byId.get(id) ?? globalThis.game?.actors?.get?.(id)).filter(Boolean);
  const update = { [`flags.${SYSTEM_ID}.${flagKey}`]: merged };
  const doc = parseMessageContent(message.content);
  const slot = doc.querySelector(`.${NOTICE_SLOT}`);
  if (slot) {
    slot.innerHTML = appliedNoticeInner(named);
    update.content = doc.body.innerHTML;
  }
  try {
    await message.update(update);
    return true;
  } catch (err) {
    console.warn('Sprinter RPG | Could not update the spell card with the applied conditions:', err);
    return false;
  }
}

/**
 * An Inflict click on a spell card, for a target this client may not write: ask the GM through the spell relay.
 * The GM re-checks the holder, the tag and that the card lists the target.
 * @returns {Promise<boolean>} true when the GM applied it
 */
export async function relaySpellInflict(message, spell, targetActor, tag) {
  if (!message?.id || !spell?.uuid || !targetActor?.uuid || typeof tag !== 'string' || !tag) return false;
  try {
    return Boolean(await relayOne(targetActor, spell, tag, message.id));
  } catch (err) {
    console.warn(`Sprinter RPG | Could not apply [${tag}] to ${targetActor.name}:`, err);
    warn(`Sprinter RPG | Could not apply [${tag}] to ${targetActor.name}.`);
    return false;
  }
}

/** True when a burst/area aimed at enemies leaves its own caster out; the caster is then no condition target. */
export function spellSkipsCaster(actor, spell, targetActor, isBurstOrArea) {
  const sys = spell?.system || {};
  return Boolean(targetActor) && targetActor.id === actor?.id && Boolean(isBurstOrArea)
    && (sys.area?.targetFilter === 'enemies' || !sys.area?.targetFilter);
}

/**
 * Apply a spell's conditions to its targets, skipping the caster of a burst/area aimed at enemies.
 * @param {object} actor the caster
 * @param {object} spell
 * @param {Array<object>} targets actors or tokens (`{ actor }`)
 * @param {{ isCrit?: boolean, conditionTags?: string[], isBurstOrArea?: boolean, conditionRounds?: number, messageId?: string, pending?: object[] }} [opts]
 *   a card builder passes the tags and flags it already computed. A target this client may not write goes through the GM,
 *   which needs the posted card: `messageId` when the card exists, else `pending` collects `{ targetActor, tag }` for
 *   `relayPendingSpellConditions` to send once it does.
 * @returns {Promise<object[]>} the target actors the conditions were applied to
 */
export async function applySpellConditions(actor, spell, targets, opts = {}) {
  const sys = spell?.system || {};
  const conditionTags = opts.conditionTags ?? getItemInflictedConditions(actor, spell, { isCrit: opts.isCrit === true });
  const isBurstOrArea = Boolean(opts.isBurstOrArea);
  const conditionRounds = opts.conditionRounds ?? 0;
  const applied = [];
  for (const t of targets || []) {
    const targetActor = t.actor || t;
    if (!targetActor) continue;
    if (spellSkipsCaster(actor, spell, targetActor, isBurstOrArea)) continue;
    let attempted = 0;
    let succeeded = 0;
    for (const tag of conditionTags) {
      attempted += 1;
      try {
        const ok = await applyOne(targetActor, spell, tag, {
          source: spell.name,
          sourceItem: spell,
          duration: sys.duration || '1 scene',
          durationRounds: conditionRounds
        }, { messageId: opts.messageId, pending: opts.pending });
        if (ok === true) succeeded += 1;
      } catch (err) {
        // One failure never blocks the other targets or the card that reports the hit.
        console.warn(`Sprinter RPG | Could not apply [${tag}] to ${targetActor.name}:`, err);
        warn(`Sprinter RPG | Could not apply [${tag}] to ${targetActor.name}.`);
      }
    }
    if (attempted > 0 && succeeded === 0) continue;
    if (!applied.some(a => a.id === targetActor.id)) applied.push(targetActor);
  }
  return applied;
}

/**
 * The "Inflicts Condition" block with one Inflict button per condition tag; '' when there are none.
 * @param {object} actor the caster
 * @param {object} spell
 * @param {string[]} conditionTags
 * @param {{ isBurstOrArea?: boolean, conditionRounds?: number, appliedTargets?: object[], effectSummaryHtml?: string }} [opts]
 *   `effectSummaryHtml` is `spellConditionSummary`'s result, computed by the async caller (this function is synchronous)
 * @returns {string}
 */
export function spellConditionActionsHtml(actor, spell, conditionTags, { isBurstOrArea = false, conditionRounds = 0, appliedTargets = [], effectSummaryHtml = '' } = {}) {
  if (!conditionTags?.length) return '';
  const sys = spell.system || {};
  const radiusLabel = sys.area?.radius ? `${sys.area.radius}ft ` : '';
  const filterLabel = targetFilterLabel(sys.area?.targetFilter) || 'Enemies';
  const appliedNotice = `<div class="${NOTICE_SLOT}">${appliedNoticeInner(appliedTargets)}</div>`;

  const buttonsHtml = conditionTags.map(tag => {
    const tagDef = getTagDefinition(tag) || { label: tag.replace(/^condition\./, '') };
    const label = tagDef.label || tag;
    return `
          <button type="button" class="cog-apply-condition-btn cog-apply-debuff-btn cog-bg-accent-fill cog-text-on-fill" data-action="crawlerApplyCondition"
            data-condition-tag="${tag}"
            data-duration-rounds="${conditionRounds}"
            data-debuff-name="${escapeAttr(label)}"
            data-item-id="${spell.id || spell._id}"
            data-item-name="${escapeAttr(spell.name)}"
            data-actor-uuid="${actor.uuid}"
            data-is-burst="${isBurstOrArea}"
            data-radius="${sys.area?.radius || 5}"
            data-target-filter="${sys.area?.targetFilter || 'enemies'}"
            style="width: 100%; border: 1px solid var(--cog-accent-strong-fill); border-radius: 3px; padding: 4px; font-size: 11px; cursor: pointer; font-weight: bold; font-family: var(--font-primary, sans-serif);">
            <i class="fa-solid fa-skull"></i> Inflict [${escapeAttr(label)}] ${isBurstOrArea ? '(Burst Area)' : 'on Target(s)'}
          </button>
        `;
  }).join('');

  return `
        <div class="cog-spell-condition-actions cog-bg-danger-tint" style="margin-top: 8px; padding: 6px 8px; border: 1px solid var(--cog-danger); border-radius: 4px;">
          <div class="cog-text-accent" style="font-size: 11px; font-weight: bold; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
            <i class="fa-solid fa-skull-crossbones"></i>
            ${isBurstOrArea ? `Inflicts in Burst Area (${radiusLabel}${filterLabel}):` : `Inflicts Condition on Target:`}
          </div>
          ${appliedNotice}
          <div style="display: flex; flex-direction: column; gap: 4px;">
            ${buttonsHtml}
          </div>
          ${effectSummaryHtml}
        </div>
      `;
}

/**
 * The "What this does" section for the conditions a spell card offers: each condition's rules, and
 * nothing of the spell. '' when no condition has rules text.
 * @param {object} actor the caster
 * @param {object} spell
 * @param {string[]} conditionTags
 * @returns {Promise<string>}
 */
export function spellConditionSummary(actor, spell, conditionTags) {
  const effects = (Array.isArray(conditionTags) ? conditionTags : []).map((ref) => ({ kind: 'debuffs', ref }));
  return cardSummary(spell, OMIT_ALL, { actor, effects });
}
