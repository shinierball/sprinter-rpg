/**
 * The weapon section of the gear sheet: the Skill used to attack, the weapon type, hands, damage and to-hit, each as
 * a precomputed view (`context.weapon`) so the partials under `templates/items/parts/gear/` only lay it out.
 * Reads structured data only: Skills through `listedSkillEntries`, types through `weaponTypeTags`, bonus damage from the
 * item's own `damageModifiers` `add` rows.
 */
import { listedSkillEntries, skillRefSlug, worldSkillResolver } from '../../utils/skill/weapon-skill-options.mjs';
import { rankReadout } from '../../data/builders/weapon-spec.mjs';
import { weaponTypeTags, DEFAULT_TAG_LOOKUP } from '../../utils/item-check/weapon-type.mjs';
import { baseDamageText, mergeBaseDamage, normalizeBaseDamage } from '../../utils/damage/base-damage.mjs';
import { summarizeRow } from '../../utils/item-describer/modifier-summary.mjs';
import { kindOf } from '../../utils/row-kinds.mjs';
import { tagCatalog } from '../../utils/tag/tag-list.mjs';
import { statOptions } from '../../utils/ui/field-options.mjs';

/** Tag namespaces the weapon type chips cover (the weapon family, then the weapon group). */
const WEAPON_TYPE_NAMESPACE = 'weapon';
const WEAPON_GROUP_NAMESPACE = 'weaponGroup';

const i18n = () => globalThis.game?.i18n;
const localize = (key) => i18n()?.localize?.(key) ?? key;
const format = (key, data) => i18n()?.format?.(key, data) ?? key;
const lower = (v) => String(v ?? '').trim().toLowerCase();

/** The weapon's own `add` rows of `damageModifiers` (the bonus damage), each with its index in the stored array. */
function bonusDamageRows(sys) {
  const rows = Array.isArray(sys?.damageModifiers) ? sys.damageModifiers : [];
  return rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row && typeof row === 'object' && kindOf('damageModifiers', row) === 'add');
}

/**
 * The type and group tags the first listed Skill (that has any) carries, minus none: what "Use the Skill's" adds.
 * @param {object} sys the item's `system`
 * @param {{ find?: Function, list?: Function }} resolver
 * @param {{ get: Function }} [tags]
 * @returns {string[]}
 */
export function skillWeaponTags(sys, resolver, tags = DEFAULT_TAG_LOOKUP) {
  const namespaces = new Map(tagCatalog().map((t) => [t.id, t.namespace]));
  for (const entry of listedSkillEntries(sys, resolver)) {
    const skillTags = Array.isArray(entry.definition?.system?.tags) ? entry.definition.system.tags : [];
    const picked = [...weaponTypeTags(skillTags, tags), ...skillTags.filter((id) => namespaces.get(id) === WEAPON_GROUP_NAMESPACE)];
    if (picked.length) return [...new Set(picked)];
  }
  return [];
}

/** The Skill pills of `skill-order-list.hbs`, each marked `unknown` when this world has no such Skill. */
function markUnresolved(pills, entries) {
  return pills.map((pill) => {
    const ref = lower(pill.value);
    const entry = entries.find((e) => e.refs.includes(ref));
    return { ...pill, unknown: !entry?.inWorld };
  });
}

function typeChips(selected) {
  const chosen = new Set(selected);
  return tagCatalog()
    .filter((t) => t.namespace === WEAPON_TYPE_NAMESPACE || t.namespace === WEAPON_GROUP_NAMESPACE)
    .map((t) => ({ id: t.id, label: t.label, description: t.description ?? '', selected: chosen.has(t.id), isGroup: t.namespace === WEAPON_GROUP_NAMESPACE }));
}

/**
 * What the weapon rolls at Rank 0, 5 and 10 as the readout partial lays it out (`gear/weapon-readout.hbs`): the gear sheet
 * and the weapon builder's damage step both read it from here.
 * @param {object} weaponSystem the weapon's `system`
 * @param {object} [resolver] the Skill catalogs (default: this world's)
 * @returns {{ readout: Array<{ rank: number, untrained: boolean, text: string, label: string }>, readoutEmpty: boolean }}
 */
