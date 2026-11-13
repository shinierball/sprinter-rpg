/**
 * Sprinter RPG: the advanced weapon builder. An opt-in, create-only studio for a weapon with every field the gear sheet
 * has. It drafts in memory (`WeaponDraftHost`, an item-shaped host) and its pages are the gear sheet's own weapon
 * partials over that draft, so the sheet's actions (`WEAPON_ACTIONS`, `LIST_ACTIONS`, `ROW_ACTIONS`, `TAG_ACTIONS`,
 * `FINDING_ACTIONS`) run here unchanged. The damage page shows what the weapon rolls at Rank 0, 5 and 10 from the damage
 * engine's own scaling. Review lists the completeness findings; Create hands the draft to `createFromSpec`, the one
 * create path, whose "Create anyway?" dialog is the only confirm.
 */
import { COGToolApp } from '../tool-app.mjs';
import { SYSTEM_PATH } from '../../constants.mjs';
import { createFromSpec, ensureCanCreateItems } from '../item-create.mjs';
import { WeaponDraftHost } from './draft-host.mjs';
import { WEAPON_BUILDER_STEPS } from '../../data/builders/weapon-spec.mjs';
import { weaponReadoutContext } from '../../sheets/item/context-weapon.mjs';
import { skillRows } from '../../data/item-setup/kinds/weapon.mjs';
import { worldSkillResolver } from '../../utils/skill/weapon-skill-options.mjs';
import { toStringList } from '../../utils/first-scalar.mjs';
import { buildCommonContext, cloneSystem } from '../../sheets/item/context-common.mjs';
import { buildRowEditorContext } from '../../sheets/item/context-rows.mjs';
import { buildGearContext } from '../../sheets/item/context-gear.mjs';
import { buildFindingsContext, FINDING_ACTIONS } from '../../sheets/item/context-findings.mjs';
import { buildSummaryContext } from '../../sheets/item/context-summary.mjs';
import { processItemFormData } from '../../sheets/item/form-data.mjs';
import { getCompendiumSkills, getAvailableDebuffs } from '../../sheets/item/catalogs.mjs';
import { LIST_ACTIONS } from '../../sheets/item/actions-lists.mjs';
import { WEAPON_ACTIONS } from '../../sheets/item/actions-weapon.mjs';
import { ROW_ACTIONS } from '../../sheets/item/actions-rows.mjs';
import { TAG_ACTIONS } from '../../sheets/item/actions-tags.mjs';

const TPL = `${SYSTEM_PATH}/templates/apps/weapon-builder`;
const t = (key, data) => (data ? globalThis.game?.i18n?.format?.(key, data) : globalThis.game?.i18n?.localize?.(key)) ?? key;

/** The row arrays the damage and extras pages edit, by the page that shows them. */
const DAMAGE_ARRAY = 'damageModifiers';
const ATTACK_ARRAY = 'attackModifiers';

/** Change the draft's picture through Foundry's file picker. */
async function onEditImage() {
  const FilePickerClass = globalThis.foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
  await new FilePickerClass({ type: 'image', current: this.host.img, callback: (path) => this.host.update({ img: path }) }).browse();
}

export class COGWeaponBuilderApp extends COGToolApp {
  static DEFAULT_OPTIONS = {
    classes: ['cog-weapon-builder-app', 'cog-sheet-window'],
    window: { title: 'COG.WeaponBuilder.Title', icon: 'fa-solid fa-crosshairs', resizable: true },
    position: { width: 760, height: 760 },
    actions: {
      ...TAG_ACTIONS, ...LIST_ACTIONS, ...WEAPON_ACTIONS, ...FINDING_ACTIONS, ...ROW_ACTIONS,
      setStep: COGWeaponBuilderApp.#onSetStep,
      back: COGWeaponBuilderApp.#onBack,
      next: COGWeaponBuilderApp.#onNext,
      editImage: onEditImage,
      createWeapon: COGWeaponBuilderApp.#onCreate
    }
  };

  // Every page is a part and stays rendered (only the active one is shown), so each control exists once in the form.
  static PARTS = {
    nav: { template: `${TPL}/nav.hbs` },
    basics: { template: `${TPL}/basics.hbs`, scrollable: [''] },
    tags: { template: `${TPL}/tags.hbs`, scrollable: [''] },
    skills: { template: `${TPL}/skills.hbs`, scrollable: [''] },
    type: { template: `${TPL}/type.hbs`, scrollable: [''] },
    damage: { template: `${TPL}/damage.hbs`, scrollable: [''] },
    extras: { template: `${TPL}/extras.hbs`, scrollable: [''] },
    review: { template: `${TPL}/review.hbs`, scrollable: [''] },
    footer: { template: `${TPL}/footer.hbs` }
  };

  /**
   * @param {{ seed?: object, actor?: object|null, resolver?: object }} [options] `seed` is a partial gear spec the draft
   *   starts from (the setup modal's answers); `actor` receives the weapon; `resolver` is the Skill catalogs
   */
  constructor(options = {}) {
    super(options);
    this.actor = options.actor ?? null;
    this.resolver = options.resolver ?? worldSkillResolver();
    this.page = WEAPON_BUILDER_STEPS[0].id;
    this.host = new WeaponDraftHost(options.seed ?? {}, { onChange: () => this.render() });
    // The sheet-shaped handle the shared actions and the replay harness read.
    this.item = this.host;
    this.document = this.host;
    this.isEditable = true;
    /** @type {object[]|null} the Skill catalog the pickers read, fetched once */
    this._catalog = null;
  }

