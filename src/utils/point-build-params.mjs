/**
 * Point-build parameter picker. A catalog benefit or detriment that declares `rowParams` (a creature
 * type, a skill, a situation, a stat...) needs the user's choice before its row templates make a row. This module is the
 * pure side: which control each parameter gets, the precomputed option lists, which parameters are still unfilled, and
 * the sanitizer for a chosen value. The values land in the selection's `params`, which `catalogRows` fills into the
 * templates (`$name` and `subject.$name`). Pure: no document reads; the registries are read through the same helpers
 * the row editor uses. Nothing here blocks a build (CONTRIBUTING rule 2): an unfilled parameter is only flagged.
 */
import { COG_TAGS, TAG_NAMESPACES, getCustomTags, identityTag } from '../data/tags.mjs';
import { ABILITIES, DEFAULT_DAMAGE_TYPES } from '../sheets/item/options.mjs';
import { pointBuildBenefits } from '../content/point-build.mjs';
import { identifierOptions } from '../sheets/item/identifier-options.mjs';

const WEAPON_TAG_NAMESPACES = ['weapon', 'weaponClass', 'weaponGroup', 'weaponProp', 'wield', 'skillGroup'];
const SPELL_TAG_NAMESPACES = ['element', 'action', 'shape', 'delivery', 'duration', 'target', 'favored'];

/**
 * How each `rowParams` name is picked. `tag` controls list the registered tags of `namespaces` (all namespaces when
 * null), grouped by namespace as the row editor's picker does. `skillTag` also offers each catalog skill's identity tag,
 * `clubTag` the club tags the catalog's membership benefits add.
 */
export const PARAM_SPECS = Object.freeze({
  creatureTag: { control: 'tag', namespaces: ['creature'], labelKey: 'COG.PointBuilder.Param.creatureTag' },
  skillTag: { control: 'tag', namespaces: ['skillGroup'], withSkills: true, labelKey: 'COG.PointBuilder.Param.skillTag' },
  groupTag: { control: 'tag', namespaces: ['skillGroup'], labelKey: 'COG.PointBuilder.Param.groupTag' },
  situation: { control: 'tag', namespaces: ['situation'], labelKey: 'COG.PointBuilder.Param.situation' },
  statTag: { control: 'tag', namespaces: ['stat'], labelKey: 'COG.PointBuilder.Param.statTag' },
  clubTag: { control: 'tag', namespaces: ['access'], withClubs: true, labelKey: 'COG.PointBuilder.Param.clubTag' },
  favoredTag: { control: 'tag', namespaces: ['favored'], labelKey: 'COG.PointBuilder.Param.favoredTag' },
  spellTag: { control: 'tag', namespaces: SPELL_TAG_NAMESPACES, labelKey: 'COG.PointBuilder.Param.spellTag' },
  weaponTag: { control: 'tag', namespaces: WEAPON_TAG_NAMESPACES, labelKey: 'COG.PointBuilder.Param.weaponTag' },
  tag: { control: 'tag', namespaces: null, labelKey: 'COG.PointBuilder.Param.tag' },
  stat: { control: 'stat', labelKey: 'COG.PointBuilder.Param.stat' },
  from: { control: 'stat', labelKey: 'COG.PointBuilder.Param.from' },
  to: { control: 'stat', labelKey: 'COG.PointBuilder.Param.to' },
  skill: { control: 'skill', labelKey: 'COG.PointBuilder.Param.skill' },
  damageType: { control: 'damageType', labelKey: 'COG.PointBuilder.Param.damageType' },
  label: { control: 'text', labelKey: 'COG.PointBuilder.Param.label' }
});

/** One param value as a trimmed string (an array or comma list keeps its first entry; CONTRIBUTING §4). */
export function cleanParamValue(raw) {
  let val = raw ?? '';
  if (Array.isArray(val)) val = val[0] ?? '';
  val = String(val);
  if (val.includes(',')) val = val.split(',')[0];
  return val.trim();
}

/** Whether a stored value counts as chosen. */
const isFilled = (value) => value !== undefined && value !== null && String(value).trim() !== '';

