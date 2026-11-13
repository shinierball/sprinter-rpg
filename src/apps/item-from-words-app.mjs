/**
 * "Describe it" (7.43c): the bridge window of Item from words. The user types what the item does, copies one prompt into
 * a chatbot of their own, pastes the reply back, and the reply is checked and shown in the review window. The system makes
 * no network call and stores no key; the prompt and the check are the pure functions of `src/utils/item-from-words/`.
 */
import { COGToolApp } from './tool-app.mjs';
import { COGDraftReviewApp } from './draft-review-app.mjs';
import { SYSTEM_PATH } from '../constants.mjs';
import { DRAFT_TYPES } from '../utils/item-from-words/draft-fields.mjs';
import { describeVocabulary } from '../utils/item-from-words/vocabulary.mjs';
import { buildItemPrompt } from '../utils/item-from-words/prompt.mjs';
import { extractDraft } from '../utils/item-from-words/extract-draft.mjs';
import { checkDraft } from '../utils/item-from-words/check-draft.mjs';
import { DRAFT_PROVIDERS } from '../utils/item-from-words/providers.mjs';
import { itemFromWordsText as t, localizeKey } from './item-from-words-text.mjs';

export class COGItemFromWordsApp extends COGToolApp {
  static DEFAULT_OPTIONS = {
    id: 'cog-item-from-words',
    classes: ['cog-sheet-window', 'cog-item-words-window'],
    window: { icon: 'fa-solid fa-comment-dots', title: 'COG.ItemFromWords.Title', resizable: true },
    position: { width: 520, height: 'auto' },
    actions: {
      setType: COGItemFromWordsApp.#onSetType,
      setWords: COGItemFromWordsApp.#onSetWords,
      setReply: COGItemFromWordsApp.#onSetReply,
      copyPrompt: COGItemFromWordsApp.#onCopyPrompt,
      checkReply: COGItemFromWordsApp.#onCheckReply,
      generate: COGItemFromWordsApp.#onGenerate
    }
  };

  static PARTS = {
    body: { template: `${SYSTEM_PATH}/templates/apps/item-from-words/bridge.hbs` }
  };

  /**
   * @param {object} options
   * @param {(type: string, spec: object) => Promise<object>} options.createItem makes the item and opens its sheet (`createAndEditItem`); handed on to the review
   * @param {object} [options.resolve] catalog reads for `checkDraft` (default: the live catalogs)
   */
  constructor(options = {}) {
    super(options);
    this.createItem = options.createItem;
    this.resolve = options.resolve;
    /** The item type the prompt is written for; '' until the user picks one. */
    this.type = '';
    this.words = '';
    this.reply = '';
    /** @type {{ kind: 'warn'|'info', text: string }|null} */
    this.notice = null;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.types = DRAFT_TYPES.map((id) => ({ id, label: localizeKey(`COG.ItemSetup.Kind.${id}.Label`), selected: id === this.type }));
    context.words = this.words;
    context.reply = this.reply;
    context.notice = this.notice;
    context.providers = Object.values(DRAFT_PROVIDERS).map(({ id, label }) => ({ id, label }));
    context.labels = {
      intro: t('Bridge.Intro'), type: t('Bridge.Type'), words: t('Bridge.Words'), wordsHint: t('Bridge.WordsHint'), copy: t('Bridge.Copy'),
      privacy: t('Bridge.Privacy'), reply: t('Bridge.Reply'), replyHint: t('Bridge.ReplyHint'), check: t('Bridge.Check')
    };
    return context;
  }

  /** The prompt for the words so far: the vocabulary read at this moment, in the interface language. */
  prompt(vocabulary = this.vocabulary()) {
    return buildItemPrompt(this.words.trim(), vocabulary);
  }

  vocabulary() {
    return describeVocabulary({ localize: localizeKey, type: this.type });
  }

  /** @param {{ kind: 'warn'|'info', text: string }|null} notice */
  async setNotice(notice) {
    this.notice = notice;
    await this.render();
  }

  static async #onSetType(event, target) {
    const type = target?.dataset?.type;
    if (!DRAFT_TYPES.includes(type)) return undefined;
    this.type = type;
    return this.render();
  }

  static async #onSetWords(event, target) {
    this.words = String(target?.value ?? '');
  }

  static async #onSetReply(event, target) {
    this.reply = String(target?.value ?? '');
  }

  static async #onCopyPrompt() {
    if (!this.type) return this.setNotice({ kind: 'warn', text: t('Bridge.NoType') });
    if (!this.words.trim()) return this.setNotice({ kind: 'warn', text: t('Bridge.NoWords') });
    await globalThis.game?.clipboard?.copyPlainText?.(this.prompt());
    return this.setNotice({ kind: 'info', text: t('Bridge.Copied') });
  }

  static async #onCheckReply() {
    return this.#reviewReply(this.reply);
  }

  /** A provider writes the draft: its text or object goes the way a paste does; a failure is a notice and the words stay. */
  static async #onGenerate(event, target) {
    const provider = DRAFT_PROVIDERS[target?.dataset?.provider];
    if (!provider) return undefined;
    if (!this.type) return this.setNotice({ kind: 'warn', text: t('Bridge.NoType') });
    if (!this.words.trim()) return this.setNotice({ kind: 'warn', text: t('Bridge.NoWords') });
    let result;
    try {
      const vocabulary = this.vocabulary();
      result = await provider.generate({ words: this.words.trim(), prompt: this.prompt(vocabulary), vocabulary });
    } catch (err) {
      return this.setNotice({ kind: 'warn', text: err?.message || t('Bridge.ProviderFailed', { label: provider.label }) });
    }
    if (result === undefined || result === null || (typeof result === 'string' && !result.trim())) {
      return this.setNotice({ kind: 'warn', text: t('Bridge.ProviderEmpty', { label: provider.label }) });
    }
    return this.#reviewReply(result);
  }

  /** The shared path of a paste and a provider: find the draft, check it, open the review. `reply` is text or a draft object. */
  async #reviewReply(reply) {
    const found = extractDraft(reply);
    if (found.error) return this.setNotice({ kind: 'warn', text: found.error });
    const check = checkDraft(found.draft, { resolve: this.resolve, expectedType: this.type || undefined });
    if (!check.ok) return this.setNotice({ kind: 'warn', text: check.warnings.map((w) => w.message).join(' ') || t('Bridge.NotChecked') });
    await this.setNotice(null);
    return new COGDraftReviewApp({ draft: found.draft, check, createItem: this.createItem, resolve: this.resolve, bridge: this }).render({ force: true });
  }
}
