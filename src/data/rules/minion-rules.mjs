/**
 * src/data/rules/minion-rules.mjs
 * Pure minion rules (core book p. 233). A minion acts on its controller's command. No Foundry globals, no document code,
 * nothing here blocks anything (Directive 2): a minion that was not commanded asks a Rule Break through the action gate.
 */

/** The Rule Break cause of an Action by a minion nobody has commanded. */
const NOT_COMMANDED_CAUSE = "Not commanded: a minion acts only on its controller's command";

/**
 * The reasons a minion may not act now. A minion that was commanded, needs no command (a self-directed source) or lost its
 * controller (Bereft: it carries on with its last command) has none.
 * @param {{ commanded?: boolean, selfDirected?: boolean, bereft?: boolean }} [state]
 * @returns {string[]}
 */
export function minionOrderCauses({ commanded = false, selfDirected = false, bereft = false } = {}) {
  return commanded || selfDirected || bereft ? [] : [NOT_COMMANDED_CAUSE];
}

/** Where a minion stands, with the label and the tracker badge of each state. */
export const MINION_STATES = Object.freeze({
  uncommanded: Object.freeze({ id: 'uncommanded', label: "Waiting for its controller's command", badge: '[UNCOMMANDED]' }),
  commanded: Object.freeze({ id: 'commanded', label: "Acting on its controller's command", badge: '[COMMANDED]' }),
  bereft: Object.freeze({ id: 'bereft', label: 'Its controller is dead; it carries on with its last command', badge: '[BEREFT]' }),
  'self-directed': Object.freeze({ id: 'self-directed', label: 'Acts without commands', badge: '[SELF-DIRECTED]' })
});

/**
 * The commanded list after a command check (core pp. 203, 233). A Success adds every creature of the group; `added` is what
 * this card has added so far. A Fail takes back only what this card added: a command another card gave stays, and a creature
 * keeps the command it had.
 * @param {{ list?: string[], group?: string[], added?: string[], success?: boolean }} p
 * @returns {{ list: string[], added: string[] }}
 */
export function commandsAfterCheck({ list = [], group = [], added = [], success = false } = {}) {
  if (success) {
    const fresh = group.filter((uuid) => !list.includes(uuid));
    return { list: [...list, ...fresh], added: [...new Set([...added, ...fresh])] };
  }
  return { list: list.filter((uuid) => !added.includes(uuid)), added: [] };
}