/**
 * The `rowParams` of an entry that neither the selection's `params` nor the entry's `rowDefaults` fill.
 * @param {object} entry catalog benefit or detriment
 * @param {object} [params] the selection's chosen values
 * @returns {string[]}
 */
export function unfilledParams(entry, params = {}) {
  const defaults = entry?.rowDefaults ?? {};
  return (Array.isArray(entry?.rowParams) ? entry.rowParams : [])
    .filter((name) => !isFilled(params?.[name]) && !isFilled(defaults[name]));
}

/** The registered tags of the given namespaces (all when null), grouped by namespace: `[{ namespace, label, tags }]`. */
export function groupedTagOptions(namespaces = null) {
  const groups = new Map();
  for (const tag of [...COG_TAGS, ...getCustomTags()]) {
    if (!tag?.id) continue;
    const ns = tag.namespace || 'custom';
    if (namespaces && !namespaces.includes(ns)) continue;
    if (!groups.has(ns)) groups.set(ns, { namespace: ns, label: TAG_NAMESPACES[ns]?.label || ns, tags: [] });
    groups.get(ns).tags.push({ id: tag.id, label: tag.label || tag.id });
  }
  return [...groups.values()];
}

/** `[{ label, options: [{ value, label, selected }] }]` for one param; a chosen value the registry lacks stays selectable. */
function optionGroups(spec, current) {
  const mark = (value, label) => ({ value, label, selected: value === current });
  let groups = [];
  if (spec.control === 'tag') {
    groups = groupedTagOptions(spec.namespaces).map((g) => ({ label: g.label, options: g.tags.map((t) => mark(t.id, t.label)) }));
    if (spec.withClubs) {
      // No `access.*` tag is registered; the clubs are the access tags the catalog's own membership benefits add.
      const clubs = pointBuildBenefits().flatMap((b) => (b.rows ?? [])
        .filter((r) => r.path === 'system.tags' && String(r.row).split('.')[0] === 'access')
        .map((r) => mark(r.row, b.name)));
      if (clubs.length) groups.push({ label: TAG_NAMESPACES.access.label, options: clubs });
    }
    if (spec.withSkills) {
      const skills = identifierOptions('skill', '').map((o) => mark(identityTag('skill', o.value), o.label));
      if (skills.length) groups.push({ label: 'Skills', options: skills });
    }
  } else if (spec.control === 'stat') {
    groups = [{ label: '', options: Object.entries(ABILITIES).map(([key, label]) => mark(key, label)) }];
  } else if (spec.control === 'skill') {
    groups = [{ label: '', options: identifierOptions('skill', '').map((o) => mark(o.value, o.label)) }];
  } else if (spec.control === 'damageType') {
    const types = globalThis.CONFIG?.COG?.damageTypes || DEFAULT_DAMAGE_TYPES;
    groups = [{ label: '', options: types.map((t) => mark(t, t)) }];
  }
  if (current && !groups.some((g) => g.options.some((o) => o.selected))) {
    groups.unshift({ label: '', options: [mark(current, current)] });
  }
  return groups;
}

/**
 * The picker views for a selected entry, one per declared parameter, ready for the template. A parameter name the
 * picker has no spec for is shown as free text so no benefit is left without a way to fill it.
 * @param {object} entry catalog benefit or detriment
 * @param {object} [params] the selection's chosen values
 * @returns {Array<{ name: string, labelKey: string, isText: boolean, value: string, defaulted: boolean, missing: boolean, groups: object[] }>}
 */
export function paramPickers(entry, params = {}) {
  const defaults = entry?.rowDefaults ?? {};
  return (Array.isArray(entry?.rowParams) ? entry.rowParams : []).map((name) => {
    const spec = PARAM_SPECS[name] ?? { control: 'text', labelKey: `COG.PointBuilder.Param.${name}` };
    const chosen = isFilled(params?.[name]) ? String(params[name]).trim() : '';
    const defaulted = !chosen && isFilled(defaults[name]);
    const value = chosen || (defaulted ? String(defaults[name]) : '');
    const isText = spec.control === 'text';
    return {
      name,
      labelKey: spec.labelKey,
      isText,
      value,
      defaulted,
      missing: !value,
      groups: isText ? [] : optionGroups(spec, value)
    };
  });
}
