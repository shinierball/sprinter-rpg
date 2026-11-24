/**
 * Fan Box milestone alerts (core p. 280): the GM is told when a crawler reaches a Popularity milestone and decides on
 * the box; doing nothing awards nothing. The crossing is read from the actor update itself, the pattern
 * `hooks/vehicle-drive.mjs` uses: `preUpdateActor` (on the client that writes) stamps the Popularity the crawler had into
 * the update's options, `updateActor` (every client) acts only on the active GM. It sees every writer: a trigger row, the
 * cameras, the checklist's Apply, a sheet edit, a macro. The rules of which milestone needs a card are in
 * `utils/floor/fan-box-alerts.mjs`; the card is `chat/fan-box-alert-card.mjs`.
 *
 * The crawler carries its own answers in `flags.<system>.fanBoxAlerts` (`{ '50': { state, messageId } }`). With no GM
 * connected a player's own update stamps the new crossings `pending` in the same write, and the next active GM's `ready`
 * posts the card.
 */
import { isActiveGM, getActiveGM } from '../../utils/gm-relay.mjs';
import { isMigrationWrite } from '../migrations/world-migration.mjs';
import { runKeyed } from '../../utils/keyed-queue.mjs';
import { readFlag, writeFlag, flagPath } from '../../utils/flags.mjs';
import { planFanBoxAlert, pendingMilestones, withAlertState, milestonesInState } from '../../utils/floor/fan-box-alerts.mjs';
import { postFanBoxAlertCard, updateFanBoxAlertCard, FAN_BOX_ALERT_FLAG } from '../../chat/fan-box-alert-card.mjs';
import { getCurrentFloor } from './actor-environment.mjs';
import { readChecklistState } from './popularity-checklist.mjs';
import { grantFanBox } from './fan-box.mjs';

/** The option key the Popularity before an update rides in, from `preUpdateActor` to `updateActor`. Not stored. */
const POPULARITY_BEFORE_OPTION = 'cogPopularityBefore';
/** The crawler flag holding its answers. */
const ALERTS_FLAG = 'fanBoxAlerts';

const finite = (value) => (value !== null && value !== '' && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null);
const popularityOf = (actor) => finite(actor?.system?.details?.popularity);
const readAlerts = (actor) => {
  const raw = readFlag(actor, ALERTS_FLAG);
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
};

/** The Popularity an update sets, dotted or nested, or null when it does not touch it. */
function popularityInChanges(changes) {
  const flat = changes && typeof changes === 'object' ? changes : {};
  if (Object.hasOwn(flat, 'system.details.popularity')) return finite(flat['system.details.popularity']);
  const details = flat.system && typeof flat.system === 'object' ? flat.system.details : null;
  return details && typeof details === 'object' && Object.hasOwn(details, 'popularity') ? finite(details.popularity) : null;
}

const touchesPopularity = (changes) => {
  const flat = changes && typeof changes === 'object' ? changes : {};
  return Object.hasOwn(flat, 'system.details.popularity')
    || Boolean(flat.system && typeof flat.system === 'object' && flat.system.details && typeof flat.system.details === 'object' && Object.hasOwn(flat.system.details, 'popularity'));
};

/**
 * `preUpdateActor`: remember a crawler's Popularity before an update that changes it. With no GM connected and a writer
 * who is not a GM, also stamp each new crossing `pending` into the same update. Never blocks and never throws; it returns
 * nothing (a boolean from a pre hook would cancel the update).
 */
function onPreUpdatePopularity(actor, changes, options) {
  try {
    if (isMigrationWrite(options) || actor?.type !== 'crawler' || !options || typeof options !== 'object' || !touchesPopularity(changes)) return;
    const before = popularityOf(actor);
    options[POPULARITY_BEFORE_OPTION] = before;
    const after = popularityInChanges(changes);
    if (before === null || after === null || getActiveGM() || globalThis.game?.user?.isGM) return;
    for (const m of pendingMilestones({ before, after, alerts: readAlerts(actor) })) {
      changes[flagPath(`${ALERTS_FLAG}.${m}`)] = { state: 'pending' };
    }
  } catch (err) {
    console.warn('Sprinter RPG | The Fan Box alert stamp failed:', err);
  }
}

const messageOf = (id) => (id ? globalThis.game?.messages?.get?.(id) ?? null : null);
const cardData = (message) => readFlag(message, FAN_BOX_ALERT_FLAG);

/** Change some rows of a posted card (by milestone) and rewrite it. */
async function patchCardRows(messageId, patchFor, { now } = {}) {
  const message = messageOf(messageId);
  const data = cardData(message);
  if (!data || !Array.isArray(data.rows)) return;
  const rows = data.rows.map((row) => {
    const patch = patchFor(row);
    return patch ? { ...row, ...patch } : row;
  });
  await updateFanBoxAlertCard(message, { ...data, rows, ...(now === undefined ? {} : { now }) });
}

/**
 * Post one card for several milestones of a crawler and mark each `open` on the crawler. Caller holds the actor's key.
 * @returns {Promise<ChatMessage|null>}
 */
async function postAlert(actor, milestones, { after }) {
  const lastFloor = readChecklistState().fanBoxes?.lastFloor?.[actor.id];
  const hint = Number.isFinite(Number(lastFloor)) && Number(lastFloor) === getCurrentFloor();
  const rows = milestones.map((milestone) => ({ milestone, state: 'open', below: after < milestone ? after : null, tier: '', hint }));
  const message = await postFanBoxAlertCard({ actorId: actor.id, now: after, rows });
  let alerts = readAlerts(actor);
  for (const m of milestones) alerts = withAlertState(alerts, m, { state: 'open', messageId: message?.id ?? '' });
  await writeFlag(actor, ALERTS_FLAG, alerts);
  return message;
}

