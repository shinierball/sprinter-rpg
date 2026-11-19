/**
 * A Help pledge (Question 1377 c): a crawler promises, from their own sheet, to help one ally before that ally's next
 * eligible Skill Check; the line is pre-ticked in the ally's roll dialog. Each side writes only the actor it owns, so
 * nothing waits on a GM:
 * - the helper's actor carries the pledge, `helpPledge` (one per helper; a new one replaces it, a withdraw clears it);
 * - the ally's actor carries `helpPledgesUsed`, the id of the last pledge it used from each helper (by helper actor id).
 * A pledge is pending while it names this ally, was made on the current Floor and scene and is not the ally's used one.
 * A pledge from another Floor, or from before a combat started or the scene changed (the scene epoch, which a combat
 * start, a combat end and the Floor clock's New Scene all raise), is simply not offered (no cleanup write). This module is the one owner of both flag keys.
 */
import { readFlag, writeFlag, clearFlag } from '../../utils/flags.mjs';
import { getCurrentFloor } from '../../utils/floor/current-floor.mjs';
import { getSceneEpoch } from './dungeon-time.mjs';

const PLEDGE_FLAG = 'helpPledge';
const USED_FLAG = 'helpPledgesUsed';
const MAX_ID = 64;

const idOf = (actor) => actor?.uuid ?? actor?.id ?? null;
const text = (value) => (typeof value === 'string' ? value.slice(0, MAX_ID) : '');
const newId = () => globalThis.foundry?.utils?.randomID?.() ?? `pledge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * The helper's stored pledge, sanitised; null when there is none or it is malformed.
 * @param {object} helper
 * @returns {{ id: string, allyUuid: string, skillKey: string, floor: number, epoch: number, at: number }|null}
 */
function readPledge(helper) {
  const raw = readFlag(helper, PLEDGE_FLAG);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = text(raw.id);
  const allyUuid = text(raw.allyUuid);
  if (!id || !allyUuid) return null;
  return { id, allyUuid, skillKey: text(raw.skillKey), floor: Math.trunc(Number(raw.floor)) || 0, epoch: Math.trunc(Number(raw.epoch)) || 0, at: Number(raw.at) || 0 };
}

/**
 * The helper's pledge to this roller, when it still stands: it names the roller, was made on the current Floor and the
 * roller has not used it.
 * @param {object} helper
 * @param {object} roller
 * @returns {ReturnType<typeof readPledge>}
 */
export function pendingPledgeFor(helper, roller) {
  const pledge = readPledge(helper);
  if (!pledge || pledge.allyUuid !== idOf(roller) || pledge.floor !== getCurrentFloor() || pledge.epoch !== getSceneEpoch()) return null;
  const used = readFlag(roller, USED_FLAG);
  const helperId = helper?.id ?? '';
  return used && typeof used === 'object' && helperId && used[helperId] === pledge.id ? null : pledge;
}

/**
 * The helper's pledge that still stands for anyone (made on the current Floor and scene). Whether the ally used it is the ally's
 * data; this is what the pledge dialog shows as the current choice.
 * @param {object} helper
 */
export function standingPledge(helper) {
  const pledge = readPledge(helper);
  return pledge && pledge.floor === getCurrentFloor() && pledge.epoch === getSceneEpoch() ? pledge : null;
}

/**
 * Pledge Help to an ally (replaces any earlier pledge). Written by the helper's own client.
 * @param {object} helper
 * @param {{ allyUuid: string, skillKey?: string }} spec
 * @returns {Promise<ReturnType<typeof readPledge>>}
 */
export async function writePledge(helper, { allyUuid, skillKey = '' }) {
  const pledge = { id: newId(), allyUuid: text(allyUuid), skillKey: text(skillKey), floor: getCurrentFloor(), epoch: getSceneEpoch(), at: Date.now() };
  await writeFlag(helper, PLEDGE_FLAG, pledge);
  return pledge;
}

/** Withdraw the helper's pledge. */
export function withdrawPledge(helper) {
  return clearFlag(helper, PLEDGE_FLAG);
}

/**
 * Record on the roller (the ally, whose client rolls) the pledges a helped roll used, so they are no longer offered.
 * @param {object} roller
 * @param {{ helperId: string, pledgeId: string }[]} used
 */
export async function markPledgesUsed(roller, used = []) {
  const stored = readFlag(roller, USED_FLAG);
  const map = stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...stored } : {};
  let changed = false;
  for (const { helperId, pledgeId } of used) {
    if (!helperId || !pledgeId) continue;
    map[text(helperId)] = text(pledgeId);
    changed = true;
  }
  if (!changed) return;
  try {
    await writeFlag(roller, USED_FLAG, map);
  } catch (err) {
    console.warn('Sprinter RPG | Could not record a used Help pledge:', err);
  }
}
