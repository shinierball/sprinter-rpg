/**
 * Bard patronage as plain functions over an actor and its embedded patron or deity item (core rulebook pp. 145-146,
 * 315-316). A patron is an NPC (`patron` item) or a god (`deity` item); both carry one patronage block. Permissive
 * adjudication: every limit the book sets is a Rule Break the player may confirm, recorded on the item's `ruleBreak` flag.
 *
 * A player writes only their own actor here (adding a prospect, choosing from an offer, leaving a patron); the GM writes
 * the rest.
 */
import { confirmRuleBreak, ruleBreakUpdate } from '../../utils/rule-break.mjs';
import { firstScalar } from '../../utils/first-scalar.mjs';
import { itemIdentifier } from '../../utils/identifier.mjs';
import { findCatalogEntry } from '../../content/catalog-lookup.mjs';
import { isCombatSkill } from '../../utils/tag/tag-mechanics.mjs';
import { effectiveFloor } from '../../utils/character/race-class-floor.mjs';
import { patronCriteria } from '../../utils/patron/criteria.mjs';
import { patronProfileOf } from '../../utils/patron/patron-profile.mjs';
import { murderBan } from '../../utils/patron/endings.mjs';
import {
  PATRONAGE_STATUSES, PATRONAGE_VIA, PATRONAGE_ENDINGS, PATRON_ATTITUDES, AUDITION_RESULTS,
  activePatrons, freshPatronage, patronEligibility, patronageOf, sanitizeAuditionCheck
} from '../../utils/patron/patronage-state.mjs';
import { collectActorTags } from '../active-tags.mjs';
import { addKnownDeity } from './worship.mjs';
import { say } from './vehicle-drive-common.mjs';
import { isPatronItem, isRankedItem } from '../../utils/document-types.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';

/** `via` values that skip the access check: a transfer and a killer's patronage are not the Bard's to qualify for (p. 316). */
const NO_ACCESS_CHECK_VIA = Object.freeze(['transfer', 'killer']);
/** `via` values whose criteria rows are asked about: the audition asks at its start, the class offer and a killer are exempt (p. 316). */
const CRITERIA_VIA = Object.freeze(['direct', 'transfer']);

const now = () => Number(globalThis.game?.time?.worldTime) || 0;
const items = (actor) => Array.from(actor?.items ?? []);
const text = (raw) => String(firstScalar(raw, '') ?? '').trim();
const nullableInt = (raw, min = -Infinity) => {
  const first = firstScalar(raw, null);
  if (first === null || first === '') return null;
  const n = Number(first);
  return Number.isFinite(n) ? Math.max(min, Math.trunc(n)) : null;
};
const oneOf = (list) => (raw) => (list.includes(text(raw)) ? text(raw) : undefined);

/** One sanitiser per patronage field `writePatronage` accepts; anything else in a patch is dropped. */
const PATRONAGE_WRITERS = Object.freeze({
  status: oneOf(PATRONAGE_STATUSES),
  via: oneOf(PATRONAGE_VIA),
  since: (v) => nullableInt(v),
  attitude: oneOf(PATRON_ATTITUDES),
  earned: (v) => nullableInt(v, 0) ?? 0,
  endedBy: oneOf(PATRONAGE_ENDINGS),
  endedFloor: (v) => nullableInt(v)
});
const AUDITION_WRITERS = Object.freeze({
  dc: (v) => nullableInt(v, 0),
  steady: (v) => v === true,
  result: oneOf(AUDITION_RESULTS),
  checks: (v) => (Array.isArray(v) ? v.map(sanitizeAuditionCheck) : undefined)
});

