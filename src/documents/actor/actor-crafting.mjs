/**
 * Crafting: `actor.craft(...)`, the one path from a blueprint to a made item or an enchanted one.
 *
 * The plan comes from the pure engine (`planCraft`); this module asks one Rule Break per warning, then runs the steps in
 * order: hours off the floor clock (in chunks of at most 30), the check through `rollSkill` with a `craft` option, the
 * materials and Misc. Junk (the crawler's stacks first, then the space stash through the GM relay), salvage by the
 * check's margin, and the result (a created item, or `applyEnchantment` on the target). Nothing here blocks: every limit
 * is a confirm that records `ruleBreak: true`. Crafting hours come off the floor clock and are not banked as grind hours;
 * the check marks the skill like any skill check.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { landingFor } from '../../utils/content-source.mjs';
import { ruleBreakBadgeHtml } from '../../utils/rule-break-visibility.mjs';
import { registerRelayAction, requestRelay } from '../../utils/gm-relay.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { runKeyed } from '../../utils/keyed-queue.mjs';
import { cardMessageOptions } from '../../utils/card/chat-mode.mjs';
import { COG_OUTCOME_CONFIG } from '../session/roll-outcomes.mjs';
import {
  planCraft, raiseTemplateBonus, evaluateSalvage, planJunkSpend, isCraftSuccess, sanitizeCraftRef, craftContextTags, sharesProperty, propertyKeys
} from '../../utils/crafting/crafting-engine.mjs';
import { collectCraftModifiers } from '../../utils/roll/damage-modifiers.mjs';
import { buildRollContext } from '../../utils/roll/roll-context.mjs';
import { CRAFT_TAGS } from '../../utils/tag/tag-mechanics.mjs';
import { matchesTagQuery } from '../../utils/tag/tag-query.mjs';
import { skillStandIn } from '../../utils/skill/skill-stand-in.mjs';
import { getCurrentFloor } from '../../utils/floor/current-floor.mjs';
import { escapeHtml } from '../../sourcery/text.mjs';
import { craftText } from '../../utils/crafting/craft-text.mjs';
import { catalogEntries } from '../../content/catalog-lookup.mjs';
import { getItemAllTags } from '../active-tags.mjs';
import { buildPayload } from '../../data/builders/item-payload.mjs';
import { applyEnchantment, breakItem } from '../item/enchantments.mjs';
import { hasAsTrigger } from '../../utils/roll/amazing-success.mjs';
import { getFloorTimer, decrementFloorTimer, MAX_FLOOR_TIMER_DECREMENT } from './actor-environment.mjs';
import { applyJunkPlan } from './misc-junk.mjs';
import { getPersonalSpace } from './actor-spaces.mjs';
import {
  canWriteSpace, crawlerDoc, crawlerRef, resolveSpace, spaceLinksCrawler, userOwnsActor
} from './personal-space-links.mjs';

export const RELAY_ACTION_CRAFT_SPACE_MATERIALS = 'craftSpaceMaterials';

/** The largest number of stacks one relay request may take from. */
const MAX_TAKES = 200;

const asArray = (v) => (Array.isArray(v) ? v : []);
const round6 = (n) => Math.round(n * 1e6) / 1e6;
const esc = (v) => escapeHtml(String(v ?? ''));

/** Titles of the Rule Break confirm of each plan warning (one per `planCraft` warning code). */
const WARNING_TITLES = Object.freeze({
  notInSpace: 'Not in a Personal Space',
  noTable: 'No Crafting Table',
  belowFourthFloor: 'Enchanting Before the Fourth Floor',
  targetMismatch: 'Wrong Target',
  sameProperty: 'Same Property',
  secondAsTrigger: 'Second Amazing Success Trigger',
  missingMaterials: 'Missing Materials',
  missingJunk: 'Not Enough Misc. Junk',
  notBatchable: 'Not a Batch Recipe',
  overSkillCap: 'Above the Skill Limit',
  clockShort: 'Not Enough Time'
});

/**
 * Split hours into floor-clock requests of at most 30 hours: 64 gives 30, 30 and 4.
 * @param {number} hours
 * @returns {number[]}
 */