  /** Open the builder (a new draft each time). A user who may not create Items gets a warning instead (an actor's weapon follows the actor). */
  static open({ seed = {}, actor = null } = {}) {
    if (!actor && !ensureCanCreateItems()) return null;
    return new COGWeaponBuilderApp({ seed, actor }).render({ force: true });
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const host = this.host;
    context.item = host;
    context.document = host;
    context.owner = true;
    context.system = cloneSystem(host.system);
    this._catalog ??= { skills: await getCompendiumSkills(), debuffs: await getAvailableDebuffs() };
    buildCommonContext(context, host, { skills: this._catalog.skills, buffs: [], debuffs: this._catalog.debuffs, spells: [], tables: [] });
    buildRowEditorContext(context, host);
    buildGearContext(context, host);
    buildFindingsContext(context, host);
    await buildSummaryContext(context, host);

    const index = WEAPON_BUILDER_STEPS.findIndex((step) => step.id === this.page);
    context.page = this.page;
    context.steps = WEAPON_BUILDER_STEPS.map((step) => ({
      ...step, active: step.id === this.page, label: t(`COG.WeaponBuilder.Step.${step.id}.Label`), hint: t(`COG.WeaponBuilder.Step.${step.id}.Hint`)
    }));
    context.isFirstStep = index <= 0;
    context.isLastStep = index === WEAPON_BUILDER_STEPS.length - 1;
    context.draftName = host.name;
    context.draftImg = host.img || 'icons/svg/sword.svg';

    const blocks = context.rowEditors?.blocks ?? [];
    const addBar = context.rowEditors?.addBar ?? [];
    context.damageBlock = blocks.find((b) => b.arrayKey === DAMAGE_ARRAY) ?? null;
    context.attackBlock = blocks.find((b) => b.arrayKey === ATTACK_ARRAY) ?? null;
    context.attackAdd = addBar.find((b) => b.arrayKey === ATTACK_ARRAY) ?? null;

    const rows = skillRows(toStringList(host.system.associatedSkills), this.resolver);
    context.skillRows = rows.map((row) => ({
      ...row, note: !row.inWorld ? `(${t('COG.ItemSetup.Skills.NotInWorld')})` : (row.baseDamage || `(${t('COG.ItemSetup.Skills.NoDamage')})`)
    }));
    context.hasMissingSkill = rows.some((row) => !row.inWorld);

    Object.assign(context, weaponReadoutContext(host.system, this.resolver));
    return context;
  }

  /** @override A named control edits the draft, as the item sheet's submit-on-change does; the rest are change actions. */
  async _onChangeForm(formConfig, event) {
    const target = event?.target;
    if (target?.closest?.('[data-change-action]')) return super._onChangeForm(formConfig, event);
    if (!target?.getAttribute?.('name')) return undefined;
    const object = {};
    for (const el of this.element.querySelectorAll('[name]')) {
      if (el.hasAttribute('disabled')) continue;
      const type = (el.getAttribute('type') ?? '').toLowerCase();
      const name = el.getAttribute('name');
      if (type === 'radio') { if (el.checked) object[name] = el.value; continue; }
      if (type === 'checkbox') { object[name] = Boolean(el.checked); continue; }
      object[name] = type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value;
    }
    const data = await this._prepareSubmitData(event, this.element, { object });
    return this._processSubmitData(event, this.element, data);
  }

  /** The submitted controls as an update of the draft (rows merged and lists split as the item sheet does). */
  async _prepareSubmitData(event, form, formData) {
    const data = globalThis.foundry.utils.expandObject(formData?.object ?? {});
    return processItemFormData(this.host, data, { isGM: Boolean(globalThis.game?.user?.isGM) });
  }

  /** Write the submitted controls into the draft. */
  async _processSubmitData(event, form, submitData) {
    await this.host.update(submitData);
  }

  async #goTo(id) {
    if (!WEAPON_BUILDER_STEPS.some((step) => step.id === id)) return;
    this.page = id;
    await this.render();
  }

  static async #onSetStep(event, target) {
    await this.#goTo(String(target.dataset.step ?? ''));
  }

  static async #onBack() {
    const index = WEAPON_BUILDER_STEPS.findIndex((step) => step.id === this.page);
    await this.#goTo(WEAPON_BUILDER_STEPS[Math.max(0, index - 1)].id);
  }

  static async #onNext() {
    const index = WEAPON_BUILDER_STEPS.findIndex((step) => step.id === this.page);
    await this.#goTo(WEAPON_BUILDER_STEPS[Math.min(WEAPON_BUILDER_STEPS.length - 1, index + 1)].id);
  }

  /** Create the weapon through `createFromSpec` (it asks "Create anyway?" when something is broken). The window stays open when that is declined. */
  static async #onCreate() {
    const created = await createFromSpec('weapon', this.host.toSpec(), { actor: this.actor });
    if (created) await this.close();
  }
}
