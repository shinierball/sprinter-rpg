/**
 * src/content/specs/examples/items/creator-rows.mjs
 * Release set "Creator Rows": a race and a class that carry what the Race and Class Creators can author
 * since 3.59 and no earlier example reaches. Batch 5 adds `grantedEffects`: the buffs and debuffs a race or class
 * grants, authored as the creator's `buffs[]` / `debuffs[]` rows and compiled by `buildPayload('race'|'class', spec)`.
 * A row picked from the catalog is a frozen copy of the catalog document (`identifier`, `name`, `img`, `system`); a typed
 * row is a name and a description. `tier`, `cost` and `extraPoints` are ledger labels and never reach the item.
 * Batch 7 adds a custom perk with `defenseModifiers` and `tags` rows (the creator's Mechanics editor). Batch 8 adds a
 * labelled stat pool, a negative rank bonus (it earns Extra BP in the ledger), a rank bonus with a query and a ledger
 * cost, and a fixed skill grant row on a perk (the creator's grant row editor). Batch 9 adds a perk with senses, movement, a
 * stat cap and a `requires` query.
 */
import { exampleId } from '../ids.mjs';
import { EXAMPLE_EFFECT_SPECS } from '../effects.mjs';

/** A creator row that is a copy of the catalog buff or debuff with this identifier (the Catalog select's pick). */
function catalogCopy(identifier, ledger) {
  const def = EXAMPLE_EFFECT_SPECS.find((spec) => spec.system?.identifier === identifier);
  if (!def) throw new Error(`creator-rows: no example effect "${identifier}"`);
  return { identifier, name: def.name, img: def.img, system: structuredClone(def.system), ...ledger };
}

/** A perk row: `path` is a `system.*` field of the race or class, `value` the row for it. */
const row = (path, value) => ({ path: `system.${path}`, row: value });

const q = (all = [], any = [], none = []) => ({ all, any, none });

export const SPECS = Object.freeze([
  {
    type: 'race',
    _id: exampleId('cr', 'i', 1),
    name: 'Laugh Track Phantom',
    img: 'icons/svg/aura.svg',
    description: 'Recorded in 1974. Still laughing. +2 Charisma, -1 Strength, and 1 stat point to spend on Charisma or Intelligence; -1 Rank in Strength, never below 1; Constitution caps at 14. Walk speed -5 ft, Climb speed 10 ft, Darkvision, and double vision range. Resists Sonic damage. It cannot worship a deity. It starts with Studio Audience Approval and Canned Enthusiasm, and with the Dated Material debuff.',
    size: 'medium',
    stats: { cha: 2, str: -1 },
    buffs: [
      catalogCopy('studio-audience-approval', { tier: 'moderate', cost: 2 }),
      { name: 'Canned Enthusiasm', description: 'Applause arrives on schedule, whether or not you earned it.', tier: 'minor', cost: 1 }
    ],
    debuffs: [
      { name: 'Dated Material', description: 'Your jokes were funnier in a previous decade.', tier: 'minor', extraPoints: 1 }
    ],
    // Batch 8: a labelled pool, and a negative rank bonus (ledger-only `cost` is ignored while the value is below 0).
    statPools: [{ value: 1, options: ['cha', 'int'], label: 'Rehearsal time' }],
    rankBonuses: [{ tag: 'stat.str', value: -1, floor: 1, onlyIfOwned: true, label: 'Hasn\'t lifted anything since 1974' }],
    // Batch 7: a custom perk whose Mechanics rows are a defense modifier and a tag, authored in the creator's rows editor.
    customBenefits: [
      {
        name: 'Dead Air',
        cost: 2,
        rows: [
          row('defenseModifiers', { kind: 'resistance', damageType: 'Sonic', label: 'Already deafened by the studio' }),
          row('tags', 'creature.undead'),
          row('grants', { kind: 'skill', identifier: 'crowd-warmer', rank: 1, label: 'Crowd Warmer' })
        ]
      },
      // Batch 9: senses, movement, a stat cap and a `requires` query, each a row holding only the keys it sets.
      {
        name: 'Echo Chamber',
        cost: 2,
        rows: [
          row('senses', { darkvisionUnlimited: true, rangeMultiplier: 2 }),
          row('movement', { climb: 10, walkDelta: -5 }),
          row('statCaps', { con: 14 }),
          row('requirements', { kind: 'noWorship' })
        ]
      }
    ]
  },
  {
    type: 'class',
    _id: exampleId('cr', 'i', 2),
    name: 'Seat Filler',
    img: 'icons/svg/chest.svg',
    description: 'You are paid to be here. You are not paid enough to leave. +1 Constitution and +1 Charisma, and +1 Rank in a Knowledge Skill you already have. The Bard archetype, and the Stage Fright debuff from the first take.',
    archetypes: ['archetype.bard'],
    isEarthClass: false,
    stats: { con: 1, cha: 1 },
    debuffs: [
      catalogCopy('stage-fright', { tier: 'minor', extraPoints: 1 })
    ],
    // Batch 8: a rank bonus aimed by a query, with the ledger cost set to Epic (6 BP).
    rankBonuses: [{ query: q(['kind.skill'], ['skillGroup.knowledge']), value: 1, cost: 6, label: 'Knows where the exits are' }]
  }
]);
