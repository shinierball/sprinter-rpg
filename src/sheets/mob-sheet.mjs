import { COGCrawlerSheet } from './crawler-sheet.mjs';

/**
 * Sheet for mobs. Renders the crawler parts (health bar -/+/Auto, boss tier, passive Stat Budget
 * and Boss Action Budget readouts) without the story and achievements tabs.
 */
export class COGMobSheet extends COGCrawlerSheet {
  static OMIT_TABS = { primary: ['story', 'achievements'] };

  static DEFAULT_OPTIONS = {
    classes: ['mob']
  };
}
