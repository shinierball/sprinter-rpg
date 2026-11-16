/**
 * Sprinter RPG: the Mob Creator (ApplicationV2), in the layout of the Crawler Creator's floor start: a stage rail on the
 * left, the active stage in the middle, the live stat block on the right and a footer with the status line, Fill, Back, Next
 * and Create.
 *
 * The draft (`MobDraft`) holds the spec and the rules; this class shows it, takes the controls and creates the actor.
 */
import { COGToolApp } from '../tool-app.mjs';
import { MobDraft } from '../../data/mob-creator/draft.mjs';
import { SYSTEM_PATH } from '../../constants.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { readControl } from '../crawler-creator/stage-context.mjs';
import { FIRST_STAGE, isStage, neighbourStage, stageFooter, stagePart, stageRail, statBlock, STAGES } from './context.mjs';
import { DEFAULT_FILL_FOCUS } from './stages/stats.mjs';
import { PICK_LIST_ACTIONS } from './stages/pick-lists.mjs';
import { debuffChoices } from './stages/attacks.mjs';
import { abilitySummaries } from './stages/abilities.mjs';
import { dropOnto } from './picks.mjs';
import { tr } from './words.mjs';

const TPL = `${SYSTEM_PATH}/templates/apps/mob-creator-v2`;
const FLOOR_TPL = `${SYSTEM_PATH}/templates/apps/floor-simulator`;

/** The stage ids are part ids: one part per stage, hidden unless it is the active one. */
const STAGE_IDS = STAGES.map((s) => s.id);
/** The parts that read the draft whatever the stage. */
const SHELL_PARTS = Object.freeze(['rail', 'preview', 'footer']);
/** What a typed text control changes besides itself: the stat block's name. Numbers change the readouts in the stage too. */
const TEXT_FIELDS = new Set(['name', 'creatureType', 'description', 'aiDescription', 'notes']);
/** The template of a stage part: its own, or the placeholder of a stage that is not built yet. */
const STAGE_TEMPLATES = Object.freeze({});

/** The actions every stage's controls share, merged with each stage's own. */
const STAGE_ACTIONS = Object.assign({}, ...STAGES.map((s) => s.actions ?? {}));

export class COGMobCreatorV2App extends COGToolApp {
  static DEFAULT_OPTIONS = {
    id: 'cog-mob-creator-v2',
    classes: ['cog-sheet-window', 'cog-mob-creator-v2-window', 'cog-creator-staged'],
    window: { title: 'COG.MobCreator.Title', icon: 'fa-solid fa-skull-crossbones', resizable: true },
    position: { width: 1000, height: 780 },
    actions: {
      ...STAGE_ACTIONS,
      ...PICK_LIST_ACTIONS,
      goStep: COGMobCreatorV2App.#onGoStep,
      nextStep: COGMobCreatorV2App.#onNextStep,
      prevStep: COGMobCreatorV2App.#onPrevStep,
      setField: COGMobCreatorV2App.#onSetField,
      createMob: COGMobCreatorV2App.#onCreateMob
    }
  };

  static PARTS = {
    rail: { template: `${FLOOR_TPL}/rail.hbs` },
    ...Object.fromEntries(STAGE_IDS.map((id) => [id, { template: `${TPL}/${STAGE_TEMPLATES[id] ?? id}.hbs` }])),
    preview: { template: `${TPL}/preview.hbs` },
    footer: { template: `${TPL}/footer.hbs` }
  };

  /** @param {object} [options] Application options and the draft's starting values */
  constructor(options = {}) {
    super(options);
    this.draft = new MobDraft(options);
    this.active = FIRST_STAGE;
    this.visited = new Set([FIRST_STAGE]);
    this.fillFocus = DEFAULT_FILL_FOCUS;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const state = { active: this.active, visited: this.visited };
    return Object.assign(context, {
      rail: stageRail(this.draft, state),
      block: statBlock(this.draft),
      footer: stageFooter(this.draft, state)
    });
  }

  /** Each part reads its own slice of the context at the top level (the rail template is the floor simulator's). @override */
  async _preparePartContext(partId, context, options) {
    const part = await super._preparePartContext(partId, context, options);
    if (partId === 'rail') return { ...part, ...context.rail };
    if (STAGE_IDS.includes(partId)) {
      // The debuffs a rider can name come from the catalogs, so they are read only for the stage that shows them.
      const debuffs = partId === this.active && partId === 'attacks' ? await debuffChoices() : [];
      const summaries = partId === this.active && partId === 'abilities' ? await abilitySummaries(this.draft) : [];
      return { ...part, ...stagePart(this.draft, partId, { active: this.active, rootId: context.rootId, fillFocus: this.fillFocus, debuffs, summaries }) };
    }
    if (partId === 'preview') return { ...part, ...context.block };
    if (partId === 'footer') return { ...part, ...context.footer };
    return part;
  }

