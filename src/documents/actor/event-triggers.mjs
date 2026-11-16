/**
 * Event triggers: rows of `eventTriggers` on an actor's race, class, equipped gear, buffs and skills that do something when an
 * event happens. The events are a `kill` (lethal damage the actor applied) and a `use` (a posted use card of a skill, attack or
 * spell, `fireUseTriggers`) and a `levelUp` (each Level a crawler gains, `fireLevelUpTriggers`); the row's kind (`heal`, `gold`,
 * `debuff`, `buff`, `check`, `aiFavor`) says what.
 * `matchEventTriggers` judges the rows (`evaluateRows`, then each kind's `fire` stage, which only describes the effect) and
 * splits them by the row's limit; `fireEventTriggers` asks a Rule Break for a spent limit, applies the effects, counts the uses
 * (`utils/floor/trigger-usage.mjs`) and posts one chat card.
 *
 * Who writes is the rule kill Popularity follows (`actor-popularity.mjs`): the actor's owner or the GM applies directly; any
 * other client (a player applying damage for a crawler they do not own) asks the GM through the relay. That request names the
 * victim and the damage application, never an amount or a tag: the GM rebuilds the context from the victim's undo record
 * (`killContextOf`) and refuses a record that is undone, not lethal or already marked (`triggersFired`).
 * Popularity's Floor 2 rule does not apply: these are not Popularity. Undoing the killing damage does not take back what was given.
 */
import { evaluateRows } from '../../utils/roll/damage-modifiers.mjs';
import { applyRowKind, getRowKind, kindOf } from '../../utils/row-kinds.mjs';
import { TRIGGER_EVENTS } from '../../models/fields/modifier-fields.mjs';
import { extendContext, buildRollContext } from '../../utils/roll/roll-context.mjs';
import { COG_ROLL_OUTCOMES, extractD20Result } from '../session/roll-outcomes.mjs';
import { OUTCOME_TAGS } from '../../data/tag-vocabulary.mjs';
import { applyCondition } from './actor-conditions.mjs';
import { landBuff, gatherBuffRecipients, buffStackState, stackCapText } from './item-buffs.mjs';
import { canWriteActor } from './aura-relay.mjs';
import { findConditionEntry } from '../../content/catalog-lookup.mjs';
import { buffCopyData, buildAppliedBuff } from '../../utils/effects/applied-buff.mjs';
import { buffCardText } from '../../utils/card/buff-card-text.mjs';
import { actingRank } from '../../utils/skill/rank-source.mjs';
import { addAiFavor } from '../../chat/actions/ai-favor-tally.mjs';
import { TRIGGER_USAGE_FLAG, usesSoFar, withUses } from '../../utils/floor/trigger-usage.mjs';
import { readFlag, withFlags, writeFlag } from '../../utils/flags.mjs';
import { registerRelayAction, requestRelay } from '../../utils/gm-relay.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { ruleBreakBadgeHtml, ruleBreakMessageData } from '../../utils/rule-break-visibility.mjs';
import { ownerAndGmIds } from '../../utils/owner-recipients.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { runKeyed } from '../../utils/keyed-queue.mjs';
import { findDamageUndoRecord, markDamageUndoTriggersFired } from '../../utils/damage/damage-undo.mjs';
import { currentTokens, killApplicationPayable, killContextOf, readApplication } from './actor-popularity.mjs';
import { skillStandIn } from '../../utils/skill/skill-stand-in.mjs';
import { AFTER_KILL_CHECK_FLAG } from '../../chat/actions/after-kill-check.mjs';

const FIRE_EVENT_TRIGGERS = 'fireEventTriggers';

/** The event of a Level gained, fired once per Level by `fireLevelUpTriggers`. */
const LEVEL_UP_EVENT = 'levelUp';

/** The flag a chat card of a firing carries. */
const CARD_FLAG = 'eventTriggerCard';

