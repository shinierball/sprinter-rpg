/**
 * What an active patron gives the Bard (core rulebook pp. 316-317): mentoring in a Skill, Advantage on a Skill Advancement
 * Check from grinding with them, the quests they set and the ideas they offer. Plain functions over the actor and its
 * embedded patron or deity item. Every limit the book sets is a Rule Break the player may confirm, recorded on the item's
 * `ruleBreak` flag.
 */
import { confirmRuleBreak, markRuleBreak } from '../../utils/rule-break.mjs';
import { itemIdentifier } from '../../utils/identifier.mjs';
import { ADVANCEMENT_ROUTES } from '../../utils/skill/advancement-routes.mjs';
import { skillOrSpellName } from '../../utils/deity/deity-names.mjs';
import { findCatalogEntry } from '../../content/catalog-lookup.mjs';
import { findBookTable } from '../../sourcery/book-tables.mjs';
import { postPatronCard } from '../../chat/patron-card.mjs';
import { patronProfileOf } from '../../utils/patron/patron-profile.mjs';
import { activePatrons } from '../../utils/patron/patronage-state.mjs';
import { MENTOR_HOURS, mentorOptions, onMentorList } from '../../utils/patron/mentorship.mjs';
import { PATRON_TABLE_RECIPES } from '../../utils/patron/patron-tables.mjs';
import { COGSessionEngine } from '../session/session-engine.mjs';
import { learnSpellFromTome } from '../item/spell-tome.mjs';
import { confirmRouteGain } from './advancement-gates.mjs';
import { applyRankGain } from './actor-advancement.mjs';
import { decrementFloorTimer } from './actor-environment.mjs';
import { spaceLinksCrawler, worldSpaces } from './personal-space-links.mjs';
import { notify, say } from './vehicle-drive-common.mjs';
import { isRankedItem } from '../../utils/document-types.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';

const items = (actor) => Array.from(actor?.items ?? []);
const rankOf = (item) => Number(item?.system?.rank) || 0;

/** A Skill or Spell by identifier: the Bard's own item, else the catalog's skill, else its spell, else an unknown skill. */
function resolveEntry(actor, identifier) {
  const owned = items(actor).find((i) => isRankedItem(i) && itemIdentifier(i) === identifier);
  if (owned) return { identifier, name: owned.name, type: owned.type, owned, def: null };
  const skill = findCatalogEntry('skills', identifier);
  if (skill) return { identifier, name: skill.name, type: 'skill', owned: null, def: skill };
  const spell = findCatalogEntry('spells', identifier);
  if (spell) return { identifier, name: spell.name, type: 'spell', owned: null, def: spell };
  return { identifier, name: skillOrSpellName(identifier) ?? identifier, type: 'skill', owned: null, def: null };
}

/** The mentor rows for a patron: every Skill and Spell it lists, flagged `offered` when the Bard lacks it or has it at Rank 0. */
export function mentorChoices(actor, item) {
  const profile = patronProfileOf(item);
  const ids = [...profile.performanceSkills, ...profile.skills];
  const owned = new Map();
  for (const i of items(actor)) {
    if (isRankedItem(i)) owned.set(itemIdentifier(i), rankOf(i));
  }
  const patronSkills = ids.map((identifier) => {
    const { name, type } = resolveEntry(actor, identifier);
    return { identifier, name, type };
  });
  return mentorOptions({ patronSkills, owned });
}

/**
 * The patron teaches the Bard a Skill: Rank 1 in an hour of floor time (p. 316). A Skill off the patron's list and any
 * Spell (the book says "a Skill") each ask a Rule Break, as does a Skill the training route does not allow.
 * @param {object} actor the Bard (the owner calls this)
 * @param {object} item the embedded patron or deity item
 * @param {string} identifier the Skill or Spell
 * @param {{ options?: object }} [p] `options.ruleBreak: true` pre-confirms
 * @returns {Promise<{ ok: boolean, ruleBreak: boolean, reason?: string, name?: string }>}
 */
export async function mentor(actor, item, identifier, { options } = {}) {
  const id = String(identifier ?? '').trim().toLowerCase();
  const entry = resolveEntry(actor, id);
  if (!id || (entry.owned && rankOf(entry.owned) >= 1)) return { ok: false, ruleBreak: false, reason: 'known' };
  if (entry.type === 'spell' && !entry.owned && !entry.def) return { ok: false, ruleBreak: false, reason: 'unknown' };

  const data = { patron: item.name, actor: actor.name, skill: entry.name };
  const reasons = [];
  if (!onMentorList(patronProfileOf(item), id)) reasons.push(say('COG.Patron.Mentor.OffList', '{skill} is not one of {patron}\'s Skills', data));
  if (entry.type === 'spell') reasons.push(say('COG.Patron.Mentor.IsSpell', '{skill} is a Spell, and a patron mentors a Skill', data));
  let ruleBreak = false;
  if (reasons.length) {
    const answer = await confirmRuleBreak({
      title: say('COG.Patron.Mentor.Title', 'Mentor'),
      message: say('COG.Patron.Mentor.Ask', '{reasons}. Have {patron} mentor {actor} anyway as a Rule Break?', { ...data, reasons: reasons.join('; ') }),
      options
    });
    if (!answer.confirmed) return { ok: false, ruleBreak: false, reason: answer.refusal ?? 'cancelled' };
    ruleBreak = true;
  }

  // A Skill's route gate asks before any hours are spent; the gain does not ask it again
  let gate = null;
  if (entry.type === 'skill') {
    const subject = entry.owned ?? { name: entry.name, system: { rank: 0, rankLimits: entry.def?.system?.rankLimits } };
    gate = await confirmRouteGain(actor, subject, ADVANCEMENT_ROUTES.training, { options, verb: 'Train' });
    if (!gate.ok) return { ok: false, ruleBreak: false, reason: 'route-limit' };
    if (gate.ruleBreak) ruleBreak = true;
  }

  await decrementFloorTimer(MENTOR_HOURS, { actorUuid: actor.uuid });

  if (entry.type === 'spell') {
    await learnSpellFromTome(actor, { spellIdentifier: id, spellName: entry.name, rank: 1 });
  } else if (entry.owned) {
    const gain = await applyRankGain(actor, entry.owned, { source: 'training', options, routeChecked: gate.limited });
    if (gain.ruleBreak) ruleBreak = true;
  } else {
    await COGSessionEngine.createRankOneSkill(actor, entry.name, id);
  }
  if (ruleBreak) await markRuleBreak(item);
  notify('info', say('COG.Patron.Mentor.Done', '{patron} mentored {actor} in {skill}.', data));
  return { ok: true, ruleBreak, name: entry.name };
}

