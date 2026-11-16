/**
 * Sprinter RPG: the Create Pet modal (ApplicationV2). It drafts a pet spec in memory and hands it to `buildPetPayload`;
 * create-only, no reverse hydration (GEMINI Principle 3). Roles, Levels and links are edited on the pet sheet afterwards.
 */
import { COGToolApp } from './tool-app.mjs';
import { SYSTEM_PATH } from '../constants.mjs';
import { buildPetPayload } from '../data/pet-builder.mjs';
import { petAttitudeOptions, petOriginOptions, DEFAULT_PET_ATTITUDE, DEFAULT_PET_ORIGIN } from '../data/rules/pet-rules.mjs';
import { sizeOptions } from '../data/sizes.mjs';

export class COGPetCreatorApp extends COGToolApp {
  static DEFAULT_OPTIONS = {
    id: 'cog-pet-creator',
    classes: ['cog-sheet-window', 'cog-pet-creator-window'],
    window: { title: 'Sprinter RPG: Create Pet', icon: 'fa-solid fa-paw', resizable: true },
    position: { width: 480, height: 'auto' },
    actions: {
      setField: COGPetCreatorApp.#onSetField,
      createPet: COGPetCreatorApp.#onCreatePet
    }
  };

  static PARTS = {
    form: { template: `${SYSTEM_PATH}/templates/apps/pet-creator/form.hbs` }
  };

  constructor(options = {}) {
    super(options);
    /** The draft spec. A blank size means the default of the kind: Large for a dedicated mount, else the schema default. */
    this.spec = { name: '', size: '', creatureType: 'Beast', attitude: DEFAULT_PET_ATTITUDE, origin: DEFAULT_PET_ORIGIN, isMount: false };
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.spec = this.spec;
    context.sizeOptions = [{ value: '', label: 'Default for the kind', selected: !this.spec.size }, ...sizeOptions(this.spec.size)];
    context.attitudeOptions = petAttitudeOptions(this.spec.attitude);
    context.originOptions = petOriginOptions(this.spec.origin);
    return context;
  }

  /** Store a control's value on the draft: a checkbox its state, anything else its text. */
  static async #onSetField(event, target) {
    const prop = target.dataset.prop;
    if (!prop) return;
    this.spec[prop] = target.type === 'checkbox' ? target.checked === true : target.value;
    await this.render({ parts: ['form'] });
  }

  static async #onCreatePet() {
    return this.createPet();
  }

  /** Create the unlinked pet from the draft, open its sheet and close the modal. */
  async createPet() {
    const actor = await globalThis.Actor.create(buildPetPayload(this.spec));
    globalThis.ui?.notifications?.info?.(`Created Pet: ${actor?.name ?? this.spec.name}`);
    actor?.sheet?.render?.({ force: true });
    await this.close();
    return actor;
  }
}
