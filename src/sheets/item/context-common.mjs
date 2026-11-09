/**
 * Context shared by every item type: option lists, pill editors, catalogs, tags, interrupt and
 * rank-break flags. Type-specific additions live in `context-<type>.mjs`.
 */
import { recommendedWeaponSkillIdentifiers, recommendedOptionalEffects } from './weapon-recommendations.mjs';
import { getItemAllTags } from '../../documents/active-tags.mjs';
import { getCustomTags } from '../../data/tag-definitions.mjs';
import { COG_TAGS } from '../../data/tag-catalog.mjs';
import { TAG_NAMESPACES, normalizeElementTag } from '../../data/tag-vocabulary.mjs';
import { isAuraItem, isInterruptItem, getInterruptRange, getInterruptTriggers } from '../../utils/tag/tag-mechanics.mjs';
import {
  ABILITIES, DEFAULT_DAMAGE_TYPES, ARCHETYPES,
  WEAPON_CATEGORIES, WEAPON_TYPES, FLOORS, PROFICIENCY_MODES, WIELD_MODES, TARGET_FILTERS,
  CONTEST_STATS, CONTEST_TYPES, INTERRUPT_RANGE_FROM, choiceOptions, pickOptions
} from '../../utils/ui/field-options.mjs';
import { hasSystemField, toStringList } from './util.mjs';
import { conditionRefName } from '../../utils/item-describer/shared.mjs';
import { PERCENT_STAT_MODES, percentStatMode } from '../../utils/character/stat-percent.mjs';
import { toRowArray } from '../../models/items/grant-validation.mjs';
import { checkTypeOptions } from '../../data/rules/check-types.mjs';
import { sizeOptions } from '../../data/sizes.mjs';
import { heritageOptions } from '../../data/rules/heritages.mjs';
import { buildTagPills } from '../base/tag-editor.mjs';
import { buildQueryView } from './context-query.mjs';
import { listAreaShapes, resolveAreaGeometry, resolveAreaShapeId, areaReach } from '../../utils/area/area-geometry.mjs';
import { identifierLabel, identifierOptions } from '../../utils/ui/identifier-options.mjs';
import { buildPickList, identifierEntries, plainEntries } from './context-pick-list.mjs';

/** Buckets of a technique's `appliesToQuery`. */
const APPLIES_QUERY_BUCKETS = Object.freeze(['all', 'any', 'none']);

/**
 * The aura block's damage-type pickers: what allies inside the aura resist and are immune to. Damage types
 * come from `CONFIG.COG.damageTypes`, so a module's types are offered; a typed type the registry lacks is kept.
 * @param {object} area `system.area`
 * @param {string[]} damageTypes
 */
function buildAuraProtectionPickers(area, damageTypes) {
  const entries = plainEntries(damageTypes);
  const picker = (list, label, icon, stored) => buildPickList({
    label, icon, emptyText: 'None.', choose: '+ Add damage type...', placeholder: 'Or another damage type...',
    lists: [{ list, stored, entries, customLabel: 'Add' }]
  });
  return {
    areaGrantedResistancesPicker: picker('grantedResistances', 'Granted Resistances', 'fa-shield-virus', area?.grantedResistances),
    areaGrantedImmunitiesPicker: picker('grantedImmunities', 'Granted Immunities', 'fa-shield', area?.grantedImmunities)
  };
}

