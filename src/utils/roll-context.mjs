import { getOfferedSituations, buildActionTags } from './damage-modifiers.mjs';
import { settleFloorUses } from './floor-row-usage.mjs';
import { CHECK_TAGS } from './tag-mechanics.mjs';
import { camerasOffered, armedCamera, resolveCameraChoice, cameraAudienceList, cameraText } from './cameras.mjs';
import { actorSizeNumber } from '../data/sizes.mjs';
import { partitionTicks } from './ticked-subject.mjs';
import { getTagDefinition, USE_TAG_PREFIX, collectActorTags, splitRoleTag, ROLE_TAG_PREFIXES, ENGINE_SITUATIONS, SAME_SIZE_SITUATION, healthFractionTags } from '../data/tags.mjs';

/**
 * The one roll context. `buildRollContext` is the only producer of
 * the tag set a row's `condition` is matched against, for every engine moment (a phase). Unprefixed tags describe
 * the action; `self.*` the row owner; `subject.*` / `attacker.*` the other party. Every collector receives the
 * context and never builds its own.
 */

/** The engine moments a context can be built for (spec 2.2). */
export const ROLL_PHASES = Object.freeze(['check', 'toHit', 'damage', 'defense', 'advancement', 'manaCost', 'recovery', 'popularity', 'derived']);

/** Phases whose other party defaults to the first targeted token. */
const TARGETED_PHASES = new Set(['check', 'toHit', 'damage']);

const MAX_CONTEXT_TAGS = 512;


/** The actor's own `condition.*` tags (an applied Debuff such as Fatigued), from the actor's cached tag set. */
export function actorConditionTags(actor) {
  if (!actor) return [];
  const all = actor.system?.tagSet instanceof Set ? actor.system.tagSet : collectActorTags(actor);
  return [...all].filter(t => typeof t === 'string' && t.startsWith('condition.'));
}

/**
 * What an actor IS, unprefixed: its identity tags plus its `condition.*` tags. Gear, skills and buffs describe what
 * it uses, not what it is, so they never appear. The tag set a scalar's `where` is matched against (E3, N14).
 * @param {object|null} actor
 * @returns {Set<string>}
 */
export function identityTags(actor) {
  const out = new Set();
  if (!actor) return out;
  for (const t of collectActorTags(actor, { identityOnly: true })) out.add(t);
  for (const t of actorConditionTags(actor)) out.add(t);
  for (const t of healthFractionTags(actor)) out.add(t);
  return out;
}

/**
 * What an actor IS, written under one role prefix: `identityTags`, each as `<role>.<tag>`.
 * @param {object|null} actor
 * @param {'self'|'subject'|'attacker'|'victim'} role
 * @returns {Set<string>}
 */
export function roleTags(actor, role) {
  const out = new Set();
  if (!actor || !ROLE_TAG_PREFIXES.includes(role)) return out;
  for (const t of identityTags(actor)) out.add(`${role}.${t}`);
  return out;
}

/** A `situation.*` (never an engine one), `subject.<tag>` or `use.<row key>` (once per floor, 3.12c) id: what a roll's ticked toggles may carry. */
function isTickedToggle(t) {
  if (typeof t !== 'string') return false;
  if (t.startsWith('subject.')) return t.length > 'subject.'.length;
  if (t.startsWith(USE_TAG_PREFIX)) return t.length > USE_TAG_PREFIX.length;
  return t.startsWith('situation.') && getTagDefinition(t)?.engine !== true;
}

/** The first targeted token's actor (`game.user.targets`), or null. */
export function firstTargetActor() {
  const targets = globalThis.game?.user?.targets;
  if (!targets || typeof targets[Symbol.iterator] !== 'function') return null;
  for (const token of targets) return token?.actor ?? token?.document?.actor ?? null;
  return null;
}

/**
 * @typedef {object} RollContext
 * @property {string} phase one of ROLL_PHASES
 * @property {Set<string>} tags action, self.* and other-party tags
 * @property {string} key deterministic fingerprint of phase and tags
 * @property {object|null} actor row owner (live document)
 * @property {object|null} item action item (live)
 * @property {object|null} skill matching weapon skill (live)
 * @property {object|null} other other party actor (live)
 * @property {string|null} actorUuid uuid of the row owner (survives a serialized card)
 * @property {string|null} otherUuid uuid of the other party; null when no actor stood behind the subject tags (they were ticked)
 * @property {'subject'|'attacker'|null} otherRole
 * @property {boolean} isCrit
 * @property {string[]} appliedRowKeys row keys whose effect is already in the card's numbers
 */

