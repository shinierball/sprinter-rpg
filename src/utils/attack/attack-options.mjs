/**
 * The attack choices engine: what one attack may add (Damage
 * Effects, maneuvers, situations, Called Plays), what the attacker chose, which choices break a rule, and the
 * snapshot a hit card keeps so the damage roll resolves exactly what was declared.
 *
 * `buildAttackOptions` and the helpers around it are pure: no DOM, no writes. `resolveAttackChoices` is the one place
 * that decides how the choices are obtained (macro `choices`, skip, the pop-up) and the only one that reads or writes
 * the user's last pick (`attack-picks.mjs`). The pop-up itself is a function `rollAttack` reaches through a seam
 * (`options.promptAttackOptions`, else `CONFIG.COG.promptAttackOptions`, else the pre-fill); the Attack Options window
 * (`src/apps/attack-options-dialog.mjs`) is registered there and returns unsettled choices.
 *
 * Everything reads structured data: identifiers, tags, ranks and flags. A name is only ever displayed.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { getOfferedSituations } from '../roll/damage-modifiers.mjs';
import { RULE_FLAG_DEFS, hasRuleFlag } from '../tag/tag-behaviour.mjs';
import { cooldownState, effectiveCooldown } from '../time/cooldowns.mjs';
import { formatRemaining, timingAmount } from '../time/timing.mjs';
import { describeRow } from '../item-describer/feature-describer.mjs';
import { formatDamageFormula } from '../damage/damage-parts.mjs';
import { currentTimeContext } from '../../documents/actor/dungeon-time.mjs';
import { techniqueBandSummary } from '../../documents/actor/actor-techniques.mjs';
import { confirmRuleBreak } from '../rule-break.mjs';
import { attackText } from './attack-text.mjs';
import { getAttackPick, prefill, rememberAttackPick } from './attack-picks.mjs';
import { settleFloorUses } from '../floor/floor-row-usage.mjs';
import { USE_TAG_PREFIX } from '../../data/tag-vocabulary.mjs';
import { headOnOfferFor } from '../vehicle/vehicle-combat.mjs';
import { camerasOffered, armedCamera, cameraAudienceList, sanitizeCameraChoice } from '../roll/cameras.mjs';
import { firstScalar } from '../first-scalar.mjs';
import { skillRefSlug, readableSkillName } from '../skill/weapon-skill-options.mjs';
import { escapeAttr } from '../escape-attr.mjs';

/** The rule flag a situation tag carries to be listed under Maneuvers (3.22-4 registers it and flags `situation.aiming`). */
const MANEUVER_FLAG = 'maneuver';

/** Entry-point options of a click: Shift rolls the last pick without the pop-up. */
export function skipOptions(event) {
  return { skipDialog: Boolean(event?.shiftKey) };
}

// -- Sanitising (CONTRIBUTING §4) -----------------------------------------------------------------------------------------

function firstText(raw) {
  const val = firstScalar(raw);
  return typeof val === 'string' ? val.trim() : '';
}

/** Non-empty strings from an array or a comma list, deduplicated. */
function textList(raw) {
  const list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split(',') : []);
  return [...new Set(list.filter(v => typeof v === 'string').map(v => v.trim()).filter(Boolean))];
}

const isNoneId = (id) => !id || id === 'none';

/**
 * The choices an attack is rolled with, sanitised. `situations` and `calledPlays` are arrays once answered; `calledPlays`
 * null means "every pending Called Play" (a macro that does not name them).
 * @typedef {object} AttackChoices
 * @property {string[]} effects Damage Effect identifiers (one, or more only as a Rule Break)
 * @property {string} variant the first effect's variant id, or ''
 * @property {string[]} maneuvers ticked maneuver situation tags
 * @property {string[]} situations other ticked situation tags
 * @property {string[]|null} calledPlays Called Play ids used
 * @property {'attack'|'effect'} markTarget
 * @property {string|null} cameras Playing to the Cameras audience id ('' = none); null = not answered (the armed choice applies)
 * @property {string} skill the weapon Skill identifier picked for this attack; '' = the default (7.51)
 */

