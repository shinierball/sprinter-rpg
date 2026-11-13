/**
 * Sprinter RPG: the crafting app (3.15 S6b).
 *
 * One window to craft from a blueprint: pick a personal space the crawler uses, a blueprint (on the crawler or in the
 * space's stash), the gear to enchant (enchant mode), the skill for each step and the quantity, read the plan the pure
 * engine (`planCraft`) makes of it, and press Craft. The app never decides a Rule Break: every warning it shows is the
 * one `actor.craft` asks about, and `actor.craft` does the asking. Freeform crafting (C8) is a "New draft blueprint"
 * the player then writes on its own sheet.
 *
 * Every control is a `data-action` or `data-change-action` delegate with no `name` (GEMINI section 5); every label and
 * `selected` flag is computed in `_prepareContext`.
 */
import { COGToolApp } from './tool-app.mjs';
import { SYSTEM_PATH } from '../constants.mjs';
import { planCraft } from '../utils/crafting/crafting-engine.mjs';
import { getEnchantmentCategory } from '../data/rules/crafting-rules.mjs';
import { matchesTagQuery } from '../utils/tag/tag-query.mjs';
import { getItemAllTags } from '../documents/active-tags.mjs';
import { getCurrentFloor } from '../utils/floor/current-floor.mjs';
import { getFloorTimer } from '../documents/actor/actor-environment.mjs';
import { craftModifierResolver, craftSpaceInput, resolveOutputTemplate } from '../documents/actor/actor-crafting.mjs';
import { buildPayload } from '../data/builders/item-payload.mjs';
import { isBlueprintLootType } from '../models/items/loot-model.mjs';
import { pickOptions } from '../utils/ui/field-options.mjs';
import { resolveSpace, spaceMembers, userOwnsActor } from '../documents/actor/personal-space-links.mjs';
import { groupLinksCrawler } from '../documents/actor/space-group.mjs';
import { allVehicles } from '../utils/vehicle/vehicle-lookup.mjs';

const TPL = `${SYSTEM_PATH}/templates/apps/crafting-app`;
const APP_ID = 'cog-crafting-app';

const asArray = (v) => (Array.isArray(v) ? v : []);
const SEP = ':';
/** The space select's value for crafting outside any personal space (a Rule Break `actor.craft` asks about). */
const NO_SPACE = 'none';

const loc = (key, data) => {
  const i18n = globalThis.game?.i18n;
  if (data && typeof i18n?.format === 'function') return i18n.format(key, data);
  return i18n?.localize?.(key) ?? key;
};

/**
 * The gear installed on the vehicles `crafter` owns (the current user can write) or drives. Everything on the vehicle's
 * item list counts; the caller filters it by the blueprint's target query.
 * @param {Actor|null} crafter
 * @returns {Item[]}
 */
export function vehicleGearFor(crafter) {
  if (!crafter) return [];
  const user = globalThis.game?.user;
  const out = [];
  for (const vehicle of allVehicles()) {
    const drives = vehicle.system?.pilotUuid === crafter.uuid && !!crafter.uuid;
    if (!userOwnsActor(vehicle, user) && !drives) continue;
    for (const item of vehicle.items ?? []) if (item.type === 'gear') out.push(item);
  }
  return out;
}

/** A target's label in the select: vehicle gear says which vehicle it is on, worn gear says so. */
function targetLabel(item) {
  if (item.parent?.type === 'mount_vehicle') return loc('COG.CraftApp.OnVehicle', { name: item.name, vehicle: item.parent.name });
  return item.system?.equipped ? loc('COG.CraftApp.EquippedGear', { name: item.name }) : item.name;
}

/** `crawler:<id>` or `space:<id>`: how a blueprint choice is written in the select. */
const blueprintKey = (source, item) => `${source}${SEP}${item.id}`;

/** Whether an item is a blueprint loot item. */
const isBlueprint = (item) => item?.type === 'loot' && isBlueprintLootType(item.system?.lootType);