const TEMPLATES = {
  'COG.EventTrigger.Healed': '{label}: healed {slots} {slotWord}',
  'COG.EventTrigger.HealBlocked': '{label}: no healing',
  'COG.EventTrigger.Gold': '{label}: +{amount} gold',
  'COG.EventTrigger.AiFavor': '{label}: +{amount} AI Favor',
  'COG.EventTrigger.Debuff': '{label}: you gain {debuff}',
  'COG.EventTrigger.DebuffBlocked': '{label}: {debuff} did not land',
  'COG.EventTrigger.Buff': '{label}: {buff} on {names}',
  'COG.EventTrigger.BuffSkipped': 'skipped {names}',
  'COG.EventTrigger.BuffBlocked': '{label}: {buff} did not land',
  'COG.EventTrigger.BuffAtCap': 'at its cap on {names}',
  'COG.EventTrigger.NotYours': 'not yours to change',
  'COG.EventTrigger.CheckOffer': '{label}: roll {skill}',
  'COG.EventTrigger.CheckButton': 'Roll {skill}',
  'COG.EventTrigger.RuleBreakTitle': 'Trigger Limit',
  'COG.EventTrigger.RuleBreakMessage': '{label} already fired {used} of {limit} times this {scope}. Fire it again as a Rule Break?',
  'COG.EventTrigger.Slot': 'slot',
  'COG.EventTrigger.Slots': 'slots'
};

function t(key, data = {}) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.format === 'function') return i18n.format(key, data);
  return TEMPLATES[key].replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? ''));
}

/**
 * The rows of `event` on the actor that match `context`, split by their limit. A row with no `oncePer` always fires; one with
 * a limit fires while its count in the current combat or floor is below `limit`, and is `spent` after. Pure given the record.
 * @param {Actor} actor
 * @param {string} event one of `TRIGGER_EVENTS`
 * @param {{ tags: Iterable<string> }} context the event's RollContext (a kill: the per-target context, the victim as `subject.*`)
 * @param {{ combat: string, floor: string }} tokens the current scope tokens (`currentTokens`)
 * @param {object|null} [record] the actor's stored usage (`triggerUsage`); read from the actor when omitted
 * @returns {{ fire: Array<object>, spent: Array<object> }} effect descriptions (`{ type, key, label, oncePer, limit, ... }`); a spent one also carries `used`
 */
function matchEventTriggers(actor, event, context, tokens, record = readFlag(actor, TRIGGER_USAGE_FLAG)) {
  const out = { fire: [], spent: [] };
  if (!actor || !TRIGGER_EVENTS.includes(event) || !context?.tags) return out;
  for (const { source, row, key } of evaluateRows(actor, 'eventTriggers', context)) {
    if (row.event !== event) continue;
    const def = getRowKind('eventTriggers', kindOf('eventTriggers', row));
    const effects = [];
    applyRowKind('eventTriggers', def, 'fire', effects, row, { actor, source, context, key, label: row.label || source.name || 'Trigger' });
    for (const effect of effects) {
      // a Level gained has no limit (the book gives none): the row's `oncePer` is ignored for it
      if (event === LEVEL_UP_EVENT) effect.oncePer = '';
      const used = effect.oncePer ? usesSoFar(record, tokens, effect.oncePer, effect.key) : 0;
      if (effect.oncePer && used >= effect.limit) out.spent.push({ ...effect, used });
      else out.fire.push(effect);
    }
  }
  return out;
}

/** The item a buff effect came from: resolved from its uuid, else the user's own item with that uuid. */
function sourceOf(actor, effect) {
  if (!effect.sourceUuid) return null;
  return globalThis.fromUuidSync?.(effect.sourceUuid) ?? Array.from(actor.items ?? []).find((i) => i.uuid === effect.sourceUuid) ?? null;
}

/** A skill or spell row's copy takes its duration from the item, as a use card's copy does; null when the copy keeps the buff's own. */
function copyWithItemDuration(actor, source, effect, rank) {
  if (!['skill', 'spell'].includes(source?.type)) return null;
  return buildAppliedBuff(actor, source, { index: -1, row: { buff: effect.ref } }, { rank, messageId: '' });
}