/** @returns {AttackChoices} */
function sanitiseChoices(raw, options = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const effects = textList(src.effects).filter(id => !isNoneId(id));
  const situations = Array.isArray(src.situations) ? textList(src.situations) : textList(options.situations);
  const calledPlays = Array.isArray(src.calledPlays) ? textList(src.calledPlays) : (Array.isArray(options.calledPlays) ? textList(options.calledPlays) : null);
  return {
    effects,
    variant: effects.length ? firstText(src.variant) : '',
    maneuvers: textList(src.maneuvers).filter(t => t.startsWith('situation.')),
    situations,
    calledPlays,
    markTarget: (src.markTarget ?? options.markTarget) === 'attack' ? 'attack' : 'effect',
    cameras: src.cameras === undefined || src.cameras === null ? null : sanitizeCameraChoice(src.cameras),
    skill: skillRefSlug(firstText(src.skill))
  };
}

/** No Damage Effect, nothing ticked, every pending Called Play used. */
export function emptyChoices(model = null) {
  return sanitiseChoices({ calledPlays: (model?.calledPlays ?? []).map(e => e?.id) });
}

/**
 * The choices a caller answered outright: `options.choices`, else the `options.damageEffect` shorthand (`effects: [id]`;
 * '' / 'none' = None), which the chat and test helpers use. Null when the caller answered nothing.
 * @param {object} [options]
 * @returns {AttackChoices|null}
 */
export function readChoiceOptions(options = {}) {
  const given = options?.choices;
  if (given && typeof given === 'object' && !Array.isArray(given)) return sanitiseChoices(given, options);
  const shorthand = options?.damageEffect !== undefined && options?.damageEffect !== null ? options.damageEffect : options?.effect;
  if (shorthand === undefined || shorthand === null) return null;
  const id = firstText(typeof shorthand === 'object' ? shorthand?.system?.identifier : shorthand);
  return sanitiseChoices({ effects: isNoneId(id) ? [] : [id] }, options);
}

// -- The model -----------------------------------------------------------------------------------------------------

/** A formula is worked out the first time the pop-up reads it: building a model alone rolls nothing and previews nothing. */
function memo(target, key, compute) {
  const value = compute();
  Object.defineProperty(target, key, { value, enumerable: true });
  return value;
}

/** The damage formula of an attack with one effect (or None), as the card button would print it. '' when unknown. */
function previewFormula(actor, item, effectId, damageContext = null) {
  try {
    const opts = { damageEffect: isNoneId(effectId) ? 'none' : effectId, techniques: [], ...(damageContext ? { rollContext: damageContext } : {}) };
    if (item?.type === 'skill') {
      const data = actor.getSkillDamageData(item, opts);
      return data?.hasDamage ? (data.formulaWithStat || data.formula || '') : '';
    }
    const parts = item?.type === 'spell' ? actor.getSpellDamageParts(item, opts) : actor.getAttackDamageParts(item, opts);
    return parts.length ? formatDamageFormula(parts) : '';
  } catch {
    return '';
  }
}

/** Whether the effect's skill is ready now, and what is left (the same reading `gateItemCooldown` makes). */
function effectCooldown(actor, skill, rank) {
  const ready = { ready: true, label: '' };
  if (!skill) return ready;
  try {
    const spec = effectiveCooldown(skill, { rank });
    if (!spec.unit) return ready;
    const amount = timingAmount(spec, { actor, source: skill, carrier: skill, row: spec, context: { phase: 'use', item: skill } });
    const records = Array.isArray(skill.system?.useRecords) ? skill.system.useRecords : [];
    const state = cooldownState(spec, records.find(r => r?.key === 'self') ?? null, currentTimeContext(actor), { amount });
    return state.ready ? ready : { ready: false, label: formatRemaining(state) };
  } catch {
    return ready;
  }
}

/** One Damage Effect as the model lists it. Works for any identifier (a macro may name one the attack does not offer). */
function effectOption(actor, item, identifier, damageContext = null) {
  const skill = actor.findDamageEffectSkill?.(identifier) ?? null;
  const config = skill?.system?.techniqueConfig ?? {};
  const rank = Number(actor.getSkillRank?.(identifier)) || 0;
  const variantsAll = Array.isArray(config.variants) ? config.variants : [];
  const variantOf = (v) => ({ id: String(v?.id ?? ''), label: String(v?.label ?? ''), minRank: Number(v?.minRank) || 0, replacesDamage: v?.replacesDamage === true });
  const all = variantsAll.map(variantOf).filter(v => v.id);
  return {
    identifier,
    name: actor.getDamageEffectLabel?.(identifier) || identifier,
    icon: config.icon || 'fa-burst',
    rank,
    untrained: rank <= 0,
    summary: techniqueBandSummary(config.summaryBands, rank) || actor.getDamageEffectDescription?.(identifier) || '',
    get preview() { return memo(this, 'preview', () => previewFormula(actor, item, identifier, damageContext)); },
    cooldown: effectCooldown(actor, skill, rank),
    variants: all.filter(v => v.minRank <= rank),
    lockedVariants: all.filter(v => v.minRank > rank)
  };
}