export function clockChunks(hours) {
  const chunks = [];
  let left = round6(Number(hours) || 0);
  while (left > 1e-9) {
    const chunk = Math.min(MAX_FLOOR_TIMER_DECREMENT, left);
    chunks.push(round6(chunk));
    left = round6(left - chunk);
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// The relay: an occupant's player takes materials out of the space's stash
// ---------------------------------------------------------------------------

/** A request's takes as clean `{ itemId, quantity }` pairs; anything unusable is dropped. */
function cleanTakes(raw) {
  return asArray(raw).slice(0, MAX_TAKES).map((t) => ({
    itemId: typeof t?.itemId === 'string' ? t.itemId : '',
    quantity: Math.floor(Number(t?.quantity))
  })).filter((t) => t.itemId && Number.isFinite(t.quantity) && t.quantity > 0);
}

/**
 * Lower stacks in a space's stash. Loot only (a table or any other item on the space is never touched); each take is
 * clamped to what is there and a stack at 0 is deleted. Serialised with the stash moves of the same space.
 * @returns {Promise<{ ok: boolean, reason?: string, taken?: Array<{ itemId: string, quantity: number }> }>}
 */
async function performTakeMaterials(space, takes) {
  const taken = [];
  for (const { itemId, quantity } of takes) {
    const item = space.items?.get(itemId);
    if (!item || item.type !== 'loot') continue;
    const have = Math.max(0, Math.floor(Number(item.system?.quantity) || 0));
    const take = Math.min(have, quantity);
    if (take <= 0) continue;
    if (have - take > 0) await item.update({ 'system.quantity': have - take });
    else await item.delete();
    taken.push({ itemId, quantity: take });
  }
  return { ok: true, taken };
}

registerRelayAction(RELAY_ACTION_CRAFT_SPACE_MATERIALS, {
  authorize: (payload, requester) => {
    if (!requester) return false;
    const space = resolveSpace(payload?.spaceUuid);
    const crawler = crawlerDoc(resolveActorByUuid(payload?.crawlerUuid));
    if (!space || crawler?.type !== 'crawler' || !spaceLinksCrawler(space, crawler)) return false;
    return requester.isGM === true || userOwnsActor(crawler, requester);
  },
  apply: async (payload) => {
    const space = resolveSpace(payload?.spaceUuid);
    const crawler = crawlerDoc(resolveActorByUuid(payload?.crawlerUuid));
    if (!space || crawler?.type !== 'crawler' || !spaceLinksCrawler(space, crawler)) return { ok: false, reason: 'invalid' };
    const takes = cleanTakes(payload?.takes);
    return runKeyed(`stash:${space.uuid ?? space.id}`, () => performTakeMaterials(space, takes));
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The skill a step is rolled with: the player's pick, else the first owned match, else an untrained catalog stand-in. */
function pickSkill(actor, step, index, skillIds) {
  const owned = [...(actor.items ?? [])].filter((i) => i.type === 'skill');
  const byRef = (ref) => owned.find((s) => s.id === ref || s.system?.identifier === ref);
  const wanted = Array.isArray(skillIds) ? skillIds[index] : (skillIds?.[step.templateId] ?? skillIds?.[index]);
  if (typeof wanted === 'string' && wanted) {
    const hit = byRef(wanted);
    if (hit) return hit;
    const stand = skillStandIn(actor, wanted);
    if (stand) return stand;
  }
  const first = asArray(step.skillOptions)[0];
  const ownedMatch = first ? byRef(first) : null;
  if (ownedMatch) return ownedMatch;
  const hasQuery = step.skillQuery && ['all', 'any', 'none'].some((k) => asArray(step.skillQuery[k]).length);
  if (!hasQuery) return null;
  const entry = catalogEntries('skills').find((e) => e.system?.identifier && matchesTagQuery(getItemAllTags(e), step.skillQuery));
  return entry ? skillStandIn(actor, entry.system.identifier) : null;
}

/** The craft reference a step is rolled with (`rollSkill`'s `craft` option); the modifier rows read the same tags. */
function craftRefOf(step, blueprintTarget, template) {
  const tableTags = asArray(step.tableBonus?.used).map((t) => t.type).filter(Boolean);
  const subject = template ?? blueprintTarget;
  return {
    dc: step.dc,
    tableTier: step.tableBonus?.tier ?? 0,
    tableBaseTier: step.tableBonus?.baseTier ?? step.tableBonus?.tier ?? 0,
    tableMultiplier: step.modifiers?.tableMultiplier ?? 1,
    tableLabel: asArray(step.tableBonus?.used).map((t) => t.name).filter(Boolean).join(', '),
    mode: step.mode,
    tags: [...tableTags, ...(subject ? [...getItemAllTags(subject)] : [])],
    stepLabel: step.label
  };
}

/**
 * The personal-space items whose `craftModifiers` rows count for a step: the tables the step uses and every installed
 * attachment (a space upgrade carrying a `crafting.attachment.<id>` tag). Items of a space the crawler is not linked to count
 * for nothing.
 * @param {object|null} spaceDoc
 * @param {boolean} linked
 * @param {object} step a planned step (its `tableBonus.used`)
 * @returns {object[]}
 */
export function craftSpaceSources(spaceDoc, linked, step) {
  if (!spaceDoc || !linked) return [];
  const usedIds = new Set(asArray(step?.tableBonus?.used).map((t) => t.id).filter(Boolean));
  return [...(spaceDoc.items ?? [])].filter((item) => {
    if (item?.type !== 'space_upgrade' || item.system?.purchased === false) return false;
    if (usedIds.has(item.id)) return true;
    return [...getItemAllTags(item)].some((tag) => tag.startsWith(CRAFT_TAGS.attachmentPrefix));
  });
}

/**
 * The `modifiers.resolve` function `planCraft` takes: for one step, the crafter's `craftModifiers` rows (the sources
 * the crawler already has, with a skill's rows counting only when that skill rolls the step) and the rows of the
 * space's tables and attachments, judged against the tags the step's check carries.
 * @param {Actor} actor
 * @param {{ skills: Array<Item|null>, spaceDoc: object|null, linked: boolean, target?: Item|null, template?: Item|null }} params
 *   `skills[i]` is the skill that rolls step `i`; `template` is the item an item-mode blueprint makes
 * @returns {(step: object, index: number) => { maxBonus: number|null, timeMultiplier: number, batchMultiplier: number, tableMultiplier: number, bonusValue: number }}
 */
export function craftModifierResolver(actor, { skills = [], spaceDoc = null, linked = false, target = null, template = null } = {}) {
  return (step, index) => {
    const craft = sanitizeCraftRef(craftRefOf(step, target, template));
    const context = buildRollContext({
      actor, phase: 'check', item: skills[index] ?? null, other: null, tags: craftContextTags(craft)
    });
    const { maxBonus, timeMultiplier, batchMultiplier, tableMultiplier, bonusValue } = collectCraftModifiers(actor, context, {
      extraSources: craftSpaceSources(spaceDoc, linked, step)
    });
    return { maxBonus, timeMultiplier, batchMultiplier, tableMultiplier, bonusValue };
  };
}

/** The item a blueprint makes, from its uuid or its identifier among the world's items; null when neither resolves. */
export async function resolveOutputTemplate(bp) {
  const out = bp.output ?? {};
  if (out.uuid && typeof globalThis.fromUuid === 'function') {
    try {
      const doc = await globalThis.fromUuid(out.uuid);
      if (doc) return doc;
    } catch { /* an unresolvable uuid falls through to the identifier */ }
  }
  if (out.identifier) {
    const world = globalThis.game?.items;
    const list = typeof world?.find === 'function' ? world : [];
    const hit = typeof list.find === 'function' ? list.find((i) => i.system?.identifier === out.identifier) : null;
    if (hit) return hit;
  }
  return null;
}

/** The `crafted` provenance flag (C7) on an item, plus `ruleBreak` when a break was confirmed. */
async function stampCrafted(item, crafted, ruleBreak) {
  if (!item) return;
  if (typeof item.setFlag === 'function') {
    await item.setFlag(SYSTEM_ID, 'crafted', crafted);
    if (ruleBreak) await item.setFlag(SYSTEM_ID, 'ruleBreak', true);
  } else {
    await item.update({ [`flags.${SYSTEM_ID}.crafted`]: crafted, ...(ruleBreak ? { [`flags.${SYSTEM_ID}.ruleBreak`]: true } : {}) });
  }
}

/** Create `units` of the output template on the crawler, compiled through `buildPayload`. */
async function createOutput(actor, template, units, crafted, ruleBreak) {
  const source = template.toObject ? template.toObject() : structuredClone(template);
  const system = structuredClone(source.system ?? {});
  system.quantity = units;
  if (template.type === 'gear') system.equipped = false;
  const payload = buildPayload(template.type, { name: source.name ?? template.name, img: source.img, system }, { warnings: [] });
  payload.flags = {
    ...payload.flags,
    [SYSTEM_ID]: { ...payload.flags?.[SYSTEM_ID], crafted, ...(ruleBreak ? { ruleBreak: true } : {}) }
  };
  // A blueprint's output from a turned-off theme arrives as Celestial AI Poop (the template carries the stamp).
  const landing = landingFor(source);
  const [item] = await actor.createEmbeddedDocuments('Item', [landing.off ? landing.poop : payload]);
  return item ?? null;
}

/** The templates one enchant step applies: all of them for a one-roll step, else the next in order. */
function templatesForStep(templates, step, cursor) {
  const group = step.templateIds.length > 1;
  if (group) return { list: templates, next: cursor + templates.length };
  const tpl = templates[cursor];
  return { list: tpl ? [tpl] : [], next: cursor + 1 };
}

/**
 * The result card (pure): steps with their outcome, what was made or applied, the salvage and the confirmed Rule Breaks.
 * @param {object} data `{ actorName, blueprintName, steps, made, ruleBreaks, ruleBreak, stopped }`
 * @returns {string}
 */
function craftResultCardHtml(data) {
  const lines = asArray(data.steps).map((s) => {
    const outcome = COG_OUTCOME_CONFIG[s.outcome]?.label ?? s.outcome ?? 'Not rolled';
    const salvage = asArray(s.salvage).filter((m) => m.needed > 0)
      .map((m) => `${esc(m.label || m.identifier || 'material')} ${m.consumed} used${m.kept ? `, ${m.kept} kept` : ''}`);
    const extras = [
      s.applied ? 'applied' : '',
      s.created ? 'made' : '',
      s.destroyed ? 'the item was destroyed' : '',
      s.broke ? 'the item broke' : '',
      s.bonusRaised ? (s.bonusRaised.raised > 0 ? craftText('COG.Craft.BonusRaised', { n: s.bonusRaised.n, source: s.bonusRaised.source ?? '' }) : craftText('COG.Craft.BonusNothingToRaise')) : ''
    ].filter(Boolean);
    return `<li><strong>${esc(s.label || s.kind)}</strong>: ${esc(outcome)}${s.dc !== undefined ? ` (Difficulty ${esc(s.dc)})` : ''}`
      + `, ${esc(s.hours)} h${extras.length ? `; ${esc(extras.join(', '))}` : ''}`
      + `${salvage.length ? `<br><em>${salvage.join('; ')}</em>` : ''}</li>`;
  }).join('');
  const made = asArray(data.made).map((m) => `<li>${esc(m)}</li>`).join('');
  const breaks = asArray(data.ruleBreaks).map((b) => `<li>${esc(b)}</li>`).join('');
  return `<div class="cog-chat-card cog-craft-card">
    <h4><strong>${esc(data.actorName)}</strong> crafts ${esc(data.blueprintName)}${data.ruleBreak ? ` ${ruleBreakBadgeHtml()}` : ''}</h4>
    <ol>${lines}</ol>
    ${made ? `<p><strong>Result</strong></p><ul>${made}</ul>` : ''}
    ${data.stopped ? `<p><em>${esc(data.stopped)}</em></p>` : ''}
    ${breaks ? `<p><strong>Rule Breaks</strong></p><ul>${breaks}</ul>` : ''}
  </div>`;
}

// ---------------------------------------------------------------------------
// Crafting and taking materials
// ---------------------------------------------------------------------------

/**
 * Take materials out of a personal space's stash. The space's owner and the GM write directly; an occupant's player asks
 * the GM through the `craftSpaceMaterials` relay.
 * @param {Actor} space
 * @param {Array<{ itemId: string, quantity: number }>} takes
 * @returns {Promise<Array<{ itemId: string, quantity: number }>>} what was taken
 */
export async function takeSpaceMaterials(actor, space, takes) {
  const clean = cleanTakes(takes);
  if (!space || !clean.length) return [];
  const reply = await requestRelay(
    RELAY_ACTION_CRAFT_SPACE_MATERIALS,
    { spaceUuid: space.uuid, crawlerUuid: crawlerRef(actor), takes: clean },
    { direct: canWriteSpace(space) }
  );
  return reply.ok ? asArray(reply.result?.taken) : [];
}

/**
 * Craft from a blueprint. Plans the craft, asks a Rule Break for each warning (a refusal stops before anything
 * is spent), then runs the steps in order. A failed step ends the attempt; items made by earlier steps are kept.
 *
 * @param {object} params
 * @param {Item} params.blueprint a loot item with `system.blueprint`
 * @param {Item|null} [params.target] the gear an enchant blueprint goes on
 * @param {Actor|string|false|null} [params.space] the personal space used (default: the crawler's own); `false` is an
 *   explicit "no personal space" (the `notInSpace` Rule Break is asked and no space is used)
 * @param {string[]|Object<string, string>|null} [params.skillIds] the skill picked per step (by index, or by template id)
 * @param {number} [params.quantity=1] units, or batch size for a batchable blueprint
 * @param {object} [params.modifiers] `{ timeMultiplier, batchMultiplier, maxBonus }` fixed for every step, on top of the
 *   crafter's own `craftModifiers` rows (the skill's, worn gear's, and the space's table and attachments)
 * @param {object} [params.options] the confirm options (`ruleBreak`, `interactive`), also passed to the checks
 * @returns {Promise<{ success: boolean, refusal?: string, code?: string, steps: object[], made: Item[], hoursSpent: number, ruleBreak: boolean, ruleBreaks: string[], message?: object }>}
 */
export async function craft(actor, { blueprint, target = null, space = null, skillIds = null, quantity = 1, modifiers = {}, options = {} } = {}) {
  const bp = blueprint?.system?.blueprint;
  const empty = { steps: [], made: [], hoursSpent: 0, ruleBreak: false, ruleBreaks: [] };
  if (!bp) return { ...empty, success: false, refusal: 'no-blueprint' };

  const wanted = space ?? options.space;
  const spaceDoc = wanted === false ? null : (resolveSpace(wanted) ?? getPersonalSpace(actor));
  const linked = !!spaceDoc && spaceLinksCrawler(spaceDoc, actor);
  const items = [...(actor.items ?? [])];
  const floor = getCurrentFloor();
  // The output item is resolved first: its tags can name the skills (a vehicle upgrade, 3.44i).
  const template = bp.mode === 'item' ? await resolveOutputTemplate(bp) : null;
  const planInput = {
    blueprint,
    target,
    template,
    crawler: { items, skills: items.filter((i) => i.type === 'skill'), floor },
    space: spaceDoc ? { items: [...(spaceDoc.items ?? [])], linked } : null,
    floor,
    clockHours: getFloorTimer(),
    quantity
  };
  // The first plan only says which steps there are, so the skills that roll them can be picked; the limits and
  // speed-ups depend on those skills (S7), so the plan that counts is made again with the rows resolved.
  const draft = planCraft({ ...planInput, modifiers });

  // Everything that can be refused is settled before anything is spent.
  if (bp.mode === 'item' && !template) {
    globalThis.ui?.notifications?.warn?.(`${blueprint.name} has no item to make. Set its output first.`);
    return { ...empty, success: false, refusal: 'no-output' };
  }
  const skills = draft.steps.map((step, i) => pickSkill(actor, step, i, skillIds));
  if (skills.some((s) => !s)) {
    globalThis.ui?.notifications?.warn?.(`${blueprint.name} names no skill ${actor.name} can roll for it.`);
    return { ...empty, success: false, refusal: 'no-skill' };
  }
  const plan = planCraft({
    ...planInput,
    modifiers: { ...modifiers, resolve: craftModifierResolver(actor, { skills, spaceDoc, linked, target, template }) }
  });

  const confirmedCodes = new Set();
  const ruleBreaks = [];
  // A crafter without the step's skill (a catalog stand-in with no gear bonus) rolls untrained only as a Rule Break.
  const untrained = new Set();
  for (const skill of skills) {
    if (skill.isGranted !== true || Number(skill.modifiedRank) > 0 || untrained.has(skill.id)) continue;
    const res = await confirmRuleBreak({
      title: 'Untrained Skill',
      message: `You do not have ${skill.name}. Roll untrained as a Rule Break?`,
      options: { ruleBreak: options.ruleBreak === true, interactive: options.interactive }
    });
    if (!res.confirmed) return { ...empty, success: false, refusal: res.refusal ?? 'cancelled', code: 'untrained' };
    untrained.add(skill.id);
    ruleBreaks.push(`${actor.name} rolled ${skill.name} untrained.`);
  }
  for (const warning of plan.warnings) {
    const res = await confirmRuleBreak({
      title: WARNING_TITLES[warning.code] ?? 'Rule Break',
      message: `${warning.message} Craft anyway as a Rule Break?`,
      options: { ruleBreak: options.ruleBreak === true, interactive: options.interactive }
    });
    if (!res.confirmed) return { ...empty, success: false, refusal: res.refusal ?? 'cancelled', code: warning.code };
    confirmedCodes.add(warning.code);
    ruleBreaks.push(warning.message);
  }

  const bpTemplates = asArray(bp.enchantments);
  const lootOutput = bp.mode === 'item' && template.type !== 'gear';
  const gearOutput = bp.mode === 'item' && template.type === 'gear';
  const units = Math.max(1, Math.floor(Number(bp.quantity) || 1)) * Math.max(1, Math.floor(Number(quantity) || 1));
  const crafted = () => ({
    actorUuid: actor.uuid,
    actorName: actor.name,
    blueprintUuid: blueprint.uuid ?? '',
    worldTime: Number(globalThis.game?.time?.worldTime) || 0
  });
  const anyBreak = () => ruleBreaks.length > 0;
  const result = { ...empty, success: true, ruleBreaks };

  let enchantTarget = bp.mode === 'item' ? null : target;
  let allDone = true;
  let stopped = '';
  let cursor = 0;
  const madeNames = [];

  /** The gear item an item-mode craft makes, created the first time a step needs it. */
  const ensureGear = async () => {
    if (enchantTarget || !gearOutput) return enchantTarget;
    enchantTarget = await createOutput(actor, template, units, crafted(), anyBreak());
    result.made.push(enchantTarget);
    madeNames.push(`${enchantTarget.name} x${units}`);
    return enchantTarget;
  };

  for (let i = 0; i < plan.steps.length; i += 1) {
    const step = plan.steps[i];
    const record = { kind: step.kind, label: step.label, dc: step.dc, hours: step.hours, outcome: '', salvage: [] };
    result.steps.push(record);

    const message = await actor.rollSkill(skills[i], { ...options, craft: craftRefOf(step, target, template) });
    const info = message?.flags?.[SYSTEM_ID]?.craft;
    if (!info) {
      result.success = false;
      result.refusal = 'roll-declined';
      stopped = 'The check was not rolled, so the attempt ended.';
      allDone = false;
      break;
    }
    // The hours do not affect the roll, so the clock moves only once the check was rolled (a declined dialog spends none).
    for (const chunk of clockChunks(step.hours)) await decrementFloorTimer(chunk, { actorUuid: actor.uuid });
    result.hoursSpent = round6(result.hoursSpent + step.hours);
    record.outcome = info.outcome;
    record.margin = info.margin;
    const success = isCraftSuccess(info.outcome);

    // Materials and junk are spent whether or not the check succeeds; a miss returns some by margin (Table 47).
    const lines = step.materials.map((m) => ({
      label: m.label, identifier: m.identifier, needed: m.found, salvageable: m.salvageable
    }));
    const salvage = evaluateSalvage({ outcome: info.outcome, margin: info.margin, materials: lines });
    record.salvage = salvage;
    const spaceTakes = [];
    const crawlerTakes = new Map();
    step.materials.forEach((line, li) => {
      let left = salvage[li].consumed;
      for (const stack of line.stacks) {
        if (left <= 0) break;
        const take = Math.min(stack.quantity, left);
        const sink = stack.source === 'space' ? spaceTakes : null;
        if (sink) sink.push({ itemId: stack.itemId, quantity: take });
        else crawlerTakes.set(stack.itemId, (crawlerTakes.get(stack.itemId) ?? 0) + take);
        left -= take;
      }
    });
    if (step.junk > 0) {
      const junk = evaluateSalvage({ outcome: info.outcome, margin: info.margin, materials: [{ label: 'Misc. Junk', needed: step.junk, salvageable: true }] })[0];
      record.salvage.push(junk);
    }
    await applyCrawlerTakes(actor, crawlerTakes);
    if (spaceTakes.length) await takeSpaceMaterials(actor, spaceDoc, spaceTakes);
    if (step.junk > 0) {
      const junk = record.salvage[record.salvage.length - 1];
      await spendJunkFrom(actor, spaceDoc, linked, junk.consumed);
    }

    if (!success) {
      allDone = false;
      const subject = enchantTarget;
      if (info.outcome === 'critical_failure' && subject) {
        await breakItem(subject);
        record.broke = true;
      }
      stopped = `${step.label || 'The step'} failed, so the attempt ended.`;
      break;
    }

    if (step.kind === 'mundane') {
      if (gearOutput) {
        await ensureGear();
        record.created = true;
      }
    } else if (lootOutput) {
      record.applied = true;
    } else {
      const subject = await ensureGear();
      const { list, next } = templatesForStep(bpTemplates, step, cursor);
      cursor = next;
      let stepApplied = true;
      // A bonusValue row raises the numbers the templates write; Difficulty and hours were fixed by the plan (G4-D5)
      const extra = Number(step.modifiers?.bonusValue) || 0;
      let raisedCount = 0;
      for (const original of list) {
        const tpl = extra > 0 ? raiseTemplateBonus(original, extra) : null;
        if (tpl) raisedCount += tpl.raised;
        const res = await applyEnchantment(subject, tpl ? tpl.template : original, {
          method: 'craft',
          // Only a template that clashes now carries the confirmed Rule Break; the rest record none.
          ruleBreak: (confirmedCodes.has('sameProperty') && Boolean(sharesProperty(subject.system, original, { ignoreAs: true })))
            || (confirmedCodes.has('secondAsTrigger') && propertyKeys(original.rows, original.property).includes('as') && hasAsTrigger(subject)),
          interactive: options.interactive
        });
        if (res.destroyed) {
          record.destroyed = true;
          stepApplied = false;
          stopped = `${subject.name} was destroyed by the over-enchanting roll.`;
          break;
        }
        if (!res.applied) {
          stepApplied = false;
          stopped = `${original.label || 'The enchantment'} was not applied.`;
          break;
        }
        if (res.ruleBreak && !anyBreak()) ruleBreaks.push(`${original.label || 'An enchantment'} was applied as a Rule Break.`);
      }
      if (extra > 0) record.bonusRaised = { n: extra, raised: raisedCount, source: skills[i].name };
      record.applied = stepApplied;
      if (!stepApplied) {
        allDone = false;
        break;
      }
      await stampCrafted(subject, crafted(), anyBreak());
      madeNames.push(`${subject.name} enchanted: ${step.label}`);
    }
  }

  if (result.success && lootOutput && allDone) {
    const item = await createOutput(actor, template, units, crafted(), anyBreak());
    if (item) {
      result.made.push(item);
      madeNames.push(`${item.name} x${units}`);
    }
  }
  if (!allDone && result.success) result.success = false;
  result.ruleBreak = anyBreak();

  result.message = await globalThis.ChatMessage.create({
    speaker: globalThis.ChatMessage.getSpeaker?.({ actor }),
    content: craftResultCardHtml({
      actorName: actor.name,
      blueprintName: blueprint.name,
      steps: result.steps,
      made: madeNames,
      ruleBreaks,
      ruleBreak: result.ruleBreak,
      stopped
    }),
    flags: { [SYSTEM_ID]: { isCraftResult: true, ...(result.ruleBreak ? { ruleBreak: true } : {}) } }
  }, cardMessageOptions(actor));
  return result;
}

/** Lower the crawler's own stacks; a stack at zero is deleted. */
async function applyCrawlerTakes(actor, takes) {
  const plan = [...takes].map(([itemId, quantity]) => ({ itemId, quantity }));
  if (plan.length) await applyJunkPlan(actor, plan);
}

/** Spend junk points: the crawler's stacks first, then the stash of the space it is linked to. */
async function spendJunkFrom(actor, space, linked, points) {
  const own = planJunkSpend([...(actor.items ?? [])], points);
  await applyJunkPlan(actor, own.plan);
  if (own.missing <= 0 || !space || !linked) return;
  const stash = planJunkSpend([...(space.items ?? [])], own.missing);
  await takeSpaceMaterials(actor, space, stash.plan.map((p) => ({ itemId: p.itemId, quantity: p.quantity })));
}