function assemble(fields, tags) {
  return { ...fields, tags, key: `${fields.phase}|${[...tags].sort().join(',')}` };
}

/**
 * Build the tag set rows are matched against for one engine moment.
 *
 * @param {object} params
 * @param {object|null} [params.actor] the row owner; null for an ownerless tick (no `self.*`)
 * @param {string} params.phase one of ROLL_PHASES
 * @param {object|null} [params.item] action item (adds its tags)
 * @param {object|null} [params.skill] matching weapon skill (adds its tags)
 * @param {string|string[]} [params.check] key(s) of CHECK_TAGS
 * @param {string} [params.stat] governing stat key; adds `stat.<stat>`
 * @param {Iterable<string>} [params.tags] extra action tags (a hazard, an incoming attack, FLOOR_END_TAG)
 * @param {Iterable<string>} [params.situations] ticked `situation.*` / `subject.*` toggles (engine ones dropped)
 * @param {object|null} [params.other] the other party; undefined = phase default (spec 2.2), null = none
 * @param {'subject'|'attacker'} [params.otherRole] undefined = phase default
 * @param {Iterable<string>} [params.otherTags] inner tags of an other party that is no longer a live actor (the card's recorded tags); written under the other role
 * @param {object|null} [params.inherit] a parsed card context: its `situation.*` and `subject.*` tags and `isCrit`
 * @param {boolean} [params.isCrit]
 * @param {boolean} [params.disadvantaged]
 * @param {boolean} [params.inCombat] defaults to a started combat
 * @param {boolean} [params.wieldedOneHanded] forwarded to buildActionTags
 * @param {string[]} [params.appliedRowKeys]
 * @returns {RollContext}
 */
export function buildRollContext({
  actor = null, phase, item = null, skill = null, check, stat, tags = [], situations = [],
  other, otherRole, otherTags, inherit = null, isCrit = false, disadvantaged = false, inCombat, wieldedOneHanded,
  appliedRowKeys = []
} = {}) {
  if (!ROLL_PHASES.includes(phase)) throw new TypeError(`buildRollContext: unknown phase "${phase}"`);
  const out = new Set();
  const derived = phase === 'derived';
  const inherited = inherit && typeof inherit === 'object' ? inherit : null;
  const inheritedTags = inherited ? [...(inherited.tags ?? [])].filter(t => typeof t === 'string') : [];

  let otherActor = null;
  let role = otherRole ?? (phase === 'defense' ? 'attacker' : 'subject');
  if (!derived) {
    for (const t of buildActionTags(item, skill, { wieldedOneHanded, tags: [...(tags ?? [])] })) out.add(t);
    for (const c of Array.isArray(check) ? check : [check]) if (c && CHECK_TAGS[c]) out.add(CHECK_TAGS[c]);
    const statKey = typeof stat === 'string' ? stat.toLowerCase().trim() : '';
    if (statKey) out.add(`stat.${statKey}`);
    for (const t of situations ?? []) if (isTickedToggle(t)) out.add(t);

    for (const t of inheritedTags) if (t.startsWith('situation.')) out.add(t);
    if (other !== undefined) otherActor = other;
    else if (inherited) {
      // The attack was made against that party in that situation; retargeting must not change the roll.
      for (const t of inheritedTags) if (splitRoleTag(t)?.role === 'subject') out.add(t);
      role = otherRole ?? inherited.otherRole ?? role;
    } else if (TARGETED_PHASES.has(phase)) otherActor = firstTargetActor();

    if (inCombat ?? Boolean(globalThis.game?.combat?.started)) out.add(ENGINE_SITUATIONS.inCombat);
    if (disadvantaged) out.add(ENGINE_SITUATIONS.disadvantaged);
  }

  const crit = !derived && Boolean(isCrit || inherited?.isCrit);
  if (crit) out.add(ENGINE_SITUATIONS.criticalHit);
  for (const t of roleTags(actor, 'self')) out.add(t);
  if (otherActor) for (const t of roleTags(otherActor, role)) out.add(t);
  // Engine-set: the two parties are the same size (a technique that needs it). A live actor on each side is required.
  if (!derived && actor && otherActor && actorSizeNumber(actor) === actorSizeNumber(otherActor)) out.add(SAME_SIZE_SITUATION);
  if (!derived) for (const t of otherTags ?? []) if (typeof t === 'string' && t) out.add(`${role}.${t}`);

  const hasOther = Boolean(otherActor) || [...(otherTags ?? [])].length > 0 || (other === undefined && inheritedTags.some(t => splitRoleTag(t)?.role === 'subject'));
  const otherUuid = otherActor?.uuid ?? (other === undefined && inherited ? (inherited.otherUuid ?? null) : null);
  return assemble({
    phase, actor: actor ?? null, item: item ?? null, skill: skill ?? null,
    other: otherActor ?? null, otherRole: hasOther ? role : null,
    actorUuid: actor?.uuid ?? null, otherUuid,
    isCrit: crit, appliedRowKeys: [...(appliedRowKeys ?? [])]
  }, out);
}