/** The dotted update for a partial patronage: sanitised, unknown keys dropped, `audition` as a nested partial. */
function patronageUpdate(item, patch) {
  const base = item?.type === 'deity' ? 'system.bond.patronage' : 'system.patronage';
  const update = {};
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (key === 'audition' && value && typeof value === 'object') {
      for (const [sub, subValue] of Object.entries(value)) {
        const clean = AUDITION_WRITERS[sub]?.(subValue);
        if (clean !== undefined) update[`${base}.audition.${sub}`] = clean;
      }
      continue;
    }
    const clean = PATRONAGE_WRITERS[key]?.(value);
    if (clean !== undefined) update[`${base}.${key}`] = clean;
  }
  return update;
}

/**
 * Write part of an item's patronage. Each value is sanitised (a bad status is ignored, a Difficulty clamps to 0 or more);
 * keys that are not patronage fields are dropped; `audition.checks` is replaced whole.
 * @param {object} item a patron item or a deity item
 * @param {object} patch e.g. `{ attitude: 'reluctant', audition: { dc: 12 } }`
 */
export async function writePatronage(item, patch) {
  const update = patronageUpdate(item, patch);
  if (Object.keys(update).length) await item.update(update);
  return item;
}

/**
 * The embedded item for a patron: the actor's existing item of that identifier, else a new one with its patronage reset
 * to `prospect`. A god is embedded as a known deity (as `addKnownDeity`) and its patronage set to `prospect`.
 * @param {object} actor
 * @param {object} patronDoc a world, compendium or catalog `patron` or `deity` document
 * @returns {Promise<object|null>} the embedded item
 */
export async function addPatronProspect(actor, patronDoc) {
  if (!actor || !patronDoc) return null;
  if (patronDoc.type === 'deity') {
    const god = await addKnownDeity(actor, patronDoc, { via: 'gm' });
    if (god && patronageOf(god).status === 'none') await writePatronage(god, { status: 'prospect' });
    return god;
  }
  const identifier = patronProfileOf(patronDoc).identifier || itemIdentifier(patronDoc);
  const existing = items(actor).find((i) => i?.type === 'patron' && patronProfileOf(i).identifier === identifier);
  if (existing) return existing;
  const data = typeof patronDoc.toObject === 'function' ? patronDoc.toObject() : structuredClone(patronDoc);
  delete data._id;
  delete data.id;
  data.system = { ...(data.system ?? {}), identifier, patronage: freshPatronage('prospect') };
  const [created] = await actor.createEmbeddedDocuments('Item', [data]);
  return created ?? null;
}

let offerOpener = null;

/**
 * Register the function that opens the GM's patron offer picker (the picker module calls this when it loads). Null clears it.
 * @param {((actor: object) => unknown)|null} fn
 */
export function setPatronOfferOpener(fn) {
  offerOpener = typeof fn === 'function' ? fn : null;
}

/**
 * Open the offer picker for a crawler that must choose a patron (p. 146). GM only.
 * @returns {unknown} whatever the picker returns, or null when nothing opened
 */
export function openPatronOffer(actor) {
  if (!globalThis.game?.user?.isGM || !actor || !offerOpener) return null;
  return offerOpener(actor);
}

/** The linked actor of a patron item, or null. */
function linkedActor(profile) {
  if (!profile.actorUuid) return null;
  try {
    return globalThis.fromUuidSync?.(profile.actorUuid) ?? null;
  } catch {
    return null;
  }
}

/** A Skill or Spell the patron knows, resolved: the linked actor's own item, else the catalog's. */
function resolveKnown(identifier, linked) {
  const owned = items(linked).find((i) => isRankedItem(i) && itemIdentifier(i) === identifier);
  if (owned) return { identifier, type: owned.type, combat: owned.type === 'spell' ? false : isCombatSkill(owned) };
  const skill = findCatalogEntry('skills', identifier);
  if (skill) return { identifier, type: 'skill', combat: isCombatSkill(skill) };
  if (findCatalogEntry('spells', identifier)) return { identifier, type: 'spell', combat: false };
  return { identifier, type: 'skill', combat: null };
}

/**
 * The criteria rows a patron item measures against this Bard (p. 315): `[{ id, status }]` for `presence`,
 * `performance`, `combat` and `access`.
 * @param {object} actor the Bard
 * @param {object} item a patron item
 */