  /** Items dropped on the window (from a compendium, the sidebar or another mob's sheet) join the draft. @override */
  _onRender(context, options) {
    super._onRender?.(context, options);
    if (this.#dropWired || !this.element?.addEventListener) return;
    this.#dropWired = true;
    this.element.addEventListener('dragover', (event) => event.preventDefault());
    this.element.addEventListener('drop', (event) => this.#onDrop(event));
  }

  #dropWired = false;

  async #onDrop(event) {
    event.preventDefault();
    const dragData = COGMobCreatorV2App.#dragData(event);
    if (!dragData || !(await dropOnto(this.draft, dragData))) return;
    await this.render({ parts: this._parts() });
  }

  /** The parsed payload of a drag event (Foundry's own reader when it is there). */
  static #dragData(event) {
    const reader = globalThis.foundry?.applications?.ux?.TextEditor?.implementation?.getDragEventData;
    if (typeof reader === 'function') return reader.call(globalThis.foundry.applications.ux.TextEditor.implementation, event);
    try { return JSON.parse(event.dataTransfer?.getData('text/plain') ?? ''); } catch { return null; }
  }

  /** The parts to show again: the shell, the active stage and any `also`. */
  _parts(...also) {
    return [...new Set([...SHELL_PARTS, this.active, ...also])];
  }

  /** Go to a stage and show it (the stage it leaves is hidden). */
  async #goTo(id) {
    if (!isStage(id)) return;
    const left = this.active;
    this.active = id;
    this.visited.add(id);
    await this.render({ parts: this._parts(left) });
  }

  static #onGoStep(event, target) {
    return this.#goTo(target.dataset.step);
  }

  static #onNextStep() {
    return this.#goTo(neighbourStage(this.active, 1));
  }

  static #onPrevStep() {
    return this.#goTo(neighbourStage(this.active, -1));
  }

  /** A stage control's value by path (`data-path`, converted by `data-type`); the draft coerces it. */
  static async #onSetField(event, target) {
    const path = target.dataset.path;
    if (!this.draft.set(path, readControl(target))) return;
    // A typed text control keeps the panel (and the caret) where it is; anything that moves a readout re-shows it.
    await this.render({ parts: TEXT_FIELDS.has(path) ? [...SHELL_PARTS] : this._parts() });
  }

  static #onCreateMob() {
    return this.createMob();
  }

  /**
   * Create the unlinked mob actor. A draft that breaks a rule is listed once and made on confirmation, recording the Rule
   * Break (Directive 2); Cancel creates nothing.
   * @param {{ ruleBreak?: boolean, forceRuleBreak?: boolean }} [options] `ruleBreak: true` is the caller's own confirmation
   * @returns {Promise<Actor|null>}
   */
  async createMob(options = {}) {
    const reasons = this.draft.ruleBreaks().map((b) => b.reason);
    let ruleBreak = Boolean(options.ruleBreak || options.forceRuleBreak);
    if (reasons.length && !ruleBreak) {
      const reasonText = reasons.join(' ');
      const answer = await confirmRuleBreak({
        title: tr('COG.MobCreator.RuleBreak.Title'),
        message: tr('COG.MobCreator.RuleBreak.Message', { reasons: reasonText }),
        reason: reasonText,
        options
      });
      if (!answer.confirmed) {
        if (answer.refusal !== 'cancelled') globalThis.ui?.notifications?.error?.(reasonText);
        return null;
      }
      ruleBreak = true;
    }

    const warnings = [];
    const payload = this.draft.compile({ ruleBreak, warnings });
    for (const w of warnings) globalThis.ui?.notifications?.warn?.(`${w.path}: ${w.message}`);
    try {
      const actor = await Actor.create(payload);
      globalThis.ui?.notifications?.info?.(tr('COG.MobCreator.Created', { name: actor.name }));
      actor.sheet?.render?.({ force: true });
      this.close();
      return actor;
    } catch (err) {
      console.error('Sprinter RPG | Failed to create mob actor:', err);
      globalThis.ui?.notifications?.error?.(tr('COG.MobCreator.CreateFailed', { message: err.message }));
      throw err;
    }
  }
}
