/**
 * Session Manager "Secrets" tab (7.1f, 629 a): the GM's ledger of transformation events. It lists every secret debuff
 * held GM-side and every pending or changed affliction on world actors and unlinked placed tokens, and carries the
 * buttons (Open, Reveal, Change, Cure) and the GM note for each row. Every action takes a row `key` from the list.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { getCurrentFloor } from '../../documents/actor/actor-environment.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { CURE_WINDOWS, afflictionStage, cueOf, cureWindowOpen, isAffliction, normalizeTransform, transformState } from '../../utils/character/transform-rules.mjs';
import { listPending, reveal, cure, setNote } from '../../documents/pending-secrets.mjs';
import { changeVictim, revertTransformation, confirmHeldRevert, changeNow } from '../../documents/actor/transformations.mjs';
import { formatDayClock } from '../../utils/time/timing.mjs';

const landedLabel = (floor, at) => `Floor ${floor}, ${formatDayClock(at)}`;

/** Actors that can carry an affliction: world actors, then the actors of unlinked placed tokens (each once). */
function carriers() {
  const seen = new Map();
  for (const actor of Array.from(globalThis.game?.actors ?? [])) if (actor?.uuid) seen.set(actor.uuid, actor);
  for (const scene of Array.from(globalThis.game?.scenes ?? [])) {
    for (const token of Array.from(scene.tokens ?? [])) {
      if (token?.actorLink) continue;
      const actor = token.actor;
      if (actor?.uuid && !seen.has(actor.uuid)) seen.set(actor.uuid, actor);
    }
  }
  return [...seen.values()];
}

function cureWindowLabel(item, floor) {
  const id = normalizeTransform(item.system?.transform)?.curable || 'never';
  const label = CURE_WINDOWS[id]?.label ?? id;
  return `${label} (${cureWindowOpen(item, { floor }) ? 'open' : 'closed'})`;
}

/**
 * The rows of the tab: held secrets first (oldest first), then afflictions by carrier.
 * @returns {object[]} `{ key, kind: 'held'|'affliction', actorName, actorUuid, afflictionId, name, stage, landed,
 *   cue, window, note, canReveal, canChange, canCure }`
 */
export function buildSecretRows() {
  const floor = getCurrentFloor();
  const rows = listPending().map((r) => ({
    key: r.id,
    kind: 'held',
    actorName: r.actorName,
    actorUuid: r.actorUuid,
    afflictionId: '',
    name: r.name,
    stage: 'held secret',
    landed: landedLabel(r.landedFloor, r.landedAt),
    cue: cueOf(r.debuffData)?.label ?? '',
    window: isAffliction(r.debuffData) ? cureWindowLabel(r.debuffData, floor) : '',
    note: r.note ?? '',
    canReveal: true,
    canChange: isAffliction(r.debuffData),
    canCure: true
  }));
  for (const actor of carriers()) {
    for (const item of Array.from(actor.items ?? [])) {
      if (!isAffliction(item)) continue;
      const stage = afflictionStage(item);
      const state = transformState(item);
      rows.push({
        key: `${actor.uuid}#${item.id}`,
        kind: 'affliction',
        actorName: actor.name,
        actorUuid: actor.uuid,
        afflictionId: item.id,
        name: item.name,
        stage,
        landed: landedLabel(state.landedFloor ?? 1, state.landedAt),
        cue: cueOf(item)?.label ?? '',
        window: cureWindowLabel(item, floor),
        note: item.flags?.[SYSTEM_ID]?.gmNote ?? '',
        canReveal: false,
        canChange: stage === 'pending',
        canCure: true
      });
    }
  }
  return rows;
}

const rowByKey = (key) => buildSecretRows().find((r) => r.key === key) ?? null;

function carrierOf(row) {
  const actor = resolveActorByUuid(row.actorUuid);
  return { actor, affliction: actor?.items?.get(row.afflictionId) ?? null };
}

/** Open the carrier's sheet. */
export function openRowActor(key) {
  const row = rowByKey(key);
  const actor = row ? resolveActorByUuid(row.actorUuid) : null;
  actor?.sheet?.render?.(true);
  return Boolean(actor);
}

/** Reveal a held secret to its carrier. */
export async function revealRow(key) {
  const row = rowByKey(key);
  return row?.kind === 'held' ? Boolean(await reveal(row.key)) : false;
}

/** Change a row now: a held secret is created and fired; a pending affliction is fired (plain confirmation). */
export async function changeRow(key) {
  const row = rowByKey(key);
  if (!row) return false;
  if (row.kind === 'held') return Boolean(await changeNow(row.key));
  const { actor, affliction } = carrierOf(row);
  return actor && affliction ? changeVictim(actor, affliction) : false;
}

/**
 * Cure a row. A held secret is dropped; a pending affliction is removed; a changed one is reverted, asking a Rule Break
 * when its cure window is closed (the GM adjudicates; nothing is blocked).
 */
export async function cureRow(key) {
  const row = rowByKey(key);
  if (!row) return false;
  if (row.kind === 'held') return cure(row.key);
  const { actor, affliction } = carrierOf(row);
  if (!actor || !affliction) return false;
  const gate = await confirmHeldRevert(actor, affliction);
  if (!gate.proceed) return false;
  return revertTransformation(actor, affliction, { ruleBreak: gate.ruleBreak });
}

/** Save the GM note of a row (the store for a held secret, the affliction's `gmNote` flag otherwise). */
export async function saveRowNote(key, note) {
  const row = rowByKey(key);
  if (!row) return false;
  if (row.kind === 'held') return setNote(row.key, note);
  const { affliction } = carrierOf(row);
  if (!affliction) return false;
  await affliction.setFlag(SYSTEM_ID, 'gmNote', String(note ?? ''));
  return true;
}