/** One material line of the plan, as the table shows it. */
function materialView(line) {
  const text = line.label || line.identifier || loc('COG.CraftApp.Material');
  const bySource = new Map();
  for (const s of asArray(line.stacks)) bySource.set(s.source, (bySource.get(s.source) ?? 0) + s.quantity);
  const from = [...bySource].map(([source, qty]) => `${source === 'space' ? loc('COG.CraftApp.FromStash') : loc('COG.CraftApp.FromCrawler')} ${qty}`).join(', ');
  return {
    text,
    needed: line.needed,
    found: line.found,
    missing: line.missing,
    short: line.missing > 0,
    from,
    summary: loc('COG.CraftApp.MaterialLine', { have: line.found, need: line.needed }),
    unsalvageable: line.salvageable === false
  };
}

export class COGCraftingApp extends COGToolApp {
  static DEFAULT_OPTIONS = {
    id: APP_ID,
    classes: ['cog-sheet-window', 'cog-crafting-app-window'],
    window: { title: 'COG.CraftApp.Title', icon: 'fa-solid fa-hammer', resizable: true },
    position: { width: 760, height: 'auto' },
    actions: {
      setSpace: COGCraftingApp.#onSetSpace,
      setBlueprint: COGCraftingApp.#onSetBlueprint,
      setTarget: COGCraftingApp.#onSetTarget,
      setSkill: COGCraftingApp.#onSetSkill,
      setQuantity: COGCraftingApp.#onSetQuantity,
      newDraftBlueprint: COGCraftingApp.#onNewDraft,
      openBlueprint: COGCraftingApp.#onOpenBlueprint,
      craft: COGCraftingApp.#onCraft
    }
  };

  static PARTS = {
    header: { template: `${TPL}/header.hbs` },
    source: { template: `${TPL}/source.hbs` },
    plan: { template: `${TPL}/plan.hbs`, scrollable: [''] },
    footer: { template: `${TPL}/footer.hbs` }
  };

  /**
   * @param {object} options `crawler` (or `actor`), optionally `space`, `blueprint` (an item or its choice key) and `target`
   */
  constructor(options = {}) {
    super(options);
    this.crawler = options.crawler ?? options.actor ?? null;
    this.spaceId = options.space?.id ?? '';
    this.blueprintKey = '';
    this.targetId = options.target?.id ?? '';
    this.skillIds = [];
    this.quantity = 1;
    this.lastResult = null;
    if (options.blueprint) this.#adoptBlueprint(options.blueprint);
  }

  /** @override A window is bound to its crawler: a request for another crawler replaces it. */
  static async open(options = {}) {
    const existing = foundry.applications.instances.get(APP_ID);
    if (existing instanceof this) {
      const crawler = options.crawler ?? options.actor;
      if (crawler && existing.crawler?.id !== crawler.id) await existing.close();
    }
    return super.open(options);
  }

