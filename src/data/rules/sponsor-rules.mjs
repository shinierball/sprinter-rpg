/**
 * The Sponsor limits (core p. 284, p. 39, p. 281). A crawler holds at most three Sponsors, and Sponsors bid from the
 * start of the Fourth Floor, so a Sponsor before then, or Playing to the Sponsors before then, is a Rule Break the
 * player may confirm. Pure: the reasons are plain text; the confirms are `confirmSponsorAdd` and the camera gate.
 */
import { langText } from '../../utils/lang-text.mjs';

/** The most Sponsors a crawler holds (p. 284). */
export const SPONSOR_LIMIT = 3;
/** Sponsors bid from this Floor (p. 284; the Fourth Floor's notice, p. 39; Playing to the Sponsors, p. 281). */
const SPONSORSHIP_FIRST_FLOOR = 4;

/** Text for the Sponsor limits (full lang keys, English fallbacks for a Node run). */
export const sponsorText = langText({
  'COG.Sponsor.Limits.Title': 'Sponsor limit',
  'COG.Sponsor.Limits.Add': 'Add {name} anyway as a Rule Break?',
  'COG.Sponsor.Limits.Over': 'A crawler holds at most {limit} Sponsors.',
  'COG.Sponsor.Limits.Early': 'Sponsors bid from the Fourth Floor, and this crawler is on Floor {floor}.',
  'COG.Sponsor.Limits.PlayEarly': 'Playing to the Sponsors is available from the Fourth Floor, and this crawler is on Floor {floor}.',
  'COG.Sponsor.Limits.PlayQuestion': 'Play to the Sponsors anyway as a Rule Break?',
  'COG.Sponsor.Limits.PlayLabel': 'Sponsors (before the Fourth Floor: Rule Break)'
});

/**
 * The reasons adding one more Sponsor breaks a rule.
 * @param {{ held: number, floor: number }} state Sponsors held now, and the crawler's Floor
 * @returns {string[]}
 */
export function sponsorAddBreaks({ held, floor }) {
  const reasons = [];
  if (Number(held) >= SPONSOR_LIMIT) reasons.push(sponsorText('COG.Sponsor.Limits.Over', { limit: SPONSOR_LIMIT }));
  if (Number(floor) < SPONSORSHIP_FIRST_FLOOR) reasons.push(sponsorText('COG.Sponsor.Limits.Early', { floor }));
  return reasons;
}

/** The reasons Playing to the Sponsors on `floor` breaks a rule: one before the Fourth Floor, else none. */
export function sponsorPlayBreaks(floor) {
  return Number(floor) < SPONSORSHIP_FIRST_FLOOR ? [sponsorText('COG.Sponsor.Limits.PlayEarly', { floor })] : [];
}