/**
 * A new context with more on it (the original is untouched): ticked toggles, extra action tags, and the two engine
 * situations that are only known after the d20 mode or the roll resolved.
 * @param {RollContext} context
 * @param {object} [add]
 * @param {Iterable<string>} [add.situations]
 * @param {Iterable<string>} [add.tags]
 * @param {boolean} [add.disadvantaged]
 * @param {boolean} [add.isCrit]
 * @param {boolean} [add.isAmazing] the roll's subject was beaten by 10 or more (E6.9); never with a Critical Hit
 * @returns {RollContext}
 */
export function extendContext(context, { situations = [], tags = [], disadvantaged, isCrit, isAmazing = false } = {}) {
  const out = new Set(context.tags);
  for (const t of tags ?? []) if (t) out.add(t);
  for (const t of situations ?? []) if (isTickedToggle(t)) out.add(t);
  if (disadvantaged) out.add(ENGINE_SITUATIONS.disadvantaged);
  const crit = Boolean(context.isCrit || isCrit);
  if (crit) out.add(ENGINE_SITUATIONS.criticalHit);
  // A Natural 20 is a Critical Hit, which supersedes an Amazing Success (E6.9): a crit context never carries the tag.
  if (crit) out.delete(ENGINE_SITUATIONS.amazingSuccess);
  else if (isAmazing) out.add(ENGINE_SITUATIONS.amazingSuccess);
  const { tags: _tags, key: _key, ...fields } = context;
  return assemble({ ...fields, isCrit: crit, appliedRowKeys: [...(context.appliedRowKeys ?? [])] }, out);
}

function tagsOf(contextOrTags) {
  const plain = contextOrTags instanceof Set || Array.isArray(contextOrTags);
  const raw = contextOrTags && typeof contextOrTags === 'object' && !plain ? contextOrTags.tags : contextOrTags;
  return [...(raw ?? [])].filter(t => typeof t === 'string' && t);
}

/** The unprefixed tags of a context (or a tag list): the action and its circumstances. */
export function actionTagsOf(contextOrTags) {
  return new Set(tagsOf(contextOrTags).filter(t => splitRoleTag(t) === null));
}

/**
 * The kill-Popularity context of one lethal application (3.56o): the killer as `self`, the victim as `subject`, the attack's
 * own action tags. The one builder for the owner path and for the GM that pays a non-owner's request. A live victim gives
 * its tags now; `subjectTags` (inner tags, stored on the undo record at damage time) add the tags it had when it died, and
 * stand alone when the victim is gone.
 * @param {object} p
 * @param {Actor} p.attacker
 * @param {Actor|null} [p.victim]
 * @param {Iterable<string>} [p.attackTags]
 * @param {Iterable<string>} [p.subjectTags]
 */
export function buildKillContext({ attacker, victim = null, attackTags = [], subjectTags = [] }) {
  const base = { actor: attacker, phase: 'popularity', tags: [...(attackTags ?? [])] };
  return buildRollContext({ ...base, other: victim ?? null, otherTags: [...(subjectTags ?? [])] });
}