/** The copy a `buff` effect lands, the item the row is on and the recipients it reaches; null when the catalog has no such buff. */
function buffEffectPlan(actor, effect) {
  const entry = findConditionEntry('buffs', effect.ref);
  if (!entry) return null;
  const source = sourceOf(actor, effect);
  const data = buffCopyData(effect.ref);
  const rank = ['skill', 'spell'].includes(source?.type) ? actingRank(source) : 0;
  if (rank > 0) data.system = { ...data.system, rank };
  let copy = withFlags(data, { appliedBy: { messageId: '', sourceUuid: effect.sourceUuid, sourceName: source?.name ?? effect.label, casterUuid: actor.uuid ?? '' } });
  copy = copyWithItemDuration(actor, source, effect, rank) ?? copy;
  const { recipients } = gatherBuffRecipients(actor, source, { row: { target: effect.target, range: effect.range } }, { rank: rank || 1, buffData: copy });
  return { entry, copy, recipients };
}

/** The recipients of a plan a row may land on: no reason to doubt them, and this client can write them. */
function landableRecipients(plan) {
  return plan.recipients.filter(({ actor, reasons }) => reasons.length === 0 && canWriteActor(actor)).map(({ actor }) => actor);
}

/**
 * The recipients of a `buff` effect whose stack is at its cap, each with the words of the Rule Break that lands one more.
 */
function buffsAtCap(actor, effect) {
  const plan = buffEffectPlan(actor, effect);
  if (!plan) return [];
  return landableRecipients(plan).flatMap((recipient) => {
    const state = buffStackState(recipient, plan.copy);
    return state?.full ? [stackCapText(recipient, plan.copy, state)] : [];
  });
}

/**
 * A `buff` effect: land the catalog buff on who the row reaches, here. A recipient with a reason to doubt (out of reach, wrong kind or side, immune) or one
 * this client cannot write is skipped and named; a second copy of one the recipient owns is declined, never asked about. A
 * stack at its cap lands one more only when the cap was asked about first (`effect.capConfirmed`, `fireEventTriggers`); else
 * it is declined and named.
 */
async function applyBuffEffect(actor, effect, options) {
  const plan = buffEffectPlan(actor, effect);
  const base = { ...effect, buff: plan?.entry.name ?? findConditionEntry('buffs', effect.ref)?.name ?? effect.ref, landed: [], skipped: [], capped: [] };
  if (!plan) return { ...base, blocked: true };
  for (const { actor: recipient, reasons } of plan.recipients) {
    const doubt = reasons.map((r) => buffCardText(`COG.BuffCard.Reason.${r}`));
    if (!canWriteActor(recipient)) doubt.push(t('COG.EventTrigger.NotYours'));
    if (doubt.length) { base.skipped.push(`${recipient.name} (${doubt.join(', ')})`); continue; }
    const res = await landBuff(recipient, plan.copy, { options: { ...options, interactive: false, capConfirmed: effect.capConfirmed === true } });
    if (res.reason === 'cap') base.capped.push(recipient.name);
    else if (res.action === 'declined') base.skipped.push(recipient.name);
    else base.landed.push(recipient.name);
  }
  return base.landed.length ? base : { ...base, blocked: true };
}
/** Writers of the effect types that carry their own (a type with none is handled in `applyEffect`). */
const EFFECT_WRITERS = Object.freeze({
  // a gain while the day's bar is up asks a Rule Break; refused, nothing is written and no line is posted
  async aiFavor(actor, effect, options) {
    return (await addAiFavor(actor, effect.amount, effect.label, options)) ? effect : null;
  }
});

/** The card line of the effect types that carry their own text. */
const EFFECT_LINES = Object.freeze({
  aiFavor: (effect) => t('COG.EventTrigger.AiFavor', { label: effect.label, amount: effect.amount })
});

