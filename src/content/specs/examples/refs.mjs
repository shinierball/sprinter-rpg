/**
 * src/content/specs/examples/refs.mjs
 * Committed ids and identifiers of the 3.4 example documents, plus the
 * two tags the examples need registered (the module tag of section 3 row `tagrows:rule-rows` and the custom situation
 * of row `roll:custom-situation`). The shiny content provider (src/content/shiny-content-provider.mjs) registers
 * the tags; build:packs and the tests register them before compiling.
 *
 * Reference rule (section 4): an example never names another document. A field whose reader accepts a
 * `system.identifier` gets the identifier (it survives a world import that drops `_id`s); the loot `buff`/`debuff`
 * outcomes, whose reader matches `_id` only, get the `_id`; actor links (`ownerId`, ...) get the actor `_id`
 * and work after an "import with ids" of the examples-actors pack. Ids are 16 characters, prefix `dccex`, and the
 * first ten differ per document so build:packs' embedded-item ids (parent head + counter) never collide.
 */
import { SYSTEM_ID } from '../../../constants.mjs';

const item = (n) => `dccexi${String(n).padStart(2, '0')}00000000`;
const actor = (n) => `dccexa${String(n).padStart(2, '0')}00000000`;

/** Item ids (examples-items pack). */
export const EXAMPLE_ITEM_IDS = Object.freeze({
  'studio-audience-approval': item(1),
  'viral-moment': item(2),
  'stage-fright': item(3),
  'wardrobe-malfunction': item(4),
  'crowd-warmer': item(5),
  'take-one-for-the-ratings': item(6),
  'studio-slapfight': item(7),
  'novelty-mallet-handling': item(8),
  'hostile-interview': item(9),
  'union-rate-medic': item(10),
  'steadicam-instincts': item(11),
  'curtain-call': item(12),
  'confetti-cannon': item(13),
  'laser-pointer-of-judgment': item(14),
  'sponsored-padding': item(15),
  'fog-machine-malfunction': item(16),
  'objection-sustained': item(17),
  'laugh-track-therapy': item(18),
  'spotlight-hog': item(19),
  'regulation-novelty-mallet': item(20),
  't-shirt-cannon': item(21),
  'breakaway-sequin-vest': item(22),
  'lucky-contestant-lanyard': item(23),
  'mystery-box-remote': item(24),
  'branded-earpiece': item(25),
  'cue-light-headset': item(26),
  'sponsor-approved-energy-drink': item(27),
  'grab-bag-of-regret': item(28),
  'ratings-booster-shot': item(29),
  'cue-card-of-combustion': item(30),
  'clicker-of-mild-inconvenience': item(31),
  'instant-loser-scratch-ticket': item(32),
  'static-gremlin': item(33),
  'hype-man': item(34),
  'the-showrunner': item(35),
  'snackfront-megacorp': item(36),
  'participation-trophy': item(37),
  'rehearsal-room': item(38),
  'velvet-rope-barricade': item(39),
  'squib-charge': item(40),
  'red-carpet-rollout': item(41),
  'warding-lantern': item(42),
  'mirror-sequin-cape': item(43)
});

/** Actor ids (examples-actors pack). */
export const EXAMPLE_ACTOR_IDS = Object.freeze({
  'contestant-zero': actor(1),
  'green-room': actor(2),
  'overcaffeinated-stagehand': actor(3),
  'the-floor-manager': actor(4),
  'clipboard-intern': actor(5),
  'applause-llama': actor(6),
  'prize-showcase-golf-cart': actor(7),
  'off-brand-bodyguard': actor(8),
  'retired-game-show-host': actor(9)
});

/** RollTable ids (examples-tables pack). */
export const EXAMPLE_TABLE_IDS = Object.freeze({
  'consolation-prizes': 'dccext0100000000'
});

/** The compendium UUID of an example document. */
export const exampleUuid = (pack, documentName, id) => `Compendium.${SYSTEM_ID}.${pack}.${documentName}.${id}`;

/** A world Actor UUID for an example actor (valid once the examples-actors pack is imported with its ids). */
export const exampleActorUuid = (key) => `Actor.${EXAMPLE_ACTOR_IDS[key]}`;

/**
 * The module tag the Cue Light Headset carries (a registered tag with `rows` and a rule flag). The
 * same definition as the E8.2 engine fixture (tests/fixtures/examples/engine-examples.mjs), shipped here.
 */
export const EXAMPLE_CUE_LIGHT_TAG = Object.freeze({
  id: 'studio-props.cue-light',
  label: 'Cue Light',
  namespace: 'rule',
  description: 'While the cue light is on, you hit a little more often, and nobody can step in front of your attacks.',
  rows: Object.freeze({
    attackModifiers: Object.freeze([Object.freeze({ kind: 'bonus', label: 'Cue light', value: 2 })])
  }),
  flags: Object.freeze(['no-redirect'])
});

/** The custom situation Hostile Interview's row reads (E7.2: a `situation.*` offered as a toggle on the roll dialog). */
export const EXAMPLE_LIVE_AUDIENCE_TAG = Object.freeze({
  id: 'situation.live_audience',
  label: 'Live Audience',
  namespace: 'situation',
  description: 'A studio audience is watching. Some things go better in front of a crowd.'
});

/** The table attachment the Hot Glue Holster carries: a blueprint's `tables` query can require it, and its rows speed up crafts. */
export const EXAMPLE_GLUE_HOLSTER_TAG = Object.freeze({
  id: 'crafting.attachment.glue_holster',
  label: 'Glue Holster',
  namespace: 'crafting',
  description: 'A table attachment: the glue gun is always within reach, so props take less time.'
});

/** The recipe the Backlit Trim blueprint carries: a locked recipe, opened by a studio row whose condition names this tag. */
export const EXAMPLE_SIGNAGE_RECIPE_TAG = Object.freeze({
  id: 'crafting.recipe.signage',
  label: 'Signage Recipe',
  namespace: 'crafting',
  description: 'A locked recipe: a crafting table will not take a blueprint with this tag until a studio\'s unlock row names it.'
});

/** The tag the Loot Boxes choice example queries: gear that is a souvenir of the show. */
export const EXAMPLE_SOUVENIR_TAG = Object.freeze({
  id: 'prize.souvenir',
  label: 'Souvenir',
  namespace: 'prize',
  description: 'Merchandise from the show. It is a keepsake first and equipment second.'
});

/** Every tag the examples need registered, as fresh copies (registerTag stores what it is given). */
export function exampleTagDefinitions() {
  return [
    { ...EXAMPLE_CUE_LIGHT_TAG, rows: structuredClone(EXAMPLE_CUE_LIGHT_TAG.rows), flags: [...EXAMPLE_CUE_LIGHT_TAG.flags] },
    { ...EXAMPLE_LIVE_AUDIENCE_TAG },
    { ...EXAMPLE_GLUE_HOLSTER_TAG },
    { ...EXAMPLE_SIGNAGE_RECIPE_TAG },
    { ...EXAMPLE_SOUVENIR_TAG }
  ];
}
