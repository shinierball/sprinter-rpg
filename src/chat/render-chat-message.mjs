/**
 * Chat message render hook handler. Button clicks go through one delegated
 * `data-action` listener (see dispatch.mjs); render-time work lives in ./render/.
 */
import { bindChatActions } from './dispatch.mjs';
import { hideForeignInterruptButtons, hideGmOnlyButtons } from './render/interrupt-visibility.mjs';
import { addSenderBadges } from './render/sender-badges.mjs';
import { renderCameraAward } from './render/cameras.mjs';
import { renderDamageApplications } from './render/damage-applications.mjs';
import { renderCheckAssists } from './render/check-assists.mjs';
import { renderCheckDifficulty } from './render/check-difficulty.mjs';
import { renderVehicleCheck } from './render/vehicle-check.mjs';
import { renderPatronCheck } from './render/patron-check.mjs';
import { hideForeignContestButtons } from './render/contest.mjs';
import { hideSpentInflictButtons } from './render/spell-condition-buttons.mjs';
import { hideGmRuleBreakBadges } from '../utils/rule-break-visibility.mjs';

/**
 * Hook handler for Chat Message rendering.
 * @param {ChatMessage} message
 * @param {HTMLElement} root the rendered message element
 * @param {object} data
 */
export function onRenderChatMessage(message, root, data) {
  if (!root) return;
  bindChatActions(root, message);
  renderCheckAssists(root, message);
  renderCheckDifficulty(root, message);
  renderVehicleCheck(root, message);
  renderPatronCheck(root, message);
  renderCameraAward(root, message);
  renderDamageApplications(root, message);
  hideForeignInterruptButtons(root);
  hideForeignContestButtons(root);
  hideGmOnlyButtons(root);
  addSenderBadges(root, message);
  hideGmRuleBreakBadges(root, message);
  hideSpentInflictButtons(root, message);
}
