/**
 * A pet's role and special abilities (core book pp. 231-232). A role is a permanent buff on the pet tagged `pet.role.<id>`; an
 * ability is a permanent buff tagged `pet.ability.<id>`. What each does is the buff's own rows (DR by Floor, bonus damage, a
 * `moveSet` Move, a resistance), so a homebrew role is one `PET_ROLES` entry and one buff. A pet has one role (changing it asks
 * a Rule Break), the role's number of abilities and one more from Level 15; picking more asks a Rule Break. A dedicated mount has
 * none. Nothing here blocks (Directive 2).
 */
import { PET_ROLES, PET_MATURE_LEVEL, isAbilityTags, petAbilityPicks, roleIdFromTags } from '../../data/rules/pet-rules.mjs';
import { findCatalogEntry } from '../../content/catalog-lookup.mjs';
import { confirmRuleBreak, withRuleBreak } from '../../utils/rule-break.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { ownerAndGmIds } from '../../utils/owner-recipients.mjs';
import { speakerOf } from './vehicle-drive-common.mjs';

/** The pet's buff items. */
const buffsOf = (pet) => Array.from(pet?.items ?? []).filter((item) => item?.type === 'buff');

const isMount = (pet) => pet?.system?.details?.isMount === true;
const levelOf = (pet) => Number(pet?.system?.details?.level) || 1;

/**
 * The role and special abilities a pet carries, read from its buffs' tags (never their names).
 * @param {Actor} pet
 * @returns {{ role: string|null, roleItems: Item[], abilities: Item[] }}
 */
function roleOf(pet) {
  const roleItems = [];
  const abilities = [];
  for (const item of buffsOf(pet)) {
    const tags = item.system?.tags ?? [];
    if (roleIdFromTags(tags)) roleItems.push(item);
    else if (isAbilityTags(tags)) abilities.push(item);
  }
  return { role: roleItems.length ? roleIdFromTags(roleItems[0].system?.tags) : null, roleItems, abilities };
}

/**
 * How many special abilities the pet may still pick: its role's, plus the Level 15 pick, less those it has.
 * @param {Actor} pet
 * @returns {number} 0 or more
 */
function rolePicksLeft(pet) {
  const { role, abilities } = roleOf(pet);
  return Math.max(0, petAbilityPicks({ role, level: levelOf(pet), isMount: isMount(pet) }) - abilities.length);
}

/** Creation data for the pet's copy of a buff: no id, active (a permanent buff only counts while active). */
function buffCopy(source) {
  const data = typeof source?.toObject === 'function' ? source.toObject() : structuredClone(source);
  delete data._id;
  delete data.id;
  data.type = 'buff';
  data.system = { ...(data.system ?? {}), active: true };
  return data;
}

/** The buff data a role id names: the catalog buff whose identifier the registry gives it. */
function roleBuffData(roleId) {
  const def = PET_ROLES[roleId];
  return def ? findCatalogEntry('buffs', def.buff) : null;
}

const say = (message) => globalThis.ui?.notifications?.warn?.(message);

/**
 * Give a pet its role: embed the role's buff. A pet that already has a role asks a Rule Break (the book gives it one choice); on
 * confirm the old role buff is replaced. A dedicated mount takes no role.
 * @param {Actor} pet
 * @param {string|object} source a registered role id (its buff is read from the catalog), or the role buff's data (tagged `pet.role.<id>`)
 * @param {{ options?: object }} [params]
 * @returns {Promise<Item|null>} the embedded buff, or null when nothing was embedded
 */