const maneuverDeclared = () => Boolean(RULE_FLAG_DEFS[MANEUVER_FLAG]);
const isManeuverTag = (tag) => maneuverDeclared() && hasRuleFlag(new Set([tag]), MANEUVER_FLAG);

/** The "Reads as" text of the row that offered a situation (E7.1d). */
function readsOf(o) {
  try {
    return o.row ? describeRow(o.arrayKey, o.row).join('; ') : '';
  } catch {
    return '';
  }
}

function situationOption(actor, o) {
  const carrier = o.sourceRef?.carrier ?? o.sourceRef ?? null;
  const rank = carrier?.type === 'skill' ? (Number(actor.getSkillRank?.(carrier)) || 0) : undefined;
  const reads = readsOf(o);
  return {
    tag: o.tag, label: o.label, source: o.source, ...(rank !== undefined ? { rank } : {}), ...(rank !== undefined && carrier.id ? { carrierId: carrier.id } : {}), reads,
    ...(o.used !== undefined ? { used: o.used } : {})
  };
}

/** The AI Favor rating of the attack with no Damage Effect (the None row's badge). */
function noneFavor(actor, item, context) {
  try {
    return actor.getAiFavorRating(item, { context, damageEffect: 'none' }).value;
  } catch {
    return 0;
  }
}

/** D7: the maneuver's Disadvantage note, from the roll's advantage state with and without the maneuver ticked. */
function maneuverNote(advantageFor, tag) {
  if (typeof advantageFor !== 'function') return '';
  try {
    const without = advantageFor([]);
    const withIt = advantageFor([tag]);
    if (withIt?.mode === 'disadvantage' && without?.mode !== 'disadvantage') return 'Disadvantage';
    if (withIt?.mode === 'cancelled' && without?.mode === 'advantage') return `Disadvantage (cancelled by ${(without.reasons ?? []).join(', ')})`;
    if (withIt?.mode === 'advantage' && without?.mode === 'advantage' && withIt.net < without.net) {
      return `Disadvantage (outweighed by ${(without.advantages ?? []).join(', ')})`;
    }
  } catch {
    // an unreadable advantage state leaves no note
  }
  return '';
}

/**
 * What this attack may add. Never throws; missing data gives empty lists.
 * @param {object} actor
 * @param {object} attackItem
 * @param {object} context the roll's RollContext before any ticked situation
 * @param {object} [opts]
 * @param {'hit'|'damage'} [opts.mode='hit']
 * @param {Array<{ id: string }>} [opts.calledPlays=[]] the Called Plays pending for this roll (hit mode)
 * @param {(situations: string[]) => object} [opts.advantageFor] the roll's advantage state with these situations ticked (D7 note)
 * @param {object} [opts.options] the roll's options (explicit targets), read for the head-on offer (hit mode)
 * @param {Array<object>} [opts.skillOptions] the weapon's Skill options (`resolveWeaponSkills(...).options`, hit mode); the window lists them from two up
 * @param {string} [opts.defaultSkill] the identifier the roll uses when the attacker picks none
 * @param {string} [opts.chosenSkill] the Skill the roll already uses (a damage roll from a card or macro): the effects offered are that Skill's
 * @returns {{ mode: string, isMob: boolean, attackName: string, effects: object[], maneuvers: object[], situations: object[],
 *   calledPlays: object[], plainFormula: string, aiFavorIfNone: number, hasOptions: boolean, optionFor: (id: string) => object }}
 */
