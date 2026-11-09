/**
 * Tag actions: explicit tags, rank-gated tags and the tag-query editors (a technique's `appliesToQuery`,
 * the `condition` of a modifier row). Every handler runs with `this` = the item sheet.
 */
import { COGTagManager } from '../../apps/tag-manager.mjs';
import { RANK_BREAK_THRESHOLDS, roleTag } from '../../data/tag-vocabulary.mjs';
import { getTagDefinition, registerCustomTag } from '../../data/tag-definitions.mjs';
import { slugifyIdentifier } from '../../utils/identifier.mjs';
import { rankBreakFillPatch } from '../../apps/rank-break-parser.mjs';
import { getAvailableDebuffs } from './catalogs.mjs';
import { normalizeTagList } from '../../utils/tag/tag-query.mjs';
import { composeQueryTag } from './context-query.mjs';
import { queryBucketsAt } from './util.mjs';
import { addTagFromInput, removeTagFromDocument } from '../base/tag-editor.mjs';

export { addTagFromInput };

/** The stored bucket (a copy) at a query path, or null when the path or bucket is not an editable query. */
function readBucket(item, path, bucket) {
  if (!queryBucketsAt(item, path)?.includes(bucket)) return null;
  const query = foundry.utils.getProperty(item, path);
  return Array.isArray(query?.[bucket]) ? [...query[bucket]] : [];
}

/**
 * Write one bucket. A query inside a row array is written by cloning the top-level array the path passes through,
 * setting the bucket in the clone and writing the whole array back (a null query becomes `{}` first); any other query
 * writes its own path.
 */
async function writeBucket(item, path, bucket, ids) {
  const segments = path.split('.');
  let field = { fields: item.system.constructor.schema.fields };
  let arrayDepth = -1;
  for (let i = 1; i < segments.length && arrayDepth < 0; i++) {
    field = field?.fields?.[segments[i]];
    if (field?.element) arrayDepth = i;
  }
  if (arrayDepth < 0) return item.update({ [`${path}.${bucket}`]: ids });
  const arrayPath = segments.slice(0, arrayDepth + 1).join('.');
  const rest = segments.slice(arrayDepth + 1).join('.');
  const rows = foundry.utils.deepClone(foundry.utils.getProperty(item, arrayPath) ?? []);
  if (foundry.utils.getProperty(rows, segments[arrayDepth + 1]) === undefined) return null;
  // An optional query (a grant row's) is null until first edited: start it as an empty object.
  if (foundry.utils.getProperty(rows, rest) == null) foundry.utils.setProperty(rows, rest, {});
  foundry.utils.setProperty(rows, `${rest}.${bucket}`, ids);
  return item.update({ [arrayPath]: rows });
}

/**
 * Add a tag ID to a bucket of a tag query (a technique's `appliesToQuery`, or a modifier row's `condition`).
 * Any non-empty ID is accepted, custom and `id.<type>.<identifier>` tags included; the editor flags unregistered ones.
 * @param {COGItem} item
 * @param {string} path e.g. `system.appliesToQuery` or `system.damageModifiers.2.condition`
 * @param {'all'|'any'|'none'} bucket
 * @param {string} tagId
 * @param {string} [role] 'action' (default, unprefixed), 'self', 'subject' or 'attacker': prefixes the tag with the
 *   role (a tag that already carries a role prefix is added as typed and the role is ignored)
 * @returns {Promise<boolean>} true when the item changed
 */
export async function addQueryTag(item, path, bucket, tagId, role = 'action') {
  const id = composeQueryTag(tagId, role, roleTag).id;
  const current = id ? readBucket(item, path, bucket) : null;
  if (!current || current.includes(id)) return false;
  current.push(id);
  return Boolean(await writeBucket(item, path, bucket, current));
}

/**
 * Remove a tag ID from a bucket of a tag query.
 * @returns {Promise<boolean>} true when the item was updated
 */
export async function removeQueryTag(item, path, bucket, tagId) {
  const current = readBucket(item, path, bucket);
  if (!current) return false;
  return Boolean(await writeBucket(item, path, bucket, current.filter((t) => t !== tagId)));
}

/** The id of a new situation tag from its label: `situation.` plus the label as lower-case words joined by `_`. */
export function situationTagId(label) {
  const slug = slugifyIdentifier(label).replaceAll('-', '_');
  return slug ? `situation.${slug}` : '';
}

