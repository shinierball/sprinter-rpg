/**
 * PvP rounds (core p. 87): an optional rule a table agrees on. While a combat carries the `pvp` flag, each round every
 * player's crawler rolls initiative (d20 + Dex Mod; Advantage on a sneak Attack in the first round), the Crawler phase
 * orders them by it, and each has one Action a round, the second being Evade. The Mob phase and the other crawler-side
 * combatants keep their phase values. This module owns the `pvp` flag and never imports `initiative.mjs`,
 * `action-ledger.mjs` or `combat.mjs`, which import it.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { clearFlag, readFlag, writeFlag } from '../../utils/flags.mjs';
import { isPlayerCrawler } from '../../utils/combat/combat-sides.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { langText } from '../../utils/lang-text.mjs';
import { isCombatWriter } from './combatants.mjs';

/** World setting: the table has agreed to PvP rounds (core p. 87: off by default). */
export const PVP_COMBAT_SETTING = 'pvpCombat';
const PVP_FLAG = 'pvp';
const EVADE_TYPE = 'evade';
/** Actions a player's crawler takes in a PvP round besides its Evade (the second Action is the Evade). */
const PVP_ACTIONS_PER_ROUND = 1;

const TEXT = Object.freeze({
  'COG.PvpRounds.Budget': 'PvP combat: one Action a round; the second is Evade (core p. 87)',
  'COG.PvpRounds.Mark': 'PvP {total}',
  'COG.PvpRounds.MarkTie': 'PvP {total}, simultaneous',
  'COG.PvpRounds.CardTitle': 'PvP initiative, round {round}',
  'COG.PvpRounds.CardLine': '{name}: {total}',
  'COG.PvpRounds.CardTie': '{name}: {total} (simultaneous)',
  'COG.PvpRounds.ToggleOn': 'PvP ROUNDS: ON',
  'COG.PvpRounds.ToggleOff': 'PvP rounds: off',
  'COG.PvpRounds.ToggleTip': 'Toggle PvP rounds for this combat (core p. 87)',
  'COG.PvpRounds.GmOnly': 'Only the GM can toggle PvP rounds.',
  'COG.PvpRounds.DialogTitle': 'Start PvP rounds',
  'COG.PvpRounds.DialogIntro': 'Each player\'s crawler rolls d20 + Dex every round. Tick a crawler that made a sneak Attack: it rolls this round with Advantage.',
  'COG.PvpRounds.DialogSneak': 'Made a sneak Attack',
  'COG.PvpRounds.DialogStart': 'Start',
  'COG.PvpRounds.DialogCancel': 'Cancel'
});
export const pvpText = langText(TEXT);

/** True when the table has agreed to PvP rounds (the world setting). */
export function pvpRoundsOffered() {
  return globalThis.game?.settings?.get?.(SYSTEM_ID, PVP_COMBAT_SETTING) === true;
}

/**
 * The `pvp` flag of a combat read defensively: `{ since, sneak }` or null when the combat runs no PvP rounds.
 * @param {object} combat
 * @returns {{ since: number, sneak: string[] }|null}
 */
function pvpStateOf(combat) {
  const raw = readFlag(combat, PVP_FLAG);
  if (!raw || typeof raw !== 'object') return null;
  const since = Math.trunc(Number(raw.since));
  const sneak = Array.isArray(raw.sneak) ? raw.sneak.filter((id) => typeof id === 'string') : [];
  return { since: Number.isFinite(since) ? since : 1, sneak };
}

/** True when this combat runs PvP rounds (the combat carries the flag). */
export function pvpRoundsActive(combat) {
  return pvpStateOf(combat) !== null;
}

/** True when this combatant is a player's crawler (the only combatants PvP rounds touch). */
export function isPvpCombatant(combatant) {
  return isPlayerCrawler(combatant?.actor);
}

/**
 * The initiative formula of one player's crawler: d20 + Dex Mod (core p. 57), two dice keeping the higher with Advantage.
 * @param {{ dexMod?: number, advantage?: boolean }} p
 * @returns {string}
 */
function pvpInitiativeFormula({ dexMod = 0, advantage = false } = {}) {
  const mod = Math.trunc(Number(dexMod)) || 0;
  return `${advantage ? '2d20kh' : '1d20'} ${mod < 0 ? '-' : '+'} ${Math.abs(mod)}`;
}