export function buildAttackOptions(actor, attackItem, context, { mode = 'hit', calledPlays = [], advantageFor = null, options: rollOptions = {}, skillOptions = [], defaultSkill = '', chosenSkill = '' } = {}) {
  // A damage-mode model previews with the roll's own damage context, so building it reads the targets once.
  const damageContext = mode === 'damage' ? context : null;
  let effects = [];
  let offered = [];
  try {
    const ids = typeof actor?.getSelectableDamageEffects === 'function' ? actor.getSelectableDamageEffects(attackItem, { chosen: chosenSkill }) : [];
    effects = ids.map(id => effectOption(actor, attackItem, id, damageContext));
    offered = getOfferedSituations(actor, context, {
      ...(mode === 'damage' ? { keys: ['damageModifiers'], exclusive: true } : { isAttack: true }),
      subjects: context?.other ? false : undefined,
      withRows: true
    });
  } catch (err) {
    console.warn('Sprinter RPG | Could not build the attack options', err);
  }
  // 3.44 G3: an attack on a moving vehicle or one of its occupants may be head-on; the same offer a skill roll or Evade gets.
  // A mob's declared attack rolls no to-hit (the crawler's Evade dialog carries its own head-on toggle), so it is not asked.
  if (mode === 'hit' && actor?.type !== 'mob') {
    try {
      offered.push(...headOnOfferFor(actor, context, rollOptions ?? {}));
    } catch (err) {
      console.warn('Sprinter RPG | Could not build the head-on offer', err);
    }
  }
  const options = offered.map(o => situationOption(actor, o));
  const maneuvers = options.filter(o => isManeuverTag(o.tag)).map(o => ({ ...o, note: maneuverNote(advantageFor, o.tag) }));
  const situations = options.filter(o => !isManeuverTag(o.tag));
  const pending = mode === 'hit' ? calledPlays.filter(e => e && typeof e.id === 'string') : [];
  const aiFavorIfNone = noneFavor(actor, attackItem, context);
  // Playing to the Cameras (E6.10): a hit roll of anything but a mob offers the audiences; a damage roll is no Check.
  const cameraRoll = mode === 'hit' && camerasOffered(actor);
  const cameras = cameraRoll ? cameraAudienceList().map(a => ({ id: a.id, label: String(a.label || a.id) })) : [];
  const armedCameras = cameraRoll ? armedCamera(actor) : '';
  const cache = new Map(effects.map(e => [e.identifier, e]));
  return {
    mode,
    isMob: actor?.type === 'mob',
    attackName: attackItem?.name ?? '',
    effects,
    maneuvers,
    situations,
    calledPlays: pending,
    cameras,
    armedCameras,
    skills: mode === 'hit' ? skillChoiceRows(skillOptions) : [],
    defaultSkill: mode === 'hit' ? String(defaultSkill || '') : '',
    get plainFormula() { return memo(this, 'plainFormula', () => previewFormula(actor, attackItem, 'none', damageContext)); },
    aiFavorIfNone,
    hasOptions: (mode === 'hit' && skillOptions.length > 1) || effects.length > 0 || maneuvers.length > 0 || situations.length > 0 || pending.length > 0 || Boolean(armedCameras),
    optionFor(id) {
      if (!cache.has(id)) cache.set(id, effectOption(actor, attackItem, id, damageContext));
      return cache.get(id);
    }
  };
}

/** The Skill options a window lists, each with its label (never a raw id: a Skill this world lacks reads as its identifier made readable). */
function skillChoiceRows(options) {
  return (Array.isArray(options) ? options : []).map((o) => {
    const name = String(o.skill?.name || readableSkillName(o.identifier));
    // A trained option shows its Rank even when the world lacks the Skill (an attack item's toHitRank applies, 1086)
    const label = o.trained ? attackText('COG.Attack.Skill.Rank', { name, rank: o.rank })
      : (o.inWorld ? attackText('COG.Attack.Skill.Untrained', { name }) : attackText('COG.Attack.Skill.NotInWorld', { name }));
    return { identifier: o.identifier, name, rank: o.rank, trained: o.trained, inWorld: o.inWorld, listed: o.listed, label };
  });
}

// -- Rule Break reasons (9) ----------------------------------------------------------------------------------------

/**
 * Every way these choices break a rule, as display strings (never a block, CONTRIBUTING rule 2). Order: untrained, cooldown (hit),
 * more than one effect, an effect the attack does not allow, a locked variant. Mobs earn no Untrained reason; their cooldowns count like a crawler's (3.22-8).
 * @param {ReturnType<typeof buildAttackOptions>} model
 * @param {AttackChoices} choices
 * @param {{ isMob?: boolean, offered?: Iterable<string> }} [opts] `offered`: the Damage Effects the Skill actually used allows
 *   (the window lists the default Skill's, so a changed Skill judges an effect against its own list, 7.52)
 * @returns {string[]}
 */