/** What an undo record keeps to rebuild the kill context later: the attack's action tags and the victim's inner tags. */
export function killContextRecordOf(context) {
  return { attackTags: [...actionTagsOf(context)].sort(), subjectTags: [...roleTagsOf(context, 'subject')].sort() };
}

/** The inner tags of one role in a context (or a tag list), without the role prefix. */
export function roleTagsOf(contextOrTags, role) {
  const out = new Set();
  for (const t of tagsOf(contextOrTags)) {
    const split = splitRoleTag(t);
    if (split?.role === role) out.add(split.tag);
  }
  return out;
}

/** The card form of a context (spec 5.1): plain JSON, no live documents. */
export function serializeRollContext(context) {
  return {
    v: 1,
    phase: context.phase,
    tags: [...context.tags].sort(),
    actorUuid: context.actor?.uuid ?? context.actorUuid ?? null,
    otherUuid: context.other?.uuid ?? context.otherUuid ?? null,
    otherRole: context.otherRole ?? null,
    isCrit: Boolean(context.isCrit),
    appliedRowKeys: [...(context.appliedRowKeys ?? [])]
  };
}

/**
 * Read a serialized context back (a string from a `data-roll-context` attribute, or an object). Pure; null unless the
 * payload is a version 1 context with a known phase, at most 512 non-empty string tags and string row keys.
 * @returns {{ v: 1, phase: string, tags: string[], actorUuid: string|null, otherUuid: string|null, otherRole: 'subject'|'attacker'|null, isCrit: boolean, appliedRowKeys: string[] }|null}
 */
export function parseRollContext(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw); } catch { return null; }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.v !== 1) return null;
  if (!ROLL_PHASES.includes(data.phase)) return null;
  const { tags, appliedRowKeys = [] } = data;
  if (!Array.isArray(tags) || tags.length > MAX_CONTEXT_TAGS || !tags.every(t => typeof t === 'string' && t)) return null;
  if (!Array.isArray(appliedRowKeys) || !appliedRowKeys.every(k => typeof k === 'string')) return null;
  const str = (v) => (typeof v === 'string' && v ? v : null);
  return {
    v: 1,
    phase: data.phase,
    tags: [...tags],
    actorUuid: str(data.actorUuid),
    otherUuid: str(data.otherUuid),
    otherRole: data.otherRole === 'subject' || data.otherRole === 'attacker' ? data.otherRole : null,
    isCrit: Boolean(data.isCrit),
    appliedRowKeys: [...appliedRowKeys]
  };
}

/**
 * A damage card's context as it applies to one target. Keeps the card's action, situation.* and
 * self.* tags; replaces its subject.* tags with roleTags(other, 'subject'), unless the card's subject was asserted
 * (card.otherUuid === null: ticked by hand, no actor behind it), in which case a ticked tag is kept only when the target
 * has no tag in its namespace (E8.14; `partitionTicks`), the target's tags are added, and each tick the target
 * contradicts is listed in the result's `droppedTicks` for the caller to warn about; drops the roll's situation.critical_hit and adds it when `isCrit`, and likewise drops
 * situation.amazing_success and adds it when `isAmazing && !isCrit` (E6.9, judged per target). No live attacker is read.
 * @param {object|null} card a parsed card context (parseRollContext)
 * @param {{ other?: object|null, isCrit?: boolean, isAmazing?: boolean, attacker?: object|null }} [opts]
 * @returns {RollContext|null} null when card is null
 */
