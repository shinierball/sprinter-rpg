/**
 * Render-time Difficulty block on plain check cards.
 *
 * The card's flags are the truth (`flags.sprinter-rpg.check`); this module only decorates: the Difficulty line and how
 * it was reached, the degree badge (never the margin, p. 60) and, for the GM, the buttons that set it. Markup is built
 * with createElement/textContent: names are user text and never go through innerHTML.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { readCheckRecord, effectiveCheck } from '../../utils/roll/check-assists.mjs';
import { COG_OUTCOME_CONFIG } from '../../documents/session/roll-outcomes.mjs';
import { getCurrentFloor } from '../../utils/floor/current-floor.mjs';
import { difficultyFor, defaultModeFor, canSetDifficulty, offersFormulas, difficultyLineText, difficultyText } from '../../utils/roll/check-difficulty.mjs';
import { foeEntryFor, knownFoes } from '../actions/check-difficulty.mjs';

const BLOCK_CLASS = 'cog-check-difficulty';

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(doc, { label, action, mode = null, isDefault = false, title = '' }) {
  const b = el(doc, 'button', `cog-assist-offer-btn${isDefault ? ' is-default' : ''}`, label);
  b.type = 'button';
  b.dataset.action = action;
  if (mode) b.dataset.mode = mode;
  if (title) b.title = title;
  return b;
}

function badge(doc, outcome) {
  const cfg = COG_OUTCOME_CONFIG[outcome];
  if (!cfg) return null;
  const b = el(doc, 'span', `cog-check-degree ${cfg.class}`, cfg.label);
  b.dataset.difficulty = 'true';
  return b;
}

/** The formula buttons with their worked numbers, the default mode first. */
function formulaButtons(doc, message, record, floor) {
  const stat = record.stat || '';
  const foe = knownFoes(message, record)[0] ?? null;
  const entry = foe ? foeEntryFor(foe, stat, null) : null;
  const buttons = {
    unopposed: button(doc, { label: difficultyText('ButtonUnopposed', { dc: difficultyFor({ mode: 'unopposed' }, { floor }).value }), action: 'crawlerSetDifficulty', mode: 'unopposed' }),
    stat: button(doc, { label: difficultyText('ButtonStat', { dc: difficultyFor({ mode: 'stat' }, { floor }).value }), action: 'crawlerSetDifficulty', mode: 'stat' }),
    opposed: entry
      ? button(doc, {
        label: difficultyText('ButtonOpposed', { dc: difficultyFor({ mode: 'opposed', stat, foe: entry }, { floor }).value, foe: entry.name, stat: stat.toUpperCase() }),
        action: 'crawlerSetDifficulty',
        mode: 'opposed'
      })
      : button(doc, { label: difficultyText('ButtonOpposedAsk'), action: 'crawlerAskOpposed' })
  };
  const first = defaultModeFor(record);
  const order = [first, ...Object.keys(buttons).filter((k) => k !== first)];
  const row = el(doc, 'div', 'cog-check-difficulty-formulas');
  for (const key of order) {
    if (key === first) buttons[key].classList.add('is-default');
    row.append(buttons[key]);
    if (key === 'opposed' && entry) {
      row.append(button(doc, { label: '▾', action: 'crawlerAskOpposed', title: difficultyText('ChangeOpposed') }));
    }
  }
  return row;
}

function gmControls(doc, message, record, pending) {
  const floor = record.floor ?? getCurrentFloor();
  const details = el(doc, 'details', 'cog-check-difficulty-controls');
  details.dataset.gmOnly = 'true';
  if (pending) details.setAttribute('open', '');
  details.append(el(doc, 'summary', '', difficultyText('Change')));
  if (offersFormulas(record)) details.append(formulaButtons(doc, message, record, floor));
  const typed = el(doc, 'div', 'cog-check-difficulty-typed');
  const box = el(doc, 'input');
  box.type = 'number';
  box.min = '0';
  box.step = '1';
  box.setAttribute('aria-label', difficultyText('NumberLabel'));
  typed.append(box, button(doc, { label: difficultyText('Set'), action: 'crawlerSetDifficulty', mode: 'typed' }));
  if (record.difficulty || record.dc !== null) typed.append(button(doc, { label: difficultyText('Clear'), action: 'crawlerClearDifficulty' }));
  details.append(typed);
  return details;
}

/**
 * Decorate a plain check card with its Difficulty line, degree and the GM's controls. Idempotent.
 * @param {HTMLElement} root the rendered message element
 * @param {ChatMessage} message
 */
export function renderCheckDifficulty(root, message) {
  if (!root?.querySelector) return;
  const card = root.querySelector('.message-content') ?? root;
  card.querySelectorAll(`.${BLOCK_CLASS}, [data-difficulty="true"]`).forEach((n) => n.remove());
  const record = readCheckRecord(message);
  if (!record) return;
  const flags = message?.flags?.[SYSTEM_ID] ?? {};
  if (!canSetDifficulty(record, flags)) return;
  const eff = effectiveCheck(record);
  if (!eff) return;
  const doc = root.ownerDocument;
  const block = el(doc, 'div', BLOCK_CLASS);
  const plain = offersFormulas(record);

  // An attack or spell card shows its targets' Evade, so its line appears only when the GM set a number.
  if (plain || record.difficulty) {
    const line = record.difficulty
      ? difficultyLineText(record.difficulty)
      : (record.dc !== null ? difficultyText('Line', { dc: record.dc }) : difficultyText('NotSet'));
    const text = record.difficulty?.standing ? `${line} · ${difficultyText('Standing')}` : line;
    block.append(el(doc, 'p', 'cog-check-difficulty-line', text));
  }

  if (plain && !eff.pending) {
    if (record.targets.length) {
      card.querySelectorAll('.cog-check-target-row[data-target-id]').forEach((row) => {
        const target = eff.targets.find((t) => t.actorId === row.dataset.targetId);
        const b = target ? badge(doc, target.outcome) : null;
        if (b) row.append(b);
      });
    } else {
      const b = badge(doc, eff.outcome);
      if (b) block.append(b);
    }
  }

  if (globalThis.game?.user?.isGM) block.append(gmControls(doc, message, record, eff.pending));
  if (block.childNodes.length) card.append(block);
}