/** One effect written to the actor. Returns the card line's data, or null when nothing was done (healing refused). */
async function applyEffect(actor, effect, options) {
  if (effect.type === 'heal') {
    const res = await actor.applyHealingBars?.(effect.slots, options);
    return res?.blocked ? { ...effect, blocked: true } : effect;
  }
  if (effect.type === 'gold') {
    await runKeyed(`gold:${actor.uuid ?? ''}`, async () => {
      await actor.update({ 'system.currency.gold': (Number(actor.system?.currency?.gold) || 0) + effect.amount });
    });
    return effect;
  }
  const write = EFFECT_WRITERS[effect.type];
  if (write) return write(actor, effect, options);
  if (effect.type === 'debuff') {
    // Immunity, the repeat rule and a held secret debuff are applyCondition's: a null means nothing landed on the user
    const landed = await applyCondition(actor, effect.ref, { ...options, source: effect.label });
    return landed ? effect : { ...effect, blocked: true };
  }
  if (effect.type === 'buff') return applyBuffEffect(actor, effect, options);
  // an effect marked `offer` posts a card for the holder to act on instead of writing the actor
  if (effect.offer === true) return offerCheck(actor, effect);
  return null;
}

/**
 * Post the offer of a `check` effect: one card whispered to the holder's owners and the GM with a button that rolls the skill
 * (`crawlerAfterKillCheck`, chat/actions/after-kill-check.mjs). The effect comes back marked `offered`, so the firing's own card carries no line for it.
 */
async function offerCheck(actor, effect) {
  const skillName = skillStandIn(actor, effect.skill)?.name || effect.skill;
  const speaker = globalThis.ChatMessage?.getSpeaker?.({ actor });
  const button = `<button type="button" class="cog-check-offer-btn" data-action="crawlerAfterKillCheck"><i class="fa-solid fa-dice-d20"></i> ${escapeAttr(t('COG.EventTrigger.CheckButton', { skill: skillName }))}</button>`;
  await globalThis.ChatMessage?.create?.(withFlags({
    speaker,
    whisper: ownerAndGmIds(actor),
    content: `<div class="cog-chat-card"><p><i class="fa-solid fa-dice-d20"></i> ${escapeAttr(t('COG.EventTrigger.CheckOffer', { label: effect.label, skill: skillName }))}</p>${button}</div>`
  }, { [AFTER_KILL_CHECK_FLAG]: { actorUuid: actor.uuid ?? '', skill: effect.skill, used: false } }));
  return { ...effect, offered: true };
}

/** The card line text of one effect. */
function textOf(effect) {
  if (effect.type === 'buff') {
    const notes = [
      effect.skipped?.length ? t('COG.EventTrigger.BuffSkipped', { names: effect.skipped.join(', ') }) : '',
      effect.capped?.length ? t('COG.EventTrigger.BuffAtCap', { names: effect.capped.join(', ') }) : ''
    ].filter(Boolean);
    const head = effect.landed?.length
      ? t('COG.EventTrigger.Buff', { label: effect.label, buff: effect.buff, names: effect.landed.join(', ') })
      : t('COG.EventTrigger.BuffBlocked', { label: effect.label, buff: effect.buff });
    return [head, ...notes].join('; ');
  }
  const own = EFFECT_LINES[effect.type];
  if (own) return own(effect);
  if (effect.type === 'debuff') return t(effect.blocked ? 'COG.EventTrigger.DebuffBlocked' : 'COG.EventTrigger.Debuff', { label: effect.label, debuff: findConditionEntry('debuffs', effect.ref)?.name ?? effect.ref });
  if (effect.type === 'heal') {
    return effect.blocked
      ? t('COG.EventTrigger.HealBlocked', { label: effect.label })
      : t('COG.EventTrigger.Healed', { label: effect.label, slots: effect.slots, slotWord: t(effect.slots === 1 ? 'COG.EventTrigger.Slot' : 'COG.EventTrigger.Slots') });
  }
  return t('COG.EventTrigger.Gold', { label: effect.label, amount: effect.amount });
}