export function ruleBreakReasons(model, choices, { isMob = model?.isMob === true, offered: offeredIds = null } = {}) {
  const reasons = [];
  const ids = choices?.effects ?? [];
  const option = (id) => (typeof model?.optionFor === 'function' ? model.optionFor(id) : (model?.effects ?? []).find(e => e.identifier === id));
  for (const id of ids) {
    const eff = option(id);
    if (!isMob && eff?.untrained) reasons.push(attackText('COG.AttackChoices.Reason.Untrained', { name: eff.name }));
  }
  if (model?.mode !== 'damage') {
    for (const id of ids) {
      const eff = option(id);
      if (eff?.cooldown && eff.cooldown.ready === false) reasons.push(attackText('COG.AttackChoices.Reason.Cooldown', { name: eff.name, left: eff.cooldown.label }));
    }
  }
  if (ids.length > 1) reasons.push(attackText('COG.AttackChoices.Reason.Multiple'));
  const offered = new Set(offeredIds ?? (model?.effects ?? []).map(e => e.identifier));
  for (const id of ids) {
    if (!offered.has(id)) reasons.push(attackText('COG.AttackChoices.Reason.NotOffered', { name: option(id)?.name ?? id, attack: model?.attackName ?? '' }));
  }
  if (ids.length && choices.variant) {
    const eff = option(ids[0]);
    const locked = (eff?.lockedVariants ?? []).find(v => v.id === choices.variant);
    if (locked) reasons.push(attackText('COG.AttackChoices.Reason.Variant', { variant: locked.label || locked.id, name: eff.name, rank: locked.minRank }));
  }
  return reasons;
}

/**
 * One confirmation listing every reason. Nothing to confirm is a pass.
 * @returns {Promise<{ proceed: boolean, ruleBreak: boolean }>}
 */
export async function confirmChoiceRuleBreaks(reasons, options = {}) {
  if (!reasons.length) return { proceed: true, ruleBreak: false };
  const check = await confirmRuleBreak({
    title: attackText('COG.AttackChoices.Confirm.Title'),
    message: `${reasons.map(escapeAttr).join('<br>')}<br>${attackText('COG.AttackChoices.Confirm.Question')}`,
    reason: reasons.join(' '),
    options
  });
  return { proceed: check.confirmed, ruleBreak: check.confirmed };
}

// -- The snapshot (11) ---------------------------------------------------------------------------------------------

/**
 * The first effect's chosen variant when it replaces the damage (a Stun instead of damage), else null: the hit card's
 * button then reads "Resolve: <label>" instead of "Roll Attack Damage".
 * @returns {{ id: string, label: string, replacesDamage: boolean }|null}
 */
export function replacingVariant(choices, model) {
  if (!choices?.effects?.length || !choices.variant || !model) return null;
  const v = choicesFlag(choices, model).effects[0]?.variant;
  return v?.replacesDamage ? v : null;
}

/**
 * The hit card's `attackChoices` flag: names and ranks from the model, so the card never needs the actor again.
 * @param {AttackChoices} choices
 * @param {ReturnType<typeof buildAttackOptions>} model
 * @param {{ ruleBreak?: boolean, reasons?: string[] }} [rule]
 */
export function choicesFlag(choices, model, { ruleBreak = false, reasons = [] } = {}) {
  const effects = choices.effects.map((identifier, i) => {
    const eff = model.optionFor(identifier);
    const variant = i === 0 && choices.variant
      ? [...(eff.variants ?? []), ...(eff.lockedVariants ?? [])].find(v => v.id === choices.variant)
      : null;
    return {
      identifier, name: eff.name, rank: eff.rank, untrained: eff.untrained,
      ...(variant ? { variant: { id: variant.id, label: variant.label, replacesDamage: variant.replacesDamage } } : {})
    };
  });
  const byTag = new Map(model.maneuvers.map(m => [m.tag, m]));
  const maneuvers = choices.maneuvers.filter(t => byTag.has(t)).map((tag) => {
    const m = byTag.get(tag);
    return { tag, label: m.label, rank: m.rank ?? 0, note: m.note ?? '' };
  });
  const unlisted = choices.maneuvers.filter(t => !byTag.has(t));
  const situationLabels = Object.fromEntries(model.situations.filter(s => s?.tag && s.label).map(s => [s.tag, s.label]));
  return {
    effects,
    maneuvers,
    situations: [...new Set([...choices.situations, ...unlisted])],
    situationLabels,
    calledPlays: [...(choices.calledPlays ?? [])],
    markTarget: choices.markTarget,
    cameras: choices.cameras || '',
    skill: choices.skill || '',
    ruleBreak: Boolean(ruleBreak),
    reasons: [...reasons]
  };
}

