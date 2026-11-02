/**
 * Sprinter RPG — Rapid Batch Importer
 * 
 * Provides an ultra-fast in-person play transcription and batch entry interface.
 * GMs or scribes can paste raw bullet points, chat lines, or speech-to-text transcripts
 * to rapidly parse, review, tweak, and commit multiple player rolls and combat results
 * into the active session ledger in a single click.
 */

import { COGToolApp } from './tool-app.mjs';
import { COGSessionEngine, COG_ROLL_OUTCOMES, COG_OUTCOME_CONFIG } from './session-manager.mjs';
import { COGRapidTextParser } from './rapid-text-parser.mjs';
import { SYSTEM_PATH } from '../constants.mjs';
import { lootBoxTierOptions } from '../data/loot-box-tiers.mjs';

const TPL = `${SYSTEM_PATH}/templates/apps/rapid-batch-import`;

export class COGRapidBatchImportApp extends COGToolApp {
  static DEFAULT_OPTIONS = {
    id: 'cog-rapid-batch-import',
    classes: ['cog-rapid-batch-import-app'],
    window: { title: '⚡ Rapid Batch Roll & Event Importer', icon: 'fa-solid fa-bolt', resizable: true },
    position: { width: 940, height: 700 },
    actions: {
      loadSample: COGRapidBatchImportApp.#onLoadSample,
      clearAll: COGRapidBatchImportApp.#onClearAll,
      setDefaultCrawler: COGRapidBatchImportApp.#onSetDefaultCrawler,
      insertChip: COGRapidBatchImportApp.#onInsertChip,
      setRawText: COGRapidBatchImportApp.#onSetRawText,
      refreshAutocomplete: COGRapidBatchImportApp.#onRefreshAutocomplete,
      parseText: COGRapidBatchImportApp.#onParseText,
      addRow: COGRapidBatchImportApp.#onAddRow,
      deleteRow: COGRapidBatchImportApp.#onDeleteRow,
      editRow: COGRapidBatchImportApp.#onEditRow,
      commit: COGRapidBatchImportApp.#onCommit
    }
  };

  // The textarea lives in `input`, which only re-renders when the text itself is replaced
  // (sample / clear), so typing and parsing never recreate it.
  static PARTS = {
    header: { template: `${TPL}/header.hbs` },
    input: { template: `${TPL}/input.hbs`, scrollable: ['.cog-rapid-textarea'] },
    preview: { template: `${TPL}/preview.hbs`, scrollable: ['.cog-rapid-preview-scroll'] },
    footer: { template: `${TPL}/footer.hbs` }
  };

  constructor(options = {}) {
    super(options);
    this.sessionId = options.sessionId || COGSessionEngine.getActiveSessionId();
    this.rawText = options.rawText || '';
    this.defaultActorId = options.defaultActorId || '';
    this._currentSuggestions = [];
    this._autocompleteIndex = 0;
    this.parsedEvents = [];
  }

  /** Autocomplete keyboard handling for the textarea, delegated once at the root. @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.element.addEventListener('keydown', (event) => {
      if (event.target?.closest?.('.cog-rapid-textarea')) this._onTextareaKeydown(event);
    });
    // The suggestion list closes on any pointerdown outside it and the textarea, so it never gets between the GM and a button.
    this.element.addEventListener('pointerdown', (event) => this._onRootPointerDown(event));
  }

  /** Hide the autocomplete list when the pointer goes down anywhere but the textarea or the list itself. */
  _onRootPointerDown(event) {
    if (event.target?.closest?.('.cog-rapid-textarea, .cog-rapid-autocomplete-dropdown')) return;
    const dropdown = this.element?.querySelector('.cog-rapid-autocomplete-dropdown');
    if (dropdown) dropdown.style.display = 'none';
    this._currentSuggestions = [];
  }

  /** Re-render the parts that depend on the parsed rows. */
  _renderRows() {
    return this.render({ parts: ['preview', 'footer'] });
  }

