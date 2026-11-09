/**
 * Contest Tracker (GM): set up, run and end a race or chase.
 *
 * Two modes in one window. With no contest chosen it edits a local draft (kind, participants from selected tokens or
 * the active combat, legs with their check, per-participant skill overrides) and "Post contest card" creates the
 * contest's chat card. With a contest chosen the same controls write the contest through `updateContest` (the state
 * lives on the card, so a reloaded GM client resumes from the chat log), and the leg buttons open and close legs, type
 * a GM result, mark a participant out, and accept or dismiss a skill proposal a player sent through the relay.
 *
 * The tracker edits contest state, not a document schema, so its controls are unnamed inputs wired with
 * `data-change-action` / `data-action` delegates. Skills are picked by `system.identifier` from the catalog. Nothing
 * here blocks (CONTRIBUTING rule 2); the engine and the service decide what a change means.
 */
import { offeredEntries } from '../utils/content-source.mjs';
import { COGToolApp } from './tool-app.mjs';
import { SYSTEM_PATH } from '../constants.mjs';
import { resolveActorByUuid } from '../utils/actor-uuid.mjs';
import { getCurrentFloor } from '../utils/floor/current-floor.mjs';
import { MOVEMENT_SKILL_TAG } from '../data/tag-vocabulary.mjs';
import { sanitizeContest, raceStandings, chaseStatus, participantLegSkill } from '../utils/contest/contest-engine.mjs';
import { CONTEST_KINDS, contestKindInfo } from '../data/rules/contest-rules.mjs';
import { drawLegFromTable, applyLegDraw } from '../utils/contest/contest-leg-draw.mjs';
import { getAvailableRollTables } from '../sheets/item/catalogs.mjs';
import { participantIsOut } from '../chat/contest-card.mjs';
import {
  postContestCard, repostContestCard, getContest, listContests, updateContest, openLeg, closeLeg, endContest,
  setGmResult, markParticipantOut, setSkillOverride, acceptSkillProposal, dismissSkillProposal, governingStat
} from '../chat/contest-service.mjs';

const TPL = `${SYSTEM_PATH}/templates/apps/contest-tracker`;
const STATS = ['str', 'dex', 'con', 'int', 'cha'];
const MOVE_MODES = ['move', 'swim', 'climb', 'fly'];

const t = (key, data) => globalThis.game?.i18n?.format?.(key, data) ?? globalThis.game?.i18n?.localize?.(key) ?? key;
const notify = (level, message) => globalThis.ui?.notifications?.[level]?.(`Sprinter RPG | ${message}`);
const clone = (v) => JSON.parse(JSON.stringify(v));
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

