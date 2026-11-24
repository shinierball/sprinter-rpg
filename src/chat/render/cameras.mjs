/**
 * Render-time Playing to the Cameras block (E6.10 B3b, 3.7). The card's flags are the truth; this only decorates: after
 * the static note it shows the settled line or "Awaiting the result" and, for the GM, the controls the state calls for
 * (the six result buttons while the result is unknown or picked by hand, Award when settling is due, the withheld AI
 * Favor button). Built with createElement and textContent.
 */
import { cameraText, CAMERA_RESULTS, readCameraFlag, readCameraPrompt, sanitizeCameraRecord } from '../../utils/roll/cameras.mjs';
import { cameraAwardPlan, cameraChangesText, cameraResultLabel } from '../actions/cameras.mjs';
import { messageById } from '../../utils/card/recent-cards.mjs';
import { el } from './element.mjs';

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
  const { record, result } = plan;
  const isGM = Boolean(globalThis.game?.user?.isGM);
  const wrap = el(doc, 'div', 'cog-camera-award-block');

  if (record.settled.result) {
    const changes = cameraChangesText(record.settled);
    const resultLabel = cameraResultLabel(record.settled.result);
    wrap.append(el(doc, 'div', 'cog-camera-status', changes
      ? cameraText('COG.Cameras.Settled', { changes, result: resultLabel })
      : cameraText('COG.Cameras.SettledNone', { result: resultLabel })));
  } else {
    wrap.append(el(doc, 'div', 'cog-camera-status', cameraText('COG.Cameras.Awaiting')));
  }
  if (record.closed) wrap.append(el(doc, 'div', 'cog-camera-closed', cameraText('COG.Cameras.Closed')));

  if (isGM) {
    if (!record.closed && (result === null || record.pickedResult)) {
      const picks = el(doc, 'div', 'cog-camera-picks');
      picks.title = cameraText('COG.Cameras.PickTip');
      picks.append(el(doc, 'span', 'cog-camera-pick-label', cameraText('COG.Cameras.PickLabel')));
      for (const id of CAMERA_RESULTS) picks.append(button(doc, cameraText(`COG.Cameras.Pick.${id}`), 'crawlerCameraPickRow', { result: id }));
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

/**
 * A GM prompt card the migration left behind: its source card is `closed` (settled on an earlier release) and the prompt was
 * never answered, so its stored buttons name choices the table no longer has. The buttons are taken off and the card says
 * to make the choice by hand. A prompt whose source is not closed, or not found, is left as it is.
 * @param {HTMLElement} root the rendered message element
 * @param {object} message
 * @returns {HTMLElement|null} the notice added
 */
export function renderCameraPrompt(root, message) {
  const prompt = readCameraPrompt(message);
  if (!prompt || typeof prompt !== 'object' || prompt.resolved || !root?.querySelector) return null;
  const source = messageById(prompt.sourceId);
  if (!source || !sanitizeCameraRecord(readCameraFlag(source))?.closed) return null;
  const doc = root.ownerDocument ?? globalThis.document;
  const notice = el(doc, 'div', 'cog-camera-closed', cameraText('COG.Cameras.LeftOpen'));
  for (const choices of root.querySelectorAll('.cog-camera-choices')) choices.remove();
  for (const choice of root.querySelectorAll('.cog-camera-choice')) choice.remove();
  (root.querySelector('.cog-camera-prompt') ?? root.querySelector('.message-content') ?? root).append(notice);
  return notice;
}
