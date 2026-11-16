/**
 * The pet builder: a pure `buildPetPayload(spec)` that compiles an authoring spec into an Actor creation payload for a pet
 * or a dedicated mount (GEMINI Principle 3). The Create Pet modal, the pack pets and the example pets all go through it
 * (Directive 4), reached as `buildPayload('pet', spec)`. Create-only: nothing here reads a document back.
 *
 * A new pet is the base pet of the core book (p. 231): Level 1, Str 2, Int 1, Con 2, Dex 2, Cha 1, Move 20 plus its size
 * value, DR 0. A dedicated mount (p. 232) is Large with Move 30 and Step 10. Level is always 1: a pet gains Levels with its
 * crawler (9.7b), so a spec's `level` is ignored. Never throws: junk reads as the default.
 *
 * Spec keys: `_id`, `name`, `img`, `race`, `size`, `creatureType`, `attitude`, `origin`, `isMount`, `ownerId`, `riderId`, `stats` (the five stats
 * a spec overrides), `move`, `dr`, `attacks` (`{ name, stat, damageDice, damageType }`), `tags`, `notes`,
 * `prototypeToken`, `flags`.
 */
import { firstScalar, toStringList } from '../utils/first-scalar.mjs';
import { getCOGStatModifier } from '../documents/actor/actor-constants.mjs';
import { registerPayloadDelegate } from './builders/item-payload.mjs';
import { normalizeBaseDamage } from '../utils/damage/base-damage.mjs';
import { DEFAULT_SIZE, getSizeInfo, sanitizeSizeId } from './sizes.mjs';
import { normalizeElementTag } from './tag-vocabulary.mjs';
import { BASE_MOUNT, BASE_PET, sanitizePetAttitude, sanitizePetOrigin } from './rules/pet-rules.mjs';

const STATS = Object.freeze(['str', 'int', 'con', 'dex', 'cha']);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A whole number of 0 or more from user input, else `fallback`. */
function wholeNumber(raw, fallback) {
  const n = Math.trunc(Number(firstScalar(raw, fallback)));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** The embedded natural-attack Skill of an `attacks` entry. A pet's Ranks follow the Floor, so the stored Rank is 1. */
function attackItem(raw) {
  const name = String(firstScalar(raw?.name, '')).trim() || 'Natural Attack';
  const stat = STATS.includes(firstScalar(raw?.stat, '')) ? firstScalar(raw.stat) : 'str';
  const damageType = String(firstScalar(raw?.damageType, '')).trim() || 'Physical';
  const element = normalizeElementTag(damageType);
  const baseDamage = normalizeBaseDamage({ dice: String(firstScalar(raw?.damageDice, '1d4')).trim(), stat, damageType });
  return {
    name,
    type: 'skill',
    img: 'icons/svg/pawprint.svg',
    system: {
      rank: 1,
      stat,
      checkType: 'attack',
      isAttack: true,
      hasDamage: true,
      baseDamage,
      tags: ['kind.skill', 'companion.pet', 'action.attack', ...(element ? [element] : []), 'weaponClass.natural', 'skillGroup.strike', 'skillGroup.combat']
    }
  };
}

/**
 * @param {object} [spec] see the file header
 * @returns {object} an Actor creation payload `{ _id?, name, type: 'pet', img, system, items?, ... }`
 */
export function buildPetPayload(spec = {}) {
  const input = isObject(spec) ? spec : {};
  const isMount = firstScalar(input.isMount, false) === true;

  const givenSize = sanitizeSizeId(input.size);
  const size = givenSize ? getSizeInfo(givenSize).id : (isMount ? BASE_MOUNT.size : DEFAULT_SIZE);
  const sizeValue = getSizeInfo(size).size;

  const typed = isObject(input.stats) ? input.stats : {};
  const abilities = {};
  for (const stat of STATS) {
    const value = wholeNumber(typed[stat], BASE_PET.stats[stat]);
    abilities[stat] = { value, mod: getCOGStatModifier(value) };
  }

  const baseMove = isMount ? BASE_MOUNT.move : BASE_PET.moveBase + sizeValue;
  const move = wholeNumber(input.move, baseMove);
  const dr = wholeNumber(input.dr, BASE_PET.dr);

  const tags = ['companion.pet', ...(isMount ? ['companion.mount', 'rule.mount'] : []), ...toStringList(input.tags)];

  const payload = {
    ...(input._id ? { _id: String(input._id) } : {}),
    name: String(firstScalar(input.name, '')).trim() || 'New Pet Companion',
    type: 'pet',
    ...(input.img ? { img: String(firstScalar(input.img, '')) } : {}),
    system: {
      tags: [...new Set(tags)],
      abilities,
      attributes: {
        size,
        speed: { move, step: isMount ? BASE_MOUNT.step : BASE_PET.step },
        dr: { armor: dr }
      },
      details: {
        level: BASE_PET.level,
        race: String(firstScalar(input.race, '')).trim(),
        creatureType: String(firstScalar(input.creatureType, '')).trim() || 'Beast',
        isMount,
        attitude: sanitizePetAttitude(input.attitude),
        origin: sanitizePetOrigin(input.origin),
        ownerId: String(firstScalar(input.ownerId, '')).trim(),
        riderId: String(firstScalar(input.riderId, '')).trim(),
        notes: String(firstScalar(input.notes, ''))
      }
    }
  };
  if (Array.isArray(input.attacks) && input.attacks.length) payload.items = input.attacks.filter(isObject).map(attackItem);
  if (isObject(input.prototypeToken)) payload.prototypeToken = structuredClone(input.prototypeToken);
  if (isObject(input.flags)) payload.flags = structuredClone(input.flags);
  return payload;
}

registerPayloadDelegate('pet', buildPetPayload);
