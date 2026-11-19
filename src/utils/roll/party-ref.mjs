/**
 * The party check a roll is made for (`options.partyCheck` on `rollSkill`, and `party` on the check record): the party card's
 * message id and the participant's id. A leaf: the check record and the skill roll both read it here.
 */
const MAX_PARTY_REF_ID = 64;

/**
 * Both ids (strings, at most 64 characters), or null when either is missing.
 * @param {unknown} raw
 * @returns {{ messageId: string, participantId: string }|null}
 */
export function sanitizePartyCheckRef(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const messageId = typeof raw.messageId === 'string' ? raw.messageId.slice(0, MAX_PARTY_REF_ID) : '';
  const participantId = typeof raw.participantId === 'string' ? raw.participantId.slice(0, MAX_PARTY_REF_ID) : '';
  return messageId && participantId ? { messageId, participantId } : null;
}