  /** Remember a blueprint passed in (an item, or a choice key) and its space. */
  #adoptBlueprint(blueprint) {
    if (typeof blueprint === 'string') {
      this.blueprintKey = blueprint;
      return;
    }
    const parent = blueprint?.parent;
    if (parent?.type === 'personal_space') {
      this.spaceId = parent.id;
      this.blueprintKey = blueprintKey('space', blueprint);
    } else if (blueprint?.id) this.blueprintKey = blueprintKey('crawler', blueprint);
  }

  // ---------------------------------------------------------------------------
  // Reading the choices
  // ---------------------------------------------------------------------------

  /** The personal spaces the crawler owns or occupies. */
  get spaces() {
    return asArray(this.crawler?.getLinkedPersonalSpaces?.());
  }

  /** The space in use: the chosen one, else the crawler's default. */
  get space() {
    if (this.spaceId === NO_SPACE) return null;
    const spaces = this.spaces;
    return spaces.find((s) => s.id === this.spaceId) ?? resolveSpace(this.crawler?.getPersonalSpace?.()) ?? spaces[0] ?? null;
  }

  /** Blueprints on the crawler, then in the space's stash, as `{ key, item, source }`. */
  get blueprints() {
    const list = [];
    for (const item of this.crawler?.items ?? []) if (isBlueprint(item)) list.push({ key: blueprintKey('crawler', item), item, source: 'crawler' });
    const space = this.space;
    if (space) for (const item of space.items ?? []) if (isBlueprint(item)) list.push({ key: blueprintKey('space', item), item, source: 'space' });
    return list;
  }

  /** The blueprint in use: the chosen one if it is still there, else the first. */
  get blueprintChoice() {
    const all = this.blueprints;
    return all.find((b) => b.key === this.blueprintKey) ?? all[0] ?? null;
  }

  /**
   * Gear on the crawler (equipped or carried) that the blueprint's `target` query accepts, then the gear on the vehicles the
   * crafter owns or drives (3.44i; the label names the vehicle).
   */
  targetCandidates(bp) {
    const query = bp?.target;
    const empty = !query || !['all', 'any', 'none'].some((k) => asArray(query[k]).length);
    const fits = (i) => i.type === 'gear' && (empty || matchesTagQuery(getItemAllTags(i), query));
    const own = [...(this.crawler?.items ?? [])].filter(fits);
    return [...own, ...vehicleGearFor(this.crawler).filter(fits)];
  }

  /** The `skillIds` array `actor.craft` takes: the pick per step, blank where the default stands. */
  #skillIdsFor(plan) {
    return plan.steps.map((step, i) => {
      const picked = this.skillIds[i];
      return picked && asArray(step.skillOptions).includes(picked) ? picked : (asArray(step.skillOptions)[0] ?? '');
    });
  }

  /** The plan for the current choices (the one `actor.craft` makes again when it runs). */
  #plan(choice, target, template = null) {
    const items = [...(this.crawler?.items ?? [])];
    const space = this.space;
    const floor = getCurrentFloor();
    const linked = !!space && groupLinksCrawler(space, this.crawler);
    const planInput = {
      blueprint: choice.item,
      target,
      template,
      crawler: { items, skills: items.filter((i) => i.type === 'skill'), floor },
      space: craftSpaceInput(space, linked),
      floor,
      clockHours: getFloorTimer(),
      quantity: this.quantity
    };
    // Planned twice, as `actor.craft` does: the first plan names the steps, the second resolves the craftModifiers rows
    // of the skills picked for them. `template` is the resolved output item of an item-mode blueprint, as at craft.
    const draft = planCraft({ ...planInput, modifiers: {} });
    const skills = this.#skillIdsFor(draft).map((id) => items.find((i) => i.id === id) ?? null);
    return planCraft({
      ...planInput,
      modifiers: { resolve: craftModifierResolver(this.crawler, { skills, spaceDoc: space, linked, target, template, blueprint: choice.item }) }
    });
  }

  // ---------------------------------------------------------------------------
  // Context
  // ---------------------------------------------------------------------------

  /** @override */
  async _prepareContext(options = {}) {
    const context = await super._prepareContext(options);
    const crawler = this.crawler;
    context.crawler = crawler;
    context.hasCrawler = !!crawler;
    context.floor = getCurrentFloor();
    context.clock = getFloorTimer();

    const space = this.space;
    context.hasSpace = !!space;
    context.spaceOptions = pickOptions(
      [...this.spaces.map((s) => ({ id: s.id, label: s.name })), { id: NO_SPACE, label: loc('COG.CraftApp.NoSpace') }],
      space?.id ?? NO_SPACE
    );

    const blueprints = this.blueprints;
    const choice = this.blueprintChoice;
    context.blueprintOptions = pickOptions(
      blueprints.map((b) => ({
        id: b.key,
        label: b.source === 'space' ? loc('COG.CraftApp.StashBlueprint', { name: b.item.name }) : b.item.name
      })),
      choice?.key ?? '',
      { blankLabel: loc('COG.CraftApp.NoBlueprint') }
    );
    context.hasBlueprint = !!choice;
    context.blueprintName = choice?.item?.name ?? '';
    context.noBlueprints = blueprints.length === 0;

    context.plan = null;
    context.targetOptions = [];
    context.isEnchantMode = false;
    context.batchable = false;
    context.quantity = this.quantity;
    context.canCraft = false;
    context.result = this.lastResult;
    if (!choice || !crawler) return context;

    const bp = choice.item.system?.blueprint ?? {};
    const enchantMode = bp.mode !== 'item';
    context.isEnchantMode = enchantMode;
    context.batchable = bp.batchable === true;
    context.modeLabel = loc(enchantMode ? 'COG.CraftApp.ModeEnchant' : 'COG.CraftApp.ModeItem');

    let target = null;
    if (enchantMode) {
      const candidates = this.targetCandidates(bp);
      target = candidates.find((i) => i.id === this.targetId) ?? null;
      context.targetOptions = pickOptions(
        candidates.map((i) => ({ id: i.id, label: targetLabel(i) })),
        target?.id ?? '',
        { blankLabel: loc('COG.CraftApp.NoTarget') }
      );
      context.noTargets = candidates.length === 0;
    }

    const plan = this.#plan(choice, target, enchantMode ? null : await resolveOutputTemplate(bp));
    const skills = new Map([...(crawler.items ?? [])].filter((i) => i.type === 'skill').map((s) => [s.id, s]));
    const chosen = this.#skillIdsFor(plan);
    context.plan = {
      steps: plan.steps.map((step, i) => {
        const { category: enchantCategory } = step;
        return {
          index: i,
          number: i + 1,
          label: step.label || loc(step.kind === 'mundane' ? 'COG.CraftApp.BaseStep' : 'COG.CraftApp.EnchantStep'),
          kindLabel: step.kind === 'mundane' ? loc('COG.CraftApp.KindMundane') : loc('COG.CraftApp.KindEnchant'),
          categoryLabel: enchantCategory ? loc(getEnchantmentCategory(enchantCategory).label) : '',
          bonusLevel: step.bonusLevel,
          dc: step.dc,
          hours: step.hours,
          skillOptions: pickOptions(
            asArray(step.skillOptions).map((id) => ({ id, label: loc('COG.CraftApp.SkillRank', { name: skills.get(id)?.name ?? id, rank: skills.get(id)?.system?.rank ?? 0 }) })),
            chosen[i]
          ),
          hasSkillOptions: asArray(step.skillOptions).length > 0,
          tableTier: step.tableBonus?.tier ?? 0,
          tableNames: asArray(step.tableBonus?.used).map((t) => t.name).filter(Boolean).join(', '),
          tableNote: step.modifiers?.tableMultiplier !== undefined && step.modifiers.tableMultiplier !== 1
            ? (step.modifiers.tableMultiplier === 0 ? loc('COG.CraftApp.TableNoBonus') : loc('COG.CraftApp.TableScaled', { base: step.tableBonus?.baseTier ?? 0, mult: step.modifiers.tableMultiplier }))
            : '',
          bonusNote: step.kind === 'enchant' && step.modifiers?.bonusValue > 0 ? loc('COG.CraftApp.BonusValue', { n: step.modifiers.bonusValue }) : '',
          needsTable: step.needsTable === true,
          materials: step.materials.map(materialView),
          junk: step.junk
        };
      }),
      totalHours: plan.totalHours,
      warnings: plan.warnings.map((w) => ({ code: w.code, message: w.message, ruleBreak: w.ruleBreak === true })),
      notices: plan.notices.map((n) => ({ code: n.code, message: n.message })),
      hasWarnings: plan.warnings.length > 0,
      hasNotices: plan.notices.length > 0,
      empty: plan.steps.length === 0
    };
    context.canCraft = plan.steps.length > 0;
    return context;
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  static async #onSetSpace(event, target) {
    this.spaceId = String(target.value ?? '');
    this.blueprintKey = '';
    await this.render();
  }

  static async #onSetBlueprint(event, target) {
    this.blueprintKey = String(target.value ?? '');
    this.targetId = '';
    this.skillIds = [];
    this.lastResult = null;
    await this.render();
  }

  static async #onSetTarget(event, target) {
    this.targetId = String(target.value ?? '');
    await this.render();
  }

  static async #onSetSkill(event, target) {
    const step = Number(target.dataset.step);
    if (Number.isInteger(step) && step >= 0) this.skillIds[step] = String(target.value ?? '');
    await this.render();
  }

  static async #onSetQuantity(event, target) {
    const n = Math.floor(Number(target.value));
    this.quantity = Number.isFinite(n) && n >= 1 ? n : 1;
    await this.render();
  }

  /** C8: freeform crafting is a draft blueprint the player writes on its sheet. */
  static async #onNewDraft() {
    if (!this.crawler) return;
    const payload = buildPayload('loot', {
      name: loc('COG.CraftApp.DraftName'),
      system: { lootType: 'blueprint', blueprint: { mode: 'item' } }
    }, { warnings: [] });
    const [item] = await this.crawler.createEmbeddedDocuments('Item', [payload]);
    if (!item) return;
    this.blueprintKey = blueprintKey('crawler', item);
    this.targetId = '';
    this.skillIds = [];
    item.sheet?.render?.({ force: true });
    await this.render();
  }

  static async #onOpenBlueprint() {
    this.blueprintChoice?.item?.sheet?.render?.({ force: true });
  }

  /** Craft. `actor.craft` asks every Rule Break itself; the app only passes the choices. */
  static async #onCraft() {
    const choice = this.blueprintChoice;
    if (!choice || !this.crawler) return;
    const bp = choice.item.system?.blueprint ?? {};
    const target = bp.mode === 'item' ? null : (this.targetCandidates(bp).find((i) => i.id === this.targetId) ?? null);
    const plan = this.#plan(choice, target, bp.mode === 'item' ? await resolveOutputTemplate(bp) : null);
    const result = await this.crawler.craft({
      blueprint: choice.item,
      target,
      // "No personal space" is passed as `false`, so the craft does not fall back to the crawler's own space.
      space: this.spaceId === NO_SPACE ? false : this.space,
      skillIds: this.#skillIdsFor(plan),
      quantity: this.quantity
    });
    this.lastResult = result ? {
      success: result.success === true,
      refused: !!result.refusal,
      summary: result.refusal
        ? loc('COG.CraftApp.Refused')
        : loc(result.success ? 'COG.CraftApp.Succeeded' : 'COG.CraftApp.Failed'),
      ruleBreak: result.ruleBreak === true
    } : null;
    await this.render();
  }
}

/**
 * The crawler and space a sheet's opener should use: the crawler itself, or (from a space) the first occupant the
 * current user owns.
 * @param {Actor|Item|null} owner a crawler, a personal space, or an item held by one
 * @returns {{ crawler: Actor|null, space: Actor|null }}
 */
export function craftingContextFor(owner) {
  const isActor = owner?.type === 'crawler' || owner?.type === 'personal_space';
  const doc = isActor ? owner : (owner?.parent ?? null);
  if (doc?.type === 'crawler') return { crawler: doc, space: null };
  if (doc?.type === 'personal_space') {
    const user = globalThis.game?.user;
    const crawler = spaceMembers(doc).occupants.find((c) => userOwnsActor(c, user)) ?? null;
    return { crawler, space: doc };
  }
  return { crawler: globalThis.game?.user?.character ?? null, space: null };
}