export function weaponReadoutContext(weaponSystem, resolver = worldSkillResolver()) {
  const lines = rankReadout(weaponSystem, resolver);
  return {
    readoutEmpty: lines.every((line) => !line.text),
    readout: lines.map((line) => ({ ...line, label: format('COG.WeaponBuilder.Readout.Rank', { rank: line.rank }) }))
  };
}

/**
 * @param {object} context the sheet's render context (`system`, `associatedSkillsPills` set; `weapon` is added)
 * @param {object} item the gear item
 * @param {{ resolver?: object, tags?: object }} [deps] catalogs (default: this world's)
 */
export function buildWeaponContext(context, item, { resolver = worldSkillResolver(), tags = DEFAULT_TAG_LOOKUP } = {}) {
  const sys = context.system;
  const isAttack = item?.type === 'attack';
  const entries = listedSkillEntries(sys, resolver);
  context.toHitStatOptions = statOptions(sys.toHitStat, { blankLabel: 'Auto' });
  context.associatedSkillsPills = markUnresolved(context.associatedSkillsPills ?? [], entries);

  // A mob never gets a stand-in for a listed Skill it does not own, so its sheet asks what its roll picks
  const holder = item?.parent?.type === 'mob' && typeof item.parent._resolveWeaponSkills === 'function' ? item.parent : null;
  const mobPick = holder ? holder._resolveWeaponSkills(item).option?.identifier : undefined;
  const first = entries.find((e) => e.inWorld) ?? null;
  const found = holder ? (entries.find((e) => e.inWorld && skillRefSlug(e.identifier) === mobPick) ?? null) : first;
  const mobLacks = holder && !found && first;
  const defaultBase = normalizeBaseDamage(found?.definition?.system?.baseDamage);
  const own = normalizeBaseDamage(sys.baseDamage);
  const hasOverride = Boolean(own.dice || own.stat || own.damageType);
  const skillText = baseDamageText(defaultBase);
  const effectiveText = baseDamageText(mergeBaseDamage(defaultBase, own));
  const bonus = bonusDamageRows(sys).map(({ row, index }) => ({ index, text: summarizeRow('damageModifiers', row), disabled: row.disabled === true }));

  const selectedTags = (Array.isArray(sys.tags) ? sys.tags : []).filter((id) => typeof id === 'string');
  const chips = typeChips(selectedTags);
  const skillTags = skillWeaponTags(sys, resolver, tags);

  Object.assign(context, weaponReadoutContext(sys, resolver));
  context.weapon = {
    title: localize(isAttack ? 'COG.Attack.Sheet.Title' : 'COG.GearSheet.Weapon.Title'),
    typeOptional: isAttack,
    hasSkills: entries.length > 0,
    skillCount: entries.length,
    defaultSkillName: found?.definition?.name ?? '',
    typeChips: chips.filter((c) => !c.isGroup),
    groupChips: chips.filter((c) => c.isGroup),
    selectedChips: chips.filter((c) => c.selected),
    hasType: weaponTypeTags(selectedTags, tags).length > 0,
    canUseSkillType: skillTags.some((id) => !selectedTags.includes(id)),
    damage: {
      skillLine: mobLacks
        ? format('COG.GearSheet.Damage.MobLacksSkill', { skill: first.definition?.name ?? first.identifier })
        : found
        ? format('COG.GearSheet.Damage.SkillLine', { skill: found.definition?.name ?? found.identifier, damage: skillText || localize('COG.GearSheet.Damage.NoBase') })
        : localize('COG.GearSheet.Damage.NoSkill'),
      hasOverride,
      effectiveLine: hasOverride ? format(isAttack ? 'COG.Attack.Sheet.Rolls' : 'COG.GearSheet.Damage.Rolls', { damage: effectiveText }) : '',
      bonus,
      hasBonus: bonus.length > 0
    },
    toHitRank: Number(sys.toHitRank) || 0
  };
}
