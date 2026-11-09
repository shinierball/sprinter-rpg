/**
 * Authorship dialog (7.16e, GM): three radio choices for who wrote the words of a document, written to
 * `flags.sprinter-rpg.source.authorship`. Opened by the "Authorship…" window control of the item and actor sheets.
 * The write passes `cogAuthorship: false`, so a GM's choice is never turned into `edited` by the edit hook.
 */
import { COGToolApp } from './tool-app.mjs';
import { SYSTEM_ID, SYSTEM_PATH } from '../constants.mjs';
import { contentRegistry } from '../content/registry.mjs';
import { readSourceStamp } from '../utils/content-source.mjs';
import { worldStamp } from '../hooks/stamp-new-documents.mjs';

const t = (key, data) => {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data && typeof i18n.format === 'function' ? i18n.format(key, data) : i18n.localize(key);
};

export class COGAuthorshipApp extends COGToolApp {
  static DEFAULT_OPTIONS = {
    classes: ['cog-sheet-window', 'cog-authorship-window'],
    window: { icon: 'fa-solid fa-feather', resizable: false },
    position: { width: 380, height: 'auto' },
    actions: {
      pickAuthorship: COGAuthorshipApp.#onPick,
      applyAuthorship: COGAuthorshipApp.#onApply,
      cancelAuthorship: COGAuthorshipApp.#onCancel
    }
  };

  static PARTS = {
    body: { template: `${SYSTEM_PATH}/templates/apps/authorship/dialog.hbs` }
  };

  /** @param {{ document: foundry.abstract.Document }} options */
  constructor(options = {}) {
    super(options);
    this.document = options.document;
    this.choice = readSourceStamp(this.document)?.authorship ?? '';
    this.options.window.title = t('COG.Authorship.DialogTitle', { name: this.document?.name ?? '' });
  }

  /** Open the dialog for a document. */
  static open(options = {}) {
    return new this(options).render({ force: true });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.hint = t('COG.Authorship.Hint');
    context.choices = contentRegistry.listAuthorship().map((mark) => ({
      id: mark.id, icon: mark.icon, label: t(mark.label), checked: mark.id === this.choice
    }));
    return context;
  }

  /** The source stamp that writing `id` leaves on the document: its own with the new mark, or the world stamp when it has none. */
  static stampWith(document, id) {
    return { ...(readSourceStamp(document) ?? worldStamp()), authorship: id };
  }

  static async #onPick(event, target) {
    this.choice = target.dataset.authorship ?? '';
    await this.render();
  }

  static async #onApply() {
    if (!this.choice || !contentRegistry.getAuthorship(this.choice)) return this.close();
    await this.document.update({ [`flags.${SYSTEM_ID}.source`]: COGAuthorshipApp.stampWith(this.document, this.choice) }, { cogAuthorship: false });
    return this.close();
  }

  static async #onCancel() {
    return this.close();
  }
}
