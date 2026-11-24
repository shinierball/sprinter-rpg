/**
 * NPC against NPC (core p. 83, Mob on Mob Action, Table 8): the static comparison a card shows in place of AUTO-HIT, and
 * the d12 table the GM may roll instead. Pure; the card and the chat handler read the numbers from here.
 */
import { langText } from '../lang-text.mjs';

/** The die of Table 8. */
export const NPC_TABLE_DIE = '1d12';
/** Band 12 (an Amazing Success) adds this many times the Floor to the damage. */
const NPC_TABLE_FLOOR_FACTOR = 2;

/** The d12 faces at which each band of Table 8 starts, lowest first. */
const BAND_FROM = Object.freeze([['major_fail', 1], ['miss', 2], ['compare', 5], ['hit', 9], ['amazing', 12]]);

/**
 * The attacker's Attack against the defender's Evade: it hits only when its number is the higher (the book's "better value").
 * @param {{ attack: number, evade: number }} p
 * @returns {{ isHit: boolean }}
 */
export function npcComparison({ attack, evade }) {
  return { isHit: Number(attack) > Number(evade) };
}

/**
 * The band of Table 8 a d12 face falls in, and the damage it adds.
 * @param {number} d12
 * @param {{ floor?: number }} [opts]
 * @returns {{ band: 'major_fail'|'miss'|'compare'|'hit'|'amazing', bonus: number }}
 */
export function npcTableBand(d12, { floor = 0 } = {}) {
  const face = Math.trunc(Number(d12));
  let band = BAND_FROM[0][0];
  for (const [id, from] of BAND_FROM) if (face >= from) band = id;
  const bonus = band === 'amazing' ? NPC_TABLE_FLOOR_FACTOR * Math.max(0, Math.trunc(Number(floor)) || 0) : 0;
  return { band, bonus };
}

const TEXT = Object.freeze({
  'COG.TargetRows.NpcVsNpc.Hits': 'Hits',
  'COG.TargetRows.NpcVsNpc.Misses': 'Misses',
  'COG.TargetRows.NpcVsNpc.Line': 'NPC vs NPC: Attack {attack} vs Evade {evade}: {result}',
  'COG.TargetRows.NpcVsNpc.Button': 'Table 8 (1d12)',
  'COG.TargetRows.NpcVsNpc.GmOnly': 'Sprinter RPG | Only the GM rolls the NPC table.',
  'COG.TargetRows.NpcVsNpc.Flavor': 'NPC vs NPC (d12 {face}): {summary}',
  'COG.TargetRows.NpcVsNpc.Band.major_fail': 'the attacker fails badly and is easier to hit until the round ends',
  'COG.TargetRows.NpcVsNpc.Band.miss': 'a miss',
  'COG.TargetRows.NpcVsNpc.Band.compare': "a hit only if the attacker's Stat is higher",
  'COG.TargetRows.NpcVsNpc.Band.hit': 'a hit',
  'COG.TargetRows.NpcVsNpc.Band.amazing': 'an Amazing Success: the damage plus {bonus} (add it by hand)',
  'COG.TargetRows.Pvp.Evade': 'Evade vs {dc}',
  'COG.TargetRows.Pvp.Button': 'Roll Evade vs Attack ({dc})',
  'COG.TargetRows.Pvp.ButtonFree': 'Roll Evade vs Attack ({dc}): free, the attacker was forced'
});

/** Localized text with an English fallback (the test harness has no i18n). */
export const targetRowText = langText(TEXT);
