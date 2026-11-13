/**
 * The review window of Item from words (7.43c): what a checked draft does, in the item describer's words, what could not be
 * resolved, what was dropped and left unsaid, and who wrote it. Nothing is made until Create. A pick or a note answers one
 * unresolved reference by changing the draft and checking it again (`review.mjs`); Create hands the checked spec to
 * `createItem` (`createAndEditItem`), stamped as homebrew with the chosen authorship.
 */
import { COGToolApp } from './tool-app.mjs';
import { SYSTEM_PATH } from '../constants.mjs';
import { contentRegistry } from '../content/registry.mjs';
import { offeredEntries } from '../utils/content-source.mjs';
import { itemIdentifier } from '../utils/identifier.mjs';
import { identifierOptions } from '../utils/ui/identifier-options.mjs';
import { describeItem, emptyLine } from '../utils/item-describer/index.mjs';
import { checkDraft } from '../utils/item-from-words/check-draft.mjs';
import { pickReference, noteReference, reviewSpec } from '../utils/item-from-words/review.mjs';
import { worldStamp } from '../hooks/stamp-new-documents.mjs';
import { itemFromWordsText as t, localizeKey } from './item-from-words-text.mjs';

/** The mark a draft starts with: it came through a chatbot (decision 1059). */
const DEFAULT_AUTHORSHIP = 'ai';

/** The completeness severities, worst first (the order the review lists them). */
const FINDING_SEVERITIES = Object.freeze(['broken', 'warning', 'note']);

export class COGDraftReviewApp extends COGToolApp {
  static DEFAULT_OPTIONS = {
    classes: ['cog-sheet-window', 'cog-item-words-window', 'cog-draft-review-window'],
    window: { icon: 'fa-solid fa-clipboard-list', title: 'COG.ItemFromWords.Review.Title', resizable: true },
    position: { width: 520, height: 'auto' },
    actions: {
      pickReference: COGDraftReviewApp.#onPick,
      noteReference: COGDraftReviewApp.#onNote,
      setAuthorship: COGDraftReviewApp.#onAuthorship,
      toggleNotes: COGDraftReviewApp.#onToggleNotes,
      createDraftItem: COGDraftReviewApp.#onCreate,
      backToBridge: COGDraftReviewApp.#onBack
    }
  };

  static PARTS = {
    body: { template: `${SYSTEM_PATH}/templates/apps/item-from-words/review.hbs` }
  };

  /**
   * @param {object} options
   * @param {object} options.draft what `extractDraft` found
   * @param {object} options.check the `checkDraft` result for it (`ok`)
   * @param {(type: string, spec: object) => Promise<object>} options.createItem makes the item and opens its sheet
   * @param {object} [options.resolve] catalog reads for `checkDraft` and the picker (default: the live catalogs)
   * @param {object} [options.bridge] the window to close after Create
   */
  constructor(options = {}) {
    super(options);
    this.draft = options.draft;
    this.check = options.check ?? checkDraft(options.draft, { resolve: options.resolve });
    this.createItem = options.createItem;
    this.resolve = options.resolve;
    this.bridge = options.bridge ?? null;
    const marks = contentRegistry.listAuthorship();
    this.authorship = marks.some((m) => m.id === DEFAULT_AUTHORSHIP) ? DEFAULT_AUTHORSHIP : (marks[0]?.id ?? '');
    this.keepNotes = true;
  }

  /** The picker's choices for a catalog kind. */
  #pickerOptions(kind) {
    const list = this.resolve?.list ?? offeredEntries;
    const entries = (list(kind) ?? []).map((def) => ({ ...def, system: { ...def.system, identifier: itemIdentifier(def) } }));
    return identifierOptions(entries, '', { blankLabel: t('Review.Pick') });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const { check } = this;
    const lines = await describeItem(check.payload);
    context.typeLabel = t(`Review.Type.${check.type}`);
    context.name = check.payload?.name ?? '';
    context.lines = (lines.length ? lines : [emptyLine()]).map((line) => ({ text: line.text, badge: line.badge }));
    context.matched = check.matchedByName.map((m) => t('Review.MatchedByName', { ref: m.ref, name: m.name, kind: t(`Review.Kind.${m.kind}`) }));
    context.unresolved = check.unresolved.map((entry, index) => ({
      index, ref: entry.ref, kind: t(`Review.Kind.${entry.kind}`), options: this.#pickerOptions(entry.kind)
    }));
    context.findings = FINDING_SEVERITIES.map((severity) => ({
      severity,
      broken: severity === 'broken',
      label: t(`Review.Findings.${severity}`),
      items: (check.findings ?? []).filter((f) => f.severity === severity).map((f) => globalThis.game?.i18n?.format?.(f.messageKey, f.data) ?? f.messageKey)
    })).filter((group) => group.items.length);
    context.warnings = check.warnings.filter((w) => w.code !== 'reference').map((w) => `${w.path}: ${w.message}`);
    context.dropped = check.dropped.map((d) => `${d.path}: ${d.reason}`);
    context.unexpressed = check.unexpressed;
    context.keepNotes = this.keepNotes;
    context.authorship = contentRegistry.listAuthorship().map((mark) => ({
      id: mark.id, icon: mark.icon, label: localizeKey(mark.label), checked: mark.id === this.authorship
    }));
    context.hiddenNote = contentRegistry.isAuthorshipHidden(this.authorship);
    context.labels = {
      does: localizeKey('COG.ItemSummary.Heading'), matched: t('Review.Matched'), unresolved: t('Review.Unresolved'), unresolvedHint: t('Review.UnresolvedHint'),
      note: t('Review.Note'), findings: t('Review.Findings.Heading'), findingsHint: t('Review.Findings.Hint'), warnings: t('Review.Warnings'), dropped: t('Review.Dropped'), unexpressed: t('Review.Unexpressed'),
      keepNotes: t('Review.KeepNotes'), authorship: t('Review.Authorship'), hidden: t('Review.Hidden'), create: t('Review.Create'), back: t('Review.Back')
    };
    return context;
  }

  /** The draft changed: check it again and redraw. */
  async #redraft(next) {
    if (!next) return;
    this.draft = next;
    this.check = checkDraft(next, { resolve: this.resolve });
    await this.render();
  }

  static async #onPick(event, target) {
    const identifier = String(target?.value ?? '').trim();
    const entry = this.check.unresolved[Number(target?.dataset?.index)];
    if (!identifier || !entry) return;
    await this.#redraft(pickReference(this.draft, entry, identifier));
  }

  static async #onNote(event, target) {
    const entry = this.check.unresolved[Number(target?.dataset?.index)];
    if (!entry) return;
    await this.#redraft(noteReference(this.draft, entry, t('Review.NoteLine', { kind: t(`Review.Kind.${entry.kind}`), ref: entry.ref })));
  }

  static async #onAuthorship(event, target) {
    this.authorship = target?.dataset?.authorship ?? this.authorship;
    await this.render();
  }

  static async #onToggleNotes(event, target) {
    this.keepNotes = Boolean(target?.checked);
    await this.render();
  }

  static async #onCreate() {
    const stamp = { ...worldStamp(), authorship: this.authorship };
    const { type, spec } = reviewSpec(this.check, { stamp, keepNotes: this.keepNotes });
    const created = await this.createItem(type, spec);
    await this.bridge?.close?.();
    await this.close();
    return created;
  }

  static async #onBack() {
    return this.close();
  }
}
