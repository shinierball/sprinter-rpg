/**
 * Sprinter RPG - Crawler Character Creation Dataset
 * Contains species data (content only). Background tables are not part of this dataset.
 * The creation rules (standard array, validation, rank resolution, generation) are in rules/crawler-creation-rules.mjs.
 */

export const COG_SPECIES_DATA = {
  human: {
    id: 'human',
    label: 'Human',
    aiFavor: 1,
    inherentSkill: {
      name: 'Unarmed Combat',
      ref: 'dccskl0000000014',
      rank: 3,
      stat: 'str',
      source: 'Species Inherent'
    },
    tierLabels: {
      tier1: 'Childhood',
      tier2: 'Adolescence',
      tier3: 'Career / Profession',
      tier4: 'Hobby'
    },
    tierRanks: {
      tier1: 1,
      tier2: 1,
      tier3: 3,
      tier4: 2
    }
  },
  animal: {
    id: 'animal',
    label: 'Animal',
    aiFavor: 0,
    inherentSkill: {
      name: 'Slice Attack',
      ref: 'dccskl0000000003',
      rank: 3,
      stat: 'dex',
      source: 'Species Inherent'
    },
    tierLabels: {
      tier1: 'Youth',
      tier2: 'Training',
      tier3: 'Adult',
      tier4: 'Quirk'
    },
    tierRanks: {
      tier1: 1,
      tier2: 1,
      tier3: 3,
      tier4: 2
    }
  }
};