export function retargetContext(card, { other = null, isCrit = false, isAmazing = false, attacker = null } = {}) {
  if (!card) return null;
  const asserted = card.otherUuid === null || card.otherUuid === undefined;
  const out = new Set();
  const askedTicks = [];
  for (const t of card.tags ?? []) {
    if (typeof t !== 'string' || !t) continue;
    if (t === ENGINE_SITUATIONS.criticalHit || t === ENGINE_SITUATIONS.amazingSuccess) continue;
    if (splitRoleTag(t)?.role === 'subject') {
      if (!asserted) continue;
      if (other) { askedTicks.push(t); continue; }
    }
    // Same size was judged against the roll's first target; a hand-ticked one (no target at the roll) stays.
    if (t === SAME_SIZE_SITUATION && !asserted) continue;
    out.add(t);
  }
  let droppedTicks = [];
  if (other) {
    const targetTags = roleTags(other, 'subject');
    const { kept, dropped } = partitionTicks(askedTicks, targetTags);
    for (const t of kept) out.add(t);
    for (const t of targetTags) out.add(t);
    droppedTicks = dropped;
  }
  if (other && attacker && actorSizeNumber(attacker) === actorSizeNumber(other)) out.add(SAME_SIZE_SITUATION);
  if (isCrit) out.add(ENGINE_SITUATIONS.criticalHit);
  else if (isAmazing) out.add(ENGINE_SITUATIONS.amazingSuccess);
  return assemble({
    phase: card.phase, actor: null, item: null, skill: null,
    other: other ?? null, otherRole: 'subject',
    actorUuid: card.actorUuid ?? null, otherUuid: other?.uuid ?? null,
    isCrit: Boolean(isCrit), appliedRowKeys: [...(card.appliedRowKeys ?? [])], droppedTicks
  }, out);
}

/**
 * The one `damage` context of a damage roll. A caller that already built it hands it down as `options.rollContext`
 * (a live context: `tags` is a Set) and it is returned as is. Otherwise one is built: from the attack card's parsed
 * context when `options.rollContext` is that (the damage roll inherits its `situation.*`, `subject.*` and `isCrit`),
 * else from the live targets. `options.isCrit === true` marks the roll as a crit for headless callers.
 * @param {object} actor the row owner (the attacker)
 * @param {object} [options] roll options
 * @param {object} [params] `{ item, skill, tags }` for `buildRollContext`
 * @returns {RollContext}
 */
export function resolveDamageContext(actor, options = {}, params = {}) {
  const given = options?.rollContext;
  if (given?.tags instanceof Set) return given;
  return buildRollContext({
    ...params, actor, phase: 'damage', inherit: given && typeof given === 'object' ? given : null,
    isCrit: options?.isCrit === true, wieldedOneHanded: options?.wieldedOneHanded
  });
}

