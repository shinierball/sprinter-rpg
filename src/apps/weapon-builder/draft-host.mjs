/**
 * The weapon builder's draft: an item-shaped host (the contract of `src/sheets/item/row-host.mjs`) over an unsaved gear
 * `system`, so the gear sheet's weapon partials and actions (`WEAPON_ACTIONS`, `LIST_ACTIONS`, `ROW_ACTIONS`,
 * `TAG_ACTIONS`, `FINDING_ACTIONS`) run against it unchanged. Nothing is created from here: the window turns the draft
 * into a spec and hands it to `createFromSpec`.
 *
 * `system` is a standalone gear DataModel, so the real schema cleans every write and `system.constructor.schema` is the
 * schema the row editors and form processing read.
 */
import { getItemAllTags } from '../../documents/active-tags.mjs';
import { startWeaponDraft } from '../../data/builders/weapon-spec.mjs';

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export class WeaponDraftHost {
  /**
   * @param {object} [seed] a partial gear spec (`{ name, img, system }`)
   * @param {{ onChange?: Function }} [options] `onChange` runs after every update (the window re-renders)
   */
  constructor(seed = {}, { onChange = null } = {}) {
    const draft = startWeaponDraft(seed);
    const Model = globalThis.CONFIG.Item.dataModels.gear;
    this.id = 'weapon-draft';
    this.uuid = '';
    this.type = 'gear';
    this.documentName = 'Item';
    this.name = String(draft.name ?? '');
    this.img = String(draft.img ?? '');
    this.flags = {};
    this.actor = null;
    this.parent = null;
    this.pack = null;
    this.isOwner = true;
    this.system = new Model(draft.system);
    this._onChange = onChange;
  }

  /** Every tag the draft carries: its own and the ones the engine derives. */
  get allTags() {
    return getItemAllTags(this);
  }

  /** The draft as a document-shaped object (`system` in full, so every field has its value). */
  toObject() {
    return { _id: this.id, name: this.name, type: this.type, img: this.img, system: this.system.toObject(true) };
  }

  /** The draft as the spec `createFromSpec('weapon', spec)` takes: a blank name or image is left to the builder's defaults. */
  toSpec() {
    const { name, img, system } = this.toObject();
    return { ...(name.trim() ? { name } : {}), ...(img ? { img } : {}), system };
  }

  /**
   * Apply changes the way `Document#update` takes them: dotted paths (`system.tags`, `name`) or a nested `system`.
   * @param {object} changes
   * @returns {Promise<WeaponDraftHost>}
   */
  async update(changes = {}) {
    for (const [path, value] of Object.entries(changes)) {
      if (path === 'name') this.name = String(value ?? '');
      else if (path === 'img') this.img = String(value ?? '');
      else if (path === 'system' && isPlain(value)) this.system.updateSource(value);
      else if (path.startsWith('system.')) this.system.updateSource({ [path.slice('system.'.length)]: value });
    }
    await this._onChange?.(this);
    return this;
  }
}
