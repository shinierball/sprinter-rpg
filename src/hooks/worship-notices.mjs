/**
 * The GM notice for rival worshippers (p. 164): when a token whose actor worships a rival of a god a player's crawler
 * worships appears on a scene, or such a crawler starts worshipping while those tokens are on the viewed scene, the
 * active GM gets one whisper. Plain text; the token's disposition is never touched.
 */
import { isActiveGM } from '../utils/gm-relay.mjs';
import { collectActorTags } from '../documents/active-tags.mjs';
import { godsFromTags, rivalNoticeLines, rivalsLookup } from '../utils/deity/rivals.mjs';
import { deityLabel, deityRecords } from '../utils/deity/deity-names.mjs';
import { isWorshipBond } from '../utils/deity/worship-state.mjs';
import { gmWhisper, say } from '../documents/actor/vehicle-drive-common.mjs';
import { escapeAttr } from '../utils/escape-attr.mjs';

const LINE = ['COG.Deity.Rivals.Line', '{token} worships {god}, a rival of {rival} (worshipped by {crawler})'];
const TITLE = ['COG.Deity.Rivals.Title', 'Rival worshippers'];

const godsOf = (actor) => godsFromTags(collectActorTags(actor));
const playerCrawlers = () => Array.from(globalThis.game?.actors ?? [])
  .filter((a) => a?.type === 'crawler' && a.hasPlayerOwner === true)
  .map((a) => ({ actor: a, name: a.name, gods: godsOf(a) }))
  .filter((c) => c.gods.length);

/** The notice lines for some tokens against the player crawlers. */
function linesFor(tokens, crawlers) {
  const records = deityRecords([...tokens.map((t) => t.actor), ...crawlers.map((c) => c.actor)]);
  const rivalsOf = rivalsLookup(records);
  const text = { label: (g) => deityLabel(records, g), format: (d) => say(LINE[0], LINE[1], d) };
  return tokens.flatMap((t) => rivalNoticeLines({ tokenName: t.name, tokenGods: godsOf(t.actor), crawlers }, rivalsOf, text));
}

async function whisper(lines) {
  if (!lines.length || typeof globalThis.ChatMessage?.create !== 'function') return null;
  const body = lines.map((l) => `<div class="cog-text-muted">${escapeAttr(l)}</div>`).join('');
  const content = `<div class="cog-chat-card cog-worship-card"><header class="cog-card-header"><h3><i class="fa-solid fa-hands-praying"></i> ${escapeAttr(say(TITLE[0], TITLE[1]))}</h3></header><div class="cog-card-body">${body}</div></div>`;
  return globalThis.ChatMessage.create({ content, whisper: gmWhisper() });
}

/** `createToken`: a non-crawler token that worships a rival of a player's god. */
async function onTokenCreated(tokenDoc) {
  if (!isActiveGM()) return;
  const actor = tokenDoc?.actor;
  if (!actor || actor.type === 'crawler') return;
  const crawlers = playerCrawlers();
  if (!crawlers.length) return;
  await whisper(linesFor([{ name: tokenDoc.name || actor.name, actor }], crawlers));
}

const startedWorship = (changes) => (changes?.system?.bond?.status ?? changes?.['system.bond.status']) === 'worshipper';

/** `updateItem`: a player's crawler started worshipping; scan the viewed scene's tokens. */
async function onDeityUpdated(item, changes) {
  if (!isActiveGM() || item?.type !== 'deity' || !startedWorship(changes) || !isWorshipBond(item)) return;
  const actor = item.parent;
  if (actor?.type !== 'crawler' || actor.hasPlayerOwner !== true) return;
  const tokens = Array.from(globalThis.canvas?.scene?.tokens ?? [])
    .filter((t) => t?.actor && t.actor.type !== 'crawler')
    .map((t) => ({ name: t.name || t.actor.name, actor: t.actor }));
  if (!tokens.length) return;
  await whisper(linesFor(tokens, [{ actor, name: actor.name, gods: godsOf(actor) }]));
}

let registered = false;
/** Once, from the ready hook. */
export function registerWorshipNoticeHooks() {
  if (registered) return;
  registered = true;
  globalThis.Hooks?.on?.('createToken', (tokenDoc) => onTokenCreated(tokenDoc));
  globalThis.Hooks?.on?.('updateItem', (item, changes) => onDeityUpdated(item, changes));
}
