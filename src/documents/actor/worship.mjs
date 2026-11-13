/**
 * Worship actions as plain functions over an actor and its embedded deity item (core rulebook pp. 163-164, 312).
 * A god the crawler has met is a `known` deity item; worshipping it sets the bond to `worshipper` and embeds the god's
 * tier gifts as buffs. Permissive adjudication: every limit the book sets (a second god, worshipping while Fallen,
 * Zealot without a Cleric or Paladin archetype) is a Rule Break the player may confirm.
 *
 * A player writes only their own actor here; the GM-side effects (day sweep, offenses) are other modules'.
 */
import { confirmRuleBreak, ruleBreakUpdate } from '../../utils/rule-break.mjs';
import { firstScalar } from '../../utils/first-scalar.mjs';
import { itemIdentifier } from '../../utils/identifier.mjs';
import { CLERGY_ARCHETYPE_TAGS, WORSHIP_TAGS } from '../../data/tag-vocabulary.mjs';
import {
  NON_CLERGY_MAX_TIER, SHUNNED_MAX, WORSHIP_TIERS, BOND_STATUSES, BOND_KNOWN_VIA,
  bondOf, deityGiftOf, deityIdOf, freshBond
} from '../../utils/deity/worship-state.mjs';
import { tierGiftPlan } from '../../utils/deity/tier-gifts.mjs';
import { raceClassView } from '../../data/race-class-plan.mjs';
import { checkRequirements } from '../../utils/character/requirements.mjs';
import { postWorshipNotice } from '../../chat/worship-card.mjs';
import { noticeRivalPatron } from './patron-notices.mjs';
import { collectActorTags } from '../active-tags.mjs';
import { say } from './vehicle-drive-common.mjs';
import { RACE_CLASS_TYPES, isEffectItem } from '../../utils/document-types.mjs';

const MAX_TIER = WORSHIP_TIERS.zealot;
const BIG = Number.MAX_SAFE_INTEGER;
const clampInt = (raw, min, max) => {
  const n = Math.trunc(Number(firstScalar(raw, 0)));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
};
const nullableInt = (raw) => {
  const first = firstScalar(raw, null);
  if (first === null || first === '') return null;
  const n = Math.trunc(Number(first));
  return Number.isFinite(n) ? n : null;
};

/** One sanitiser per bond field `writeBond` accepts; anything else in a patch is dropped. */
const BOND_WRITERS = Object.freeze({
  status: (v) => (BOND_STATUSES.includes(firstScalar(v)) ? firstScalar(v) : undefined),
  knownVia: (v) => (BOND_KNOWN_VIA.includes(firstScalar(v)) ? firstScalar(v) : undefined),
  tier: (v) => clampInt(v, 0, MAX_TIER),
  zealotSkill: (v) => String(firstScalar(v, '') ?? '').trim(),
  since: (v) => { const first = firstScalar(v, null); const n = Number(first); return first === null || first === '' || !Number.isFinite(n) ? null : n; },
  lastOfferingDay: nullableInt,
  missedDays: (v) => clampInt(v, 0, BIG),
  streak: (v) => clampInt(v, 0, BIG),
  offenses: (v) => clampInt(v, 0, BIG),
  shunned: (v) => clampInt(v, 0, SHUNNED_MAX)
});

/** The dotted update for a partial bond: sanitised, unknown keys dropped, `floorOfferings` as a nested partial. */
function bondUpdate(patch) {
  const update = {};
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (key === 'floorOfferings' && value && typeof value === 'object') {
      if ('floor' in value) update['system.bond.floorOfferings.floor'] = String(firstScalar(value.floor, '') ?? '').trim();
      if ('count' in value) update['system.bond.floorOfferings.count'] = clampInt(value.count, 0, BIG);
      continue;
    }
    const clean = BOND_WRITERS[key]?.(value);
    if (clean !== undefined) update[`system.bond.${key}`] = clean;
  }
  return update;
}

/**
 * Write part of a deity item's bond. Each value is sanitised (a tier clamps to 0-3, Shunned to 0-2, a bad status is
 * ignored); keys that are not bond fields are dropped.
 * @param {object} deityItem
 * @param {object} patch e.g. `{ missedDays: 0, floorOfferings: { count: 2 } }`
 */
export async function writeBond(deityItem, patch) {
  const update = bondUpdate(patch);
  if (!Object.keys(update).length) return deityItem;
  await deityItem.update(update);
  return deityItem;
}

const deityItems = (actor) => Array.from(actor?.items ?? []).filter((i) => i?.type === 'deity');
const now = () => Number(globalThis.game?.time?.worldTime) || 0;

