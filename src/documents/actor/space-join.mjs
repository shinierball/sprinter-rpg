/**
 * Joining personal spaces. A space joins another space with a connector (gold); the group then shares tables, studios and
 * training rooms (see `spaceGroup`) while each keeps its own stash, defence, housing and occupants. The owner of the joining
 * space joins it to the space of a party member where they are already an occupant; a join that breaks either rule, or takes
 * the group past the ranks in the book, asks a Rule Break and then works. Either owner, or the GM, detaches. Detaching
 * deletes nothing. A player who cannot write the space asks the GM through the `spaceLink` relay.
 */
import { confirmRuleBreak, ruleBreakUpdate } from '../../utils/rule-break.mjs';
import { registerRelayAction, requestRelay } from '../../utils/gm-relay.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { sameParty } from '../../utils/combat/party.mjs';
import { rankFromPoints, spaceRules } from '../../data/rules/space-rank-rules.mjs';
import { canWriteSpace, crawlerDoc, crawlerRef, resolveSpace, spaceListsRef, userOwnsActor } from './personal-space-links.mjs';
import { joinedLinks, spaceGroup } from './space-group.mjs';
import { payForSpace } from './space-purchases.mjs';

/** The relay action a player's join or detach goes through when they cannot write the space. */
const RELAY_ACTION_SPACE_LINK = 'spaceLink';

const OPS = Object.freeze({ join: 'join', detach: 'detach' });

/** A `COG.SpaceJoin` string (the English fallback serves a Node run with no catalogue). */
const joinText = (key, data, fallback) => {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(`COG.SpaceJoin.${key}`) && typeof i18n.format === 'function') return i18n.format(`COG.SpaceJoin.${key}`, data);
  return fallback;
};

const ownerOf = (space) => crawlerDoc(resolveActorByUuid(space?.system?.ownerUuid));
const askOptions = (options) => ({ ruleBreak: options.ruleBreak === true, interactive: options.interactive });
const inGroup = (group, space) => group.members.some(member => member === space || (member.uuid && member.uuid === space.uuid));

/** Whether this user may join `space` to another space: the GM, or the player who owns the space's owner crawler. */
export function mayJoinSpace(space, user = globalThis.game?.user) {
  const owner = ownerOf(space);
  return Boolean(user?.isGM || (owner && userOwnsActor(owner, user)));
}

/** Whether this user may detach `a` and `b`: the GM, or a player who owns either space's owner crawler. */
export function mayDetachSpaces(a, b, user = globalThis.game?.user) {
  return mayJoinSpace(a, user) || mayJoinSpace(b, user);
}

/**
 * Which rule joining `space` to `target` would break: the owner of `space` is not in the party of the owner of `target`,
 * or is not yet an occupant of `target`.
 * @returns {{ ownerName: string, otherName: string, notParty: boolean, notOccupant: boolean }}
 */
function joinProblems(space, target) {
  const owner = ownerOf(space);
  const other = ownerOf(target);
  return {
    ownerName: owner?.name ?? space?.name ?? '',
    otherName: other?.name ?? target?.name ?? '',
    notParty: !(owner && other && sameParty(owner, other)),
    notOccupant: !(owner && spaceListsRef(target, crawlerRef(owner)))
  };
}

/** The sentences naming what a join breaks ('' when it breaks nothing). */
function problemText(space, target, found) {
  const sentences = [];
  if (found.notParty) {
    sentences.push(joinText('NotParty', { owner: found.ownerName, other: found.otherName },
      `${found.ownerName} is not in ${found.otherName}'s party.`));
  }
  if (found.notOccupant) {
    sentences.push(joinText('NotOccupant', { owner: found.ownerName, space: target.name },
      `${found.ownerName} is not an occupant of ${target.name}.`));
  }
  return sentences.join(' ');
}

/** What the join breaks, for the sheet's Join list ('' when it breaks nothing). */
export function joinProblemLabel(space, target) {
  const found = joinProblems(space, target);
  return found.notParty || found.notOccupant ? problemText(space, target, found) : '';
}

// ---------------------------------------------------------------------------
// The writes: directly when this user can write the space, else through the GM relay
// ---------------------------------------------------------------------------

/** Add the link to `space` (once); a confirmed Rule Break is recorded on the space. */
async function writeJoin(space, target, ruleBreak, reason) {
  const links = joinedLinks(space);
  if (links.includes(target.uuid)) return;
  const update = { 'system.joinedToUuids': [...links, target.uuid] };
  if (ruleBreak) {
    Object.assign(update, ruleBreakUpdate(reason));
  }
  await space.update(update);
}

/** Remove the link to `target` from `space` (the one side that holds it). */
async function writeDetach(space, target) {
  const links = joinedLinks(space);
  if (!links.includes(target.uuid)) return;
  await space.update({ 'system.joinedToUuids': links.filter(uuid => uuid !== target.uuid) });
}

/** Why a relayed join or detach is refused, or '' when it may go ahead. */
function relayRefusal(payload, requester) {
  const space = resolveSpace(payload?.spaceUuid);
  const target = resolveSpace(payload?.targetUuid);
  if (!space || !target || space === target || !Object.values(OPS).includes(payload?.op)) return 'invalid';
  if (payload.op === OPS.join) return mayJoinSpace(space, requester) ? '' : 'owner';
  return mayDetachSpaces(space, target, requester) ? '' : 'owner';
}

registerRelayAction(RELAY_ACTION_SPACE_LINK, {
  authorize: (payload, requester) => !!requester && relayRefusal(payload, requester) === '',
  apply: async (payload, requester) => {
    const reason = relayRefusal(payload, requester);
    if (reason) return { ok: false, reason };
    const space = resolveSpace(payload.spaceUuid);
    const target = resolveSpace(payload.targetUuid);
    if (payload.op === OPS.join) await writeJoin(space, target, payload.ruleBreak === true, String(payload.reason ?? ''));
    else await writeDetach(space, target);
    return { ok: true };
  }
});