/**
 * The choices a hit card holds, sanitised. Null when the message carries no snapshot.
 * @param {{ flags?: object }|null} message
 * @returns {(AttackChoices & { ruleBreak: boolean, reasons: string[] })|null}
 */
export function choicesFromMessage(message) {
  const flag = message?.flags?.[SYSTEM_ID]?.attackChoices;
  if (!flag || typeof flag !== 'object' || Array.isArray(flag)) return null;
  const effects = (Array.isArray(flag.effects) ? flag.effects : []).filter(e => e && typeof e === 'object');
  const ids = effects.map(e => firstText(e.identifier)).filter(id => !isNoneId(id));
  return {
    ...sanitiseChoices({
      effects: ids,
      variant: effects[0]?.variant?.id,
      maneuvers: (Array.isArray(flag.maneuvers) ? flag.maneuvers : []).map(m => m?.tag),
      situations: flag.situations,
      calledPlays: flag.calledPlays,
      markTarget: flag.markTarget,
      cameras: flag.cameras,
      skill: flag.skill
    }),
    ruleBreak: flag.ruleBreak === true,
    reasons: textList(flag.reasons)
  };
}

/** A technique-shaped record (what `options.techniques` takes) for an effect the actor owns. */
function techniqueFor(actor, identifier) {
  const skill = actor?.findDamageEffectSkill?.(identifier) ?? null;
  const sys = skill?.system ?? {};
  return {
    id: skill?.id ?? identifier,
    identifier,
    name: actor?.getDamageEffectLabel?.(identifier) || identifier,
    rank: Number(actor?.getSkillRank?.(identifier)) || 0,
    item: skill ?? undefined,
    system: skill ? sys : undefined
  };
}

/**
 * The damage roll's inputs for these choices: the first effect is the chosen effect, every further one rides as a
 * technique (a Rule Break pick), and the variant is carried for 3.22-5.
 * @param {AttackChoices} choices
 * @param {object} [actor] resolves the extra effects to their technique skills
 * @returns {{ damageEffect: string, techniques: object[], effectVariant: string }}
 */
export function choicesToDamageOptions(choices, actor = null) {
  const ids = choices?.effects ?? [];
  return {
    damageEffect: ids[0] ?? 'none',
    techniques: ids.slice(1).map(id => techniqueFor(actor, id)),
    effectVariant: ids.length ? (choices?.variant ?? '') : ''
  };
}

// -- Obtaining the choices (3) -------------------------------------------------------------------------------------

/** Without a registered window (a headless caller, no UI) the pre-filled last pick is the answer. */
async function usePrefill(_actor, _item, _model, prefilled) {
  return prefilled.choices;
}

/** The pop-up function in force: this call's, the registered one (`CONFIG.COG`), else the pre-fill. */
function prompterFor(options) {
  if (typeof options?.promptAttackOptions === 'function') return options.promptAttackOptions;
  const registered = globalThis.CONFIG?.COG?.promptAttackOptions;
  return typeof registered === 'function' ? registered : usePrefill;
}

/**
 * Decide the choices of one attack (hit or standalone damage), in the order of 3 and D3:
 * `options.choices` / `options.damageEffect` answer outright (the last pick is neither read nor written); an attack with
 * nothing optional rolls plain; `skipDialog`, `interactive: false` roll the pre-filled last pick; anything else opens
 * the pop-up pre-filled from it. Reads the last pick; writing it is `commitPick`, after the Rule Break confirmation.
 *
 * @param {object} actor
 * @param {object} item
 * @param {ReturnType<typeof buildAttackOptions>} model
 * @param {object} options the roll options
 * @param {object} [ctx] `{ context }` handed to the pop-up
 * @returns {Promise<{ choices: AttackChoices, remember: boolean, skillAnswered?: boolean }|null>} null when the user cancelled the pop-up
 */
