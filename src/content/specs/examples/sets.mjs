/**
 * src/content/specs/examples/sets.mjs
 * Example-set metadata. One entry per set, in folder order.
 * - `id`: kebab slug, and the basename of the set's kind files (`mobs/<id>.mjs`, ...).
 * - `code`: two lowercase letters for `exampleId`, unique; null for the 3.4 sets, whose ids are committed in refs.mjs
 *   and coverage.mjs.
 * - `label`: the folder name without the release.
 * - `release`: null until the coordinator stamps it at the phase checkpoint (a per-phase chore, like the version bump).
 * - `premise`: one line of human text.
 * Order: the coverage set comes first because the matrix set references its buffs and debuffs (the examples-items pack
 * lists referenced documents first, and the flattened pack lists keep their 3.4 order).
 */
export const EXAMPLE_SET_META = Object.freeze([
  Object.freeze({
    id: 'coverage', code: null, label: 'Damage and Stat Coverage', release: '5.1.0',
    premise: 'One buff or debuff per damage type and stat, so every modifier path has a worked example.'
  }),
  Object.freeze({
    id: 'matrix', code: null, label: 'Mechanic Matrix', release: '5.1.0',
    premise: 'One example per live row of the mechanic matrix.'
  }),
  Object.freeze({
    id: 'attack-profiles', code: 'ap', label: 'Attack Profiles', release: '5.3.0',
    premise: 'Three mobs whose attacks show the structured attack fields: hit Difficulty, range, area shapes, cooldown, rider lists and saves.'
  }),
  Object.freeze({
    id: 'racing-and-chasing', code: 'rc', label: 'Racing and Chasing', release: '5.5.0',
    premise: 'Sneakers that help only in a chase, a quick and a slow mob for a contest, and a table of obstacles the tracker draws legs from.'
  }),
  Object.freeze({
    id: 'creator-rows', code: 'cr', label: 'Creator Rows', release: '5.8.0',
    premise: 'A race and a class that carry what the Race and Class Creators author: the buffs and debuffs they grant, as catalog copies and typed rows.'
  }),
  Object.freeze({
    id: 'plain-labels', code: 'pl', label: 'Plain Labels', release: '5.8.0',
    premise: 'A race that leaves size alone and picks a heritage, a class that requires it, spells and skills that use plain labels and tags, a firecracker, and an intern.'
  }),
  Object.freeze({
    id: 'used-up', code: 'us', label: 'Used Up', release: '5.8.0',
    premise: 'A reusable buzzer, a rechargeable wand and a multi-dose tonic, plus a drink that leaves a bottle, a scroll whose junk remembers it, a bag of the junk itself, and a torch that leaves a Burnt Torch.'
  }),
  Object.freeze({
    id: 'base-skills', code: 'bk', label: 'Base Skills', release: '6.0.0',
    premise: 'Every skill the base classes, races and starter weapons use, and one that only proves the system works.'
  }),
  Object.freeze({
    id: 'base-set', code: 'bs', label: 'Base Set', release: '6.0.0',
    premise: 'Ten classes, two races, and the spells and debuffs a world starts with before an import.'
  })
]);

/** The folder name for a set: "<release> · <label>", or "Unreleased · <label>" before the stamp. */
export function exampleFolderName(set) {
  return `${set.release ?? 'Unreleased'} · ${set.label}`;
}