export function patronCriteriaFor(actor, item) {
  const profile = patronProfileOf(item);
  const linked = linkedActor(profile);
  const bardRanks = new Map();
  for (const i of items(actor)) {
    if (isRankedItem(i)) bardRanks.set(itemIdentifier(i), Number(i.system?.rank) || 0);
  }
  const rankOfLinked = (identifier) => {
    if (!linked) return null;
    const owned = items(linked).find((i) => i?.type === 'skill' && itemIdentifier(i) === identifier);
    return owned ? Number(owned.system?.rank) || 0 : 0;
  };
  const linkedTags = Array.isArray(linked?.system?.tags) ? linked.system.tags : [];
  return patronCriteria({
    performance: profile.performanceSkills.map((identifier) => ({ identifier, rank: rankOfLinked(identifier) })),
    known: profile.skills.map((identifier) => resolveKnown(identifier, linked)),
    tags: [...profile.tags, ...linkedTags],
    bardRanks
  });
}

/** Every criteria row of a patron item as met / unmet / "the GM judges" lines (the audition dialog and Make Patron show it); '' for a god. */
export function patronCriteriaHtml(actor, item) {
  if (item.type !== 'patron') return '';
  const rows = patronCriteriaFor(actor, item).map((row) => {
    const name = say(`COG.Patron.Audition.Criteria.${row.id}`, row.id);
    const state = say(`COG.Patron.Audition.Criteria.State.${row.status}`, row.status);
    return `<li>${escapeAttr(name)}: ${escapeAttr(state)}</li>`;
  });
  return `<ul class="cog-patron-criteria">${rows.join('')}</ul>`;
}

const CRITERIA_LABELS = Object.freeze({
  performance: ['COG.Patron.Gate.Criteria.Performance', 'a performance Skill above the Bard\'s at Rank 10 or more'],
  combat: ['COG.Patron.Gate.Criteria.Combat', 'a Combat Skill or Spell the Bard is untrained in'],
  access: ['COG.Patron.Gate.Criteria.Access', 'access to a club, guild or PR agent']
});

/** The sentence for another active patron (a Bard has one at a time), or null when there is none. */
function anotherPatronReason(actor, item) {
  const others = activePatrons(items(actor)).filter((i) => i.id !== item.id);
  if (!others.length) return null;
  return say('COG.Patron.Gate.Another', '{actor} already has a patron ({others})', { patron: item.name, actor: actor.name, others: others.map((i) => i.name).join(', ') });
}

/**
 * One sentence per rule the book sets that this acquisition breaks (the audition asks the same ones at its start, with
 * `starting` set: it is the audition, so it does not list the missing one).
 */
export function becomeReasons(actor, item, via, { starting = false } = {}) {
  const data = { patron: item.name, actor: actor.name };
  const reasons = [];
  if (!NO_ACCESS_CHECK_VIA.includes(via) && patronEligibility(collectActorTags(actor)) === 'none') {
    reasons.push(say('COG.Patron.Gate.NotEligible', '{actor} has nothing that gives access to a patron', data));
  }
  const another = anotherPatronReason(actor, item);
  if (another) reasons.push(another);
  if (murderBan(items(actor), effectiveFloor(actor)).bannedThisFloor) {
    reasons.push(say('COG.Patron.Gate.Murdered', '{actor} killed their last patron this Floor (p. 316)', data));
  }
  if (item.type === 'deity' && item.system?.patronage !== true && via !== 'class') {
    reasons.push(say('COG.Patron.Gate.NoPatronage', '{patron} does not take patrons', data));
  }
  if (via === 'direct' && !starting && isPatronItem(item)) {
    reasons.push(say('COG.Patron.Gate.NoAudition', '{patron} has not agreed at an audition (p. 315)', data));
  }
  if (item.type === 'patron' && CRITERIA_VIA.includes(via)) {
    const unmet = patronCriteriaFor(actor, item).filter((row) => row.status === 'unmet' && CRITERIA_LABELS[row.id]);
    if (unmet.length) {
      const names = unmet.map((row) => say(...CRITERIA_LABELS[row.id])).join(', ');
      reasons.push(say('COG.Patron.Gate.Criteria.Unmet', '{patron} wants more of {actor}: {criteria}', { ...data, criteria: names }));
    }
  }
  return reasons;
}