/** The Font Awesome icon of a card line, by the effect's type. */
function iconOf(type) {
  if (type === 'heal') return 'fa-heart';
  if (type === 'buff') return 'fa-sparkles';
  if (type === 'aiFavor') return 'fa-hand-holding-heart';
  return type === 'debuff' ? 'fa-bolt' : 'fa-coins';
}

/** The card's line for one applied effect, escaped. */
function lineOf(effect) {
  const text = textOf(effect);
  const icon = iconOf(effect.type);
  return `<p><i class="fa-solid ${icon}"></i> ${escapeAttr(text)}${effect.ruleBreak ? ` ${ruleBreakBadgeHtml({ cls: '' })}` : ''}</p>`;
}

/**
 * Apply what an event earns: the rows that fire plus the spent rows whose key is in `confirmedKeys` (those carry `ruleBreak`); a
 * buff row whose key is in `capConfirmedKeys` may add a copy past its stack's cap (it carries `ruleBreak` too).
 * One queue per actor, and the usage record is read inside it, so two firings both count. A heal the healing gate refused is
 * neither counted nor paid. Runs on a client that can write the actor (the owner, or the GM through the relay).
 * @returns {Promise<{ fired: Array<object> }>}
 */
function applyEventTriggers(actor, { event, context, confirmedKeys = [], capConfirmedKeys = [], combatId = '', triggeredBy = '', options = {} }) {
  return runKeyed(`event-triggers:${actor?.uuid ?? ''}`, async () => {
    const tokens = currentTokens(actor, combatId);
    const record = readFlag(actor, TRIGGER_USAGE_FLAG);
    const confirmed = new Set(confirmedKeys);
    const capConfirmed = new Set(capConfirmedKeys);
    const { fire, spent } = matchEventTriggers(actor, event, context, tokens, record);
    const earned = [...fire, ...spent.filter(e => confirmed.has(e.key)).map(e => ({ ...e, ruleBreak: true }))]
      .map(e => (capConfirmed.has(e.key) ? { ...e, capConfirmed: true, ruleBreak: true } : e));
    const fired = [];
    const refused = [];
    for (const effect of earned) {
      const done = await applyEffect(actor, effect, options);
      if (done?.blocked) refused.push(done);
      else if (done) fired.push(done);
    }
    const counted = fired.filter(e => e.oncePer).map(e => ({ scope: e.oncePer, key: e.key }));
    if (counted.length) await writeFlag(actor, TRIGGER_USAGE_FLAG, withUses(record, tokens, counted));
    const lines = [...fired.filter(e => !e.offered), ...refused];
    if (lines.length) {
      const anyRuleBreak = lines.some(e => e.ruleBreak);
      const card = withFlags({
        speaker: globalThis.ChatMessage?.getSpeaker?.({ actor }),
        whisper: ownerAndGmIds(actor),
        content: `<div class="cog-chat-card">${lines.map(lineOf).join('')}</div>`
      }, { [CARD_FLAG]: true, ruleBreak: anyRuleBreak, ...(triggeredBy ? { triggeredBy } : {}) });
      await globalThis.ChatMessage?.create?.(anyRuleBreak ? ruleBreakMessageData(card) : card);
    }
    return { fired };
  });
}

/**
 * The Rule Break for a stack at its cap, asked once per `buff` row before anything is written, on the client that may write
 * the holder (never inside the GM's relay, which cannot ask). One question per recipient at its cap; the row's key comes
 * back when every one was confirmed.
 * @returns {Promise<string[]>} the keys of the rows confirmed
 */
async function confirmStackCaps(actor, effects, options) {
  const keys = [];
  for (const effect of effects.filter(e => e.type === 'buff')) {
    const questions = buffsAtCap(actor, effect);
    if (questions.length === 0) continue;
    let all = true;
    for (const text of questions) {
      const res = await confirmRuleBreak({ title: text.title, message: text.message, reason: text.reason, options });
      all &&= res.confirmed;
    }
    if (all) keys.push(effect.key);
  }
  return keys;
}