/** The registered `condition.*` tags as pick entries (value = the tag id, which is what the engine reads as a condition reference). */
function conditionEntries() {
  const seen = new Set();
  const out = [];
  for (const tag of [...COG_TAGS, ...getCustomTags()]) {
    if (!tag?.id || tag.namespace !== 'condition' || !tag.label || seen.has(tag.id)) continue;
    seen.add(tag.id);
    out.push({ value: tag.id, label: tag.label });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** `system.area` field behind each aura effect picker key (the keys are `PICK_LISTS` entries in actions-lists.mjs). */
const AREA_PICK_FIELDS = Object.freeze({
  areaGrantedBuffs: 'grantedBuffs',
  areaCleanseDebuffs: 'cleanseDebuffs',
  areaInflictedDebuffs: 'inflictedDebuffs',
  areaPulseConditions: 'pulseConditions'
});

/**
 * The aura block's effect pickers: buffs granted inside the aura, debuffs and conditions it inflicts, conditions applied
 * each pulse, and debuffs it cleanses. Each is the shared multi-pick list over its `system.area` string array. Buffs and
 * debuffs are stored by identifier; conditions by their `condition.<id>` tag, the reference the aura and pulse code resolves.
 * @param {object} area `system.area`
 * @param {{availableBuffs?: object[], availableDebuffs?: object[]}} catalogs
 */
function buildAuraEffectPickers(area, { availableBuffs = [], availableDebuffs = [] } = {}) {
  const buffs = identifierEntries(availableBuffs);
  const debuffs = identifierEntries(availableDebuffs);
  const effects = [...conditionEntries(), ...debuffs];
  const picker = (list, label, icon, entries, choose, customLabel) => buildPickList({
    label, icon, emptyText: 'None.', choose, placeholder: 'Or an identifier...',
    lists: [{ list, stored: area?.[AREA_PICK_FIELDS[list]], entries, customLabel }]
  });
  return {
    areaGrantedBuffsPicker: picker('areaGrantedBuffs', 'Granted Buffs (to characters inside the aura)', 'fa-sparkles', buffs, '+ Add buff...', 'Buff'),
    areaCleanseDebuffsPicker: picker('areaCleanseDebuffs', 'Cleanse Debuffs Inside Aura', 'fa-sparkles', debuffs, '+ Add debuff...', 'Debuff'),
    areaInflictedDebuffsPicker: picker('areaInflictedDebuffs', 'Inflicted Aura Debuffs & Conditions', 'fa-skull', effects, '+ Add debuff or condition...', 'Add'),
    areaPulseConditionsPicker: picker('areaPulseConditions', 'Conditions Applied Each Pulse', 'fa-hourglass-half', effects, '+ Add condition...', 'Add')
  };
}

/**
 * The shape select, size-input flags and the resolved-geometry line of an item's area block (spell, skill, gear).
 * Options come from the registered shape tags that carry geometry; fields show by the selected shape's size kind.
 * @param {object} area `system.area`
 * @param {object} item the item (rank breaks and rank resolve the printed geometry)
 * @returns {{ options: object[], absorbElementOptions: object[], showRadius: boolean, showLength: boolean, anchorHint: string, summary: string }}
 */
function buildAreaShapeView(area, item) {
  const shapes = listAreaShapes();
  const current = resolveAreaShapeId(area?.shape);
  const anchorHint = (s) => (s.anchor === 'point' ? 'placed' : 'from caster');
  const options = shapes.map((s) => ({ value: s.id, label: `${s.label} (${anchorHint(s)})`, selected: s.id === current }));
  const active = shapes.find((s) => s.id === current);
  const showLength = active?.size === 'length';
  let summary = '';
  const geometry = resolveAreaGeometry(item);
  if (geometry) {
    const label = active?.label || geometry.shape;
    const size = geometry.size === 'length' ? `${geometry.length} ft long by ${geometry.width} ft wide` : `${areaReach(geometry)} ft radius`;
    const angle = geometry.angle ? `, ${geometry.angle} degrees` : '';
    const splash = geometry.splash > 0 ? `, plus ${geometry.splash} ft splash` : '';
    summary = `${label}: ${size}${angle}${splash}, ${geometry.anchor === 'point' ? 'placed at a point' : 'from the caster'}`;
  }
  // The element a temporary-bar grant is limited to: the registered `element.*` tags (modules add more), empty = any damage.
  const absorb = normalizeElementTag(area?.absorbElement);
  const elementTags = [...COG_TAGS, ...getCustomTags()].filter((t) => t?.id && (t.namespace || String(t.id).split('.')[0]) === 'element');
  const absorbElementOptions = [{ value: '', label: 'Any damage', selected: !absorb }, ...elementTags.map((t) => ({ value: t.id, label: t.label || t.id, selected: t.id === absorb }))];
  if (absorb && !elementTags.some((t) => t.id === absorb)) absorbElementOptions.push({ value: absorb, label: `${absorb} (Custom)`, selected: true });
  return { options, absorbElementOptions, showRadius: !showLength, showLength, anchorHint: active ? anchorHint(active) : '', summary };
}

/**
 * A render-only copy of the item's system data. Context builders normalise and decorate it
 * (hydrated rank breaks, outcome option lists); none of that may leak into the document.
 * @param {object} system
 * @returns {object}
 */
export function cloneSystem(system) {
  if (!system) return {};
  const keys = new Set([...Object.keys(system), ...Object.keys(system.constructor?.schema?.fields ?? {})]);
  const plain = {};
  for (const key of keys) plain[key] = system[key];
  return foundry.utils.deepClone(plain);
}

/**
 * @param {object} context render context (mutated)
 * @param {COGItem} item
 * @param {{skills: object[], buffs: object[], debuffs: object[], spells: object[], tables: object[]}} catalogs
 */
/** Display name of the skill an `associatedSkills` entry references, or the raw value when unresolved. */
function skillLabelFor(value, skills = []) {
  const raw = String(value ?? '').trim().toLowerCase().replace(/^id\.skill\./, '');
  const hit = (skills || []).find((s) => raw && ((s.system?.identifier || '').toLowerCase() === raw || String(s.id || '').toLowerCase() === raw));
  return hit?.name || String(value ?? '');
}

export function buildCommonContext(context, item, catalogs) {
  const sys = context.system;
  context.abilities = ABILITIES;

  // Interrupt range editor: items whose schema has an interrupt block and that act as interrupts.
  context.showInterruptRange = hasSystemField(item, 'interrupt') && isInterruptItem(item);
  const rangeFrom = getInterruptRange(item).from;
  context.interruptRangeFromOptions = INTERRUPT_RANGE_FROM.map((o) => ({ ...o, selected: rangeFrom === o.value }));
  context.interruptTriggerLabels = context.showInterruptRange ? getInterruptTriggers(item).map((t) => t.label).join(', ') : '';

  buildLightContext(context, item);

  // A buff cannot emit an aura (3.13-4): the sheet says so when its tags still ask for one.
  context.showBuffAuraNote = item.type === 'buff' && isAuraItem(item);

  // Gold value: the GM edits it; an owning crawler sees it once its appraisal skill reaches the value Rank.
  const actor = item.actor;
  const determineValueRank = actor ? actor.getDetermineValueRank() : 0;
  context.canSeeItemValue = !actor || actor.canSeeItemValue();
  context.canEditItemValue = context.isGM;
  context.determineValueRank = determineValueRank;

  context.damageTypes = globalThis.CONFIG?.COG?.damageTypes || [...DEFAULT_DAMAGE_TYPES];


  context.areaShapeView = buildAreaShapeView(sys.area, item);

  // Select options (CONTRIBUTING §5)
  context.weaponCategories = WEAPON_CATEGORIES;
  context.weaponCategoryOptions = pickOptions(WEAPON_CATEGORIES, sys.weaponCategory, { blankLabel: '-- None / Generic --' });
  context.wieldModeOptions = pickOptions(WIELD_MODES, sys.wieldMode);
  context.proficiencyModeOptions = pickOptions(PROFICIENCY_MODES, sys.proficiencyMode);
  context.periodicDamageTypeOptions = pickOptions(context.damageTypes, sys.area?.periodicDamageType, { blankLabel: '-- Damage Type --' });
  context.proficiencyModes = PROFICIENCY_MODES;
  context.wieldModes = WIELD_MODES;
  context.targetFilterOptions = TARGET_FILTERS;
  context.archetypeOptions = ARCHETYPES;
  context.weaponTypes = WEAPON_TYPES;
  // `system.duration` stays human text (E4.5 S19); the cooldown and duration editors come from context-timing.mjs.
  context.checkTypeOptions = checkTypeOptions(sys.checkType);
  context.archetypeTagOptions = archetypeTagOptions(sys.archetypes);
  context.damageTypeOptions = choiceOptions(context.damageTypes, sys.damageType || '');
  context.weaponTypeOptions = choiceOptions(WEAPON_TYPES, sys.weaponType || '');
  context.sizeOptions = sizeOptions(sys.size, { blankLabel: 'COG.Size.noChange' });
  context.heritageOptions = heritageOptions(sys.heritage);
  context.floorOptions = choiceOptions(FLOORS, sys.floor || '');

  // Buff / debuff stat effects are `grants[kind: stat]` rows: the table edits them in place by their index in `grants`.
  // Percent is always live on buffs and debuffs, so only an owned item of another type, in fixed mode, shows the Locked column.
  context.statGrantRows = statGrantRows(sys.grants, {
    showLocked: item.type !== 'buff' && item.type !== 'debuff' && Boolean(item.actor) && percentStatMode() === PERCENT_STAT_MODES.FIXED
  });
  context.statGrantShowLocked = context.statGrantRows.some((r) => r.showLocked);
  // The Minimum column (7.1g): a buff's or debuff's stat row can stop the score falling below a floor
  context.statGrantShowMinimum = item.type === 'buff' || item.type === 'debuff';
  context.statGrantIsPenalty =item.type === 'debuff';

  // Pill editors
  context.associatedSkillsList = toStringList(sys.associatedSkills);
  context.associatedSkillsString = context.associatedSkillsList.join(', ');
  // Pills show the skill's name for a stored identifier (or id / id.skill.<identifier>); unresolved values show raw.
  context.associatedSkillsPills = context.associatedSkillsList.map((value) => ({ value, label: skillLabelFor(value, catalogs.skills) }));
  context.optionalEffectsList = toStringList(sys.optionalEffects);
  context.optionalEffectsString = context.optionalEffectsList.join(', ');

  // Technique restriction query ({ all, none } tag IDs) and the tag picker grouped by namespace.
  context.appliesToQuery = buildQueryView(sys.appliesToQuery, 'system.appliesToQuery', APPLIES_QUERY_BUCKETS);
  const tagGroups = new Map();
  for (const tag of [...COG_TAGS, ...getCustomTags()]) {
    if (!tag?.id) continue;
    const ns = tag.namespace || 'custom';
    if (!tagGroups.has(ns)) tagGroups.set(ns, { namespace: ns, label: TAG_NAMESPACES[ns]?.label || ns, tags: [] });
    tagGroups.get(ns).tags.push({ id: tag.id, label: tag.label || tag.id });
  }
  context.techniqueTagOptions = [...tagGroups.values()];

  // Catalogs
  const { skills, buffs, debuffs, spells, tables } = catalogs;
  context.availableSkills = skills;
  context.availableTechniques = skills.filter((s) =>
    s.system?.isTechnique === true
    || s.system?.techniqueConfig?.isDamageEffect === true
    || Boolean(s.system?.techniqueConfig?.damageBonus)
    || Boolean(s.system?.techniqueConfig?.baseDiceCountMod));
  context.recommendedSkills = recommendedWeaponSkillIdentifiers(item, skills);
  context.recommendedEffects = recommendedOptionalEffects(item, skills);
  // Optional effects are technique identifiers; the pills show the technique's name.
  context.optionalEffectPills = context.optionalEffectsList.map((id) => ({ id, label: identifierLabel(skills, id) }));
  context.availableBuffs = buffs;
  context.availableDebuffs = debuffs;
  if (hasSystemField(item, 'area')) {
    Object.assign(context, buildAuraProtectionPickers(sys.area, context.damageTypes));
    Object.assign(context, buildAuraEffectPickers(sys.area, { availableBuffs: buffs, availableDebuffs: debuffs }));
  }
  context.availableSpells = spells;
  context.spellIdentifierOptions = pickOptions(spells.filter(sp => sp?.system?.identifier).map(sp => ({ id: sp.system.identifier, label: sp.name })), sys.spellIdentifier);
  context.availableRollTables = tables;

  // Rank breaks (Ranks 5, 10, 15, 20 by default; each milestone rank is configurable 1-20).
  context.availableRanks = Array.from({ length: 20 }, (_, i) => i + 1);
  context.hasRankBreaksConfigured = Boolean(sys.rankBreaks && Object.values(sys.rankBreaks).some((rb) => rb && (
    Boolean(rb.damageDice)
    || Number(rb.rankDamageDice) > 0
    || Boolean(rb.buffsResistances)
    || Boolean(rb.debuff)
    || Boolean(rb.notes)
    || Boolean(rb.isArmorPiercing)
    || Number(rb.critMultiplier) > 1
    || Number(rb.healing?.barsBonus) > 0
    || Boolean(rb.healing?.cleanseDebuff)
    || Number(rb.area?.radiusBonus) > 0
    || Number(rb.tempBars?.hpPerSlot) > 0
    || Number(rb.contest?.dcBonus) > 0
    || Boolean(rb.contest?.onFailDebuff)
    || Number(rb.baseDiceMultiplier) > 1
    || Boolean(rb.baseDiceCountMod)
    || Number(rb.toHitBonus) > 0
    || Number(rb.checkBonus) > 0
    || Number(rb.rangeBonus) > 0
    || Number(rb.durationBonus) > 0
    || Number(rb.area?.lineLengthBonus) > 0
    || Number(rb.area?.lineWidthBonus) > 0
    || Number(rb.area?.splashBonus) > 0
    || Number(rb.interrupt?.rangeBonus) > 0
    || Number(rb.interrupt?.drBonus) > 0
    || rb.interrupt?.ignoreDebuffs === true
    || Number(rb.onHit?.healBonus) > 0
  )));

  context.contestStats = CONTEST_STATS;
  context.contestSkillOptions = identifierOptions(skills, sys.contest?.targetSkill, { blankLabel: '(None: stat check)' });
  context.contestFailDebuffOptions = identifierOptions(debuffs, sys.contest?.onFailDebuff, { blankLabel: '-- None --' });
  context.contestTypes = CONTEST_TYPES;
  context.hasContestConfigured = Boolean(
    sys.contest?.hasContest
    || sys.contest?.targetSkill
    || sys.contest?.onFailDebuff
    || sys.contest?.onFailNotes
    || Number(sys.contest?.customDC) > 0
  );

  context.tagsData = buildTagsData(item);
  return context;
}

/** The registered `archetype.*` tags (core and custom) as multi-select options, with the class's stored ones selected. */
function archetypeTagOptions(selected) {
  const chosen = new Set(Array.isArray(selected) ? selected : []);
  const options = [...COG_TAGS, ...getCustomTags()]
    .filter((t) => t?.id && (t.namespace || String(t.id).split('.')[0]) === 'archetype')
    .map((t) => ({ value: t.id, label: t.label || t.id, selected: chosen.has(t.id) }));
  for (const id of chosen) if (!options.some((o) => o.value === id)) options.push({ value: id, label: id, selected: true });
  return options;
}

/** Explicit (removable) and derived (read-only) tags for the tags part. */
function buildTagsData(item) {
  const explicitTags = Array.isArray(item.system?.tags) ? item.system.tags : [];
  const allTags = item.allTags instanceof Set ? item.allTags : getItemAllTags(item);
  const derivedTags = [...allTags].filter((t) => !explicitTags.includes(t));
  return {
    identifier: item.system?.identifier || '',
    ...buildTagPills({ explicit: explicitTags, derived: derivedTags }),
    allTagsCount: allTags.size
  };
}

/**
 * Structured Base Damage selects (shared by the skill and spell sheets): the stat ('' = the item's own stat, 'none' = no stat)
 * and the damage type, over the registered damage types (a typed value the registry lacks is kept as a Custom option).
 * @param {object} context sheet context
 * @param {{ownStatLabel?: string}} [opts]
 */
export function buildBaseDamageContext(context, { ownStatLabel = 'Own stat' } = {}) {
  const raw = context.system?.baseDamage;
  const baseDamage = raw && typeof raw === 'object' ? raw : {};
  context.baseDamageStatOptions = [
    { value: '', label: ownStatLabel },
    ...['str', 'dex', 'con', 'int', 'cha'].map((v) => ({ value: v, label: v.toUpperCase() })),
    { value: 'none', label: 'None' }
  ].map((o) => ({ ...o, selected: o.value === String(baseDamage.stat || '') }));
  context.baseDamageTypeOptions = [{ value: '', label: 'Default', selected: !baseDamage.damageType }, ...choiceOptions(context.damageTypes || [], baseDamage.damageType || '')];
}

/** Healing cleanse list and flag shared by skills and spells. */
export function buildHealingContext(context) {
  const healing = context.system.healing;
  const cleanse = toStringList(healing?.cleanseDebuffs);
  context.hasHealingConfigured = Boolean(healing?.hasHealing || healing?.isHoT || cleanse.length > 0);
  context.cleanseDebuffsList = cleanse;
  // The pill shows the debuff's live name; the stored reference (an identifier) is what a click removes.
  context.cleanseDebuffPills = cleanse.map(ref => ({ ref, label: conditionRefName(ref) }));
  context.cleanseDebuffsString = cleanse.join(', ');
}

/** Rank-gated tag text per milestone (`rankBreaks.<key>.tags` joined), for the unnamed tag inputs. */
export function buildRankBreakTagText(context, thresholds) {
  const rbs = context.system.rankBreaks || {};
  context.rankBreakTagText = Object.fromEntries(Object.keys(thresholds).map((k) => [
    k, (Array.isArray(rbs[k]?.tags) ? rbs[k].tags : []).join(', ')
  ]));
}

/** Crit timing choices for a rank-break debuff. */
const DEBUFF_ON_OPTIONS = [
  { value: 'hit', label: 'On hit' },
  { value: 'crit', label: 'On critical hit only' }
];

/**
 * Per-milestone view of the rank-break fields that need precomputed options or defaults (CONTRIBUTING §5):
 * `context.rankBreakViews.<rankKey>`. `withDamageType` adds the damage type choices (skills only: the spell sheet
 * already has its own damage type input per milestone).
 * @param {object} context render context (mutated)
 * @param {Record<string, number>} thresholds RANK_BREAK_THRESHOLDS
 * @param {{ withDamageType?: boolean }} [opts]
 */
export function buildRankBreakViews(context, thresholds, { withDamageType = false } = {}) {
  const rbs = context.system.rankBreaks || {};
  const damageTypes = context.damageTypes || [...DEFAULT_DAMAGE_TYPES];
  context.rankBreakViews = Object.fromEntries(Object.keys(thresholds).map((key) => {
    const rb = rbs[key] || {};
    const debuffOn = rb.debuffOn === 'crit' ? 'crit' : 'hit';
    return [key, {
      baseDiceMultiplier: Number(rb.baseDiceMultiplier) > 1 ? Number(rb.baseDiceMultiplier) : 1,
      debuffOnOptions: DEBUFF_ON_OPTIONS.map((o) => ({ ...o, selected: o.value === debuffOn })),
      damageTypeOptions: withDamageType ? choiceOptions(damageTypes, rb.damageType || '') : [],
      showLight: context.isLightItem === true,
      lightModeOptions: lightModeOptions(rb.light?.mode, { withUnchanged: true })
    }];
  }));
}

/**
 * The buff / debuff stat table rows: each `grants[kind: stat]` row with its index into `grants` (the inputs are named by
 * that index) and a precomputed stat select.
 * @param {Array|object} grants
 * @param {{ showLocked?: boolean }} [opts] `showLocked`: the table has a Locked column (an owned item in fixed mode)
 * @returns {Array<{ idx: number, stat: string, label: string, value: number, percent: number, locked: (number|string), showLocked: boolean, options: Array<{ value: string, label: string, selected: boolean }> }>}
 */
export function statGrantRows(grants, { showLocked = false } = {}) {
  return toRowArray(grants).flatMap((row, idx) => {
    if (row?.kind !== 'stat') return [];
    const stat = String(row.stat ?? '').toLowerCase();
    return [{
      idx, stat, label: String(row.label ?? ''), value: Number(row.value) || 0, percent: Number(row.percent) || 0,
      // An empty lock stays an empty input (not 0): the row is not locked yet
      locked: row.locked === null || row.locked === undefined || row.locked === '' ? '' : Number(row.locked),
      // An empty Minimum is no minimum (not 0)
      floor: row.floor === null || row.floor === undefined || row.floor === '' ? '' : Number(row.floor),
      showLocked,
      options: Object.entries(ABILITIES).map(([value, label]) => ({ value, label: `${value.toUpperCase()} (${label})`, selected: value === stat }))
    }];
  });
}

const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;

/** Light mode choices (`carried` / `free`); `withUnchanged` adds the blank "this rank break does not set it" option. */
function lightModeOptions(current, { withUnchanged = false } = {}) {
  const options = [
    { value: 'carried', label: loc('COG.Item.Light.ModeCarried') },
    { value: 'free', label: loc('COG.Item.Light.ModeFree') }
  ];
  if (withUnchanged) options.unshift({ value: '', label: loc('COG.Item.Light.ModeUnchanged') });
  const selected = current || (withUnchanged ? '' : 'carried');
  return options.map((o) => ({ ...o, selected: o.value === selected }));
}

/**
 * The Light section: shown on every item type that has a `light` block, so a blank item can be given a light. The light
 * data stays the source of truth: radii above 0 derive `rule.emits-light`, with no stored flag. (Gating the section on
 * that derived tag made it unreachable on a blank item.) Animation choices come from Foundry's `CONFIG.Canvas.lightAnimations`.
 * @param {object} context render context (mutated)
 * @param {COGItem} item
 */
function buildLightContext(context, item) {
  context.isLightItem = hasSystemField(item, 'light');
  if (!context.isLightItem) return;
  const light = context.system.light ?? {};
  const animations = globalThis.CONFIG?.Canvas?.lightAnimations ?? {};
  const current = String(light.animation ?? '');
  const options = [{ value: '', label: loc('COG.Item.Light.AnimationNone'), selected: current === '' }];
  for (const [key, def] of Object.entries(animations)) options.push({ value: key, label: loc(def?.label ?? key), selected: key === current });
  if (current && !animations[current]) options.push({ value: current, label: `${current} (Custom)`, selected: true });
  context.lightAnimationOptions = options;
  context.lightModeOptions = lightModeOptions(light.mode);
}
