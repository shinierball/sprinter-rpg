/**
 * The flags an assist roll's chat card carries: that it is one, where it came from (`source`: 'sheet' for a Called Play
 * rolled from a sheet, 'interrupt' for an after-roll assist), the check card it answers and who rolled which skill. This
 * module owns the words. (`source` here is the assist's origin; the content source stamp is another flag with the same
 * key, owned by `content-source.mjs`, which lives on documents and never on a chat card.)
 */
import { readFlags, withFlags } from '../flags.mjs';

/** Where an assist roll came from. */
export const ASSIST_SOURCE = Object.freeze({ SHEET: 'sheet', INTERRUPT: 'interrupt' });

/** The assist-roll flags of a chat message (a key it does not carry reads `undefined`); null for no message. */
export const assistRollOf = (message) => (message
  ? readFlags(message, ['isAssistRoll', 'source', 'checkMessageId', 'assisterUuid', 'itemId', 'skillName', 'formula'])
  : null);

/** `data` (message data) marked as an assist roll with `patch` (source, assisterUuid, itemId, skillName, formula, ...) beside it. */
export const withAssistRoll = (data, patch) => withFlags(data, { isAssistRoll: true, ...patch });
