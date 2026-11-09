/**
 * src/content/specs/examples/sets.mjs
 * Example-set metadata. One entry per set, in folder order.
 * - `id`: kebab slug, and the basename of the set's kind files (`mobs/<id>.mjs`, ...).
 * - `symbol`: two or three capitals for the source badge (7.7c), unique within the set list.
 * - `code`: two lowercase letters for `exampleId`, unique; null for the 3.4 sets, whose ids are committed in refs.mjs
 *   and coverage.mjs.
 * - `label`: the folder name without the release.
 * - `release`: null until the coordinator stamps it at the phase checkpoint (a per-phase chore, like the version bump).
 * - `authorship`: the registered authorship id (7.16) every document of the set carries unless the ledger
 *   (`../authorship.mjs`) names it: 'ai' when an agent wrote the set.
 * - `premise`: one line of human text.
 * Order: the coverage set comes first because the matrix set references its buffs and debuffs (the examples-items pack
 * lists referenced documents first, and the flattened pack lists keep their 3.4 order).
 */
export const EXAMPLE_SET_META = Object.freeze([
  Object.freeze({
    id: 'coverage', symbol: 'CV', code: null, label: 'Damage and Stat Coverage', release: '5.1.0',
    authorship: 'ai',
    premise: 'One buff or debuff per damage type and stat, so every modifier path has a worked example.'
  }),
  Object.freeze({
    id: 'matrix', symbol: 'MX', code: null, label: 'Mechanic Matrix', release: '5.1.0',
    authorship: 'ai',
    premise: 'One example per live row of the mechanic matrix.'
  }),
  Object.freeze({
    id: 'attack-profiles', symbol: 'AP', code: 'ap', label: 'Attack Profiles', release: '5.3.0',
    authorship: 'ai',
    premise: 'Three mobs whose attacks show the structured attack fields: hit Difficulty, range, area shapes, cooldown, rider lists and saves.'
  }),
  Object.freeze({
    id: 'racing-and-chasing', symbol: 'RC', code: 'rc', label: 'Racing and Chasing', release: '5.5.0',
    authorship: 'ai',
    premise: 'Sneakers that help only in a chase, a quick and a slow mob for a contest, and a table of obstacles the tracker draws legs from.'
  }),
  Object.freeze({
    id: 'creator-rows', symbol: 'CR', code: 'cr', label: 'Creator Rows', release: '5.8.0',
    authorship: 'ai',
    premise: 'A race and a class that carry what the Race and Class Creators author: the buffs and debuffs they grant, as catalog copies and typed rows.'
  }),
  Object.freeze({
    id: 'plain-labels', symbol: 'PL', code: 'pl', label: 'Plain Labels', release: '5.8.0',
    authorship: 'ai',
    premise: 'A race that leaves size alone and picks a heritage, a class that requires it, spells and skills that use plain labels and tags, a firecracker, and an intern.'
  }),
  Object.freeze({
    id: 'used-up', symbol: 'US', code: 'us', label: 'Used Up', release: '5.8.0',
    authorship: 'ai',
    premise: 'A reusable buzzer, a rechargeable wand and a multi-dose tonic, plus a drink that leaves a bottle, a scroll whose junk remembers it, a bag of the junk itself, and a torch that leaves a Burnt Torch.'
  }),
  Object.freeze({
    id: 'base-skills', symbol: 'BK', code: 'bk', label: 'Base Skills', release: '6.0.0',
    authorship: 'ai',
    premise: 'Every skill the base classes, races and starter weapons use, and one that only proves the system works.'
  }),
  Object.freeze({
    id: 'base-set', symbol: 'BS', code: 'bs', label: 'Base Set', release: '6.0.0',
    authorship: 'ai',
    premise: 'Ten classes, two races, and the spells and debuffs a world starts with before an import.'
  }),
  Object.freeze({
    id: 'crafting', symbol: 'CF', code: 'cf', label: 'Crafting', release: '7.0.0',
    authorship: 'ai',
    premise: 'A workbench that improves every floor, glitter nobody can salvage, two blueprints, a memo that upgrades whatever you are holding, and a toaster that went badly.'
  }),
  Object.freeze({
    id: 'loot-boxes', symbol: 'LB', code: 'lb', label: 'Loot Boxes', release: '7.0.0',
    authorship: 'ai',
    premise: 'Six achievements that each pay out a box, the boxes themselves, the prizes inside, a prize-category chain that turns an unfilled box into a freshly enchanted item, and a sash and a buff whose Stat bonuses are a percent.'
  }),
  Object.freeze({
    id: 'vehicles', symbol: 'VH', code: 'vh', label: 'Vehicles', release: '7.0.0',
    authorship: 'ai',
    premise: 'A prize van with everything bolted on, a motorized podium for one, a skill only valets have, and a blueprint for armor made of sponsor logos.'
  }),
  Object.freeze({
    id: 'floor-starts', symbol: 'FS', code: 'fs', label: 'Floor Starts', release: '7.0.0',
    authorship: 'ai',
    premise: 'Three crawlers that start past the Tutorial Floors, on Floor 3, Floor 4 and Floor 5, with typed answers for every arrival they skipped and a Race and Class for the two later starts.'
  }),
  Object.freeze({
    id: 'offline-mode', symbol: 'OM', code: 'om', label: 'Offline Mode', release: '7.0.0',
    authorship: 'ai',
    premise: 'A wind-up garter that keeps its bonus where powered gear stops responding, and an enchanted anklet that does not.'
  }),
  Object.freeze({
    id: 'contract-clauses', symbol: 'CC', code: 'cc', label: 'Contract Clauses', release: '7.0.0',
    authorship: 'ai',
    premise: 'Studio paperwork that changes you: a mascot clause, an extras contract and a night-shift drink, a lawyer in a can, and a spill of Toxic Sludge that iodine pills fix if you take them before the floor ends.'
  })
]);

/** The folder name for a set: "<release> · <label>", or "Unreleased · <label>" before the stamp. */
export function exampleFolderName(set) {
  return `${set.release ?? 'Unreleased'} · ${set.label}`;
}
