/**
 * The race and class select options a sheet shows: heritage and archetype groups, world items, and the current
 * reference and label.
 */

import { offeredEntries } from '../utils/content-source.mjs';
import { ARCHETYPE_TO_TAG } from './tag-vocabulary.mjs';
import { companionHeritageId, heritageGroups, heritageLabel, sanitizeHeritageId } from './rules/heritages.mjs';
import { isFormRace } from '../utils/character/transform-rules.mjs';
import { worldRaces as worldRaceItems } from './race-class-plan.mjs';
import { checkRequirements, requirementSubject } from '../utils/character/requirements.mjs';

/**
 * Generates precomputed select options for Race and Class dropdowns.
 *
 * With `requirements`, each option is judged against the actor (or actor view) it is given: an option with unmet
 * requirements gets `unmet: n` and a "(n unmet)" label suffix, stays where it is and stays selectable (rule 2), and
 * `currentRequirements` holds the picked option's judged rows for the badge list under the select.
 *
 * @param {Actor} actor
 * @param {{ requirements?: boolean }} [options]
 * @returns {object} { raceOptions, classOptions, hasCustomRace, hasCustomClass, currentRace, currentClass,
 *   currentRaceLabel, currentClassLabel, currentRequirements: { race, class } } (option values and current* are
 *   references; *Label are names; `currentRequirements` rows are `checkRequirements` rows, empty unless `requirements`)
 */
export function getRaceClassContext(applier, actor, { requirements = false } = {}) {
  // `details.race` / `details.class` hold a reference (the item identifier) or, for an uncataloged
  // write-in, the text itself. A race or class item embedded directly (dropped, imported, scripted)
  // never wrote the detail, so its own reference stands in; otherwise the Core selects read "None" beside real items.
  const embeddedRef = (type) => String(actor?.items?.find((i) => i.type === type)?.system?.identifier ?? '');
  const currentRace = String(actor?.system?.details?.race || '').trim() || embeddedRef('race');
  const currentClass = String(actor?.system?.details?.class || '').trim() || embeddedRef('class');
  // One reader set for every option of this render; the picked option's rows are kept for the badge list.
  const readers = requirements ? requirementSubject(actor) : null;
  const currentRequirements = { race: [], class: [] };
  const judged = (kind, def, opt, label) => {
    if (!readers) return { ...opt, label };
    const { rows } = checkRequirements(actor, { ...def, type: kind }, readers);
    if (opt.selected) currentRequirements[kind] = rows;
    const count = rows.filter((r) => r.status === 'unmet').length;
    if (!count) return { ...opt, label };
    return { ...opt, label: `${label} (${count} unmet)`, unmet: count };
  };
  const option = (def, label = def.name) => {
    const value = applier.definitionRef(def);
    return judged('race', def, { value, selected: Boolean(value) && value === currentRace }, label);
  };

  // 1. Race Options: one group per registered heritage; a `companion.pet` race joins the companion group
  const groupOptions = new Map(heritageGroups().map(g => [g.id, []]));
  let raceFound = false;

  const companionId = companionHeritageId();
  const raceCatalog = offeredEntries('races');
  for (const r of raceCatalog) {
    const opt = option(r);
    if (opt.selected) raceFound = true; else if (isFormRace(r)) continue; // a form race is listed only when it is the actor's (7.1g)
    const tags = r.system?.tags || [];
    const heritageId = tags.includes('companion.pet') ? companionId : sanitizeHeritageId(r.system?.heritage);
    if (!groupOptions.has(heritageId)) groupOptions.set(heritageId, []);
    groupOptions.get(heritageId).push(opt);
  }

  const worldRaces = [];
  for (const item of worldRaceItems()) {
    const opt = option({ name: item.name, uuid: item.uuid, system: item.system }, `${item.name} (Custom)`);
    if (opt.selected) raceFound = true; else if (isFormRace(item)) continue;
    worldRaces.push(opt);
  }

  // Registered groups always show (empty or not); an unregistered id gets its own group after them
  const groups = heritageGroups({ companionFirst: actor?.type === 'pet' });
  const known = new Set(groups.map(g => g.id));
  for (const id of groupOptions.keys()) if (!known.has(id)) groups.push({ id, label: heritageLabel(id) });
  const raceOptions = groups.map(g => ({ label: g.label, options: groupOptions.get(g.id) ?? [] }));
  if (worldRaces.length > 0) {
    raceOptions.push({ label: 'Custom / World Races', options: worldRaces });
  }

  const hasCustomRace = Boolean(currentRace && !raceFound);

  // 2. Class Options
  const archetypes = [
    'Arcanist', 'Barbarian', 'Bard', 'Cleric', 'Druid',
    'Fighter', 'Mage', 'Monk', 'Paladin', 'Rogue'
  ];
  const archetypeMap = {};
  for (const arch of archetypes) archetypeMap[arch] = [];
  const multiclassClasses = [];
  let classFound = false;

  const classCatalog = offeredEntries('classes');
  const classOption = (def, label = def.name) => {
    const value = applier.definitionRef(def);
    return judged('class', def, { value, selected: Boolean(value) && value === currentClass }, label);
  };
  for (const c of classCatalog) {
    const opt = classOption(c);
    if (opt.selected) classFound = true;

    // One archetype tag groups the class under it; none, several or an unlisted one puts it with the special classes.
    const tags = Array.isArray(c.system?.archetypes) ? c.system.archetypes : [];
    const matchArch = tags.length === 1 ? archetypes.find(a => ARCHETYPE_TO_TAG[a.toLowerCase()] === tags[0]) : null;
    if (matchArch) archetypeMap[matchArch].push(opt);
    else multiclassClasses.push(opt);
  }

  const worldClasses = [];
  for (const item of globalThis.game?.items ?? []) {
    if (item.type !== 'class') continue;
    const opt = classOption({ name: item.name, uuid: item.uuid, system: item.system }, `${item.name} (Custom)`);
    if (opt.selected) classFound = true;
    worldClasses.push(opt);
  }

  const classOptions = [];
  for (const arch of archetypes) {
    if (archetypeMap[arch].length > 0) {
      classOptions.push({ label: `${arch} Classes`, options: archetypeMap[arch] });
    }
  }
  if (multiclassClasses.length > 0) {
    classOptions.push({ label: 'Multiclass & Special Classes', options: multiclassClasses });
  }
  if (worldClasses.length > 0) {
    classOptions.push({ label: 'Custom / World Classes', options: worldClasses });
  }

  const hasCustomClass = Boolean(currentClass && !classFound);

  return {
    raceOptions,
    classOptions,
    hasCustomRace,
    hasCustomClass,
    currentRace,
    currentClass,
    currentRaceLabel: applier.definitionLabel('race', currentRace, { actor }),
    currentClassLabel: applier.definitionLabel('class', currentClass, { actor }),
    currentRequirements
  };
}