/** Ask one question with a button per answer. Resolves the pressed action, or null (closed, or no dialog available). */
async function askChoice({ title, content, buttons }) {
  const Dialog = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof Dialog?.wait !== 'function') return null;
  try {
    return await Dialog.wait({ window: { title }, content: `<p>${content}</p>`, buttons, rejectClose: false });
  } catch {
    return null;
  }
}

/**
 * The embedded known deity for a god: the actor's existing item of that identifier, else a new one with its bond reset.
 * @param {object} actor
 * @param {object} deityDoc a world, compendium or catalog deity (or another actor's)
 * @param {{ via?: 'seen'|'temple'|'scroll'|'gm' }} [options] how the crawler learned of it (p. 163)
 * @returns {Promise<object|null>} the embedded item
 */
export async function addKnownDeity(actor, deityDoc, { via = 'seen' } = {}) {
  if (!actor || !deityDoc) return null;
  const identifier = deityIdOf(deityDoc) || itemIdentifier(deityDoc);
  const existing = deityItems(actor).find((i) => deityIdOf(i) === identifier);
  if (existing) return existing;
  const data = typeof deityDoc.toObject === 'function' ? deityDoc.toObject() : structuredClone(deityDoc);
  delete data._id;
  delete data.id;
  data.system = { ...(data.system ?? {}), identifier, bond: freshBond(via) };
  const [created] = await actor.createEmbeddedDocuments('Item', [data]);
  return created ?? null;
}

/** The item types that carry `requirements`. */
const REQUIRING_TYPES = RACE_CLASS_TYPES;

/**
 * The race and class rows that are met now and would be unmet if these bonds changed: the explicit re-check on starting
 * or leaving worship (the actor is choosing to change worship; nothing else re-checks a race or class once applied).
 * @param {object} actor
 * @param {{ item: object, bond: object }[]} changes the deity items and the bond fields they would take
 * @returns {string[]} one "<race or class>: <row line>" per row the change breaks
 */
function brokenRequirements(actor, changes) {
  const before = raceClassView(actor);
  const after = raceClassView(actor);
  for (const { item, bond } of changes) {
    const row = after.items.find((i) => i._id === item.id);
    if (row) row.system.bond = { ...row.system.bond, ...bond };
  }
  const broken = [];
  for (const def of Array.from(actor.items ?? [])) {
    if (!REQUIRING_TYPES.includes(def?.type)) continue;
    const was = checkRequirements(before, def).rows;
    const now = checkRequirements(after, def).rows;
    now.forEach((row, i) => {
      if (row.status === 'unmet' && was[i]?.status === 'met') broken.push(`${def.name}: ${row.line}`);
    });
  }
  return broken;
}

/** Ask one Rule Break when a worship change breaks a race or class row. `key` is the Lang key of the question. */
async function confirmWorshipRequirements(actor, deityItem, changes, key, fallback, options) {
  const broken = brokenRequirements(actor, changes);
  if (!broken.length) return { ok: true, ruleBreak: false };
  const text = say(key, fallback, { deity: deityItem.name, lines: broken.join('; ') });
  const answer = await confirmRuleBreak({ title: say('COG.Deity.Worship.RequirementTitle', 'Requirement broken'), message: text, reason: text, options });
  return answer.confirmed ? { ok: true, ruleBreak: true } : { ok: false, ruleBreak: false, reason: answer.refusal ?? 'cancelled' };
}

/** The actor's tier and standing gifts of one god (the buffs and debuffs the plan may create, update or delete). */
function ownedTierGifts(actor, deityItem) {
  const id = deityIdOf(deityItem);
  return Array.from(actor.items ?? []).filter((item) => {
    if (!isEffectItem(item)) return false;
    const gift = deityGiftOf(item);
    return gift && gift.deity === id && (gift.kind === 'tier' || gift.kind === 'standing');
  });
}

/**
 * Make the actor's embedded tier and standing gifts of this god match its bond: the `tierEffects` up to the worshipped
 * tier plus the standing buff, none when the god is not worshipped. Gifts already right keep their item ids.
 * @returns {Promise<{ create: object[], deleteIds: string[], update: object[] }>} the plan that was applied
 */
export async function syncTierGifts(actor, deityItem) {
  const userId = globalThis.game?.user?.id ?? '';
  const plan = tierGiftPlan(deityItem, bondOf(deityItem), ownedTierGifts(actor, deityItem), { now: now(), userId });
  if (plan.deleteIds.length) await actor.deleteEmbeddedDocuments('Item', plan.deleteIds);
  if (plan.update.length) await actor.updateEmbeddedDocuments('Item', plan.update);
  if (plan.create.length) await actor.createEmbeddedDocuments('Item', plan.create);
  return plan;
}