/**
 * The options a grind Advancement Check takes from a patron (p. 316: grinding with a patron, or on their advice, gives
 * Advantage). Asks only when an active patron lists the Skill; yes gives `{ advantage: true }`, anything else `{}`.
 * @param {object} actor
 * @param {object} skill the owned Skill being advanced
 * @returns {Promise<{ advantage?: true }>}
 */
export async function patronGrindOptions(actor, skill) {
  const id = itemIdentifier(skill);
  const patron = activePatrons(items(actor)).find((p) => onMentorList(patronProfileOf(p), id));
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (!patron || typeof DialogV2?.confirm !== 'function') return {};
  const text = say('COG.Patron.Mentor.GrindAsk', 'Grinding with {patron}, or on their Advice?', { patron: patron.name });
  const yes = await DialogV2.confirm({
    window: { title: say('COG.Patron.Mentor.GrindTitle', 'Grinding with a patron') },
    content: `<p>${escapeAttr(text)}</p>`,
    rejectClose: false,
    modal: true
  });
  return yes === true ? { advantage: true } : {};
}

/**
 * The GM sets the Bard a quest from a patron (p. 317): one in the crawler's personal space, `source` the patron's name and
 * `patron` its identifier. One quest at a time: a second while one is open asks a Rule Break.
 * @param {object} actor the Bard
 * @param {object} item the patron item
 * @param {{ title?: string, reward?: string, description?: string }} quest
 * @param {{ options?: object }} [p]
 * @returns {Promise<{ ok: boolean, ruleBreak: boolean, reason?: string }>}
 */
export async function addPatronQuest(actor, item, { title, reward, description } = {}, { options } = {}) {
  const space = worldSpaces().find((s) => spaceLinksCrawler(s, actor));
  if (!space) {
    notify('warn', say('COG.Patron.Quest.NoSpace', '{actor} has no personal space to hold a quest. Link one from the Story tab first.', { actor: actor.name }));
    return { ok: false, ruleBreak: false, reason: 'no-space' };
  }
  const identifier = patronProfileOf(item).identifier;
  const open = (Array.isArray(space.system?.quests) ? space.system.quests : []).find((q) => q?.patron === identifier && !q.completed);
  let ruleBreak = false;
  if (open) {
    const answer = await confirmRuleBreak({
      title: say('COG.Patron.Quest.Title', 'Patron quest'),
      message: say('COG.Patron.Quest.Open', '{patron} already has a quest open ({quest}); a patron sets one at a time. Set another anyway as a Rule Break?', { patron: item.name, quest: open.title }),
      options
    });
    if (!answer.confirmed) return { ok: false, ruleBreak: false, reason: answer.refusal ?? 'cancelled' };
    ruleBreak = true;
  }
  await space.system.addQuest({ title, reward, description, source: item.name, patron: identifier });
  if (ruleBreak) await markRuleBreak(item);
  return { ok: true, ruleBreak };
}

/**
 * A GM card of ideas for the patron (p. 317): [Roll Table 71] for quest ideas and [Roll Table 72] for favour ideas.
 * Nothing is stored. Where the tables have not been imported the card says so.
 * @param {object} actor the Bard
 * @param {object} item the patron item
 */
export async function postPatronIdeas(actor, item) {
  const found = [
    [PATRON_TABLE_RECIPES.quests, 'Table 71', say('COG.Patron.Ideas.Quests', 'Quest ideas')],
    [PATRON_TABLE_RECIPES.favours, 'Table 72', say('COG.Patron.Ideas.Favours', 'Favour ideas')]
  ];
  const lines = [];
  for (const [recipe, tableName, text] of found) {
    const tableUuid = await findBookTable(recipe);
    if (!tableUuid) continue;
    lines.push({
      text,
      buttons: [{ label: say('COG.Patron.Ideas.Roll', 'Roll {table}', { table: tableName }), action: 'crawlerDrawTable', data: { 'table-uuid': tableUuid, 'table-name': tableName }, gmOnly: true, icon: 'fa-dice-d20' }]
    });
  }
  if (!lines.length) lines.push({ text: say('COG.Patron.Ideas.Missing', 'Import the core rulebook tables to draw them') });
  return postPatronCard(actor, { title: say('COG.Patron.Ideas.Title', 'Ideas from {patron}', { patron: item.name }), icon: 'fa-lightbulb', lines, audience: 'gm' });
}