export async function resolveAttackChoices(actor, item, model, options = {}, ctx = {}) {
  const resolved = await decideChoices(actor, item, model, options, ctx);
  if (!resolved) return resolved;
  // A caller that ticks situations or Called Plays itself (`options.situations`, `options.calledPlays`) answers those outright.
  const { choices } = resolved;
  // Playing to the Cameras: `options.cameras` answers outright, else the pop-up's pick, else the armed choice; only where offered.
  const offered = (model.cameras ?? []).length > 0;
  const cameras = !offered ? '' : (typeof options.cameras === 'string' ? sanitizeCameraChoice(options.cameras) : (choices.cameras ?? model.armedCameras ?? ''));
  return {
    ...resolved,
    choices: {
      ...choices,
      cameras,
      situations: Array.isArray(options.situations) ? [...new Set([...choices.situations, ...textList(options.situations)])] : choices.situations,
      calledPlays: Array.isArray(options.calledPlays) ? textList(options.calledPlays) : choices.calledPlays
    }
  };
}

async function decideChoices(actor, item, model, options, ctx) {
  const given = readChoiceOptions(options);
  if (given) return { choices: withDefaults(given, model), remember: false };
  if (!model.hasOptions) return { choices: emptyChoices(model), remember: false };

  const prefilled = prefill(model, getAttackPick(globalThis.game?.user, actor, item));
  if (options.skipDialog === true || options.interactive === false) {
    if (prefilled.dropped.length) globalThis.ui?.notifications?.info?.(prefilled.dropped.map(d => d.hint).join(' '));
    return { choices: prefilled.choices, remember: false };
  }
  const picked = await prompterFor(options)(actor, item, model, prefilled, { ...ctx, options, mode: model.mode });
  if (!picked) return null;
  // A window with no Skill select (a damage roll) answers no Skill: the remembered Skill pick must survive it (7.51 review N3)
  return { choices: withDefaults(picked, model), remember: true, skillAnswered: (model.skills ?? []).length > 1 };
}

/** Choices a caller left without Called Plays use every pending one. */
function withDefaults(choices, model) {
  if (Array.isArray(choices.calledPlays)) return choices;
  return { ...choices, calledPlays: (model.calledPlays ?? []).map(e => e.id) };
}

/**
 * Store the pop-up's pick as the user's last pick for the attack (only when it changed). Call it once the attack is
 * going ahead: a Cancel anywhere before leaves the older pick.
 * @returns {Promise<boolean>}
 */
export async function commitPick(actor, item, resolved) {
  if (!resolved?.remember) return false;
  return rememberAttackPick(globalThis.game?.user, actor, item, resolved.choices, { keepSkill: resolved.skillAnswered === false });
}

/**
 * Settle the answered choices of a spell roll without a second dialog (3.22-11): the pop-up already asked, so the
 * ticked situations stand as given; a `use.<row key>` toggle still settles through the shared floor-use helper (a repeat
 * on the same floor asks for a Rule Break, the use is recorded). The Called Plays used are the pending ones the choices name.
 * @param {object} actor
 * @param {object} context the roll's context before situations
 * @param {AttackChoices} choices the resolved choices
 * @param {object} [options] the roll options (`ruleBreak`, `interactive`)
 * @param {{ calledPlays?: Array<{ id: string }>, keys?: string[], exclusive?: boolean, isAttack?: boolean }} [opts]
 *   the pending Called Plays, and what the pop-up offered (for the labels of floor rows)
 * @returns {Promise<{ situations: string[], calledPlayIds: string[], floorRuleBreak?: true }>}
 */
export async function settleChoiceToggles(actor, context, choices, options = {}, { calledPlays = [], ...offerOpts } = {}) {
  const wanted = Array.isArray(choices?.calledPlays) ? new Set(choices.calledPlays) : null;
  const calledPlayIds = calledPlays.filter(e => e && typeof e.id === 'string' && (!wanted || wanted.has(e.id))).map(e => e.id);
  const situations = [...(choices?.situations ?? [])];
  if (!situations.some(t => t.startsWith(USE_TAG_PREFIX))) return { situations, calledPlayIds };
  const labels = new Map();
  for (const o of getOfferedSituations(actor, context, offerOpts)) if (o.rowLabel) labels.set(o.tag.slice(USE_TAG_PREFIX.length), o.rowLabel);
  const settled = await settleFloorUses(actor, situations, { labels, options });
  return { situations: settled.situations, calledPlayIds, ...(settled.ruleBreak ? { floorRuleBreak: true } : {}) };
}