/**
 * Roll PvP initiative for the player crawlers of a combat (all, or the combatants in `ids`), post one card with every
 * Roll, highest first, and write each total to the combatant's `initiative`. Only the combat writer rolls.
 * @param {object} combat
 * @param {{ ids?: string[] }} [opts]
 * @returns {Promise<{ id: string, total: number }[]>}
 */
export async function rollPvpInitiative(combat, { ids = [] } = {}) {
  const state = pvpStateOf(combat);
  if (!state || !isCombatWriter()) return [];
  const round = Number(combat.round) || 1;
  const rolled = [];
  for (const c of (combat.combatants || [])) {
    if (ids.length && !ids.includes(c.id)) continue;
    if (!isPvpCombatant(c)) continue;
    const advantage = state.sneak.includes(c.id) && round === state.since;
    const formula = pvpInitiativeFormula({ dexMod: c.actor.system?.abilities?.dex?.mod, advantage });
    const roll = await new globalThis.Roll(formula).evaluate();
    rolled.push({ id: c.id, name: c.name, roll, total: Number(roll.total) || 0 });
  }
  if (!rolled.length) return [];
  rolled.sort((a, b) => b.total - a.total);
  const tied = (r) => rolled.filter((o) => o.total === r.total).length > 1;
  const lines = rolled.map((r) => {
    const line = pvpText(tied(r) ? 'COG.PvpRounds.CardTie' : 'COG.PvpRounds.CardLine', { name: r.name, total: r.total });
    return `<li>${escapeAttr(line)}</li>`;
  });
  await globalThis.ChatMessage?.create?.({
    content: `<div class="cog-pvp-initiative"><strong>${escapeAttr(pvpText('COG.PvpRounds.CardTitle', { round }))}</strong><ol>${lines.join('')}</ol></div>`,
    rolls: rolled.map((r) => r.roll)
  });
  for (const r of rolled) {
    const c = combat.combatants.find((o) => o.id === r.id);
    if (c) c.initiative = r.total;
  }
  if (combat.updateEmbeddedDocuments) {
    await combat.updateEmbeddedDocuments('Combatant', rolled.map((r) => ({ _id: r.id, initiative: r.total })));
  }
  return rolled.map(({ id, total }) => ({ id, total }));
}

/**
 * Turn PvP rounds on for a combat: store the flag (`since` is the round, or round 1 before the combat starts) and roll the
 * first initiative when the combat is under way.
 * @param {object} combat
 * @param {{ sneak?: string[] }} [opts] combatant ids whose crawler made a sneak Attack (Advantage in the first round)
 */
export async function startPvpRounds(combat, { sneak = [] } = {}) {
  await writeFlag(combat, PVP_FLAG, { since: Math.max(1, Number(combat.round) || 0), sneak });
  if ((Number(combat.round) || 0) >= 1) await rollPvpInitiative(combat);
}

/** Turn PvP rounds off: clear the flag and write the phase values back. */
export async function endPvpRounds(combat) {
  await clearFlag(combat, PVP_FLAG);
  await combat.assignPhaseInitiative?.();
}

/**
 * The tracker row's PvP mark of a player's crawler: "PvP {total}", "simultaneous" when another player crawler has the same
 * total (core p. 87). Null for any other combatant or when PvP rounds are off.
 * @returns {string|null}
 */
export function pvpTurnLabel(combat, combatant) {
  if (!pvpRoundsActive(combat) || !isPvpCombatant(combatant)) return null;
  const total = Number(combatant.initiative) || 0;
  const tie = (combat.combatants || []).some((o) => o.id !== combatant.id && isPvpCombatant(o) && (Number(o.initiative) || 0) === total);
  return pvpText(tie ? 'COG.PvpRounds.MarkTie' : 'COG.PvpRounds.Mark', { total });
}

/**
 * The Rule Break line of an Action beyond a player crawler's one Action a round (the Evade is the second). Empty when PvP
 * rounds are off, the combatant is not a player's crawler, the Action is an Evade, or a slot was named.
 * @returns {string[]}
 */
export function pvpActionLines(combat, combatant, actions, type, actionData = {}) {
  if (!pvpRoundsActive(combat) || !isPvpCombatant(combatant)) return [];
  if (type === EVADE_TYPE || actionData.slotIndex !== undefined) return [];
  const taken = (actions?.slots ?? []).filter((slot) => slot && slot.type !== EVADE_TYPE).length;
  const allowed = Math.max(PVP_ACTIONS_PER_ROUND, (Number(actions?.max) || 0) - PVP_ACTIONS_PER_ROUND);
  return taken >= allowed ? [pvpText('COG.PvpRounds.Budget')] : [];
}