/** ` data-roll-context='…'` for a chat card button, escaped for a single-quoted HTML attribute. */
export function rollContextDataAttr(context) {
  const json = JSON.stringify(serializeRollContext(context))
    .replaceAll('&', '&amp;').replaceAll("'", '&#39;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return ` data-roll-context='${json}'`;
}

/**
 * Net Advantage and Disadvantage reasons (book p. 60): more Advantage gives 2d20kh, more Disadvantage 2d20kl, equal
 * (including none) 1d20. Never a third die. Non-string and empty entries are dropped.
 * @param {{ advantages?: Array<string>, disadvantages?: Array<string> }} found
 * @returns {{ mode: 'advantage'|'disadvantage'|'cancelled'|'normal', formula: '2d20kh'|'2d20kl'|'1d20',
 *   label: string|null, reasons: Array<string>, advantages: Array<string>, disadvantages: Array<string>, net: number }}
 */
export function resolveRowAdvantage(found = {}) {
  const clean = (list) => (Array.isArray(list) ? list : []).filter(r => typeof r === 'string' && r.trim());
  const advantages = clean(found?.advantages);
  const disadvantages = clean(found?.disadvantages);
  const net = advantages.length - disadvantages.length;
  const reasons = [...advantages, ...disadvantages];
  let mode = 'normal';
  let formula = '1d20';
  let label = null;
  if (net > 0) {
    mode = 'advantage';
    formula = '2d20kh';
    label = `Advantage (${advantages.join(', ')}${disadvantages.length ? `; outweighs ${disadvantages.join(', ')}` : ''})`;
  } else if (net < 0) {
    mode = 'disadvantage';
    formula = '2d20kl';
    label = `Disadvantage (${disadvantages.join(', ')}${advantages.length ? `; outweighs ${advantages.join(', ')}` : ''})`;
  } else if (reasons.length) {
    mode = 'cancelled';
    label = `Cancelled (Advantage: ${advantages.join(', ')} vs Disadvantage: ${disadvantages.join(', ')})`;
  }
  return { mode, formula, label, reasons, advantages, disadvantages, net };
}

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/**
 * The ticked toggles in a roll's options (anything else is dropped); null when absent. `options.situations` holds
 * `situation.*` ids; `options.subjects` holds `subject.*` ids (the other party's tags, for headless callers).
 */
export function readSituationOptions(options = {}) {
  const sit = options?.situations;
  const subj = options?.subjects;
  if (!Array.isArray(sit) && !Array.isArray(subj)) return null;
  return [...(Array.isArray(sit) ? sit : []), ...(Array.isArray(subj) ? subj : [])]
    .filter(isTickedToggle);
}

// The `checked` property is the user's choice; the static attribute (the pre-ticked Called Play line) stays after an
// untick in a real DOM, so it only counts when the DOM exposes no property.
export const isChecked = (el) => (typeof el?.checked === 'boolean' ? el.checked : Boolean(el?.hasAttribute?.('checked')));

/** One Called Play line of the roll dialog: the caller's name and the number rolled. */
export function calledPlayLabel(entry) {
  const amount = Number(entry?.amount) || 0;
  return `Use ${entry?.fromName || 'an ally'}'s Called Play (${amount >= 0 ? `+${amount}` : amount})`;
}

/**
 * The pre-roll dialog's answers (E7.9 D6.3): the ticked situations and the Called Plays this roll uses.
 *
 * Situations: `options.situations` (an array) answers outright, which is how headless callers and tests tick toggles.
 * Otherwise, when a row on the actor references a situation that the roll's other tags already match, the dialog
 * offers it; only ticked situations apply. Called Plays: `opts.calledPlays` are the entries pending for this roll
 * (`pendingCalledPlaysFor`); `options.calledPlays` (an array of entry ids, `[]` = none) answers outright. Otherwise
 * each entry is a pre-ticked checkbox (D13 a). No UI, `interactive: false` or a closed dialog tick no situation and
 * use every pending Called Play: it never blocks the roll (CONTRIBUTING rule 2).
 *
 * @param {object} actor
 * @param {RollContext} context the roll's context before situations; callers then `extendContext(context, { situations })`
 * @param {object} [options] roll options (`situations`, `calledPlays`, `interactive`)
 * @param {object} [opts] `{ isAttack, keys, exclusive, subjects, calledPlays }`; all but `calledPlays` go to getOfferedSituations
 * @returns {Promise<{ situations: string[], calledPlayIds: string[] }>}
 */
export async function resolveRollToggles(actor, context, options = {}, opts = {}) {
  const res = await askRollToggles(actor, context, options, opts);
  if (!res.situations.some(t => typeof t === 'string' && t.startsWith(USE_TAG_PREFIX))) return res;
  // A ticked `use.<row key>` spends a once-per-floor row: a repeat on the same floor asks for a Rule Break, the use is recorded (3.12c)
  const labels = new Map();
  const { calledPlays: _calledPlays, ...offerOpts } = opts ?? {};
  for (const o of getOfferedSituations(actor, context, offerOpts)) if (o.rowLabel) labels.set(o.tag.slice(USE_TAG_PREFIX.length), o.rowLabel);
  const settled = await settleFloorUses(actor, res.situations, { labels, options });
  return { ...res, situations: settled.situations, ...(settled.ruleBreak ? { floorRuleBreak: true } : {}) };
}

async function askRollToggles(actor, context, options, opts) {
  const { calledPlays: pending, ...offerOpts } = opts ?? {};
  const entries = Array.isArray(pending) ? pending.filter((e) => e && typeof e.id === 'string') : [];
  const answered = Array.isArray(options?.calledPlays) ? new Set(options.calledPlays.filter((id) => typeof id === 'string')) : null;
  const defaultIds = entries.filter((e) => !answered || answered.has(e.id)).map((e) => e.id);
  const given = readSituationOptions(options);

  // A targeted token answers `subject.*` itself; only an untargeted roll offers the toggle.
  const offered = given ? [] : getOfferedSituations(actor, context, { ...offerOpts, subjects: context.other ? false : offerOpts.subjects });
  const askCalledPlays = !answered && entries.length > 0;
  // Playing to the Cameras (E6.10): a string `options.cameras` answers outright; an armed choice opens the dialog
  // pre-selected; the selector also shows whenever the dialog opens for another reason.
  const cameraRoll = opts?.cameras === true && camerasOffered(actor);
  const askCameras = cameraRoll && typeof options?.cameras !== 'string';
  const armed = cameraRoll ? armedCamera(actor) : '';
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if ((offered.length === 0 && !askCalledPlays && !(askCameras && armed)) || options?.interactive === false || typeof DialogV2?.prompt !== 'function') {
    return { situations: given ?? [], calledPlayIds: defaultIds, ...(cameraRoll ? { cameras: resolveCameraChoice(actor, options, null) } : {}) };
  }

  const situationRows = offered.map(({ tag, label, source, used }) => {
    const text = label || getTagDefinition(tag)?.label || tag;
    const from = source && source !== text ? ` <small class="cog-situation-source">from ${escapeHtml(source)}</small>` : '';
    const spent = used ? ' <small class="cog-situation-source">(already used this floor: Rule Break)</small>' : '';
    return `<label class="cog-situation-toggle"><input type="checkbox" name="situation" value="${escapeHtml(tag)}"> ${escapeHtml(text)}${from}${spent}</label>`;
  }).join('');
  const calledRows = askCalledPlays
    ? `<fieldset class="cog-called-play-toggles"><legend>Called Play</legend>${entries.map((e) => `<label class="cog-situation-toggle cog-called-play-toggle"><input type="checkbox" name="calledPlay" value="${escapeHtml(e.id)}" checked> ${escapeHtml(calledPlayLabel(e))}</label>`).join('')}</fieldset>`
    : '';
  const cameraRows = askCameras ? cameraFieldsetHtml(armed) : '';
  const ticked = (button, name) => [...(button?.form?.querySelectorAll?.(`input[name="${name}"]`) ?? [])].filter(isChecked).map((el) => el.getAttribute('value'));
  const title = offered.length ? 'Roll Situations' : (askCalledPlays ? 'Called Play' : cameraText('COG.Cameras.Title'));
  try {
    const result = await DialogV2.prompt({
      window: { title },
      content: `${offered.length ? `<p>Which of these apply to this roll?</p>${situationRows}` : ''}${calledRows}${cameraRows}`,
      ok: {
        label: 'Roll',
        callback: (_event, button) => ({
          situations: offered.length ? ticked(button, 'situation') : [],
          calledPlayIds: askCalledPlays ? ticked(button, 'calledPlay') : defaultIds,
          ...(askCameras ? { cameras: ticked(button, 'cameras')[0] ?? '' } : {})
        })
      },
      rejectClose: false,
      modal: true
    });
    if (result && typeof result === 'object' && Array.isArray(result.situations)) {
      return {
        situations: given ?? result.situations,
        calledPlayIds: result.calledPlayIds.filter((id) => defaultIds.includes(id)),
        ...(cameraRoll ? { cameras: resolveCameraChoice(actor, options, askCameras ? (result.cameras ?? '') : null) } : {})
      };
    }
  } catch {
    // fall through to the defaults
  }
  return { situations: given ?? [], calledPlayIds: defaultIds, ...(cameraRoll ? { cameras: resolveCameraChoice(actor, options, null) } : {}) };
}

/** The Playing to the Cameras radio group of the roll dialog: None plus each audience; the armed one is checked. */
function cameraFieldsetHtml(armed) {
  const radio = (value, label, checked) => `<label class="cog-situation-toggle cog-camera-toggle"><input type="radio" name="cameras" value="${escapeHtml(value)}"${checked ? ' checked' : ''}> ${escapeHtml(label)}</label>`;
  const rows = [radio('', cameraText('COG.Cameras.None'), !armed), ...cameraAudienceList().map(a => radio(a.id, a.label || a.id, a.id === armed))].join('');
  return `<fieldset class="cog-camera-toggles"><legend>${escapeHtml(cameraText('COG.Cameras.Title'))}</legend>${rows}<small class="cog-situation-source">${escapeHtml(cameraText('COG.Cameras.Hint'))}</small></fieldset>`;
}

/**
 * The situations that apply to this roll (`resolveRollToggles` without the Called Play line); see there.
 * @returns {Promise<Array<string>>} the ticked toggles
 */
export async function resolveSituations(actor, context, options = {}, opts = {}) {
  return (await resolveRollToggles(actor, context, options, opts)).situations;
}
