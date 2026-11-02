/**
 * Sidebar directory buttons (native DOM; the directory tabs are ApplicationV2 and pass an HTMLElement).
 * `renderItemDirectory` / `renderActorDirectory` fire on every render, popped-out windows included, so no
 * V1 `renderSidebarTab` or `getApplicationHeaderButtons` hook is needed.
 */
import { COGSkillManager } from '../apps/skill-manager.mjs';
import { COGSessionManagerApp } from '../apps/session-manager.mjs';
import { COGCrawlerCreatorApp } from '../apps/crawler-creator.mjs';
import { COGClassCreatorApp } from '../apps/class-creator.mjs';
import { COGRaceCreatorApp } from '../apps/race-creator.mjs';
import { COGGrindApp } from '../apps/grind-app.mjs';
import { COGContestTrackerApp } from '../apps/contest-tracker.mjs';
import { COGTagManager } from '../apps/tag-manager.mjs';
import { COGMobCreatorApp } from '../apps/mob-creator/mob-creator-app.mjs';
import { openGlobalItemCreatorDialog } from '../apps/item-creator-dialog.mjs';
import { isMarkerActor } from '../utils/marker.mjs';

const CREATE_BUTTONS = '.create-document, .create-entry, [data-action="createEntry"], [data-action="createDocument"]';
const HEADER_ACTIONS = '.header-actions, .action-buttons, header.directory-header .action-buttons';

/** The element a directory hook should work on: the hook's `html`, else the app's own element. */
function directoryRoot(app, html) {
  const root = html?.[0] ?? html ?? app?.element;
  return root?.querySelector ? root : null;
}

/** Parse a single-element HTML snippet with the root's own document. */
function createElement(root, html) {
  const holder = root.ownerDocument.createElement('div');
  holder.innerHTML = html.trim();
  return holder.firstElementChild;
}

/** Call `handler` on click, after cancelling the default action. */
function onClick(element, handler, { stop = false } = {}) {
  element.addEventListener('click', (ev) => {
    ev.preventDefault();
    if (stop) ev.stopPropagation();
    handler(ev);
  });
}

// Helper function to inject Skill Library & Manager button into the Items Directory
export function injectItemDirectoryButtons(app, html) {
  const root = directoryRoot(app, html);
  if (!root) return;

  // Intercept the right global nav Create Item buttons to use the unified Item Builder
  for (const createBtn of root.querySelectorAll(CREATE_BUTTONS)) {
    if (createBtn.dataset.cogItemBuilder) continue;
    createBtn.dataset.cogItemBuilder = 'true';
    onClick(createBtn, () => openGlobalItemCreatorDialog(), { stop: true });
  }

  if (root.querySelector('.cog-open-skill-manager-btn')) return;

  const btn = createElement(root, `
    <button type="button" class="cog-sidebar-btn cog-sidebar-btn-wide cog-open-skill-manager-btn cog-bg-accent-fill cog-text-on-fill">
      <i class="fa-solid fa-book-bookmark"></i> Skill Library & Manager
    </button>
  `);
  onClick(btn, () => COGSkillManager.open());

  const subButton = (classes, iconClass, label, title = '') => createElement(root, `
    <button type="button" class="cog-sidebar-btn cog-sidebar-btn-sub ${classes}" ${title ? `title="${title}"` : ''}>
      <i class="${iconClass}"></i> ${label}
    </button>
  `);

  const classBtn = subButton('cog-open-class-creator-btn cog-dark cog-bg-header-fill cog-text-gold', 'fa-solid fa-graduation-cap', 'Class Studio');
  onClick(classBtn, () => new COGClassCreatorApp().render({ force: true }));

  const raceBtn = subButton('cog-open-race-creator-btn cog-bg-magic-tint cog-text-magic', 'fa-solid fa-dna', 'Race Studio');
  onClick(raceBtn, () => new COGRaceCreatorApp().render({ force: true }));

  const tagBtn = subButton('cog-open-tag-manager-btn cog-bg-info-tint cog-text-info', 'fa-solid fa-tags', 'Tag Taxonomy');
  onClick(tagBtn, () => COGTagManager.open());

  const subBtnRow = createElement(root, '<div class="cog-sidebar-btn-row"></div>');
  subBtnRow.append(classBtn, raceBtn, tagBtn);

  const btnGroup = createElement(root, '<div class="cog-item-directory-actions"></div>');
  btnGroup.append(btn, subBtnRow);

  const headerActions = root.querySelector('.header-actions');
  if (headerActions) {
    headerActions.after(btnGroup);
  } else {
    root.querySelector('.directory-footer')?.before(btnGroup);
  }
}

/**
 * Light markers are plumbing for light tokens: players never see them in the actor directory.
 * @param {HTMLElement} root the directory element
 */
export function hideMarkerEntries(root) {
  if (globalThis.game?.user?.isGM) return;
  for (const entry of root.querySelectorAll('[data-entry-id]')) {
    if (isMarkerActor(globalThis.game?.actors?.get?.(entry.dataset.entryId))) entry.remove();
  }
}