/** Make the write on `space`: here when this user can write it, else the GM's client. Returns the relay's refusal reason, or ''. */
async function writeLink(op, space, target, extra = {}) {
  if (canWriteSpace(space)) {
    if (op === OPS.join) await writeJoin(space, target, extra.ruleBreak === true, extra.reason ?? '');
    else await writeDetach(space, target);
    return '';
  }
  const reply = await requestRelay(
    RELAY_ACTION_SPACE_LINK,
    { op, spaceUuid: space.uuid, targetUuid: target.uuid, ...extra },
    { direct: false }
  );
  return reply.ok && reply.result?.ok !== false ? '' : String(reply.result?.reason ?? reply.reason ?? 'refused');
}

// ---------------------------------------------------------------------------
// Join and detach
// ---------------------------------------------------------------------------

/**
 * Join `space` to `target`. A space already in the target's group is a no-op with a notice. A join that breaks the party
 * or occupant rule asks one Rule Break; one that takes the group past the ranks in the book and past both sides' ranks asks
 * another. The connector price is paid by `payer` (null = GM grant, GM only; short of gold asks a Rule Break). Writes only
 * `space.system.joinedToUuids`.
 * @param {Actor} space the joining space
 * @param {Actor} target the space joined
 * @param {Actor|null} payer
 * @param {{ ruleBreak?: boolean, interactive?: boolean }} [options]
 * @returns {Promise<{ ok: boolean, ruleBreak: boolean, paid: number, rank: number, reason?: string }>}
 */
export async function joinSpace(space, target, payer, options = {}) {
  const mine = spaceGroup(space);
  const none = (reason) => ({ ok: false, ruleBreak: false, paid: 0, rank: mine.rank, reason });
  if (space?.type !== 'personal_space' || target?.type !== 'personal_space') return none('notSpace');
  if (space === target || (space.uuid && space.uuid === target.uuid)) return none('self');
  if (inGroup(mine, target)) {
    globalThis.ui?.notifications?.info?.(joinText('Grouped', { space: space.name, target: target.name }, `${space.name} is already joined to ${target.name}.`));
    return none('grouped');
  }
  if (!mayJoinSpace(space)) {
    globalThis.ui?.notifications?.warn?.(joinText('NotOwner', { space: space.name }, `Only the owner of ${space.name} or the GM can join it to another space.`));
    return none('owner');
  }

  let ruleBreak = false;
  const reasons = [];
  const found = joinProblems(space, target);
  if (found.notParty || found.notOccupant) {
    const problem = problemText(space, target, found);
    const res = await confirmRuleBreak({
      title: 'Join Spaces',
      message: `${problem} ${joinText('JoinAsk', { space: space.name, target: target.name }, `Join ${space.name} to ${target.name} anyway as a Rule Break?`)}`,
      reason: `${space.name}: ${problem}`,
      options: askOptions(options)
    });
    if (!res.confirmed) return none('rules');
    ruleBreak = true;
    reasons.push(problem);
  }

  const theirs = spaceGroup(target);
  const rank = rankFromPoints(mine.points + theirs.points);
  const { bookMaxRank } = spaceRules();
  if (rank > bookMaxRank && rank > mine.rank && rank > theirs.rank) {
    const past = joinText('PastBook', { rank, max: bookMaxRank }, `Rank ${rank} is past the ranks in the book (they stop at ${bookMaxRank}).`);
    const res = await confirmRuleBreak({
      title: 'Rank Past the Book',
      message: `${past} ${joinText('JoinAnyway', {}, 'Join anyway as a Rule Break?')}`,
      reason: past,
      options: askOptions(options)
    });
    if (!res.confirmed) return none('pastBook');
    ruleBreak = true;
    reasons.push(past);
  }

  const pay = await payForSpace(space, payer, spaceRules().connectorPrice, 'The join connector', options);
  if (!pay.ok) return none(pay.reason);
  ruleBreak ||= pay.ruleBreak;

  const failure = await writeLink(OPS.join, space, target, { ruleBreak, reason: reasons.join(' ') || 'Joined as a Rule Break' });
  if (failure) {
    // The GM could not write the link: give the connector gold back
    if (pay.paid > 0 && payer) await payer.update({ 'system.currency.gold': Number(payer.system?.currency?.gold || 0) + pay.paid });
    return none(failure);
  }
  return { ok: true, ruleBreak: ruleBreak || pay.ruleBreak, paid: pay.paid, rank: spaceGroup(space).rank };
}

/**
 * Remove the link between `a` and `b`, whichever side holds it (both when both do). Either owner or the GM may; a player
 * who cannot write that side goes through the `spaceLink` relay. Nothing is refunded and nothing in either space is deleted.
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function detachSpaces(a, b) {
  if (a?.type !== 'personal_space' || b?.type !== 'personal_space') return { ok: false, reason: 'notSpace' };
  const holders = [[a, b], [b, a]].filter(([from, to]) => joinedLinks(from).includes(to.uuid));
  if (!holders.length) return { ok: false, reason: 'notJoined' };
  if (!mayDetachSpaces(a, b)) {
    globalThis.ui?.notifications?.warn?.(joinText('NotOwnerDetach', {}, 'Only the owner of either space or the GM can detach them.'));
    return { ok: false, reason: 'owner' };
  }
  for (const [from, to] of holders) {
    const failure = await writeLink(OPS.detach, from, to);
    if (failure) return { ok: false, reason: failure };
  }
  return { ok: true };
}
