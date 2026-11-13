/**
 * How an activation window reads in words ("for 10 minutes", "for one use", "until the end of combat"). One phrasing
 * for the chat line Use posts, the describer line and the sheet; the caller supplies the translator.
 */

/** The lang key suffixes (after the caller's prefix) and English fallbacks of the phrases, by window shape. */
const ACTIVATION_PHRASES = Object.freeze({
  combat: ['WindowCombat', 'until the end of combat'],
  oneUse: ['WindowOneUse', 'for one use'],
  uses: ['WindowUses', 'for {n} uses'],
  oneHit: ['WindowOneHit', 'until the next hit'],
  hits: ['WindowHits', 'for {n} hits'],
  timed: ['WindowTimed', 'for {n} {unit}']
});

/**
 * @param {{ window: { unit: string, value: number } }} activation a sanitised `activationOf` result
 * @param {(key: string, fallback: string, data?: object) => string} translate
 * @param {string} keyPrefix the lang key prefix the caller's catalogue keeps the `Window*` phrases under (`COG.Activation.`)
 * @returns {string}
 */
export function activationWindowPhrase(activation, translate, keyPrefix) {
  const { unit, value } = activation.window;
  const phrase = (shape, data) => translate(`${keyPrefix}${ACTIVATION_PHRASES[shape][0]}`, ACTIVATION_PHRASES[shape][1], data);
  if (unit === 'combat') return phrase('combat');
  if (unit === 'use') return value <= 1 ? phrase('oneUse') : phrase('uses', { n: value });
  if (unit === 'hit') return value <= 1 ? phrase('oneHit') : phrase('hits', { n: value });
  return phrase('timed', { n: value, unit });
}