/**
 * Fire an event on an actor: apply what matches, confirm what is past its limit, record uses, post one card.
 * @param {Actor} actor
 * @param {string} event one of `TRIGGER_EVENTS`
 * @param {object} [ctx]
 * @param {object} [ctx.context] the event's RollContext; a kill that names an application is judged on the context rebuilt from its undo record
 * @param {string} [ctx.combatId] the combat the event counts against
 * @param {{ victimUuid: string, applicationId: string }|null} [ctx.application] the damage application that killed (the once-per-kill mark and the relay's proof)
 * @param {object} [ctx.options] `interactive: false` skips the Rule Break prompts
 * @returns {Promise<{ fired: Array<object>, skipped?: string }>}
 */
export async function fireEventTriggers(actor, event, { context = null, combatId = '', application = null, options = {} } = {}) {
  if (!actor || !TRIGGER_EVENTS.includes(event)) return { fired: [], skipped: 'event' };
  const app = readApplication(application);
  const live = (event === 'kill' && app ? killContextOf(actor, app) : null) ?? context;
  if (!live?.tags) return { fired: [], skipped: 'no-context' };
  const tokens = currentTokens(actor, combatId);
  const { fire, spent } = matchEventTriggers(actor, event, live, tokens);
  if (fire.length === 0 && spent.length === 0) return { fired: [], skipped: 'no-match' };

  // A spent limit needs the Rule Break of the actor's owner or the GM; a non-owner is never asked
  const canWrite = Boolean(globalThis.game?.user?.isGM) || Boolean(actor.isOwner);
  const confirmedKeys = [];
  for (const effect of canWrite ? spent : []) {
    const res = await confirmRuleBreak({
      title: t('COG.EventTrigger.RuleBreakTitle'),
      message: t('COG.EventTrigger.RuleBreakMessage', { label: effect.label, used: effect.used, limit: effect.limit, scope: effect.oncePer }),
      options
    });
    if (res.confirmed) confirmedKeys.push(effect.key);
  }
  if (fire.length === 0 && confirmedKeys.length === 0) return { fired: [], skipped: 'limit' };
  const capConfirmedKeys = canWrite ? await confirmStackCaps(actor, [...fire, ...spent.filter(e => confirmedKeys.includes(e.key))], options) : [];

  const payload = { event, confirmedKeys, capConfirmedKeys, combatId, options };
  if (canWrite) {
    const direct = () => applyEventTriggers(actor, { ...payload, context: live, triggeredBy: globalThis.game?.user?.id ?? '' });
    if (!app) return direct();
    return runKeyed(`kill-trigger:${app.victimUuid}:${app.applicationId}`, async () => {
      // a record that is gone is not an error (the owner's own context stands); one that is undone or already fired is not paid
      const record = findDamageUndoRecord(resolveActorByUuid(app.victimUuid), app.applicationId);
      if (record && (record.undoneAt || record.triggersFired === true)) return { fired: [], skipped: 'no-application' };
      const result = await direct();
      await markFired(app);
      return result;
    });
  }
  // a non-owner may only ask for a kill, and never for a Rule Break; the GM checks the application
  if (event !== 'kill' || !app) return { fired: [], skipped: 'not-owner' };
  const res = await requestRelay(FIRE_EVENT_TRIGGERS, { actorUuid: actor.uuid, event, application: app, combatId });
  return res.ok ? (res.result ?? { fired: [] }) : { fired: [], skipped: res.reason ?? 'relay' };
}

/**
 * The context of a use: the use's own roll context (or one built from the item when nothing was rolled), plus the outcome
 * tags a kept d20 decides alone (a 1: `outcome.critical_failure`; a 20: `outcome.critical_success`). Anything that needs a
 * Difficulty is not known at the use. Pure.
 * @param {{ actor: Actor, item: Item, context?: object|null, d20?: number|null }} use
 * @returns {object} a RollContext
 */
