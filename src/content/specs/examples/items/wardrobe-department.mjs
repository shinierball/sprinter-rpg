/**
 * src/content/specs/examples/items/wardrobe-department.mjs
 * Unreleased set "Wardrobe Department": a costume that changes the body, and what the body can then wear.
 * `exampleId('wd', 'i', 1..7)`:
 *   1 Costume Fitting (affliction, cue rest, always curable)  -> form Pantomime Horse with its own token image
 *   2 Pantomime Horse (form race, Large)                      -> trait Back Half
 *   3 Back Half (trait debuff, limbModifiers arms -2, hands -2, legs +2)
 *   4 Understudy Notice (affliction, cue floor, curable on the floor) -> the same form, no token image
 *   5 Sponsor's Bracers (arms slot): taken off while the body has no arms
 *   6 Complimentary Oven Mitts (hands slot, Weapon box off, tag rule.worn): worn, not held, so a weapon and a shield fit
 *     over them; taken off while the body has no hands
 *   7 Wardrobe Call Sheet (consumable): Inflict Debuff, Costume Fitting
 * A form race is a point-buy race ticked "Transformation form"; its trait is a copy of a debuff of this set, as the
 * Race Creator's Catalog pick writes it. All text is original.
 */
import { exampleId } from '../ids.mjs';

const id = (n) => exampleId('wd', 'i', n);
const PERMANENT = Object.freeze({ type: 'permanent', value: 0 });

const BACK_HALF = {
  type: 'debuff',
  _id: id(3),
  name: 'Back Half',
  img: 'icons/svg/downgrade.svg',
  system: {
    identifier: 'back-half',
    severity: 'Major',
    description: '<p>Somebody else is the rear of the horse, and the front has to go where they go. No working arms or hands while the costume is on; two more legs than you asked for.</p>',
    limbModifiers: { arms: -2, hands: -2, legs: 2 },
    durationConfig: PERMANENT
  }
};

/** An affliction: a permanent debuff that carries a `transform` block. */
const affliction = (n, name, img, identifier, text, transform) => ({
  type: 'debuff',
  _id: id(n),
  name,
  img,
  system: { identifier, severity: 'Major', description: `<p>${text}</p>`, durationConfig: PERMANENT, transform }
});

export const SPECS = Object.freeze([
  affliction(1, 'Costume Fitting', 'icons/svg/mystery-man.svg', 'costume-fitting',
    'Wardrobe wants you back for a fitting after you sleep. The costume will not mind if you say no, but the horse will.',
    { forms: [{ race: 'pantomime-horse', tokenImg: 'icons/svg/pawprint.svg' }], effects: [], cue: 'rest', curable: 'always' }),
  {
    type: 'race',
    _id: id(2),
    name: 'Pantomime Horse',
    img: 'icons/svg/pawprint.svg',
    description: 'Two contestants, one costume, four legs and a strong disagreement about direction. The audience votes with its applause.',
    form: true,
    size: 'large',
    stats: { str: 2, dex: -2 },
    debuffs: [{ identifier: 'back-half', name: BACK_HALF.name, img: BACK_HALF.img, system: structuredClone(BACK_HALF.system), tier: 'major', extraPoints: 2 }]
  },
  BACK_HALF,
  affliction(4, 'Understudy Notice', 'icons/svg/clockwork.svg', 'understudy-notice',
    'Posted on the call board: you have been replaced on tonight\'s show by a horse. Whoever is cast as the horse takes the floor with you.',
    { forms: [{ race: 'pantomime-horse' }], effects: [], cue: 'floor', curable: 'floor' }),
  {
    type: 'gear',
    _id: id(5),
    name: 'Sponsor\'s Bracers',
    img: 'icons/svg/shield.svg',
    system: {
      identifier: 'sponsors-bracers',
      description: '<p>Forearm guards with a logo too large to read. They need arms to sit on: a body with none has to take them off.</p>',
      slot: 'arms',
      isWeapon: false
    }
  },
  {
    type: 'gear',
    _id: id(6),
    name: 'Complimentary Oven Mitts',
    img: 'icons/svg/shield.svg',
    system: {
      identifier: 'complimentary-oven-mitts',
      description: '<p>Quilted mitts from the catering sponsor, worn over the hands and not held in them: they take no hand, so a weapon and a shield still fit over them. They need hands to go on: a body with none has to take them off.</p>',
      slot: 'hands',
      isWeapon: false,
      tags: ['rule.worn']
    }
  },
  {
    type: 'loot',
    _id: id(7),
    name: 'Wardrobe Call Sheet',
    img: 'icons/svg/book.svg',
    system: {
      identifier: 'wardrobe-call-sheet',
      description: '<p>A single sheet with your name on it and a time you were never told. Hand it over and you get Costume Fitting.</p>',
      lootType: 'consumable',
      quantity: 1,
      executionMode: 'all',
      outcomes: [
        { type: 'debuff', name: 'Report to Wardrobe', debuffIdentifier: 'costume-fitting', targetType: 'self' }
      ]
    }
  }
]);