/**
 * Begin worshipping a known god at Acolyte. A crawler tagged `worship.fallen` may not worship (p. 163) and a second god
 * is asked about (leave the first, keep both as a Rule Break, or cancel).
 * @returns {Promise<{ ok: boolean, ruleBreak: boolean, reason?: string }>}
 */
export async function startWorship(actor, deityItem, { options } = {}) {
  if (bondOf(deityItem).status === 'worshipper') return { ok: true, ruleBreak: false, reason: 'already' };
  let ruleBreak = false;

  if (collectActorTags(actor).has(WORSHIP_TAGS.fallen)) {
    const answer = await confirmRuleBreak({
      title: say('COG.Deity.Worship.FallenTitle', 'Fallen from Grace'),
      reason: say('COG.Deity.Worship.FallenReason', '{actor} is Fallen from Grace and cannot worship any deity (p. 163). Worship {deity} anyway as a Rule Break?', { actor: actor.name, deity: deityItem.name }),
      options
    });
    if (!answer.confirmed) return { ok: false, ruleBreak: false, reason: answer.refusal ?? 'cancelled' };
    ruleBreak = true;
  }

  let leaving = [];
  const others = deityItems(actor).filter((i) => i.id !== deityItem.id && bondOf(i).status === 'worshipper');
  if (others.length) {
    const choice = await askChoice({
      title: say('COG.Deity.Worship.SecondTitle', 'Another god'),
      content: say('COG.Deity.Worship.SecondBody', '{actor} already worships {others}. Leave that faith (a smite is due), keep both as a Rule Break, or cancel?', { actor: actor.name, others: others.map((o) => o.name).join(', ') }),
      buttons: [
        { action: 'leave', label: say('COG.Deity.Worship.Leave', 'Leave the old faith') },
        { action: 'both', label: say('COG.Deity.Worship.KeepBoth', 'Keep both') },
        { action: 'cancel', label: say('COG.Deity.Worship.Cancel', 'Cancel') }
      ]
    });
    if (choice === 'leave') {
      leaving = others;
    } else if (choice === 'both') {
      const answer = await confirmRuleBreak({
        title: say('COG.Deity.Worship.SecondTitle', 'Another god'),
        reason: say('COG.Deity.Worship.KeepBothReason', 'Worshipping two gods at once is outside the rules (p. 163). Keep both as a Rule Break?'),
        options
      });
      if (!answer.confirmed) return { ok: false, ruleBreak: false, reason: answer.refusal ?? 'cancelled' };
      ruleBreak = true;
    } else {
      return { ok: false, ruleBreak: false, reason: 'cancelled' };
    }
  }

  // The new faith and any faith left behind are judged together: a row that any god satisfies stays met.
  const changes = [
    { item: deityItem, bond: { status: 'worshipper', tier: WORSHIP_TIERS.acolyte } },
    ...leaving.map((item) => ({ item, bond: { status: 'former', tier: 0 } }))
  ];
  const recheck = await confirmWorshipRequirements(actor, deityItem, changes, 'COG.Deity.Worship.StartBreaks',
    'Worshipping {deity} breaks {lines}. Worship anyway as a Rule Break?', options);
  if (!recheck.ok) return { ok: false, ruleBreak: false, reason: recheck.reason };
  ruleBreak = ruleBreak || recheck.ruleBreak;
  for (const other of leaving) await leaveWorship(actor, other, { reason: 'switched', options, recheck: false });

  const update = bondUpdate({
    status: 'worshipper', tier: WORSHIP_TIERS.acolyte, since: now(), lastOfferingDay: null,
    missedDays: 0, streak: 0, offenses: 0, shunned: 0, zealotSkill: '', floorOfferings: { floor: '', count: 0 }
  });
  if (ruleBreak) Object.assign(update, ruleBreakUpdate());
  await deityItem.update(update);
  await syncTierGifts(actor, deityItem);
  await noticeRivalPatron(actor, deityItem);
  return { ok: true, ruleBreak };
}

/**
 * Stop worshipping a god. Its tier, standing and boon gifts are deleted (smites stay), the bond becomes `former`, and
 * a GM notice says a smite is due: leaving the faith voluntarily means being smote (p. 163).
 * A race or class row that needs this faith and would break asks one Rule Break first (Cancel keeps the worship).
 * @param {{ reason?: string, options?: object, recheck?: boolean }} [opts] `reason` is 'left', 'switched' or 'fallen'; `recheck: false`
 *   skips the requirement check (a switch is judged once by `startWorship`)
 */