// Helper function to inject New Crawler and Session Manager buttons into the Actors Directory
export function injectActorDirectoryButtons(app, html) {
  const root = directoryRoot(app, html);
  if (!root) return;
  hideMarkerEntries(root);

  // 1. New Crawler Button next to default Create Actor button inside .header-actions
  if (!root.querySelector('.cog-create-crawler-btn-sidebar')) {
    const crawlerBtn = createElement(root, `
      <button type="button" class="create-entry cog-create-crawler-btn-sidebar" title="Open Crawler Induction Terminal">
        <i class="fa-solid fa-skull-crossbones"></i> New Crawler
      </button>
    `);
    onClick(crawlerBtn, () => COGCrawlerCreatorApp.open(), { stop: true });

    const headerActions = root.querySelector(HEADER_ACTIONS);
    if (headerActions) {
      const createActorBtn = headerActions.querySelector('.create-document, .create-entry, [data-action="createEntry"], [data-action="createDocument"], button:first-child');
      if (createActorBtn) {
        createActorBtn.after(crawlerBtn);
      } else {
        headerActions.prepend(crawlerBtn);
      }
    } else {
      const dirHeader = root.querySelector('.directory-header');
      if (dirHeader) {
        const actionsRow = createElement(root, '<div class="header-actions action-buttons flexrow cog-sidebar-actions-row"></div>');
        actionsRow.append(crawlerBtn);
        dirHeader.prepend(actionsRow);
      } else {
        root.querySelector('.directory-list')?.before(crawlerBtn);
      }
    }
  }

  // Non-GM players: hide generic "+ Create Actor" buttons so they use the dedicated "New Crawler" Induction Terminal
  if (!globalThis.game?.user?.isGM) {
    for (const createBtn of root.querySelectorAll('.create-document, [data-action="createDocument"], [data-action="createEntry"]')) {
      if (!createBtn.classList.contains('cog-create-crawler-btn-sidebar')) createBtn.style.display = 'none';
    }
  } else if (!root.querySelector('.cog-create-mob-btn-sidebar')) {
    const mobBtn = createElement(root, `
      <button type="button" class="create-entry cog-create-mob-btn-sidebar cog-dark cog-bg-header-fill cog-text-danger" title="Open Mob Creator & Boss Balancer Studio">
        <i class="fa-solid fa-dragon"></i> Mob Creator
      </button>
    `);
    onClick(mobBtn, () => COGMobCreatorApp.open(), { stop: true });
    root.querySelector(HEADER_ACTIONS)?.append(mobBtn);
  }

  // 2. Party Progression & Session Hub button
  if (!root.querySelector('.cog-open-session-manager-btn')) {
    const btn = createElement(root, `
      <button type="button" class="cog-sidebar-btn cog-sidebar-btn-wide cog-open-session-manager-btn cog-bg-accent-fill cog-text-on-fill">
        <i class="fa-solid fa-users-gear cog-dark cog-text-gold"></i> Party Progression & Session Hub
      </button>
    `);
    onClick(btn, () => COGSessionManagerApp.open());

    const headerActions = root.querySelector(HEADER_ACTIONS);
    if (headerActions) {
      headerActions.after(btn);
    } else {
      root.querySelector('.directory-footer')?.before(btn);
    }
  }

  // 3. Party Grinding & Downtime Hub button
  if (!root.querySelector('.cog-open-grind-hub-btn')) {
    const grindBtn = createElement(root, `
      <button type="button" class="cog-sidebar-btn cog-sidebar-btn-wide cog-open-grind-hub-btn cog-bg-grad-accent-warning cog-text-on-fill" title="Start Party Grinding & Downtime Session">
        <i class="fa-solid fa-dumbbell cog-dark cog-text-gold"></i> Party Grinding & Downtime Hub
      </button>
    `);
    onClick(grindBtn, () => COGGrindApp.open());

    const sessionBtn = root.querySelector('.cog-open-session-manager-btn');
    if (sessionBtn) {
      sessionBtn.after(grindBtn);
    } else {
      const headerActions = root.querySelector(HEADER_ACTIONS);
      if (headerActions) {
        headerActions.after(grindBtn);
      } else {
        root.querySelector('.directory-footer')?.before(grindBtn);
      }
    }
  }

  // 4. Racing & Chasing contest tracker (GM)
  if (globalThis.game?.user?.isGM && !root.querySelector('.cog-open-contest-tracker-btn')) {
    const contestBtn = createElement(root, `
      <button type="button" class="cog-sidebar-btn cog-sidebar-btn-wide cog-open-contest-tracker-btn cog-bg-accent-fill cog-text-on-fill" title="Run a race or a chase">
        <i class="fa-solid fa-flag-checkered cog-dark cog-text-gold"></i> Racing & Chasing Tracker
      </button>
    `);
    onClick(contestBtn, () => COGContestTrackerApp.open());
    const anchor = root.querySelector('.cog-open-grind-hub-btn');
    if (anchor) anchor.after(contestBtn);
    else root.querySelector(HEADER_ACTIONS)?.after(contestBtn);
  }
}

export function registerDirectoryHooks() {
  // Hook into the Foundry Items Directory sidebar to add a top-level Skill Library & Manager button
  Hooks.on('renderItemDirectory', (app, html) => {
    injectItemDirectoryButtons(app, html);
  });

  // Hook into the Foundry Actors Directory sidebar
  Hooks.on('renderActorDirectory', (app, html) => {
    injectActorDirectoryButtons(app, html);
  });
}
