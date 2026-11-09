/**
 * The rows of one enchantment template (3.15 S6a) shown through the item sheet's own row editors.
 *
 * A template (a blueprint's `system.blueprint.enchantments.N`, or one inside an `enchant_item` outcome row,
 * `system.outcomes.K.enchantments.N`) carries `rows.<array>` with the row shapes the item's own arrays use. The sheet edits
 * them with a {@link TemplateRowsHost}: an item-shaped adapter, in the Perk Rows Host's pattern, whose `system` projects the
 * template's rows onto the real schema. `buildRowEditorContext`, `ROW_ACTIONS` and `PICK_LIST_ACTIONS` then run against it
 * unchanged, and `update()` writes the cleaned rows back to the real item at the template's path.
 */
import { damageModifiersField, defenseModifiersField, rollModifiersField, asTriggersField } from '../../models/fields/modifier-fields.mjs';
import { grantsField } from '../../models/fields/grant-fields.mjs';
import { ENCHANTMENT_ROW_ARRAYS } from '../../utils/loot/outcome-defaults.mjs';
import { trimGrantRow } from './grant-row-fields.mjs';
import { toArray } from './util.mjs';

const clone = (value) => foundry.utils.deepClone(value);
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The `rows` arrays of a template the sheet edits (its Amazing Success triggers included). */
export const TEMPLATE_ROW_KEYS = ENCHANTMENT_ROW_ARRAYS;

let hostSchema = null;

/** The schema fields the host presents as `system`: the item's own row fields, so the editors build the same inputs. */
function hostFields() {
  if (hostSchema) return hostSchema;
  const fields = foundry.data.fields;
  hostSchema = {
    damageModifiers: damageModifiersField(fields),
    defenseModifiers: defenseModifiersField(fields),
    attackModifiers: rollModifiersField(fields),
    checkModifiers: rollModifiersField(fields),
    grants: grantsField(fields),
    asTriggers: asTriggersField(fields)
  };
  return hostSchema;
}

class TemplateRowsSystem {
  static get schema() {
    return { fields: hostFields() };
  }
}

/** The plain data of an item (a copy). */
const plainSource = (item) => (typeof item?.toObject === 'function' ? item.toObject() : clone(item ?? {}));

/** The value at a dotted `system.…` path of an item's stored data (a copy), or undefined. */
export function readAtPath(item, path) {
  return foundry.utils.getProperty(plainSource(item), path);
}

/**
 * Write `value` at a dotted `system.…` path inside an array or object field. A dotted update into an array is not safe on a
 * real document, so the top-level field the path starts in (`system.blueprint`, `system.outcomes`) is cloned, changed and
 * written back whole.
 * @returns {Promise<*>} the update result
 */
export async function writeAtPath(item, path, value) {
  const segments = String(path).split('.');
  const top = segments.slice(0, 2).join('.');
  const rest = segments.slice(2).join('.');
  if (!rest) return item.update({ [top]: value });
  const current = foundry.utils.getProperty(plainSource(item), top);
  const copy = clone(current ?? (Number.isInteger(Number(segments[2])) ? [] : {}));
  foundry.utils.setProperty(copy, rest, value);
  return item.update({ [top]: copy });
}

/** Clean one key's rows through its schema field (a grant row keeps only the fields its kind and mode show). */
function cleanKey(key, value) {
  const rows = hostFields()[key].clean(clone(toArray(value).filter(isPlain)));
  return key === 'grants' ? rows.map(trimGrantRow) : rows;
}

/**
 * An item-shaped view of one template's rows. `update({ 'system.<key>': rows })` (or a dotted path inside it) cleans the key
 * and writes it to `<templatePath>.rows.<key>` on the real item.
 */
export class TemplateRowsHost {
  /**
   * @param {object} item the real item
   * @param {string} templatePath dotted path of the template, e.g. `system.blueprint.enchantments.0`
   */
  constructor(item, templatePath) {
    this.item = item;
    this.templatePath = templatePath;
    this.id = `template-rows-${item?.id ?? ''}`;
    this.type = item?.type;
    this.system = new TemplateRowsSystem();
    const stored = readAtPath(item, `${templatePath}.rows`);
    for (const key of TEMPLATE_ROW_KEYS) this.system[key] = clone(toArray(stored?.[key]));
  }

  async update(changes) {
    const touched = new Set();
    for (const [path, value] of Object.entries(changes ?? {})) {
      if (!path.startsWith('system.')) continue;
      const rest = path.slice('system.'.length);
      const key = rest.split('.')[0];
      if (!TEMPLATE_ROW_KEYS.includes(key)) continue;
      touched.add(key);
      if (rest === key) this.system[key] = cleanKey(key, value);
      else foundry.utils.setProperty(this.system, rest, value);
    }
    for (const key of touched) {
      this.system[key] = cleanKey(key, this.system[key]);
      await writeAtPath(this.item, `${this.templatePath}.rows.${key}`, clone(this.system[key]));
    }
  }
}