function useEventContext({ actor, item, context = null, d20 = null }) {
  const base = context?.tags ? context : buildRollContext({ actor, phase: 'check', item });
  const outcome = d20 === 1 ? COG_ROLL_OUTCOMES.CRITICAL_FAILURE : (d20 === 20 ? COG_ROLL_OUTCOMES.CRITICAL_SUCCESS : null);
  return outcome ? extendContext(base, { tags: [OUTCOME_TAGS[outcome]] }) : base;
}

/**
 * Fire the `use` rows of the user for one posted use card (a skill's check or card, an attack's hit roll, a spell's cast).
 * @param {Actor} actor the user
 * @param {Item} item the skill, attack item or spell used
 * @param {{ context?: object|null, roll?: Roll|null, options?: object }} [use] `roll` is the use's d20 roll, when it rolled one
 * @returns {Promise<{ fired: Array<object> }>}
 */
export async function fireUseTriggers(actor, item, { context = null, roll = null, options = {} } = {}) {
  if (!actor || !item) return { fired: [] };
  const live = useEventContext({ actor, item, context, d20: roll ? extractD20Result(roll) : null });
  return fireEventTriggers(actor, 'use', { context: live, options });
}

/**
 * Fire the `levelUp` rows of a crawler for each Level it gained (a loop of `levels`, so a row worth 1 is 1 per Level).
 * @param {Actor} actor the crawler that gained the Levels
 * @param {number} levels how many Levels were gained
 * @param {object} [options] passed on (`interactive: false` skips the Rule Break prompts)
 * @returns {Promise<void>}
 */
export async function fireLevelUpTriggers(actor, levels, options = {}) {
  if (!actor) return;
  const count = Math.max(0, Math.trunc(Number(levels)) || 0);
  for (let i = 0; i < count; i++) {
    await fireEventTriggers(actor, LEVEL_UP_EVENT, { context: buildRollContext({ actor, phase: 'derived' }), options });
  }
}

/** Mark the named application's triggers fired; a missing victim or record is not an error. */
async function markFired(application) {
  const victim = resolveActorByUuid(application.victimUuid);
  if (victim) await markDamageUndoTriggersFired(victim, application.applicationId);
}

registerRelayAction(FIRE_EVENT_TRIGGERS, {
  authorize(p, user) {
    const actor = resolveActorByUuid(p?.actorUuid);
    if (!actor || !user || !TRIGGER_EVENTS.includes(p?.event)) return false;
    if (p.combatId !== undefined && typeof p.combatId !== 'string') return false;
    const application = readApplication(p.application);
    if (p.application !== undefined && !application) return false;
    if (user.isGM || actor.testUserPermission?.(user, 'OWNER')) return true;
    // any other user may ask only for a kill, naming the application that killed; the request carries no Rule Break
    return p.event === 'kill' && Boolean(application) && p.confirmedKeys === undefined && p.capConfirmedKeys === undefined;
  },
  async apply(p, user) {
    const actor = resolveActorByUuid(p.actorUuid);
    if (!actor) throw new Error(`Event trigger relay: actor ${p.actorUuid} not found.`);
    const application = readApplication(p.application);
    if (!application || p.event !== 'kill') return { fired: [], skipped: 'no-application' };
    const privileged = Boolean(user?.isGM) || Boolean(actor.testUserPermission?.(user, 'OWNER'));
    // check, apply and mark under one queue per application, so a repeated request cannot pay twice
    return runKeyed(`kill-trigger:${application.victimUuid}:${application.applicationId}`, async () => {
      if (!killApplicationPayable(actor, application, 'triggersFired')) return { fired: [], skipped: 'no-application' };
      const context = killContextOf(actor, application);
      if (!context) return { fired: [], skipped: 'no-context' };
      const result = await applyEventTriggers(actor, {
        event: p.event, context, confirmedKeys: privileged ? (p.confirmedKeys ?? []) : [], capConfirmedKeys: privileged ? (p.capConfirmedKeys ?? []) : [], combatId: p.combatId ?? '', triggeredBy: user?.id ?? ''
      });
      await markFired(application);
      return result;
    });
  }
});

