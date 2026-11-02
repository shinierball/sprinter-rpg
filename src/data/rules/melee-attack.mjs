/**
 * What the rulebook's "melee attack" covers (spec 3.9a section 14 Q2): a weapon-wielding melee attack, an unarmed (Hand-to-Hand)
 * attack or a natural (Strike) attack. Use as `condition.any` in a row; spread it, never share the array.
 */
export const MELEE_ATTACK_ANY = Object.freeze(['weaponClass.melee', 'weaponClass.unarmed', 'weaponClass.natural']);