/**
 * `updateActor`: on the active GM, for a crawler whose update changed Popularity, post a card for each milestone newly
 * reached, clear the "now below" line of a waiting card the crawler climbed back to, and set it on one the crawler fell
 * back below. The flag write it makes does not touch Popularity, so the hook ignores it.
 * @returns {Promise<boolean>} true when a card was posted or rewritten
 */
async function onUpdatePopularity(actor, changes, options) {
  if (isMigrationWrite(options) || actor?.type !== 'crawler' || !touchesPopularity(changes) || !isActiveGM()) return false;
  const before = finite(options?.[POPULARITY_BEFORE_OPTION]);
  const after = popularityOf(actor);
  if (before === null || after === null || before === after) return false;
  try {
    return await runKeyed(`fan-box:${actor.uuid}`, async () => {
      const alerts = readAlerts(actor);
      const plan = planFanBoxAlert({ before, after, alerts });
      if (plan.post.length) await postAlert(actor, plan.post, { after });
      const byCard = new Map();
      for (const [list, below] of [[plan.refresh, null], [plan.below, after]]) {
        for (const m of list) {
          const id = alerts[String(m)]?.messageId;
          if (id) byCard.set(id, { ...(byCard.get(id) ?? {}), [m]: below });
        }
      }
      for (const [id, belows] of byCard) await patchCardRows(id, (row) => (row.milestone in belows ? { below: belows[row.milestone] } : null), { now: after });
      return plan.post.length > 0 || byCard.size > 0;
    });
  } catch (err) {
    console.warn('Sprinter RPG | The Fan Box alert failed:', err);
    return false;
  }
}

/**
 * Answer an open alert row: `open` becomes `answer.state` on the crawler's record and on the card, once. GM only.
 * @returns {Promise<{ actor: Actor, found: boolean }|null>} null when not a GM; `found` false when nothing was open
 */
async function settleRow(messageId, milestone, answer, work) {
  if (!globalThis.game?.user?.isGM) return null;
  const message = messageOf(messageId);
  const data = cardData(message);
  const actor = data ? globalThis.game?.actors?.get?.(data.actorId) : null;
  if (!actor) return null;
  return runKeyed(`fan-box:${actor.uuid}`, async () => {
    const record = readAlerts(actor)[String(milestone)];
    if (record?.state !== 'open' || record.messageId !== messageId) return { actor, found: false };
    const result = work ? await work(actor) : null;
    if (work && !result) return { actor, found: false };
    await writeFlag(actor, ALERTS_FLAG, withAlertState(readAlerts(actor), milestone, { state: answer.state }));
    await patchCardRows(messageId, (row) => (row.milestone === Number(milestone) ? answer : null));
    return { actor, found: true, result };
  });
}

/**
 * Award the Fan Box an alert row asks about: one trophy and one waiting box of the chosen tier through `grantFanBox`, the
 * row and the crawler's record `awarded`. Does nothing unless the row is still open. GM only.
 * @returns {Promise<{ item: Item|null, boxes: Item[] }|null>}
 */
export async function awardFanBoxFromAlert(messageId, milestone, { tier }) {
  const settled = await settleRow(messageId, milestone, { state: 'awarded', tier }, (actor) => grantFanBox(actor, { tier, reason: `milestone:${milestone}` }));
  return settled?.found ? settled.result : null;
}

/** "No box" on an alert row: `open` becomes `dismissed` on the card and the crawler; nothing is created. GM only. */
export async function dismissFanBoxAlert(messageId, milestone) {
  const settled = await settleRow(messageId, milestone, { state: 'dismissed' }, null);
  return Boolean(settled?.found);
}

/**
 * At `ready`, on the active GM: one card per crawler holding `pending` crossings (stamped by a player's client while no GM
 * was connected), which become `open`. A second sweep finds nothing pending.
 * @returns {Promise<number>} cards posted
 */
async function sweepPendingFanBoxAlerts() {
  if (!isActiveGM()) return 0;
  let posted = 0;
  for (const actor of globalThis.game?.actors ?? []) {
    if (actor?.type !== 'crawler' || !milestonesInState(readAlerts(actor), 'pending').length) continue;
    await runKeyed(`fan-box:${actor.uuid}`, async () => {
      const pending = milestonesInState(readAlerts(actor), 'pending');
      if (!pending.length) return;
      if (await postAlert(actor, pending, { after: popularityOf(actor) ?? 0 })) posted += 1;
    });
  }
  return posted;
}

/**
 * Register the two update hooks (replacing any earlier registration of the same two, so a second call never doubles an
 * alert) and sweep the crossings stamped while no GM was connected. From `ready`.
 * @returns {Promise<number>} the cards the sweep posted
 */
export async function registerFanBoxAlertHooks() {
  globalThis.Hooks?.off?.('preUpdateActor', onPreUpdatePopularity);
  globalThis.Hooks?.off?.('updateActor', onUpdatePopularity);
  globalThis.Hooks?.on?.('preUpdateActor', onPreUpdatePopularity);
  globalThis.Hooks?.on?.('updateActor', onUpdatePopularity);
  try {
    return await sweepPendingFanBoxAlerts();
  } catch (err) {
    console.warn('Sprinter RPG | The Fan Box alert sweep failed:', err);
    return 0;
  }
}