  /** @override */
  async _prepareContext(options = {}) {
    const base = await super._prepareContext(options);
    const sessions = COGSessionEngine.getAllSessions();
    const session = sessions.find(s => s.id === this.sessionId) || await COGSessionEngine.getActiveSession();
    const crawlers = COGSessionEngine.getPartyCrawlers({ sessionId: this.sessionId, trackedOnly: false });

    // Fallback default actor to first party crawler if not set
    if (!this.defaultActorId && crawlers.length > 0) {
      this.defaultActorId = crawlers[0].id;
    }

    // Cache action options per crawler for instant intelligent autocomplete
    const crawlerActionMap = {};
    for (const c of crawlers) {
      crawlerActionMap[c.id] = COGSessionEngine.getCrawlerActionOptions(c.id);
    }

    const typeOptions = [
      { key: 'skill', label: 'Trained Skill' },
      { key: 'untrained_skill', label: 'Untrained Skill' },
      { key: 'attack', label: 'Attack / Strike' },
      { key: 'spell', label: 'Spell Cast' },
      { key: 'condition_applied', label: 'Condition Applied' },
      { key: 'condition_removed', label: 'Condition Removed' },
      { key: 'damage_dealt', label: 'Damage Dealt' },
      { key: 'damage_taken', label: 'Damage Taken' },
      { key: 'damage_mitigated', label: 'Damage Mitigated' },
      { key: 'favor', label: 'AI Favor' },
      { key: 'popularity', label: 'Popularity' },
      { key: 'loot', label: 'Loot Box' },
      { key: 'manual', label: 'Manual Event' }
    ];

    const outcomeOptions = Object.entries(COG_OUTCOME_CONFIG).map(([k, v]) => ({
      key: k,
      label: v.label,
      badge: v.badge,
      class: v.class
    }));

    // Precomputed quick-insert chips
    const quickChips = {
      crawlers: crawlers.map(c => ({ label: c.name, insert: c.name })),
      tactical: ['Interrupt', 'Call a Play', 'Look for Clues', 'Dodge', 'Taunt', 'Catcher', 'Intervene'].map(a => ({ label: a, insert: a })),
      outcomes: ['nat 20 crit', 'nat 1 fail', 'hit', 'miss', '18 vs 14'].map(o => ({ label: o, insert: o })),
      metrics: ['10 dmg', '8 healing', '5 blocked', 'killing blow', 'untrained'].map(m => ({ label: m, insert: m })),
      conditions: ['applied Stunned', 'inflicted Bleeding', 'cured Poison', 'applied Burning', 'applied Blinded'].map(c => ({ label: c, insert: c }))
    };

    // Attach presentation metadata to parsed events
    const displayEvents = this.parsedEvents.map((evt, idx) => {
      const actor = crawlers.find(c => c.id === evt.actorId);
      const outcomeConf = COG_OUTCOME_CONFIG[evt.outcome] || COG_OUTCOME_CONFIG.pending;
      return {
        ...evt,
        index: idx,
        displayIndex: idx + 1,
        isLoot: evt.type === 'loot',
        lootTierOptions: lootBoxTierOptions(evt.tier),
        actorName: actor?.name || 'Party / Crawler',
        actorImg: actor?.img || 'icons/svg/mystery-man.svg',
        outcomeClass: outcomeConf.class,
        outcomeBadge: outcomeConf.badge
      };
    });

    return {
      ...base,
      session,
      sessionId: session?.id || '',
      sessionTitle: session?.title || 'Active Session',
      crawlers,
      defaultActorId: this.defaultActorId,
      rawText: this.rawText,
      parsedEvents: displayEvents,
      hasEvents: displayEvents.length > 0,
      totalEvents: displayEvents.length,
      typeOptions,
      outcomeOptions,
      quickChips,
      crawlerActionMap
    };
  }