export async function applyPetRole(pet, source, { options } = {}) {
  if (!pet || pet.type !== 'pet' || isMount(pet)) return null;
  const roleId = typeof source === 'string' ? source : roleIdFromTags(source?.system?.tags);
  if (!roleId || !Object.hasOwn(PET_ROLES, roleId)) return null;
  const data = typeof source === 'string' ? roleBuffData(roleId) : source;
  if (!data) {
    say(`No catalog buff for the ${PET_ROLES[roleId].label} role (identifier ${PET_ROLES[roleId].buff}).`);
    return null;
  }
  const { role, roleItems } = roleOf(pet);
  let ruleBreak = false;
  if (role) {
    const question = `${pet.name || 'This pet'} is already a ${PET_ROLES[role]?.label ?? role} pet; a pet has one role. Change it anyway as a Rule Break?`;
    const verdict = await confirmRuleBreak({ title: 'Pet role', message: escapeAttr(question), reason: question, options });
    if (!verdict.confirmed) return null;
    ruleBreak = true;
    await pet.deleteEmbeddedDocuments('Item', roleItems.map((item) => item.id));
  }
  const copy = buffCopy(data);
  const [created] = (await pet.createEmbeddedDocuments('Item', [ruleBreak ? withRuleBreak(copy, 'Changed a pet role') : copy])) ?? [];
  return created ?? null;
}

/**
 * Give a pet a special ability: embed the buff. Past the pet's picks it asks a Rule Break. A dedicated mount asks too (it has
 * none), and a buff that is not tagged `pet.ability.<id>` is refused.
 * @param {Actor} pet
 * @param {object} source the ability buff's data (tagged `pet.ability.<id>`)
 * @param {{ options?: object }} [params]
 * @returns {Promise<Item|null>}
 */
export async function addPetAbility(pet, source, { options } = {}) {
  if (!pet || pet.type !== 'pet' || !source || !isAbilityTags(source.system?.tags)) return null;
  let ruleBreak = false;
  if (rolePicksLeft(pet) <= 0) {
    const question = `${pet.name || 'This pet'} has no special ability picks left. Add ${source.name || 'this ability'} anyway as a Rule Break?`;
    const verdict = await confirmRuleBreak({ title: 'Pet ability', message: escapeAttr(question), reason: question, options });
    if (!verdict.confirmed) return null;
    ruleBreak = true;
  }
  const copy = buffCopy(source);
  const [created] = (await pet.createEmbeddedDocuments('Item', [ruleBreak ? withRuleBreak(copy, 'Past the pet ability picks') : copy])) ?? [];
  return created ?? null;
}

/**
 * What the pet sheet's role block shows. `show` is false for a dedicated mount.
 * @param {Actor} pet
 * @returns {{ show: boolean, role: string|null, roleLabel: string, hasRole: boolean, abilities: { id: string, name: string }[], picksLeft: number, matureNote: string }}
 */
export function petRoleView(pet) {
  const { role, abilities } = roleOf(pet);
  const roleLabel = role ? (PET_ROLES[role]?.label ?? role) : '';
  const mature = levelOf(pet) >= PET_MATURE_LEVEL;
  return {
    show: !isMount(pet),
    role,
    roleLabel,
    roleBadge: roleLabel.toUpperCase(),
    hasRole: Boolean(role),
    abilities: abilities.map((item) => ({ id: item.id, name: item.name })),
    picksLeft: rolePicksLeft(pet),
    matureNote: mature ? `Level ${PET_MATURE_LEVEL}: one extra special ability` : ''
  };
}

/**
 * The first-Bonded prompt: a card to the pet's owners and the GMs with a button that opens the role picker. Posted once by the
 * settle step when a pet first becomes Bonded without a role.
 * @param {Actor} pet
 * @returns {Promise<ChatMessage|null>}
 */
export async function postRolePrompt(pet) {
  if (!pet || isMount(pet) || roleOf(pet).role || typeof globalThis.ChatMessage?.create !== 'function') return null;
  const owner = pet.getOwnerActor?.() ?? null;
  const name = escapeAttr(pet.name || 'This pet');
  const content = `<div class="cog-chat-card cog-pet-role-card">
    <header class="cog-card-header"><h3><i class="fa-solid fa-paw"></i> Choose a role</h3></header>
    <div class="cog-card-body"><div class="cog-text-muted">${name} is now Bonded. A pet has one role: Tank, Aggressive or Utility.</div>
    <div class="cog-card-actions"><button type="button" class="cog-btn" data-action="crawlerChoosePetRole" data-actor-uuid="${escapeAttr(pet.uuid)}"><i class="fa-solid fa-paw"></i> Choose role</button></div></div>
  </div>`;
  return globalThis.ChatMessage.create({ content, speaker: speakerOf(pet), whisper: ownerAndGmIds([pet, owner]) });
}
