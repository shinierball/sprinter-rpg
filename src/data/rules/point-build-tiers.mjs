/** Point-build tier rules: tier labels and point costs the race and class builders read. */

export const COG_BENEFIT_TIERS = {
  minor: { label: 'Minor Benefits', cost: 1 },
  moderate: { label: 'Moderate Benefits', cost: 2 },
  major: { label: 'Major Benefits', cost: 3 },
  extreme: { label: 'Extreme Benefits', cost: 4 },
  epic: { label: 'Epic Benefits', cost: 6 }
};

export const COG_DETRIMENT_TIERS = {
  minor: { label: 'Minor Detriments', extraPoints: 1 },
  moderate: { label: 'Moderate Detriments', extraPoints: 2 },
  major: { label: 'Major Detriments', extraPoints: 3 }
};