  static async #onLoadSample() {
    this._loadSampleNotes();
    // The textarea content changed, so the input part has to be replaced too.
    await this.render({ parts: ['input'] });
  }

  static async #onClearAll() {
    this.rawText = '';
    this.parsedEvents = [];
    await this.render();
  }

  static #onSetDefaultCrawler(event, target) {
    this.defaultActorId = target.value;
  }

  static #onInsertChip(event, target) {
    const insertText = target.dataset.insert;
    if (insertText) this._insertChipText(insertText, this.element);
  }

  static #onSetRawText(event, target) {
    this.rawText = target.value;
    this._updateAutocomplete(this.element);
  }

  static #onRefreshAutocomplete() {
    this._updateAutocomplete(this.element);
  }

  static #onParseText() {
    this._parseCurrentText();
  }

  static #onAddRow() {
    this._addBlankRow();
  }

  static async #onDeleteRow(event, target) {
    const rowIdx = parseInt(target.dataset.index, 10);
    if (!isNaN(rowIdx) && this.parsedEvents[rowIdx]) {
      this.parsedEvents.splice(rowIdx, 1);
      await this._renderRows();
    }
  }

  /** Keep this.parsedEvents in sync with an inline-edited row control (no re-render). */
  static #onEditRow(event, target) {
    const rowIdx = parseInt(target.dataset.index, 10);
    const field = target.dataset.field;
    if (isNaN(rowIdx) || !this.parsedEvents[rowIdx] || !field) return;

    const val = target.value;
    if (['total', 'targetDC', 'damage', 'healing', 'mitigation', 'statDelta'].includes(field)) {
      this.parsedEvents[rowIdx][field] = val === '' ? null : Number(val);
    } else if (['isUntrained', 'isKill'].includes(field)) {
      this.parsedEvents[rowIdx][field] = target.checked;
    } else {
      this.parsedEvents[rowIdx][field] = val;
    }
    // The tier select belongs to loot rows only.
    if (field === 'type') {
      const tierSelect = target.closest('td')?.querySelector('[data-field="tier"]');
      if (tierSelect) tierSelect.hidden = val !== 'loot';
    }
  }

  static async #onCommit() {
    await this._commitBatch();
  }

  /**
   * Insert text from a quick-insert chip into the textarea at current cursor
   */
  _insertChipText(textToInsert, root) {
    const textarea = root.querySelector('.cog-rapid-textarea');
    if (!textarea) return;

    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const currentVal = textarea.value;

    // Add leading space if needed
    const needsLeadingSpace = start > 0 && !/\s/.test(currentVal.charAt(start - 1));
    const toAdd = (needsLeadingSpace ? ' ' : '') + textToInsert + ' ';

    textarea.value = currentVal.slice(0, start) + toAdd + currentVal.slice(end);
    this.rawText = textarea.value;

    const newPos = start + toAdd.length;
    textarea.focus();
    if (typeof textarea.setSelectionRange === 'function') {
      textarea.setSelectionRange(newPos, newPos);
    }

    // Trigger autocomplete update for subsequent phase
    this._updateAutocomplete(root);
  }

  /**
   * Order-aware intelligent autocomplete keyboard handling:
   * 1. Character names first
   * 2. Actions, spells, skills second
   * 3. Outcomes, metrics, conditions, flags third
   * @param {KeyboardEvent} e
   */
  _onTextareaKeydown(e) {
    const root = this.element;
    const dropdown = root?.querySelector('.cog-rapid-autocomplete-dropdown');
    if (!dropdown || !this._currentSuggestions?.length || dropdown.style.display === 'none') return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._autocompleteIndex = (this._autocompleteIndex + 1) % this._currentSuggestions.length;
      this._renderDropdownItems(dropdown, root);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._autocompleteIndex = (this._autocompleteIndex - 1 + this._currentSuggestions.length) % this._currentSuggestions.length;
      this._renderDropdownItems(dropdown, root);
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      const item = this._currentSuggestions[this._autocompleteIndex];
      if (item) {
        e.preventDefault();
        this._applyAutocompleteSuggestion(item, root);
      }
    } else if (e.key === 'Escape') {
      dropdown.style.display = 'none';
      this._currentSuggestions = [];
    }
  }

  /**
   * Evaluate cursor position on current line and update autocomplete suggestions
   */
  _updateAutocomplete(root) {
    const textarea = root.querySelector('.cog-rapid-textarea');
    const dropdown = root.querySelector('.cog-rapid-autocomplete-dropdown');
    if (!textarea || !dropdown) return;

    const cursor = textarea.selectionStart ?? textarea.value.length;
    const textBefore = textarea.value.slice(0, cursor);
    const lineStart = textBefore.lastIndexOf('\n') + 1;
    const lineBeforeCursor = textBefore.slice(lineStart);

    const crawlers = COGSessionEngine.getPartyCrawlers({ sessionId: this.sessionId, trackedOnly: false });
    const suggestions = this._getSuggestionsForContext(lineBeforeCursor, crawlers);

    this._currentSuggestions = suggestions;
    this._autocompleteIndex = 0;

    if (!suggestions.length) {
      dropdown.style.display = 'none';
      return;
    }

    dropdown.style.display = 'flex';
    this._renderDropdownItems(dropdown, root);
  }

  /**
   * Compute context-aware suggestions knowing the order of events
   */
  _getSuggestionsForContext(lineBeforeCursor, crawlers) {
    const trimmed = lineBeforeCursor.trimStart();
    const hasTrailingSpace = /\s$/.test(lineBeforeCursor);
    const cleanTokens = trimmed.trim().length ? trimmed.trim().split(/\s+/) : [];
    const currentWord = hasTrailingSpace ? '' : (cleanTokens[cleanTokens.length - 1] || '');

    // Phase 1: Crawler Names First
    // Triggered if on first word of the line
    if (cleanTokens.length === 0 || (cleanTokens.length === 1 && !hasTrailingSpace)) {
      const matchWord = currentWord.toLowerCase();
      const crawlerSuggestions = crawlers
        .filter(c => !matchWord || c.name.toLowerCase().includes(matchWord))
        .map(c => ({
          text: c.name,
          label: c.name,
          badge: 'CRAWLER',
          badgeColor: 'var(--cog-danger-fill)',
          icon: 'fa-user'
        }));
      return crawlerSuggestions;
    }

    // Determine if first word is a known crawler
    const firstWord = cleanTokens[0]?.toLowerCase() || '';
    const matchedCrawler = crawlers.find(c => {
      const cLow = c.name.toLowerCase();
      return cLow === firstWord || cLow.startsWith(firstWord);
    }) || crawlers.find(c => c.id === this.defaultActorId);

    const actionOpts = matchedCrawler
      ? COGSessionEngine.getCrawlerActionOptions(matchedCrawler.id)
      : COGSessionEngine.getCrawlerActionOptions(this.defaultActorId);

    // Phase 2: Actions / Skills / Spells Second
    // Triggered if crawler is identified and we are on the 2nd token (or 3rd if 2-word crawler)
    const isActionPhase = (cleanTokens.length === 1 && hasTrailingSpace) ||
                          (cleanTokens.length === 2 && !hasTrailingSpace);

    if (isActionPhase) {
      const matchWord = currentWord.toLowerCase();
      const actionItems = [];

      // Add Tactical Defaults
      for (const def of (actionOpts.defaults || [])) {
        const defName = typeof def === 'string' ? def : def.name;
        if (!defName) continue;
        const insertText = (defName === 'Dodge / Evade') ? 'Dodge' : defName;
        if (!matchWord || defName.toLowerCase().includes(matchWord) || insertText.toLowerCase().includes(matchWord)) {
          actionItems.push({
            text: insertText,
            label: defName,
            badge: 'TACTICAL',
            badgeColor: 'var(--cog-info-fill)',
            icon: 'fa-shield-halved'
          });
        }
      }

      // Add Trained Skills
      for (const sk of (actionOpts.skills || [])) {
        const skName = typeof sk === 'string' ? sk : sk.name;
        if (!skName) continue;
        if (!matchWord || skName.toLowerCase().includes(matchWord)) {
          actionItems.push({
            text: skName,
            label: sk.displayName || `${skName} (Rank ${sk.rank || 1})`,
            badge: 'SKILL',
            badgeColor: 'var(--cog-success-fill)',
            icon: 'fa-graduation-cap'
          });
        }
      }

      // Add Spells & Attacks
      for (const sp of (actionOpts.spells || [])) {
        const spName = typeof sp === 'string' ? sp : sp.name;
        if (!spName) continue;
        if (!matchWord || spName.toLowerCase().includes(matchWord)) {
          actionItems.push({
            text: spName,
            label: `${spName} (${sp.mp || 0} MP)`,
            badge: 'SPELL',
            badgeColor: 'var(--cog-magic-fill)',
            icon: 'fa-wand-magic-sparkles'
          });
        }
      }
      for (const at of (actionOpts.attacks || [])) {
        const atName = typeof at === 'string' ? at : at.name;
        if (!atName) continue;
        if (!matchWord || atName.toLowerCase().includes(matchWord)) {
          actionItems.push({
            text: atName,
            label: atName,
            badge: 'ATTACK',
            badgeColor: 'var(--cog-warning-fill)',
            icon: 'fa-hand-fist'
          });
        }
      }

      // Add Common Untrained
      for (const un of (actionOpts.commonUntrained || [])) {
        const unName = typeof un === 'string' ? un : un.name;
        if (!unName) continue;
        if (!matchWord || unName.toLowerCase().includes(matchWord)) {
          actionItems.push({
            text: unName,
            label: un.displayName || `${unName} [Untrained]`,
            badge: 'UNTRAINED',
            badgeColor: 'var(--cog-danger-fill)',
            icon: 'fa-circle-question'
          });
        }
      }

      return actionItems.slice(0, 12);
    }

    // Phase 3: Outcomes, Metrics, Conditions, Flags Third
    // Triggered when crawler and action are already entered
    const matchWord = currentWord.toLowerCase();
    const outcomeAndMetricItems = [
      // Outcomes & Crits
      { text: 'nat 20 crit', label: 'Nat 20 (Critical Success)', badge: 'CRIT', badgeColor: 'var(--cog-gold-fill)', icon: 'fa-star' },
      { text: 'nat 1 fail', label: 'Nat 1 (Critical Failure)', badge: 'FUMBLE', badgeColor: 'var(--cog-accent-strong-fill)', icon: 'fa-skull' },
      { text: 'hit', label: 'Hit / Success', badge: 'OUTCOME', badgeColor: 'var(--cog-success-fill)', icon: 'fa-check' },
      { text: 'miss', label: 'Miss / Failure', badge: 'OUTCOME', badgeColor: 'var(--cog-neutral-fill)', icon: 'fa-xmark' },

      // Metrics & Flags
      { text: 'killing blow', label: 'Killing Blow', badge: 'KILL', badgeColor: 'var(--cog-accent-fill)', icon: 'fa-skull-crossbones' },
      { text: 'untrained', label: 'Untrained Check', badge: 'FLAG', badgeColor: 'var(--cog-danger-fill)', icon: 'fa-circle-question' },
      { text: '10 dmg', label: '10 Damage Dealt', badge: 'DMG', badgeColor: 'var(--cog-danger-fill)', icon: 'fa-fire' },
      { text: '8 healing', label: '8 Healing Done', badge: 'HEAL', badgeColor: 'var(--cog-success-fill)', icon: 'fa-heart-pulse' },
      { text: '5 blocked', label: '5 Damage Blocked/Mitigated', badge: 'MIT', badgeColor: 'var(--cog-info-fill)', icon: 'fa-shield' },

      // Conditions
      { text: 'applied Stunned', label: 'Applied Stunned', badge: 'CONDITION', badgeColor: 'var(--cog-warning-fill)', icon: 'fa-biohazard' },
      { text: 'inflicted Bleeding', label: 'Inflicted Bleeding', badge: 'CONDITION', badgeColor: 'var(--cog-accent-fill)', icon: 'fa-droplet' },
      { text: 'applied Burning', label: 'Applied Burning', badge: 'CONDITION', badgeColor: 'var(--cog-warning-fill)', icon: 'fa-fire-flame-curved' },
      { text: 'cured Poison', label: 'Cured Poison', badge: 'CURED', badgeColor: 'var(--cog-success-fill)', icon: 'fa-circle-check' },
      { text: 'applied Blinded', label: 'Applied Blinded', badge: 'CONDITION', badgeColor: 'var(--cog-neutral-fill)', icon: 'fa-eye-slash' },
      { text: 'applied Prone', label: 'Applied Prone', badge: 'CONDITION', badgeColor: 'var(--cog-neutral-fill)', icon: 'fa-person-falling' }
    ];

    return outcomeAndMetricItems.filter(item => !matchWord || item.text.toLowerCase().includes(matchWord) || item.label.toLowerCase().includes(matchWord));
  }

  /**
   * Render autocomplete items into the dropdown
   */
  _renderDropdownItems(dropdown, root) {
    if (!dropdown?.ownerDocument) return;
    const document = dropdown.ownerDocument;
    dropdown.innerHTML = '';
    this._currentSuggestions.forEach((item, idx) => {
      const el = document.createElement('div');
      el.className = `cog-rapid-autocomplete-item ${idx === this._autocompleteIndex ? 'active' : ''}`;
      el.style.cssText = `
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
        padding: 5px 8px; cursor: pointer; border-radius: 3px; font-size: 11px; font-family: 'Oswald', sans-serif;
        background: ${idx === this._autocompleteIndex ? 'var(--cog-surface-strong)' : 'transparent'};
        color: ${idx === this._autocompleteIndex ? 'var(--cog-text-strong)' : 'var(--cog-text)'};
      `;

      el.innerHTML = `
        <span style="display: flex; align-items: center; gap: 6px;">
          <i class="fa-solid ${item.icon}" style="width: 14px; text-align: center;"></i>
          <strong>${item.label}</strong>
        </span>
        <span class="cog-bg-dyn cog-text-on-fill" style="--cog-bg-dyn: ${item.badgeColor}; padding: 1px 5px; border-radius: 3px; font-size: 9px; font-weight: bold; text-transform: uppercase;">
          ${item.badge}
        </span>
      `;

      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this._applyAutocompleteSuggestion(item, root);
      });

      dropdown.appendChild(el);
    });
  }

  /**
   * Apply an autocomplete suggestion to the textarea and advance cursor
   */
  _applyAutocompleteSuggestion(item, root) {
    const textarea = root.querySelector('.cog-rapid-textarea');
    const dropdown = root.querySelector('.cog-rapid-autocomplete-dropdown');
    if (!textarea) return;

    const cursor = textarea.selectionStart ?? textarea.value.length;
    const textBefore = textarea.value.slice(0, cursor);
    const lineStart = textBefore.lastIndexOf('\n') + 1;
    const lineBeforeCursor = textBefore.slice(lineStart);

    // Identify last partial word to replace
    const hasTrailingSpace = /\s$/.test(lineBeforeCursor);
    let replaceStart = cursor;
    if (!hasTrailingSpace) {
      const matchLastWord = lineBeforeCursor.match(/\S+$/);
      if (matchLastWord) {
        replaceStart = cursor - matchLastWord[0].length;
      }
    }

    const before = textarea.value.slice(0, replaceStart);
    const after = textarea.value.slice(cursor);
    const insertion = item.text + ' ';

    textarea.value = before + insertion + after;
    this.rawText = textarea.value;

    const newPos = before.length + insertion.length;
    textarea.focus();
    if (typeof textarea.setSelectionRange === 'function') {
      textarea.setSelectionRange(newPos, newPos);
    }

    if (dropdown) {
      dropdown.style.display = 'none';
      this._currentSuggestions = [];
    }

    // Immediately trigger autocomplete for next phase!
    this._updateAutocomplete(root);
  }

  /**
   * Parse the current textarea string using COGRapidTextParser
   */
  _parseCurrentText() {
    const crawlers = COGSessionEngine.getPartyCrawlers({ sessionId: this.sessionId, trackedOnly: false });
    const parsed = COGRapidTextParser.parse(this.rawText, crawlers, this.defaultActorId);

    this.parsedEvents = parsed;
    this._renderRows();

    if (parsed.length === 0 && this.rawText.trim().length > 0) {
      if (typeof ui !== 'undefined' && ui.notifications?.warn) {
        ui.notifications.warn('No valid roll or action events could be parsed from the text.');
      }
    } else if (parsed.length > 0 && typeof ui !== 'undefined' && ui.notifications?.info) {
      ui.notifications.info(`Parsed ${parsed.length} action lines ready for review.`);
    }
  }

  /**
   * Load sample transcribed lines for instant demonstration
   */
  _loadSampleNotes() {
    const sample = [
      'Rosa Dodge 16 vs 14 blocked 5 dmg',
      'Dex Magic Missile 18 vs 12 hit 14 dmg',
      'Ana Heal 8 healing on Rosa',
      'Bo Headbutt nat 20 crit 35 dmg killing blow',
      'Ana Lockpicking 9 vs 15 untrained fail',
      'Rosa took 12 dmg from acid trap',
      'Rosa applied Stunned on Elite Goblin',
      'Party AI Favor: +5 favor for audience stunt'
    ].join('\n');

    this.rawText = sample;
    this._parseCurrentText();
  }

  /**
   * Append an empty row for quick manual entry
   */
  _addBlankRow() {
    this.parsedEvents.push({
      actorId: this.defaultActorId || 'unknown',
      name: 'Custom Action',
      type: 'skill',
      isUntrained: false,
      rollFormula: '1d20',
      total: 10,
      d20Result: null,
      targetDC: 12,
      outcome: COG_ROLL_OUTCOMES.PENDING,
      damage: 0,
      healing: 0,
      mitigation: 0,
      condition: '',
      conditionAction: 'applied',
      isKill: false,
      notes: ''
    });
    this._renderRows();
  }

  /**
   * Commit all parsed events into the active session ledger
   */
  async _commitBatch() {
    if (!this.parsedEvents.length) {
      if (typeof ui !== 'undefined' && ui.notifications?.warn) {
        ui.notifications.warn('There are no parsed events to import.');
      }
      return;
    }

    const created = await COGSessionEngine.batchCreateEvents(this.parsedEvents, this.sessionId);

    if (typeof ui !== 'undefined' && ui.notifications?.info) {
      ui.notifications.info(`⚡ Successfully imported ${created.length} rolls & events to the session!`);
    }

    // Refresh any open Session Manager windows
    COGSessionEngine._refreshOpenWindows();

    // Reset and close
    this.rawText = '';
    this.parsedEvents = [];
    await this.close();
  }
}