/** Warn that a role chosen on a role-prefixed tag was ignored (spec 8.2 `DoubleRole`). */
function warnDoubleRole() {
  ui.notifications?.warn(game.i18n.localize('COG.Rows.Badge.DoubleRole'));
}

/** Ask for a situation label with a DialogV2 prompt; null when cancelled or empty. */
async function promptSituationLabel() {
  const DialogV2 = foundry.applications.api.DialogV2;
  const result = await DialogV2.prompt({
    window: { title: game.i18n.localize('COG.Rows.Query.NewSituation') },
    content: `<label>${game.i18n.localize('COG.Rows.Query.SituationLabel')} <input type="text" name="label" autofocus></label>`,
    ok: {
      label: game.i18n.localize('COG.Rows.Query.Add'),
      callback: (_event, button) => String(button?.form?.elements?.label?.value ?? '').trim()
    },
    rejectClose: false,
    modal: true
  });
  return typeof result === 'string' && result ? result : null;
}

export const TAG_ACTIONS = {
  openTagManager() {
    new COGTagManager({ item: this.item }).render({ force: true });
  },

  async removeTag(event, target) {
    if (!this.isEditable) return;
    await removeTagFromDocument(this.item, target.dataset.tagId);
  },

  async addTag(event, target) {
    if (!this.isEditable) return;
    await addTagFromInput(this.item, target.closest('[data-tag-entry]')?.querySelector('input, select'));
  },

  /** Change action on an unnamed rank-break tag input (`data-rank-break="rank5"`). */
  async setRankBreakTags(event, target) {
    if (!this.isEditable) return;
    const key = target.dataset.rankBreak;
    if (!Object.hasOwn(RANK_BREAK_THRESHOLDS, key)) return;
    await this.item.update({ [`system.rankBreaks.${key}.tags`]: normalizeTagList(target.value) });
  },

  /**
   * Authoring action: parse the item's upgrade text once and fill only the empty rank-break inputs.
   * The result stays in the form for review; nothing is saved until the author submits.
   */
  async parseRankBreaks(event, target) {
    if (!this.isEditable) return;
    const debuffs = await getAvailableDebuffs();
    const patch = rankBreakFillPatch(this.item.system.rankBreaks, this.item.system.upgrades, debuffs.map((d) => ({ name: d.name, identifier: d.system?.identifier ?? '' })));
    let filled = 0;
    for (const [name, value] of Object.entries(patch)) {
      const input = this.element.querySelector(`[name="${name}"]`);
      if (!input || (input.value !== '' && Number(input.value) !== 0) || input.type === 'checkbox') continue;
      input.value = String(value);
      if (input.value !== String(value)) continue; // a select without that option stays as it was
      filled += 1;
    }
    ui.notifications.info(filled
      ? `Filled ${filled} empty rank-break field(s) from the upgrade text. Review them, then save.`
      : 'No empty rank-break fields could be filled from the upgrade text.');
  },

  /** Add the custom ID typed in the editor row, or else the selected registered tag. */
  async addQueryTag(event, target) {
    if (!this.isEditable) return;
    const row = target.closest('.cog-applies-query-row');
    const custom = row?.querySelector('input.cog-query-custom');
    const choice = String(custom?.value ?? '').trim() || row?.querySelector('select.cog-query-tag')?.value;
    const role = row?.querySelector('select.cog-query-role')?.value ?? 'action';
    if (composeQueryTag(choice, role, roleTag).doubleRole) warnDoubleRole();
    if (await addQueryTag(this.item, target.dataset.path, target.dataset.bucket, choice, role) && custom) custom.value = '';
  },

  /**
   * GM only: register a new `situation.*` custom tag from a label and add it to the bucket. A situation tag that is
   * already registered is added without re-registering. Players have no button; a typed id shows the unregistered flag.
   */
  async createSituationTag(event, target) {
    if (!this.isEditable || !game.user?.isGM) return;
    const label = await promptSituationLabel();
    const id = label ? situationTagId(label) : '';
    if (!id) return;
    if (!getTagDefinition(id)) await registerCustomTag({ id, label, namespace: 'situation' });
    const role = target.closest('.cog-applies-query-row')?.querySelector('select.cog-query-role')?.value ?? 'action';
    if (composeQueryTag(id, role, roleTag).doubleRole) warnDoubleRole();
    await addQueryTag(this.item, target.dataset.path, target.dataset.bucket, id, role);
  },

  async removeQueryTag(event, target) {
    if (!this.isEditable) return;
    await removeQueryTag(this.item, target.dataset.path, target.dataset.bucket, target.dataset.tag);
  }
};