export async function leaveWorship(actor, deityItem, { reason = 'left', options, recheck = true } = {}) {
  if (bondOf(deityItem).status !== 'worshipper') return { ok: false, reason: 'not-worshipping' };
  let ruleBreak = false;
  if (recheck) {
    const verdict = await confirmWorshipRequirements(actor, deityItem, [{ item: deityItem, bond: { status: 'former', tier: 0 } }],
      'COG.Deity.Worship.LeaveBreaks', 'Leaving {deity} breaks {lines}. Leave anyway as a Rule Break?', options);
    if (!verdict.ok) return { ok: false, ruleBreak: false, reason: verdict.reason };
    ruleBreak = verdict.ruleBreak;
  }
  const id = deityIdOf(deityItem);
  const kinds = ['tier', 'standing', 'boon'];
  const ids = Array.from(actor.items ?? [])
    .filter((item) => {
      const gift = deityGiftOf(item);
      return gift && gift.deity === id && kinds.includes(gift.kind);
    })
    .map((item) => item.id);
  if (ids.length) await actor.deleteEmbeddedDocuments('Item', ids);
  const update = bondUpdate({ status: 'former', tier: 0, zealotSkill: '' });
  if (ruleBreak) Object.assign(update, ruleBreakUpdate());
  await deityItem.update(update);
  // A fall from grace is the GM's own call (its card carries the smite chance); only a voluntary leave makes a smite due
  if (reason !== 'fallen') await postWorshipNotice('smiteDue', { actor, deity: deityItem, reason });
  return { ok: true, ruleBreak };
}

/**
 * Set the worshipped tier (1 Acolyte, 2 Devotee, 3 Zealot), clamped. Above Devotee is for a Cleric or Paladin only
 * (p. 163): anyone else confirms a Rule Break. A Zealot with several signature Skills picks the one whose cap rises (p. 164).
 * @param {{ zealotSkill?: string, options?: object }} [opts]
 * @returns {Promise<{ ok: boolean, ruleBreak: boolean, tier?: number, reason?: string }>}
 */
export async function setWorshipTier(actor, deityItem, tier, { zealotSkill, options } = {}) {
  const bond = bondOf(deityItem);
  if (bond.status !== 'worshipper') return { ok: false, ruleBreak: false, reason: 'not-worshipping' };
  const wanted = clampInt(tier, WORSHIP_TIERS.acolyte, MAX_TIER);
  let ruleBreak = false;

  if (wanted > NON_CLERGY_MAX_TIER) {
    const archetypes = new Set(actor.getArchetypeTags?.() ?? []);
    if (!CLERGY_ARCHETYPE_TAGS.some((tag) => archetypes.has(tag))) {
      const answer = await confirmRuleBreak({
        title: say('COG.Deity.Worship.ZealotTitle', 'Zealot'),
        reason: say('COG.Deity.Worship.ZealotReason', 'Only a Cleric or Paladin rises above Devotee (p. 163). Make {actor} a Zealot of {deity} as a Rule Break?', { actor: actor.name, deity: deityItem.name }),
        options
      });
      if (!answer.confirmed) return { ok: false, ruleBreak: false, reason: answer.refusal ?? 'cancelled' };
      ruleBreak = true;
    }
  }

  let chosen = '';
  if (wanted === MAX_TIER) {
    const skills = Array.isArray(deityItem.system?.signature?.skills) ? deityItem.system.signature.skills : [];
    const named = String(zealotSkill ?? '').trim();
    if (named && skills.includes(named)) chosen = named;
    else if (bond.zealotSkill && skills.includes(bond.zealotSkill)) chosen = bond.zealotSkill;
    else if (skills.length === 1) chosen = skills[0];
    else if (skills.length > 1) {
      const answer = await askChoice({
        title: say('COG.Deity.Worship.ZealotSkillTitle', 'Zealot skill'),
        content: say('COG.Deity.Worship.ZealotSkillBody', 'Which of {deity}\'s signature Skills gains the higher Rank cap?', { deity: deityItem.name }),
        buttons: [...skills.map((skill) => ({ action: skill, label: skill })), { action: 'cancel', label: say('COG.Deity.Worship.Cancel', 'Cancel') }]
      });
      if (!skills.includes(answer)) return { ok: false, ruleBreak: false, reason: 'cancelled' };
      chosen = answer;
    }
  }

  const update = bondUpdate({ tier: wanted, zealotSkill: chosen });
  if (ruleBreak) Object.assign(update, ruleBreakUpdate());
  await deityItem.update(update);
  await syncTierGifts(actor, deityItem);
  return { ok: true, ruleBreak, tier: wanted };
}
