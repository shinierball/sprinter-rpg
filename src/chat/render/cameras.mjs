/**
 * Render-time Playing to the Cameras block (E6.10 B3b, 3.7). The card's flags are the truth; this only decorates: after
 * the static note it shows the settled line or "Awaiting the result" and, for the GM, the controls the state calls for
 * (the four result buttons while the result is unknown or picked by hand, Award when settling is due, the withheld AI
 * Favor button). Built with createElement and textContent.
 */
import { cameraText } from '../../utils/cameras.mjs';
import { cameraAwardPlan, cameraChangesText, cameraRowLabel } from '../actions/cameras.mjs';

function el(doc, tag, cls, text) {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(doc, label, action, data = {}) {
  const b = el(doc, 'button', 'cog-camera-btn', label);
  b.type = 'button';
  b.dataset.action = action;
  b.dataset.gmOnly = 'true';
  for (const [k, v] of Object.entries(data)) b.dataset[k] = String(v);
  return b;
}

/**
 * @param {HTMLElement} root the rendered message element
 * @param {object} message
 * @returns {HTMLElement|null} the block added
 */
export function renderCameraAward(root, message) {
  const plan = cameraAwardPlan(message);
  if (!plan || !root?.querySelector) return null;
  const doc = root.ownerDocument ?? globalThis.document;
  const { record, row } = plan;
  const isGM = Boolean(globalThis.game?.user?.isGM);
  const wrap = el(doc, 'div', 'cog-camera-award-block');

  if (record.settled.row) {
    const changes = cameraChangesText(record.settled);
    const rowLabel = cameraRowLabel(record.settled.row);
    wrap.append(el(doc, 'div', 'cog-camera-status', changes
      ? cameraText('COG.Cameras.Settled', { changes, row: rowLabel })
      : cameraText('COG.Cameras.SettledNone', { row: rowLabel })));
  } else {
    wrap.append(el(doc, 'div', 'cog-camera-status', cameraText('COG.Cameras.Awaiting')));
  }

  if (isGM) {
    if (row === null || record.pickedRow) {
      const picks = el(doc, 'div', 'cog-camera-picks');
      picks.append(el(doc, 'span', 'cog-camera-pick-label', cameraText('COG.Cameras.PickLabel')));
      for (const n of [1, 2, 3, 4]) picks.append(button(doc, cameraText(`COG.Cameras.Pick${n}`), 'crawlerCameraPickRow', { row: n }));
      wrap.append(picks);
    }
    if (plan.pending && plan.trusted) wrap.append(button(doc, cameraText('COG.Cameras.Award'), 'crawlerCameraAward'));
    if (record.withheld?.aiFavor) {
      wrap.append(button(doc, cameraText('COG.Cameras.Withheld', { n: record.withheld.aiFavor }), 'crawlerCameraWithheld'));
    }
  }

  const note = root.querySelector('.cog-camera-note');
  if (note?.after) note.after(wrap);
  else (root.querySelector('.message-content') ?? root).append(wrap);
  return wrap;
}
