/**
 * src/content/specs/examples/items/boss-maps.mjs
 * Release set "Boss Maps": the two maps a boss can drop beyond the two the book defines, as loot an item creator can author
 * (a name, a description and one tag from the tag picker). Both are homebrew. `exampleId('bm', 'i', 1..2)`.
 *   Municipal Shortcut Map (Several Colors of Highlighter)   `rule.grind-map-city`: its holder is offered a Silver box per grinding session
 *   Atlas of Everything Shiny                                `rule.map-country`: descriptive, the GM reads out what it shows
 */
import { exampleId } from '../ids.mjs';

const MAP_IMG = 'icons/svg/book.svg';

/** A map: treasure carrying one rule tag. */
const map = (n, name, identifier, description, tag) => ({
  type: 'loot',
  _id: exampleId('bm', 'i', n),
  name,
  img: MAP_IMG,
  system: { identifier, description: `<p>${description}</p>`, lootType: 'treasure', quantity: 1, tags: [tag] }
});

export const SPECS = Object.freeze([
  map(1, 'Municipal Shortcut Map (Several Colors of Highlighter)', 'municipal-shortcut-map',
    'Someone has marked every route worth taking in a different colour and never wrote down which colour means what. Each time the party grinds, its holder may find a Silver box worth of loot.',
    'rule.grind-map-city'),
  map(2, 'Atlas of Everything Shiny', 'atlas-of-everything-shiny',
    'A hand-inked atlas of the floor with every magical item circled twice. It does nothing by itself; the GM reads out what it shows and the table decides how much to trust it.',
    'rule.map-country')
]);