/**
 * Make an item the crawler's active patron. When `gated`, every rule this breaks (no access, another active patron, a god
 * that does not take patrons, unmet criteria) is listed in one Rule Break question; Cancel changes nothing. An ungated
 * call with `anotherPatron` (the audition's agreement: it settled the criteria and access itself) still asks about another
 * active patron.
 * @param {object} actor
 * @param {object} item an embedded patron or deity item
 * @param {{ via?: string, options?: object, gated?: boolean, anotherPatron?: boolean }} [p]
 * @returns {Promise<{ ok: boolean, ruleBreak: boolean, reason?: string }>}
 */
export async function becomePatron(actor, item, { via = 'direct', options, gated = true, anotherPatron = false } = {}) {
  const how = PATRONAGE_VIA.includes(via) && via ? via : 'direct';
  const reasons = gated ? becomeReasons(actor, item, how) : (anotherPatron ? [anotherPatronReason(actor, item)].filter(Boolean) : []);
  let ruleBreak = false;
  if (reasons.length) {
    const ask = (data) => say('COG.Patron.Gate.Ask', '{reasons}. Make {patron} {actor}\'s patron anyway as a Rule Break?', data);
    const answer = await confirmRuleBreak({
      title: say('COG.Patron.Gate.Title', 'Patron'),
      message: ask({ reasons: reasons.map(escapeAttr).join('; '), patron: escapeAttr(item.name), actor: escapeAttr(actor.name) }),
      reason: ask({ reasons: reasons.join('; '), patron: item.name, actor: actor.name }),
      detail: gated && CRITERIA_VIA.includes(how) ? patronCriteriaHtml(actor, item) : '',
      options
    });
    if (!answer.confirmed) return { ok: false, ruleBreak: false, reason: answer.refusal ?? 'cancelled' };
    ruleBreak = true;
  }
  const update = patronageUpdate(item, { status: 'patron', via: how, since: now(), endedBy: '', endedFloor: null });
  if (ruleBreak) Object.assign(update, ruleBreakUpdate());
  await item.update(update);
  return { ok: true, ruleBreak };
}

/**
 * End a patronage. The circumstances the book lists (`quit`, `died`, `murdered`, `ended`) just happen; `left`, the Bard
 * walking out, asks a Rule Break.
 * @param {object} actor
 * @param {object} item
 * @param {{ endedBy: string, options?: object }} p
 * @returns {Promise<{ ok: boolean, ruleBreak: boolean, reason?: string }>}
 */
export async function endPatronage(actor, item, { endedBy, options } = {}) {
  const ending = PATRONAGE_ENDINGS.includes(endedBy) && endedBy ? endedBy : 'ended';
  let ruleBreak = false;
  if (ending === 'left') {
    const answer = await confirmRuleBreak({
      title: say('COG.Patron.Gate.Title', 'Patron'),
      message: say('COG.Patron.Gate.Leave', 'Leaving {patron} is not one of the ways a patronage ends. Leave anyway as a Rule Break?', { patron: item.name, actor: actor.name }),
      options
    });
    if (!answer.confirmed) return { ok: false, ruleBreak: false, reason: answer.refusal ?? 'cancelled' };
    ruleBreak = true;
  }
  const update = patronageUpdate(item, { status: 'former', endedBy: ending, endedFloor: effectiveFloor(actor) });
  if (ruleBreak) Object.assign(update, ruleBreakUpdate());
  await item.update(update);
  return { ok: true, ruleBreak };
}