/** The id `${prefix}${n}` that is not taken in `list`. */
function freshId(prefix, list) {
  const taken = new Set(list.map((x) => x.id));
  let n = list.length + 1;
  while (taken.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/** Catalog skills as `{ identifier, name, movement }`, movement skills first, then by name. */
function catalogSkills() {
  const rows = offeredEntries('skills')
    .map((s) => ({ identifier: s?.system?.identifier, name: s?.name, movement: (s?.system?.tags ?? []).includes(MOVEMENT_SKILL_TAG) }))
    .filter((s) => typeof s.identifier === 'string' && s.identifier && typeof s.name === 'string');
  return rows.sort((a, b) => Number(b.movement) - Number(a.movement) || a.name.localeCompare(b.name));
}

/**
 * RollTables a leg can be drawn from: the world's (the item sheets' table picker), then every RollTable compendium's
 * index. Each is `{ uuid, name, group }`.
 */
async function drawableTables() {
  const rows = (await getAvailableRollTables()).map((tb) => ({ uuid: tb.uuid, name: tb.name, group: 'world' }));
  for (const pack of globalThis.game?.packs ?? []) {
    if (pack?.documentName !== 'RollTable') continue;
    for (const entry of pack.index ?? []) {
      const uuid = entry?.uuid ?? (entry?._id ? `Compendium.${pack.collection}.RollTable.${entry._id}` : '');
      if (uuid && typeof entry?.name === 'string') rows.push({ uuid, name: entry.name, group: pack.title ?? pack.collection });
    }
  }
  return rows;
}

export class COGContestTrackerApp extends COGToolApp {
  static DEFAULT_OPTIONS = {
    id: 'cog-contest-tracker',
    classes: ['cog-sheet-window', 'cog-contest-tracker-window'],
    window: { title: 'COG.Contest.Tracker.Title', icon: 'fa-solid fa-flag-checkered', resizable: true },
    position: { width: 720, height: 'auto' },
    actions: {
      postContest: COGContestTrackerApp.#onPostContest,
      newContest: COGContestTrackerApp.#onNewContest,
      selectContest: COGContestTrackerApp.#onSelectContest,
      repostCard: COGContestTrackerApp.#onRepostCard,
      addSelected: COGContestTrackerApp.#onAddSelected,
      addCombatants: COGContestTrackerApp.#onAddCombatants,
      removeParticipant: COGContestTrackerApp.#onRemoveParticipant,
      addLeg: COGContestTrackerApp.#onAddLeg,
      removeLeg: COGContestTrackerApp.#onRemoveLeg,
      editField: COGContestTrackerApp.#onEditField,
      openLeg: COGContestTrackerApp.#onOpenLeg,
      closeLeg: COGContestTrackerApp.#onCloseLeg,
      endContest: COGContestTrackerApp.#onEndContest,
      setResult: COGContestTrackerApp.#onSetResult,
      markOut: COGContestTrackerApp.#onMarkOut,
      clearOut: COGContestTrackerApp.#onClearOut,
      setOverride: COGContestTrackerApp.#onSetOverride,
      selectTable: COGContestTrackerApp.#onSelectTable,
      drawLeg: COGContestTrackerApp.#onDrawLeg,
      acceptProposal: COGContestTrackerApp.#onAcceptProposal,
      dismissProposal: COGContestTrackerApp.#onDismissProposal
    }
  };

  static PARTS = {
    body: { template: `${TPL}/tracker.hbs`, scrollable: [''] }
  };

  /**
   * @param {object} [options]
   * @param {string} [options.contestId] resume this contest
   */
  constructor(options = {}) {
    super(options);
    /** The contest being run, or null while drafting. */
    this.contestId = typeof options.contestId === 'string' && options.contestId ? options.contestId : null;
    /** The draft edited before the card exists. */
    this.draft = sanitizeContest({ kind: options.kind });
    /** The last `{ id, state }` read from the chat log; "Re-post contest card" uses it when the card is gone. */
    this.last = null;
    /** The RollTable (uuid) "Draw obstacle" draws from. */
    this.tableUuid = '';
    this._hookIds = [];
  }

  // -------------------------------------------------------------------------------------------------------------
  // Refresh when the contest's card changes (a player's roll ingested, a card deleted)

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    const refresh = (message) => {
      if (!this.contestId || !this.rendered) return;
      const id = message?.flags?.['sprinter-rpg']?.contestState?.id;
      if (id === this.contestId) this.render();
    };
    for (const name of ['createChatMessage', 'updateChatMessage', 'deleteChatMessage']) {
      // Foundry's `Hooks.on` returns an id and `Hooks.off` takes it (or the function).
      this._hookIds.push([name, globalThis.Hooks?.on?.(name, refresh) ?? refresh]);
    }
  }

  /** @override */
  async _onClose(options) {
    for (const [name, hookId] of this._hookIds) globalThis.Hooks?.off?.(name, hookId);
    this._hookIds = [];
    return super._onClose?.(options);
  }

  // -------------------------------------------------------------------------------------------------------------
  // State

  /** The state being shown: the contest's (kept as `last`), the last read when its card is gone, or the draft. */
  #read() {
    if (!this.contestId) return { wrapper: { id: null, state: this.draft }, missing: false };
    const live = getContest(this.contestId);
    if (live) { this.last = live; return { wrapper: live, missing: false }; }
    return { wrapper: this.last ?? { id: this.contestId, state: sanitizeContest(null) }, missing: true };
  }

  /**
   * Apply a change to the draft or, with a contest chosen, to the contest on its card. The change may return `false`
   * to leave things as they are.
   */
  async #mutate(change) {
    if (!this.contestId) {
      const next = clone(this.draft);
      if ((await change(next, { resolve: resolveActorByUuid })) !== false) this.draft = sanitizeContest(next);
    } else {
      const res = await updateContest(this.contestId, (state, ctx) => change(state, ctx));
      if (!res.ok && res.reason === 'not-gm') notify('warn', t('COG.Contest.Tracker.GmOnly'));
      if (!res.ok && res.reason === 'no-contest') notify('warn', t('COG.Contest.Tracker.CardMissing'));
    }
    return this.render();
  }

  // -------------------------------------------------------------------------------------------------------------
  // Context

  /** A proposed skill's name: the catalog's, else the proposing actor's own skill item, else the identifier. */
  #proposalName(identifier, actor) {
    const own = [...(actor?.items ?? [])].find((i) => i?.type === 'skill' && i.system?.identifier === identifier);
    return catalogSkills().find((s) => s.identifier === identifier)?.name ?? own?.name ?? identifier;
  }

  /** Skill picker groups with `selected` set for one row. */
  #skillGroups(selected) {
    const all = catalogSkills();
    const known = new Set(all.map((s) => s.identifier));
    const option = (s) => ({ value: s.identifier, label: s.name, selected: s.identifier === selected });
    const groups = [
      { label: t('COG.Contest.Tracker.SkillMovement'), options: all.filter((s) => s.movement).map(option) },
      { label: t('COG.Contest.Tracker.SkillOther'), options: all.filter((s) => !s.movement).map(option) }
    ];
    // A skill id the catalog does not carry (an actor's own skill, or a module's) stays visible and selected.
    if (selected && !known.has(selected)) groups.unshift({ label: t('COG.Contest.Tracker.SkillCustom'), options: [{ value: selected, label: selected, selected: true }] });
    return groups.filter((g) => g.options.length);
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const { wrapper, missing } = this.#read();
    const { state } = wrapper;
    const resolve = resolveActorByUuid;
    const running = Boolean(this.contestId);
    const kindInfo = contestKindInfo(state.kind);

    const participants = state.participants.map((p) => {
      const actor = resolve(p.actorUuid);
      const isMob = actor?.type === 'mob';
      return {
        id: p.id, name: p.name, isMob, missingActor: !actor,
        roles: kindInfo.roles.map((r) => ({ value: r, label: r, selected: r === p.role })),
        mode: p.mode, rolls: p.mode === 'roll', fixedLocked: isMob,
        isOut: Boolean(p.out), outText: p.out ? `${p.out.reason}${p.out.leg ? ` (${p.out.leg})` : ''}` : '',
        derivedOut: participantIsOut(state, p.id, resolve)
      };
    });

    const rollingNow = () => state.participants.filter((p) => p.mode === 'roll' && !participantIsOut(state, p.id, resolve));
    const legs = state.legs.map((leg) => {
      const row = state.results[leg.id] ?? {};
      const editable = leg.status !== 'closed';
      const rolling = rollingNow();
      return {
        id: leg.id, label: leg.label, status: leg.status,
        isPending: leg.status === 'pending', isOpen: leg.status === 'open', isClosed: leg.status === 'closed',
        canOpen: running && leg.status !== 'open' && leg.status !== 'closed',
        canClose: running && leg.status === 'open',
        // Hint only (D7): every participant who rolls has a result, so the GM can close.
        allIn: leg.status === 'open' && rolling.length > 0 && rolling.every((p) => row[p.id]),
        skillBlank: !leg.check.skill,
        skillGroups: this.#skillGroups(leg.check.skill),
        stats: STATS.map((s) => ({ value: s, label: s.toUpperCase(), selected: s === leg.check.stat })),
        moveModes: MOVE_MODES.map((m) => ({ value: m, label: m, selected: m === leg.moveMode })),
        rows: state.participants.map((p) => {
          const r = row[p.id];
          const proposal = p.skillProposals[leg.id] ?? '';
          const assigned = participantLegSkill(p, leg);
          return {
            participantId: p.id, name: p.name, rolls: p.mode === 'roll',
            result: r ? { total: r.total, source: r.source, ruleBreak: r.ruleBreak, note: r.note } : null,
            sourceLabel: r ? t(`COG.Contest.Tracker.Source.${r.source}`) : '',
            overridable: editable && p.mode === 'roll',
            overrideBlank: !p.skillOverrides[leg.id],
            overrideGroups: editable && p.mode === 'roll' ? this.#skillGroups(p.skillOverrides[leg.id] ?? '') : [],
            overridden: assigned.overridden,
            proposal, proposalName: proposal ? this.#proposalName(proposal, resolveActorByUuid(p.actorUuid)) : ''
          };
        })
      };
    });

    let standings = [];
    if (state.legs.length && state.participants.length) {
      if (state.kind === 'chase') {
        const st = chaseStatus(state, resolve);
        standings = st.chasers.map((c) => ({
          name: state.participants.find((p) => p.id === c.id)?.name ?? c.id,
          text: `${t('COG.Contest.Tracker.Ground')} ${signed(c.ground)}${c.state === 'active' ? '' : `, ${c.state}`}`
        }));
      } else {
        const st = raceStandings(state, resolve);
        standings = st.rows.map((r) => ({
          name: state.participants.find((p) => p.id === r.id)?.name ?? r.id,
          text: r.places.length ? `${r.places.map((n) => n ?? '-').join(' / ')} = ${r.sum}` : '-'
        }));
      }
    }

    const contests = listContests();
    const tables = await drawableTables();
    const tableGroups = [...new Set(tables.map((tb) => tb.group))].map((group) => ({
      label: group === 'world' ? t('COG.Contest.Tracker.TablesWorld') : group,
      options: tables.filter((tb) => tb.group === group).map((tb) => ({ value: tb.uuid, label: tb.name, selected: tb.uuid === this.tableUuid }))
    }));
    return Object.assign(context, {
      running, missing, tableGroups, hasTables: tables.length > 0, tableBlank: !this.tableUuid,
      kinds: Object.values(CONTEST_KINDS).map((k) => ({ value: k.id, label: k.label, selected: k.id === state.kind })),
      kindHint: kindInfo.hint ?? '',
      isChase: state.kind === 'chase',
      thresholds: state.thresholds,
      floor: running ? state.floor : getCurrentFloor(),
      status: state.status,
      done: state.status === 'done',
      participants, hasParticipants: participants.length > 0,
      legs, hasLegs: legs.length > 0,
      standings,
      contests: contests.map((c) => ({ id: c.id, label: `${contestKindInfo(c.state.kind).label} (${c.state.status}, ${c.state.participants.length})`, selected: c.id === this.contestId })),
      hasContests: contests.length > 0,
      canPost: !running && participants.length > 0 && legs.length > 0
    });
  }

  // -------------------------------------------------------------------------------------------------------------
  // Actions (all run with `this` = the app)

  /** Participant rows for actors not already in the contest. */
  #newParticipants(entries, state) {
    const have = new Set(state.participants.map((p) => p.actorUuid));
    const role = contestKindInfo(state.kind).roles[0];
    const added = [];
    for (const { actor, token } of entries) {
      if (!actor?.uuid || have.has(actor.uuid)) continue;
      have.add(actor.uuid);
      added.push({
        id: freshId('p-', [...state.participants, ...added]),
        actorUuid: actor.uuid, tokenId: token?.id ?? '', name: token?.name || actor.name || 'Participant',
        role, mode: actor.type === 'crawler' ? 'roll' : 'fixed', vehicleUuid: null, out: null
      });
    }
    return added;
  }

  static async #onAddSelected() {
    const tokens = globalThis.canvas?.tokens?.controlled ?? [];
    if (!tokens.length) return notify('warn', t('COG.Contest.Tracker.NoTokens'));
    return this.#mutate((state) => {
      const added = this.#newParticipants(tokens.map((tk) => ({ actor: tk.actor, token: tk.document ?? tk })), state);
      if (!added.length) return false;
      state.participants.push(...added);
    });
  }

  static async #onAddCombatants() {
    const combatants = Array.from(globalThis.game?.combat?.combatants ?? []);
    if (!combatants.length) return notify('warn', t('COG.Contest.Tracker.NoCombatants'));
    return this.#mutate((state) => {
      const added = this.#newParticipants(combatants.map((c) => ({ actor: c.actor, token: c.token })), state);
      if (!added.length) return false;
      state.participants.push(...added);
    });
  }

  static async #onRemoveParticipant(event, target) {
    const id = target?.dataset?.participantId;
    return this.#mutate((state) => {
      const before = state.participants.length;
      state.participants = state.participants.filter((p) => p.id !== id);
      return state.participants.length !== before ? undefined : false;
    });
  }

  static async #onAddLeg() {
    const skills = catalogSkills();
    const skill = skills.find((s) => s.identifier === 'running')?.identifier ?? null;
    return this.#mutate((state) => {
      state.legs.push({
        id: freshId('leg-', state.legs), label: `Leg ${state.legs.length + 1}`,
        check: { skill, stat: skill ? governingStat(null, skill) : 'dex' }, moveMode: 'move', status: 'pending'
      });
      if (state.status === 'done') state.status = 'leg';
    });
  }

  static async #onRemoveLeg(event, target) {
    const id = target?.dataset?.legId;
    return this.#mutate((state) => {
      const leg = state.legs.find((l) => l.id === id);
      if (!leg || leg.status !== 'pending') return false; // only an unopened leg; results would be lost
      state.legs = state.legs.filter((l) => l.id !== id);
    });
  }

  /**
   * One handler for every plain field: `data-scope` (`meta`, `leg`, `participant`), `data-id`, `data-field`.
   * A leg's skill also fills its stat from the catalog (the GM can change the stat after).
   */
  static async #onEditField(event, target) {
    const { scope, id, field } = target?.dataset ?? {};
    const raw = target?.value;
    return this.#mutate((state, ctx) => {
      if (scope === 'meta') {
        if (field === 'kind') state.kind = raw;
        else if (field === 'catch') state.thresholds.catch = Number(raw);
        else if (field === 'lose') state.thresholds.lose = Number(raw);
        else return false;
        return undefined;
      }
      if (scope === 'leg') {
        const leg = state.legs.find((l) => l.id === id);
        if (!leg) return false;
        if (field === 'label') leg.label = raw;
        else if (field === 'skill') {
          leg.check.skill = raw || null;
          if (raw) leg.check.stat = governingStat(null, raw);
        } else if (field === 'stat') leg.check.stat = raw;
        else if (field === 'moveMode') leg.moveMode = raw;
        else return false;
        return undefined;
      }
      if (scope === 'participant') {
        const p = state.participants.find((x) => x.id === id);
        if (!p) return false;
        if (field === 'role') p.role = raw;
        else if (field === 'mode') {
          // Mobs never roll (D6): their mode stays fixed whatever the toggle says.
          p.mode = target.checked === false && ctx?.resolve?.(p.actorUuid)?.type !== 'mob' ? 'roll' : 'fixed';
        }
        else if (field === 'name') p.name = raw;
        else return false;
        return undefined;
      }
      return false;
    });
  }

  static async #onPostContest() {
    if (this.contestId) return undefined;
    const sanitized = sanitizeContest(this.draft);
    const res = await postContestCard({ ...sanitized, status: 'setup', floor: getCurrentFloor() });
    if (!res) return notify('warn', t('COG.Contest.Tracker.GmOnly'));
    this.contestId = res.id;
    return this.render();
  }

  static async #onNewContest() {
    this.contestId = null;
    this.last = null;
    this.draft = sanitizeContest(null);
    return this.render();
  }

  static async #onSelectContest(event, target) {
    const id = target?.value;
    if (!id) return COGContestTrackerApp.#onNewContest.call(this);
    this.contestId = id;
    this.last = null;
    return this.render();
  }

  static async #onRepostCard() {
    if (!this.contestId || !this.last) return undefined;
    const res = await repostContestCard(this.last);
    if (!res) notify('warn', t('COG.Contest.Tracker.GmOnly'));
    return this.render();
  }

  static async #onOpenLeg(event, target) {
    if (!this.contestId) return undefined;
    await openLeg(this.contestId, target?.dataset?.legId);
    return this.render();
  }

  static async #onCloseLeg(event, target) {
    if (!this.contestId) return undefined;
    await closeLeg(this.contestId, target?.dataset?.legId);
    return this.render();
  }

  static async #onEndContest() {
    if (!this.contestId) return undefined;
    await endContest(this.contestId);
    return this.render();
  }

  /** The GM types a result for a participant on a leg (blank is ignored). */
  static async #onSetResult(event, target) {
    if (!this.contestId) return undefined;
    const { legId, participantId } = target?.dataset ?? {};
    if (target?.value === '' || target?.value === undefined) return undefined;
    const res = await setGmResult(this.contestId, legId, participantId, target.value);
    if (res && !res.ok && res.reason === 'bad-total') notify('warn', t('COG.Contest.Tracker.BadTotal'));
    return this.render();
  }

  static async #onMarkOut(event, target) {
    if (!this.contestId) return undefined;
    const open = getContest(this.contestId)?.state.legs.find((l) => l.status === 'open');
    await markParticipantOut(this.contestId, target?.dataset?.participantId, open?.id ?? null, 'dropped');
    return this.render();
  }

  static async #onClearOut(event, target) {
    const id = target?.dataset?.participantId;
    return this.#mutate((state) => {
      const p = state.participants.find((x) => x.id === id);
      if (!p?.out) return false;
      p.out = null;
    });
  }

  /** Set or clear the participant's accepted skill for a leg. In setup it edits the draft. */
  static async #onSetOverride(event, target) {
    const { participantId, legId } = target?.dataset ?? {};
    if (this.contestId) {
      await setSkillOverride(this.contestId, participantId, legId, target?.value ?? '');
      return this.render();
    }
    return this.#mutate((state) => {
      const p = state.participants.find((x) => x.id === participantId);
      if (!p) return false;
      if (target?.value) p.skillOverrides[legId] = target.value; else delete p.skillOverrides[legId];
    });
  }

  static async #onSelectTable(event, target) {
    this.tableUuid = typeof target?.value === 'string' ? target.value : '';
    return this.render();
  }

  /**
   * Draw one row from the chosen RollTable into a leg: the narrative becomes its label and a `named` skill option its
   * skill (the catalog stat follows). A drawn row with no skill leaves the leg's skill alone.
   */
  static async #onDrawLeg(event, target) {
    const legId = target?.dataset?.legId;
    if (!this.tableUuid) return notify('warn', t('COG.Contest.Tracker.NoTable'));
    const draw = await drawLegFromTable(this.tableUuid);
    if (!draw) return notify('warn', t('COG.Contest.Tracker.DrawFailed'));
    return this.#mutate((state) => {
      const leg = state.legs.find((l) => l.id === legId);
      return applyLegDraw(leg, draw, (skill) => governingStat(null, skill)) ? undefined : false;
    });
  }

  static async #onAcceptProposal(event, target) {
    if (!this.contestId) return undefined;
    await acceptSkillProposal(this.contestId, target?.dataset?.participantId, target?.dataset?.legId);
    return this.render();
  }

  static async #onDismissProposal(event, target) {
    if (!this.contestId) return undefined;
    await dismissSkillProposal(this.contestId, target?.dataset?.participantId, target?.dataset?.legId);
    return this.render();
  }
}
