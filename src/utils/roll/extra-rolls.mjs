/**
 * Post one roll with more rolls on the same chat message (the dice a helper adds to a check): the message's `rolls`
 * are `[roll, ...extras]`, so Dice So Nice throws them together and an assist entry's `rollIndex` points at its own die.
 */

/**
 * @param {Roll} roll the main roll (index 0)
 * @param {Roll[]} extras evaluated rolls to follow it
 * @param {object} messageData as `Roll#toMessage` takes it
 * @returns {Promise<ChatMessage>}
 */
export async function postRollWithExtras(roll, extras, messageData) {
  if (!Array.isArray(extras) || extras.length === 0) return roll.toMessage(messageData);
  const data = await roll.toMessage(messageData, { create: false });
  // The prepared data holds serialised rolls (the message source); a roll that cannot serialise stays as it is.
  const serialised = extras.map((extra) => (typeof extra?.toJSON === 'function' ? JSON.stringify(extra.toJSON()) : extra));
  data.rolls = [...(Array.isArray(data.rolls) ? data.rolls : []), ...serialised];
  const ChatMessageClass = globalThis.ChatMessage?.implementation ?? globalThis.ChatMessage;
  return ChatMessageClass.create(data);
}
