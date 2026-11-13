/**
 * What an acolyte owes the faith (core rulebook pp. 163-164, 312), as Rule Breaks and a GM prompt, never a block
 * (Directive 2): no gear blessed by a rival god, no attacking a fellow worshipper, and the once-per-Floor Level for
 * killing a rival's worshipper ("Death to the Infidels"). Gods are read from the worship tags, rivalry both ways.
 */
import { BLESSED_TAG_PREFIX } from '../../data/tag-vocabulary.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { areRivals, godsFromTags, rivalsLookup } from '../../utils/deity/rivals.mjs';
import { deityLabel, deityRecords } from '../../utils/deity/deity-names.mjs';
import { deityIdOf, isWorshipBond } from '../../utils/deity/worship-state.mjs';
import { postWorshipNotice } from '../../chat/worship-card.mjs';
import { collectActorTags, getItemAllTags } from '../active-tags.mjs';
import { recordOffense } from './devotion.mjs';
import { say } from './vehicle-drive-common.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';

const PROCEED = Object.freeze({ proceed: true, ruleBreak: false });
const godsOf = (actor) => godsFromTags(collectActorTags(actor));

/** The identifiers of the gods whose `blessed.<id>` tag an item carries. */
function blessedBy(item) {
  const out = [];
  for (const tag of getItemAllTags(item)) {
    if (typeof tag !== 'string' || !tag.startsWith(BLESSED_TAG_PREFIX)) continue;
    const god = tag.slice(BLESSED_TAG_PREFIX.length).trim().toLowerCase();
    if (god && !out.includes(god)) out.push(god);
  }
  return out;
}

/**
 * Equipping gear blessed by a rival of a god the actor worships asks a Rule Break (the Enemy God's Prohibition, p. 163).
 * Rivalry counts when either god lists the other.
 * @returns {Promise<{ proceed: boolean, ruleBreak: boolean }>} `proceed: false` on Cancel
 */
export async function confirmRivalBlessedGear(actor, item, options = {}) {
  const mine = godsOf(actor);
  const blessed = blessedBy(item);
  if (!mine.length || !blessed.length) return PROCEED;
  const records = deityRecords([actor]);
  const rivalsOf = rivalsLookup(records);
  for (const god of blessed) {
    const rival = mine.find((m) => areRivals(god, m, rivalsOf));
    if (!rival) continue;
    const message = say('COG.Deity.Obligations.BlessedMessage', '{item} is blessed by {god}, a rival of {rival}, whom {actor} worships (p. 163). Equip it anyway as a Rule Break?', {
      item: escapeAttr(item.name), god: escapeAttr(deityLabel(records, god)), rival: escapeAttr(deityLabel(records, rival)), actor: escapeAttr(actor?.name)
    });
    const answer = await confirmRuleBreak({ title: say('COG.Deity.Obligations.BlessedTitle', "Rival's blessing"), message, options });
    return answer.confirmed ? { proceed: true, ruleBreak: true } : { proceed: false, ruleBreak: false };
  }
  return PROCEED;
}

/**
 * Attacking a fellow worshipper (a target whose gods include one the attacker worships) asks a Rule Break (pp. 163, 312).
 * Confirming records an Offense against each shared god; that is the GM's write, so a player's client leaves it to the
 * GM's sheet. Cancel rolls nothing.
 * @param {object} actor the attacker
 * @param {object[]} targetActors
 * @returns {Promise<{ proceed: boolean, ruleBreak: boolean }>}
 */
export async function confirmFellowWorshipperAttack(actor, targetActors, options = {}) {
  const mine = godsOf(actor);
  if (!mine.length) return PROCEED;
  const shared = [];
  let target = null;
  for (const other of targetActors ?? []) {
    if (!other || other === actor || other.uuid === actor?.uuid) continue;
    for (const god of godsOf(other)) {
      if (!mine.includes(god) || shared.includes(god)) continue;
      shared.push(god);
      target ??= other;
    }
  }
  if (!shared.length) return PROCEED;
  const records = deityRecords([actor]);
  const message = say('COG.Deity.Obligations.AttackMessage', '{actor} and {target} both worship {god}. Attacking a fellow worshipper is an Offense against {god} (pp. 163, 312). Attack anyway as a Rule Break?', {
    actor: escapeAttr(actor?.name), target: escapeAttr(target?.name), god: escapeAttr(shared.map((g) => deityLabel(records, g)).join(', '))
  });
  const answer = await confirmRuleBreak({ title: say('COG.Deity.Obligations.AttackTitle', 'Fellow worshipper'), message, options });
  if (!answer.confirmed) return { proceed: false, ruleBreak: false };
  for (const god of shared) {
    const deityItem = Array.from(actor.items ?? []).find((i) => isWorshipBond(i) && deityIdOf(i) === god);
    if (deityItem) await recordOffense(actor, deityItem, { byOwner: true });
  }
  return { proceed: true, ruleBreak: true };
}

/**
 * The killer worships a god the victim's gods are rivals of: one GM notice with [Award Level] (p. 164).
 * @returns {Promise<boolean>} whether a notice was posted
 */
export async function promptInfidelsLevel(victim, killer) {
  const theirs = godsOf(victim);
  const mine = godsOf(killer);
  if (!mine.length || !theirs.length) return false;
  const records = deityRecords([killer, victim]);
  const rivalsOf = rivalsLookup(records);
  for (const god of mine) {
    const rival = theirs.find((t) => areRivals(god, t, rivalsOf));
    if (!rival) continue;
    await postWorshipNotice('infidels', { actor: killer, victim, god: deityLabel(records, god), rival: deityLabel(records, rival) });
    return true;
  }
  return false;
}
