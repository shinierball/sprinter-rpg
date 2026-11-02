import { SYSTEM_ID } from '../constants.mjs';
import { BOSS_TIERS } from './mob-creation-rules.mjs';
import { TAG_NAMESPACES, HEALTH_FRACTION_STEPS, healthFractionTag, OUTCOME_TAGS } from './tags.mjs';
import { COG_TAGS } from './tag-catalog.mjs';
import { CHECK_TAGS, INTERRUPT_TRIGGERS, INTERCEPT_MODE_TAGS, NOT_VS_AREA_TAG, TRIGGER_MOMENTS, OFFER_ROLES } from '../utils/tag-mechanics.mjs';
import { RULE_FLAG_DEFS } from '../utils/tag-behaviour.mjs';

/** Localized lore text, resolved when the page content is read (after i18n is ready), not at import. */
function localizeGuide(key) {
  return globalThis.game?.i18n?.localize?.(key) ?? key;
}

const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const code = (id) => `<code>${esc(id)}</code>`;
const labelOf = (id) => COG_TAGS.find((d) => d.id === id)?.label ?? id;

/**
 * Where each built-in namespace lives and what reads it (the Namespace Reference page). The grouping and the reader
 * text are hand-written; the namespace list itself comes from `TAG_NAMESPACES`, and `tests/journal-tag-system.test.mjs`
 * fails when this map and the registry disagree. A namespace a module registers is listed under its own group.
 */
export const NAMESPACE_GUIDE = Object.freeze({
  // Carried by items (typed on an item's Tags tab, or derived from its fields)
  kind: { group: 'item', reader: 'The type of every document. <code>kind.core</code> (no Ranks), <code>kind.technique</code> and <code>kind.weapon</code> gate sheet and roll behaviour.' },
  action: { group: 'item', reader: 'Attack, passive, heal, interrupt: which buttons and rolls an item gets. Entries such as <code>action.summon</code> are descriptive.' },
  element: { group: 'item', reader: 'The damage type of a packet; resistance, immunity and vulnerability rows match it.' },
  shape: { group: 'item', reader: 'Area geometry and the Place Area button. Any shape carrying the <code>area</code> flag also derives <code>shape.aoe</code>.' },
  delivery: { group: 'item', reader: 'Placed, aura, self or target: how an effect is delivered. Auras pulse.' },
  duration: { group: 'item', reader: 'Floor-clock durations and rest durations.' },
  target: { group: 'item', reader: 'Who an area affects.' },
  stat: { group: 'item', reader: 'The governing stat of an item; conditions and stat substitutions test it.' },
  archetype: { group: 'item', reader: 'A class or race names its archetypes; spell Favored costs compare against them.' },
  favored: { group: 'item', reader: 'The spell Favored check (the +1 MP penalty). Falls back to the matching <code>archetype.&lt;name&gt;</code>.' },
  weapon: { group: 'item', reader: 'The weapon family; weapon skills find their gear by it.' },
  weaponClass: { group: 'item', reader: 'Melee, ranged, unarmed, natural. Unarmed and natural attacks need no wielded weapon.' },
  weaponGroup: { group: 'item', reader: 'Derived from weapon category and weapon skills; row conditions test it.' },
  weaponProp: { group: 'item', reader: 'Handling traits such as reach and thrown; range checks.' },
  wield: { group: 'item', reader: 'One-handed or two-handed. Derived for weapons; a flexible two-hander is rewritten at roll time.' },
  skillGroup: { group: 'item', reader: 'Skill pickers and lists (the contest tracker lists movement skills first); the animal-skill lockout.' },
  technique: { group: 'item', reader: 'Names the skill a combat technique targets.' },
  rule: { group: 'item', reader: 'Rule tags carry rows and flags the engine reads. A few are descriptive.' },
  trigger: { group: 'item', reader: 'Interrupt offers (page 15) and the derived on-hit, critical and fumble triggers.' },
  interrupt: { group: 'item', reader: 'What an interrupt does to the attack that triggered it (page 15).' },
  injury: { group: 'item', reader: 'Marks a debuff as an injury and its severity; Mend Injury removes by it and rest durations read it.' },
  companion: { group: 'item', reader: 'Pet, vehicle, mount; the mount flag lets a pet be ridden.' },
  heritage: { group: 'item', reader: 'Derived from the heritage a race names (a registry id: earth, alien, pet, or one a module registers), never stored; a class can require one, and no other rule reads it.' },
  role: { group: 'item', reader: 'Crew stations on vehicles and mounts; mercenary roles are descriptive.' },
  space: { group: 'item', reader: 'The kind of personal space a space item is.' },
  upgrade: { group: 'item', reader: 'The kind of upgrade a space upgrade is; the training and rest upgrades read it.' },
  access: { group: 'item', reader: 'Descriptive: access to a club, guild or facility. The GM adjudicates it (page 17).' },
  school: { group: 'item', reader: 'Descriptive: a spell\'s school or theme (illusion, healing, mind control). It shows as a line on the cast card; no rule reads it, and the GM adjudicates it (page 17).' },
  sense: { group: 'item', reader: 'Descriptive: darkvision, water breathing and the like (page 17).' },
  usage: { group: 'item', reader: 'How an item is used up. <code>usage.reusable</code> never changes, <code>usage.rechargeable</code> counts charges and stays at 0, <code>usage.consumable</code> is spent and leaves junk. <code>usage.restorable</code> makes the junk remember what it was, so a recharge can restore it. No tag means gear is reusable, anything with charges is rechargeable, and other loot is consumable.' },
  material: { group: 'item', reader: '<code>material.crafting</code> marks loot as a crafting reagent and <code>material.misc_junk</code> the baseline Misc. Junk. The junk a used-up consumable leaves behind carries both; the crafting rules (row 3.15) read them.' },
  custom: { group: 'item', reader: 'Yours. Whatever rows or flags you give a custom tag, the engine runs.' },
  // Carried by actors
  species: { group: 'actor', reader: 'A crawler\'s origin at induction; the crawler creator and the animal-skill lockout read it.' },
  mob: { group: 'actor', reader: 'Mob and boss classification: boss tier, unique, summoned, minion (page 16).' },
  creature: { group: 'actor', reader: 'What a creature is. Per-target rows test it as <code>subject.creature.&lt;x&gt;</code>; owners may edit it on their own sheet.' },
  // Derived only
  id: { group: 'derived', reader: 'The identity tag of an item, <code>id.&lt;type&gt;.&lt;identifier&gt;</code>. Grants, queries and rows use it to name one item.' },
  condition: { group: 'derived', reader: 'Comes from a debuff\'s identifier, and from the debuffs an attack can inflict. Rows test <code>self.condition.&lt;x&gt;</code>.' },
  resource: { group: 'derived', reader: 'Mana, Health Bars and temporary bars on healing and restoring items; <code>resource.health_N</code> on an actor that is hurt (page 14).' },
  contest: { group: 'derived', reader: 'From an item\'s contest settings, plus the race and chase tags the engine sets on a leg\'s roll (page 14).' },
  // Context only
  check: { group: 'context', reader: 'What kind of roll this is. Only a roll\'s context carries it (page 14).' },
  outcome: { group: 'context', reader: 'The degree of a finished check. Only cards carry it (page 14).' },
  situation: { group: 'context', reader: 'A circumstance the engine cannot see; offered as a roll-dialog toggle, or set by the engine (page 8).' },
  use: { group: 'context', reader: '<code>use.&lt;row key&gt;</code>: the once-per-Floor toggle (page 8).' },
  self: { group: 'context', reader: 'Role prefix: a tag of the row\'s owner (page 8).' },
  attacker: { group: 'context', reader: 'Role prefix: a tag of whoever is hitting you (page 8).' },
  subject: { group: 'context', reader: 'Role prefix: a tag of the other party of a roll (page 8).' }
});

const NAMESPACE_GROUPS = Object.freeze([
  { key: 'item', title: 'Carried by items', intro: 'Typed on an item\'s Tags tab, or derived from its fields. Actors pick them up through the items they carry (page 8).' },
  { key: 'actor', title: 'Carried by actors', intro: 'Typed on the actor\'s own Tags tab. <strong>Identity</strong> namespaces are the ones an actor\'s owner may edit; <strong>party</strong> namespaces describe an actor, so a row condition must say whose tag it is (<code>self.</code>, <code>subject.</code>, <code>attacker.</code>) and the row editor warns when it does not.' },
  { key: 'derived', title: 'Derived only', intro: 'Worked out by the engine from fields and state. Set the field, not the tag (page 13).' },
  { key: 'context', title: 'Context only', intro: 'Never carried by an item or an actor. They exist inside a roll or on a card, and rows test them.' },
  { key: 'module', title: 'Registered by modules or the world', intro: 'Added with <code>registerTagNamespace</code> (page 18). The engine reads them only if the module that added them says how.' }
]);

function namespaceTable(groupKey) {
  const rows = Object.entries(TAG_NAMESPACES)
    .filter(([ns]) => (NAMESPACE_GUIDE[ns]?.group ?? 'module') === groupKey)
    .map(([ns, def]) => {
      const marks = [def.identity ? 'identity' : '', def.partyTag ? 'party' : ''].filter(Boolean).join(', ');
      const reader = NAMESPACE_GUIDE[ns]?.reader ?? esc(def.description);
      return `      <tr><td>${code(ns)}</td><td>${esc(def.label)}${marks ? ` <em>(${marks})</em>` : ''}</td><td>${reader}</td></tr>`;
    });
  if (!rows.length) return '';
  return `
  <table class="cog-journal-table">
    <thead><tr><th>Namespace</th><th>Name</th><th>Who reads it</th></tr></thead>
    <tbody>
${rows.join('\n')}
    </tbody>
  </table>`;
}

function namespaceReferenceHtml() {
  const count = Object.keys(TAG_NAMESPACES).length;
  const sections = NAMESPACE_GROUPS.map((g) => {
    const table = namespaceTable(g.key);
    return table ? `\n  <h3>${g.title}</h3>\n  <p>${g.intro}</p>${table}\n` : '';
  }).join('');
  return `
<div class="cog-journal-page">
  <h2>Namespace Reference</h2>
  <p>
    Every tag starts with a namespace. This page lists all ${count} that are registered right now, grouped by where a tag of that namespace can live. The list is read from the live registry, so a namespace a module adds shows up here by itself.
  </p>
${sections}
</div>
`;
}

function flagTableHtml() {
  const rows = Object.values(RULE_FLAG_DEFS).map((d) =>
    `      <tr><td>${code(d.id)}</td><td>${esc(d.label)}</td><td>${esc(d.hint)}</td></tr>`).join('\n');
  return `  <table class="cog-journal-table">
    <thead><tr><th>Flag</th><th>Name</th><th>What the engine does</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>`;
}

const idList = (ids) => ids.map((id) => `<li>${code(id)}: ${esc(labelOf(id))}</li>`).join('\n    ');

function checkOutcomeHtml() {
  const contest = COG_TAGS.filter((d) => d.namespace === 'contest').map((d) => d.id);
  const steps = HEALTH_FRACTION_STEPS.map((n) => code(healthFractionTag(n))).join(', ');
  return `
<div class="cog-journal-page">
  <h2>Check Types, Outcomes and Health</h2>
  <p>
    Three families of tags exist only while something is being decided: what kind of roll it is, how it went, and how hurt a creature is. Items never carry them. Rows test them in a condition.
  </p>

  <h3>Check Types (<code>check.*</code>)</h3>
  <p>
    The engine tags every roll with what it is. A <code>checkModifiers</code> row conditioned on one of these touches only that kind of roll.
  </p>
  <ul>
    ${idList(Object.values(CHECK_TAGS))}
  </ul>

  <h3>Outcomes (<code>outcome.*</code>)</h3>
  <p>
    A finished d20 check against a Difficulty has a degree. The card carries the matching tag, and card-side readers test it: an assist skill's <code>when</code> query decides whether an assist is offered on an ally's card, and interrupt offers read the same card. A card with no Difficulty yet is pending, so a query that lists an outcome passes and the GM adjudicates. Popularity does not read outcome tags; it listens to events (<code>crit</code>, <code>critFail</code>, <code>kill</code>).
  </p>
  <ul>
    ${idList(Object.values(OUTCOME_TAGS))}
  </ul>

  <h3>Health Fractions (<code>resource.health_N</code>)</h3>
  <p>
    An actor at or below N% of its Hit Points carries ${steps}, every step it is at or under, so an actor at 15% carries <code>resource.health_20</code> and the steps above it. Rows read it with a role: <code>subject.resource.health_20</code> means the target is at or under a fifth of its Health. The value is captured per target at apply time, like every other <code>subject.*</code> tag.
  </p>

  <h3>Contest Tags (<code>contest.*</code>)</h3>
  <p>
    A skill or attack with contest settings derives <code>contest.dc</code> or <code>contest.opposed</code>, and <code>contest.&lt;stat&gt;</code> for the stat it is rolled against. The engine adds <code>contest.race</code> or <code>contest.chase</code> to a roll made for a leg of a race or chase.
  </p>
  <ul>
    ${idList(contest)}
  </ul>

  <h3>Three Worked Rows</h3>
  <div class="cog-journal-card">
    <h4>+2 on Evade checks</h4>
    <p>A <code>checkModifiers</code> row on a race, class, gear or buff:</p>
    <pre>
checkModifiers: [
  { kind: 'bonus', value: 2,
    condition: { all: ['check.evade'] } }
]
    </pre>
  </div>
  <div class="cog-journal-card">
    <h4>Offer an assist only after a Near Miss</h4>
    <p>On an assist skill the <code>when</code> query is matched against the card's outcome tags. Outcome tags are card-side: they are for assists and interrupt offers, not for popularity.</p>
    <pre>
assist: { formula: '1d4',
  when: { all: ['outcome.near_miss'] } }
    </pre>
    <p style="margin-bottom: 0;">For popularity, a row names the event instead: <code>{ event: 'crit', value: 1, oncePer: 'combat' }</code> in <code>popularityTriggers</code> awards +1 Popularity on a natural 20, once per combat.</p>
  </div>
  <div class="cog-journal-card">
    <h4>Double damage to a target under 20% Health</h4>
    <p>A per-target damage row (page 9). Each target is judged on its own Health when the card is applied:</p>
    <pre>
damageModifiers: [
  { mode: 'multiply', multiplier: 2,
    condition: { all: ['subject.resource.health_20'] } }
]
    </pre>
  </div>
</div>
`;
}

const MOMENT_TEXT = Object.freeze({
  [TRIGGER_MOMENTS.attacked]: 'on an attack card',
  [TRIGGER_MOMENTS.check]: 'on an ally\'s d20 check card',
  [TRIGGER_MOMENTS.turn]: 'on the assister\'s own turn',
  [TRIGGER_MOMENTS.move]: 'when a foe\'s token moves'
});
const OFFER_TEXT = Object.freeze({
  [OFFER_ROLES.TARGET]: 'the creature being attacked',
  [OFFER_ROLES.ALLY]: 'an ally of the creature being attacked or of the roller',
  [OFFER_ROLES.FOE]: 'a foe of the mover'
});

function interruptHtml() {
  const interruptIds = new Set(INTERRUPT_TRIGGERS.map((t) => t.tag));
  const derived = COG_TAGS.filter((d) => d.namespace === 'trigger' && !interruptIds.has(d.id)).map((d) => d.id);
  const rows = INTERRUPT_TRIGGERS.map((t) =>
    `      <tr><td>${code(t.tag)}</td><td>${esc(labelOf(t.tag))}</td><td>${esc(OFFER_TEXT[t.offerTo] ?? t.offerTo)}</td><td>${esc(MOMENT_TEXT[t.moment] ?? t.moment)}</td><td>${t.requiresHit ? 'only if the attack hit' : 'hit or miss'}</td></tr>`).join('\n');
  const modes = INTERCEPT_MODE_TAGS.map((m) => `<li>${code(m.tag)}: ${esc(labelOf(m.tag))} (mode <code>${esc(m.mode)}</code>)</li>`).join('\n    ');
  return `
<div class="cog-journal-page">
  <h2>Interrupts and Triggers</h2>
  <p>
    An interrupt is something a creature does in the middle of somebody else's turn. Whether a creature is offered one is decided by tags and nothing else: no names, ids or notes are read.
  </p>

  <h3>Making an Interrupt</h3>
  <ul>
    <li><code>action.interrupt</code> marks a skill, spell, gear or attack as an interrupt. It costs an Action. <code>action.free_interrupt</code> costs none. A rank break can list <code>action.free_interrupt</code> to make an interrupt free from that Rank on.</li>
    <li>One or more <code>trigger.*</code> tags say when it is offered (table below). An interrupt with no trigger tag is offered as <em>Anytime</em> to the creature being attacked.</li>
    <li>Optionally one <code>interrupt.*</code> tag says what it does to the attack that triggered it.</li>
    <li>The interrupt's own range (<code>system.interrupt</code>: <code>range</code>, <code>rangeFrom</code> of <code>defender</code> or <code>attacker</code>, or <code>unlimited</code>) says how far it can act. Range 0 is touch, one grid square. A creature with no Action left is still offered the interrupt; using it asks for a Rule Break.</li>
  </ul>

  <h3>Triggers Offered as Interrupts</h3>
  <table class="cog-journal-table">
    <thead><tr><th>Tag</th><th>Name</th><th>Offered to</th><th>Where</th><th>Needs a hit</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  <p>
    The <em>check</em> and <em>turn</em> moments offer assists rather than attack interrupts: an after-roll assist on an ally's check card, and a called bonus stored on the ally for their next roll.
  </p>

  <h3>What an Interrupt Does</h3>
  <ul>
    ${modes}
    <li>${code(NOT_VS_AREA_TAG)}: ${esc(labelOf(NOT_VS_AREA_TAG))}. The interrupt is not offered against an area attack.</li>
    <li><code>rule.no-redirect</code>: carried by an attack (or its skill), it cannot be redirected or intercepted. It carries the <code>no-redirect</code> flag.</li>
  </ul>

  <h3>Triggers the Engine Derives</h3>
  <p>
    These <code>trigger.*</code> tags are not offers. They appear on an item because of what its fields do (a critical multiplier, a fumble debuff, an On Hit debuff, a slot-loss debuff), so rows and queries can ask about them:
  </p>
  <ul>
    ${idList(derived)}
  </ul>

  <h3>Worked Redirect</h3>
  <div class="cog-journal-card">
    <h4>Step in Front</h4>
    <ul>
      <li>A skill carrying <code>action.interrupt</code>, <code>trigger.on_ally_attack</code> and <code>interrupt.redirect_attack</code>.</li>
      <li>Interrupt range 5 feet from the defender, so it reaches an ally one square away.</li>
    </ul>
    <p style="margin-bottom: 0; font-size: 13px;">
      When a foe attacks an ally, the interrupter is offered the skill on the attack card. Using it moves the attack onto the interrupter, who is then judged against their own Evade. Against an attack that carries <code>rule.no-redirect</code>, or an area attack when the skill also carries <code>interrupt.not_vs_area</code>, the offer does not appear.
    </p>
  </div>
</div>
`;
}


function mobsHtml() {
  const tiers = Object.values(globalThis.CONFIG?.COG?.bossTiers ?? BOSS_TIERS)
    .filter((t) => t?.boss !== false)
    .map((t) => `      <tr><td>${code(t.tag ?? `mob.tier.${t.id}`)}</td><td>${esc(t.label)}</td></tr>`).join('\n');
  return `
<div class="cog-journal-page">
  <h2>Mobs and Bosses</h2>
  <p>
    A mob is a creature the GM runs. Its tags say what kind of mob it is, and a handful of them change how the combat tracker treats it.
  </p>

  <h3>Boss Tiers: <code>mob.tier.&lt;id&gt;</code></h3>
  <p>
    A boss carries one <code>mob.tier.&lt;id&gt;</code> tag naming a <em>registered</em> boss tier. The engine derives <code>mob.boss</code> from it, once, when it gathers the mob's tags: a tier tag whose id is not in the tier registry makes no boss. Do not type <code>mob.boss</code> by hand; pick the tier in the Mob Creator or on the mob's sheet.
  </p>
  <table class="cog-journal-table">
    <thead><tr><th>Tier tag</th><th>Name</th></tr></thead>
    <tbody>
${tiers}
    </tbody>
  </table>

  <h3>Other Mob Tags</h3>
  <ul>
    <li><code>mob.unique</code>: a named, one-of-a-kind boss.</li>
    <li><code>mob.minion</code>: a minion.</li>
    <li><code>mob.summoned</code>: a summoned mob. It carries the <code>uncounted-ally</code> flag (page 10), so it does not count as a crawler for a Boss's actions.</li>
  </ul>

  <h3>Actions per Crawler</h3>
  <p>
    A regular mob gets one Attack Action per round; a second one asks for a Rule Break. A boss has no attack cap and a larger budget: <strong>the larger of 2 and the number of crawler-side combatants</strong> in the fight. Crawlers, companion pets, mercenaries, mounts and allied NPCs count, defeated ones included, and the count is a high-water mark that never goes down mid-encounter. Anything carrying the <code>uncounted-ally</code> flag is left out.
  </p>

  <h3>Telling Rows About a Mob</h3>
  <p>
    A mob is an actor, so rows can ask about it. From a crawler's damage row, <code>subject.mob.boss</code> is &ldquo;the target is a boss&rdquo;. From a defense row on the mob's own gear or buffs, <code>attacker.mob.boss</code> is &ldquo;the one hitting me is a boss&rdquo;. Give mobs <code>creature.*</code> tags (<code>creature.undead</code>, <code>creature.beast</code>) so per-target rows (page 9) can judge each one on its own. <code>mob</code> and <code>creature</code> are party namespaces: write the role prefix, or the row editor asks &ldquo;Whose tag is this?&rdquo;.
  </p>

  <h3>Adding a Tier</h3>
  <p>
    A module adds a tier with <code>registry.registerBossTier({ id, label, statsPerLevel, hbBase, star?, default? })</code>. It writes the tier into the live tier registry and registers the matching <code>mob.tier.&lt;id&gt;</code> tag. The Mob Creator, the stat budget and the derived <code>mob.boss</code> all pick it up (page 18).
  </p>
</div>
`;
}


/**
 * Sprinter RPG — Tag System & Content Creation Guide
 *
 * Multi-page in-game Journal Entry and reference documentation
 * explaining the data-driven Unified Tagging System, item creation,
 * secondary skill mechanics, favored spells, and structured grants.
 * Fully supports light mode and dark mode via semantic CSS classes.
 */

export const TAG_SYSTEM_JOURNAL_DATA = {
  name: "Sprinter RPG — Tag System & Content Creation Guide",
  // `version` is stamped from the installed system's manifest when the payload is built (tagSystemJournalPayload).
  flags: {
    [SYSTEM_ID]: {
      guideKey: "tagSystemGuide"
    }
  },
  pages: [
    {
      name: "1. Overview & Tag Taxonomy",
      type: "text",
      title: { show: true, level: 1 },
      text: {
        format: 1,
        content: `
<div class="cog-journal-page">
  <h2>Sprinter RPG — Unified Tagging Architecture</h2>
  <p>
    Welcome to the <strong>Sprinter RPG Tagging System</strong>! In Sprinter RPG, all game mechanics, weapon associations, technique activations, spell mana costs, and character progression are powered by <em>exact, namespaced tags</em> rather than hardcoded text, magic strings, or fragile regular expressions.
  </p>

  <div class="cog-journal-callout cog-journal-callout-info">
    <strong>Core Principle (Rule 0):</strong>
    Sprinter RPG assumes that players and GMs will constantly invent custom items, races, classes, and spells. Every mechanic relies on querying structured data tags (e.g. <code>element.fire</code>, <code>weapon.shotgun</code>) so that user-created content immediately interacts seamlessly with existing rules.
  </div>

  <h3>Tag Syntax & Notation</h3>
  <p>
    All tags follow the lowercase, dot-separated schema: <code>&lt;namespace&gt;.&lt;identifier&gt;</code>. Multi-word identifiers use hyphens or underscores (e.g., <code>rule.requires-weapon</code>, <code>wield.two_handed</code>).
  </p>

  <h3>Namespaces</h3>
  <p>
    The part before the first dot is the tag's <strong>namespace</strong>. The system defines a long list of them, and a module can add more. Page 12, <em>Namespace Reference</em>, lists every one, who may carry it and which part of the engine reads it. That page is built from the live registry, so it cannot fall behind.
  </p>
  <p>
    Rule of thumb: a namespace says <em>what kind of fact</em> the tag is. <code>element.fire</code> is a damage type, <code>wield.two_handed</code> is how a weapon is held, <code>creature.dog</code> is what a creature is. Pick the namespace first, then the identifier.
  </p>
</div>
`
      }
    },
    {
      name: "2. Tag Manager & Item Tag Editor",
      type: "text",
      title: { show: true, level: 1 },
      text: {
        format: 1,
        content: `
<div class="cog-journal-page">
  <h2>Managing Tags in Foundry VTT</h2>
  <p>
    Sprinter RPG provides two synchronized interfaces for managing tags: the <strong>Global Tag Manager & Taxonomy</strong> and the <strong>Item Sheet Tag Editor</strong>.
  </p>

  <h3>1. The Global Tag Manager (<code>COGTagManager</code>)</h3>
  <p>
    To open the Tag Manager at any time:
  </p>
  <ul>
    <li>Navigate to the <strong>Items Directory</strong> in the Foundry sidebar and click the <strong><i class="fa-solid fa-tags"></i> Tag Taxonomy</strong> header button.</li>
    <li>Or execute in the browser console / macro: <code>cog.openTagManager()</code>.</li>
  </ul>
  <p>
    <strong>Key Features:</strong>
  </p>
  <ul>
    <li><strong>Namespace Filtering:</strong> Click any namespace tab (<code>kind</code>, <code>element</code>, <code>weapon</code>, <code>rule</code>, etc.) to immediately isolate matching tags.</li>
    <li><strong>Real-Time Search:</strong> Type in the search bar to filter by tag ID, label, or description.</li>
    <li><strong>Live Usage Counts:</strong> The engine queries <code>tagIndex</code> in real time, displaying exactly how many world and compendium items currently use each tag.</li>
    <li><strong>Custom Tag Registration:</strong> Scroll to the bottom of the window to register new world tags with custom labels, auto-persisted to your world settings.</li>
  </ul>

  <h3>2. Item Sheet Tag Editor & 1-Click Assignment</h3>
  <p>
    Every Item sheet in Sprinter RPG features a dedicated <strong>Tag Editor</strong> tab and a Tag Manager header action:
  </p>
  <ol>
    <li>Open any Item sheet (Weapon, Armor, Spell, Skill, Class, Race, Buff, Loot).</li>
    <li>Click the <strong>Tags</strong> tab on the sheet to view:
      <ul>
        <li><strong>Explicit Tags:</strong> Assigned tags that you can add or remove via input.</li>
        <li><strong>Derived &amp; Identity Tags:</strong> Read-only tags the engine works out from the item's fields (e.g. <code>element.fire</code> from a Fire damage packet) together with its unique identity tag (e.g. <code>id.gear.boom-stick</code>). Page 13 lists where each comes from. To change one, change the field, not the tag.</li>
      </ul>
    </li>
    <li>Click the <strong><i class="fa-solid fa-tags"></i> Manage Tags</strong> button in the Item sheet header:
      <ul>
        <li>The Tag Manager opens bound directly to your active item.</li>
        <li>An <strong>Apply</strong> checkbox column appears in the tag list.</li>
        <li>Click any checkbox to immediately assign or unassign the tag on your item — changes save instantaneously!</li>
      </ul>
    </li>
  </ol>

  <h3>Rank-Break Tags</h3>
  <p>
    A skill or spell can list tags on a rank break (the <code>tags</code> of a <code>rankBreaks</code> tier such as <code>rank5</code>). Those tags join the item's tag set the moment the item reaches that Rank, and leave it again if the Rank drops. A Rank 5 break that lists <code>action.free_interrupt</code>, for example, turns an ordinary interrupt into a free one from Rank 5.
  </p>

  <h3>Which Attacks a Technique Rides (<code>appliesToQuery</code>)</h3>
  <p>
    A technique carries an <code>appliesToQuery</code>: a tag query (<code>all</code> / <code>any</code> / <code>none</code>) the attack's tags must match for the technique to apply. A technique for edged weapons asks for <code>weaponGroup.edge</code>; one with no query rides any attack. The weapon recommendation list on a technique uses the same query.
  </p>
</div>
`
      }
    },
    {
      name: "3. Creating Custom Weapons & Gear",
      type: "text",
      title: { show: true, level: 1 },
      text: {
        format: 1,
        content: `
<div class="cog-journal-page">
  <h2>Creating Custom Weapons with Tags</h2>
  <p>
    When creating a custom weapon in Sprinter RPG, you combine <strong>weapon classification tags</strong>, <strong>damage packets</strong>, and <strong>associated skills</strong> to give the weapon full system automation.
  </p>

  <h3>Walkthrough: The "Goblin Boom Stick"</h3>
  <p>
    Let's create a custom sawed-off incendiary weapon named <em>"Goblin Boom Stick"</em>:
  </p>
  <div class="cog-journal-card">
    <h4>Item Configuration:</h4>
    <ul>
      <li><strong>Type:</strong> Gear (Slot: <code>hands</code>, Wield Mode: <code>two_handed</code>)</li>
      <li><strong>Weapon Category:</strong> <code>ranged</code></li>
      <li><strong>Weapon Type:</strong> <code>shotgun</code></li>
      <li><strong>Associated Skills (<code>system.associatedSkills</code>):</strong> <code>shotgun</code> (by identifier; the <code>weapon.shotgun</code> tag below would match it anyway)</li>
      <li><strong>Damage Parts:</strong>
        <ul>
          <li>Part 1: <code>1d6 Fire</code> (Incendiary payload)</li>
        </ul>
      </li>
      <li><strong>Tags:</strong>
        <code>kind.gear</code>,
        <code>weaponClass.ranged</code>,
        <code>weapon.shotgun</code>,
        <code>element.fire</code>
      </li>
    </ul>
  </div>

  <h3>How the Engine Resolves Weapon Attacks</h3>
  <p>
    When a crawler equips the <em>Goblin Boom Stick</em>:
  </p>
  <ol>
    <li>
      <strong>Primary Skill vs Auxiliary Skill:</strong>
      Because <em>Shotgun</em> is a combat attack skill (carrying <code>rule.requires-weapon</code> and <code>action.attack</code>), it becomes the <strong>Primary Matching Skill</strong>.
      <em>Aiming</em> is not an attack: it carries the rule tag <code>rule.aiming-offset</code>, whose modifier rows join any ranged attack the crawler rolls with the Aiming toggle ticked (see page 4).
    </li>
    <li>
      <strong>Strictly Additive Damage Scaling:</strong>
      Unlike traditional systems that overwrite dice, Sprinter RPG uses <em>strictly additive</em> damage calculation. With Shotgun at Rank 10 and Aiming at Rank 5, Aiming ticked:
      <pre>
Total Damage = Shotgun Base Damage (1d10 Piercing)
             + Shotgun Rank 5 and Rank 10 breaks (+1d10 each, same die: 3d10 Piercing)
             + Weapon Item Damage (Boom Stick: 1d6 Fire)
             + Aiming rows, when ticked (Rank 5+: +2d4 Piercing)
      </pre>
      The chat card rolls <code>3d10 Piercing + 1d6 Fire + 2d4 Piercing</code>, each packet with its own damage type. Two things are absent on purpose:
      <ul>
        <li><strong>No stat modifier:</strong> Shotgun's Base Damage names no stat (<code>none</code>). A skill whose Base Damage names a stat adds that modifier; a blank one falls back to the skill's own stat. Once a skill supplies the Base Damage, the weapon's parts add dice only, never a stat.</li>
        <li><strong>No automatic Rank damage die:</strong> a Rank die is never a default term. It joins only when a reached rank break grants one (its <code>rankDamageDice</code>) or a damage effect does, and an <code>add</code> row can add one (page 10). Shotgun's breaks add base dice instead.</li>
      </ul>
    </li>
    <li>
      <strong>To-Hit Formula Display:</strong>
      The crawler sheet displays the full formula: <code>1d20 + 14</code> (DEX Mod +4 + Shotgun Rank 10).
    </li>
  </ol>
</div>
`
      }
    },
    {
      name: "4. Secondary Skills & Disadvantage Offsets",
      type: "text",
      title: { show: true, level: 1 },
      text: {
        format: 1,
        content: `
<div class="cog-journal-page">
  <h2>Secondary Skills & Complex Interactions</h2>
  <p>
    In Sprinter RPG, characters often possess secondary or passive skills that modify attack rolls and damage output under specific conditions.
  </p>

  <h3>How Aiming Works: a Rule Tag Carrying Rows</h3>
  <p>
    The <em>Aiming</em> skill has no special code. It carries the rule tag <code>rule.aiming-offset</code>, and that tag carries modifier rows (pages 8&ndash;10). Every row is conditioned on <code>situation.aiming</code> plus a ranged attack, so the roll dialog offers an <strong>Aiming</strong> toggle on ranged attacks and the rows apply only when it is ticked:
  </p>
  <ul>
    <li>
      <strong>Disadvantage To-Hit Offset:</strong>
      An <code>advantage</code> row adds one Disadvantage reason, so the roll die becomes <code>2d20kl</code> (keep lowest) unless an Advantage reason cancels it.
      A <code>bonus</code> row of 1 scaled by the scalar <code>rank</code> adds the crawler's Aiming Rank to the to-hit total:
      <pre>
Normal Attack: 1d20 + 9 (DEX +4 + Bow Rank 5)
Disadvantage Attack: 2d20kl + 12 (DEX +4 + Bow Rank 5 + Aiming Rank 3)
      </pre>
    </li>
    <li>
      <strong>Success Damage Bonus:</strong>
      Four <code>add</code> damage rows of <code>1d4</code>, gated by <code>minRank</code> 1, 5, 10 and 15, add bonus dice by Rank tier:
      <ul>
        <li>Rank 1–4: <code>+1d4 Piercing</code></li>
        <li>Rank 5–9: <code>+2d4 Piercing</code></li>
        <li>Rank 10–14: <code>+3d4 Piercing</code></li>
        <li>Rank 15+: <code>+4d4 Piercing</code></li>
      </ul>
    </li>
  </ul>

  <h3>Equipped Weapon Filtering (<code>rule.requires-weapon</code>)</h3>
  <p>
    To prevent character sheets from cluttering with dozens of attack buttons for weapons the character is not carrying:
  </p>
  <ul>
    <li>All weapon skills (e.g., <em>Rapier</em>, <em>Shotgun</em>, <em>Crossbow</em>) are tagged with <code>rule.requires-weapon</code>.</li>
    <li>If a crawler has Rank 15 in <em>Shotgun</em> but has no shotgun equipped (or has it stowed in their backpack), <strong>no shotgun attack is synthesized</strong> on the sheet.</li>
    <li><strong>Unarmed & Natural Attacks:</strong> Skills tagged with <code>weaponClass.unarmed</code> or <code>weaponClass.natural</code> (like <em>Pugilism</em>, <em>Bite</em>, <em>Claws</em>) do NOT require an equipped weapon and remain available at all times.</li>
  </ul>

  <h3>Items with Special Cooldown Grants</h3>
  <p>
    High-tier magical gear frequently grants a skill or spell that normal crawlers cannot acquire, balanced by strict cooldowns:
  </p>
  <div class="cog-journal-callout cog-journal-callout-alert">
    <strong>Example: Sponsor-Issued Bracers</strong><br>
    Grants a spell at Rank 15. In Sprinter RPG, items granting abilities impose a cooldown of <strong>2 hours per granted rank</strong>.
    The grant row carries it as structured data: a cooldown of 2 hours scaled by Rank, which the sheet and chat cards print as &ldquo;2 hours per Rank&rdquo; (30 hours at Rank 15).
  </div>
</div>
`
      }
    },
    {
      name: "5. Custom Spells & Favored Spell Costs",
      type: "text",
      title: { show: true, level: 1 },
      text: {
        format: 1,
        get content() { return `
<div class="cog-journal-page">
  <h2>Custom Spells & Favored Archetypes</h2>
  <p>
    ${localizeGuide('COG.Content.JournalMagicIntro')}
  </p>

  <h3>The Favored Spell Tag System</h3>
  <p>
    A spell names the archetypes that favor it with <code>favored.&lt;archetype&gt;</code> tags. Each favored tag references an archetype tag in the tag registry, so it covers every class or race that carries that archetype, built-in or homebrew. The registered favored tags:
  </p>
  <ul>
    <li><code>favored.mage</code> &rarr; <code>archetype.mage</code></li>
    <li><code>favored.cleric</code> &rarr; <code>archetype.cleric</code></li>
    <li><code>favored.paladin</code> &rarr; <code>archetype.paladin</code></li>
    <li><code>favored.druid</code> &rarr; <code>archetype.druid</code></li>
    <li><code>favored.necromancer</code> &rarr; <code>archetype.necromancer</code></li>
    <li><code>favored.bard</code> &rarr; <code>archetype.bard</code> (the example class <em>Hype Man</em> carries it, and its spell grant offers bard-favored spells such as <em>Confetti Cannon</em>)</li>
  </ul>
  <p>
    A spell may carry several favored tags, and a class may carry several archetypes. Other archetypes (fighter, rogue, monk and the rest) have no registered favored tag. A <code>favored.&lt;archetype&gt;</code> tag with no registry entry still works: the engine matches it against <code>archetype.&lt;archetype&gt;</code> of the same name.
  </p>

  <h3>The +1 MP Non-Favored Penalty Calculation</h3>
  <p>
    When a crawler casts a spell (via <code>actor.rollSpell(item)</code>):
  </p>
  <ol>
    <li>
      <strong>Reference Lookup:</strong> The engine reads the archetype each of the spell's favored tags references (<code>favored.mage</code> references <code>archetype.mage</code>).
    </li>
    <li>
      <strong>Caster Check:</strong> The engine collects the archetype tags of the crawler's class and race items (<code>actor.getArchetypeTags()</code>).
    </li>
    <li>
      <strong>Penalty Evaluation:</strong>
      <ul>
        <li>If the crawler has an archetype that one of the spell's favored tags references &rarr; <strong>Normal MP cost</strong> (e.g. 4 MP for Frostfire Lance below).</li>
        <li>If the crawler has archetypes but none of them is favored (e.g. a Fighter casting Frostfire Lance) &rarr; <strong>+1 MP Penalty</strong> (5 MP total).</li>
        <li>A spell with no favored tags costs its base MP for everyone.</li>
        <li><strong>Classless Exemption:</strong> Classless crawlers (Levels 1–2 before class selection) and pet companions have no archetype, so they are <em>completely exempt</em> from the penalty and pay base MP cost. (A homebrew race that carries an archetype tag counts, class or no class.)</li>
      </ul>
    </li>
  </ol>

  <h3>Walkthrough: Creating "Frostfire Lance"</h3>
  <div class="cog-journal-card">
    <h4>Spell Setup:</h4>
    <ul>
      <li><strong>Name:</strong> Frostfire Lance</li>
      <li><strong>Type:</strong> <code>spell</code></li>
      <li><strong>MP Cost:</strong> 4 MP</li>
      <li><strong>Base Damage:</strong> <code>2d8</code> (Damage Type: <code>Cold</code>)</li>
      <li><strong>Extra Damage Parts:</strong> <code>1d6 Fire</code></li>
      <li><strong>Tags:</strong>
        <code>kind.spell</code>,
        <code>element.ice</code>,
        <code>element.fire</code>,
        <code>favored.mage</code>
      </li>
    </ul>
    <p style="margin-bottom: 0; font-size: 13px;">
      A Mage pays 4 MP. A Rogue or Fighter casting this pays 5 MP. A Level 1 classless crawler pays 4 MP.
    </p>
  </div>
</div>
`; }
      }
    },
    {
      name: "6. Custom Classes, Races & Structured Grants",
      type: "text",
      title: { show: true, level: 1 },
      text: {
        format: 1,
        content: `
<div class="cog-journal-page">
  <h2>Creating Custom Classes & Races with Structured Grants</h2>
  <p>
    In Sprinter RPG, Class and Race documents do not rely on fragile text descriptions to apply benefits. Instead, they define a <code>system.grants</code> array that automatically applies stats, skills, spells, and choices upon selection.
  </p>

  <h3>The Grant Kinds</h3>
  <p>
    Every row has a <code>kind</code>. Skills and spells are named by their <code>identifier</code> (or a <code>uuid</code>), never by their display name; the <code>label</code> is for humans and the engine does not read it. A row the schema rejects is rejected on create and on update, so a typo costs you the save, not the show.
  </p>
  <table class="cog-journal-table">
    <thead>
      <tr>
        <th>Kind</th>
        <th>Schema & Payload</th>
        <th>Effect</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>stat</strong></td>
        <td><code>{ "kind": "stat", "stat": "str", "value": 4 }</code></td>
        <td>Adds <code>value</code> to one base ability score (<code>str</code>, <code>dex</code>, <code>con</code>, <code>int</code> or <code>cha</code>). One row per stat.</td>
      </tr>
      <tr>
        <td><strong>skill</strong></td>
        <td><code>{ "kind": "skill", "identifier": "aiming", "rank": 2 }</code></td>
        <td>Grants the skill at the given rank. On equipped gear the row adds <code>value</code> to the skill's rank instead.</td>
      </tr>
      <tr>
        <td><strong>spell</strong></td>
        <td><code>{ "kind": "spell", "identifier": "fireball", "rank": 1 }</code></td>
        <td>Grants the spell to the character.</td>
      </tr>
      <tr>
        <td><strong>rank_bonus</strong></td>
        <td><code>{ "kind": "rank_bonus", "tag": "element.fire", "value": 1 }</code></td>
        <td>Adds <code>value</code> to the rank of every skill carrying the tag, for as long as the source is active. A <code>query</code> can replace the <code>tag</code>; <code>floor</code> and <code>onlyIfOwned</code> are optional.</td>
      </tr>
      <tr>
        <td><strong>rank_cap</strong></td>
        <td><code>{ "kind": "rank_cap", "identifier": "aiming", "value": 8 }</code></td>
        <td>Lets the named skill advance up to rank <code>value</code>, if that is higher than its current cap. A <code>tag</code> can replace the <code>identifier</code> to cover every skill carrying the tag.</td>
      </tr>
    </tbody>
  </table>

  <h3>Choice and Pool Rows</h3>
  <p>
    A <code>mode</code> of <code>fixed</code> (the default) names exactly what is granted. The other two modes let the player decide, and both are validated just as strictly.
  </p>
  <table class="cog-journal-table">
    <thead>
      <tr>
        <th>Mode</th>
        <th>Schema & Payload</th>
        <th>Effect</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>choice</strong></td>
        <td><code>{ "kind": "skill", "mode": "choice", "count": 2, "options": ["aiming", "dodging", "bluffing"] }</code></td>
        <td>On <code>skill</code>, <code>spell</code> and <code>rank_cap</code> rows. The player picks <code>count</code> entries from <code>options</code>, a <code>query</code> or a <code>category</code>. <code>distinct</code> forbids picking the same one twice.</td>
      </tr>
      <tr>
        <td><strong>pool</strong></td>
        <td><code>{ "kind": "stat", "mode": "pool", "value": 3, "options": ["str", "dex", "con"] }</code></td>
        <td>On <code>stat</code> rows. The player spreads <code>value</code> points across the listed stats however they like.</td>
      </tr>
    </tbody>
  </table>

  <h3>Tag Queries in Choice Grants</h3>
  <p>
    When a class allows a player to <em>"Choose any 1 Fire or Ice spell at Rank 2"</em>, you define a structured boolean query:
  </p>
  <pre>
{
  "kind": "spell",
  "mode": "choice",
  "count": 1,
  "rank": 2,
  "query": {
    "all": ["kind.spell"],
    "any": ["element.fire", "element.ice"],
    "none": ["action.heal"]
  }
}
  </pre>
  <p>
    The engine automatically filters all world and compendium spells matching this criteria and presents them in the Level Up &amp; Class Selection dialog.
  </p>
</div>
`
      }
    },
    {
      name: "7. Rule Breaking & Engine Principles",
      type: "text",
      title: { show: true, level: 1 },
      text: {
        format: 1,
        content: `
<div class="cog-journal-page">
  <h2>Rule Breaking & the Sprinter RPG Philosophy</h2>

  <div class="cog-journal-callout cog-journal-callout-alert">
    <h3>Rules will get broken. The show rewards the ones who do it with style.</h3>
    <p style="margin-bottom: 0;">
      Crawlers will find the loophole, stack the two abilities nobody thought to test together, and ruin the producers' afternoon. That is the show. The system keeps the numbers honest and leaves the ruling to the GM; it never stops the attempt.
    </p>
  </div>

  <h3>System Design Guidelines for GMs & Creators</h3>
  <ul>
    <li>
      <strong>No Artificial Hard Gates:</strong>
      If a player creates a custom Class with 100 stat points instead of the standard 30, the system calculates and honors the exact values without crashing or throwing blocking validation errors.
    </li>
    <li>
      <strong>Strict Sprinter RPG Math Only:</strong>
      Never use D&amp;D math <code>(stat - 10) / 2</code> or proficiency bonuses. The system always maps stat scores through its own stat modifier table (e.g., 10&ndash;19 &rarr; <code>+4</code>, 20&ndash;49 &rarr; <code>+5</code>, 50&ndash;99 &rarr; <code>+6</code>).
    </li>
    <li>
      <strong>No Negative Ability Modifiers:</strong>
      In Sprinter RPG, ability scores can never produce negative modifiers. Modifiers bottom out at <code>+0</code>.
    </li>
    <li>
      <strong>Evade DC:</strong>
      Evade is always calculated as <code>DEX Mod + Gear + Buffs</code>, and the target DC to hit a crawler is <code>10 + Foe DEX Mod + Floor Number</code>. It is never <code>10 + DEX Mod</code> as base armor class.
      <br><strong>Mobs:</strong> a mob does not roll Evade. Its difficulty is the stat block's base Evade difficulty (<code>10 + its DEX Mod</code> when the block leaves it blank) <code>+ Floor Number</code>, then shifted by 5 by the mob's own net Advantage on Evade: <code>+5</code> when it nets Advantage, <code>&minus;5</code> when it nets Disadvantage, <code>+0</code> when they cancel.
    </li>
    <li>
      <strong>Damage Bars:</strong>
      Crawlers have 10 separate damage bars of <code>CON Mod</code> HP each. Damage flows through bars sequentially, triggering bar break effects when exhausted.
    </li>
  </ul>

  <h3>Quick Reference API</h3>
  <table class="cog-journal-table">
    <tbody>
      <tr>
        <td><code>cog.openTagManager()</code></td>
        <td>Opens the interactive Tag Taxonomy and Management interface.</td>
      </tr>
      <tr>
        <td><code>cog.openTagGuide()</code></td>
        <td>Opens this in-game Tag System &amp; Content Creation Journal Entry.</td>
      </tr>
      <tr>
        <td><code>game.cog.tags.find('element.fire')</code></td>
        <td>Queries the in-memory TagIndex for all items matching a tag.</td>
      </tr>
    </tbody>
  </table>
</div>
`
      }
    },
    {
      name: "8. Modifier Rows, Scope & Conditions",
      type: "text",
      title: { show: true, level: 1 },
      text: {
        format: 1,
        content: `
<div class="cog-journal-page">
  <h2>Modifier Rows</h2>
  <p>
    Gear, buffs, debuffs, skills, spells, races, classes and rule tags carry <strong>modifier rows</strong>. A row does one thing (add damage, resist a type, grant a bonus) when its <strong>condition</strong> matches. Open any item sheet, press <strong>Add row</strong>, pick what it does, then set its condition in the pill editor. Each row shows a <em>Reads as &hellip;</em> line, and <strong>Preview against target</strong> shows which rows apply against your first targeted token without changing anything.
  </p>

  <h3>The Row Arrays</h3>
  <table class="cog-journal-table">
    <thead><tr><th>Array</th><th>What it changes</th><th>Roles</th></tr></thead>
    <tbody>
      <tr><td><code>damageModifiers</code></td><td>Outgoing damage</td><td>self, subject</td></tr>
      <tr><td><code>defenseModifiers</code></td><td>Incoming damage, Evade, reflection</td><td>self, attacker</td></tr>
      <tr><td><code>attackModifiers</code></td><td>Attack rolls only</td><td>self, subject</td></tr>
      <tr><td><code>checkModifiers</code></td><td>Every roll of a skill, attacks included</td><td>self, subject, attacker</td></tr>
      <tr><td><code>manaCostModifiers</code>, <code>recoveryModifiers</code></td><td>Spell MP cost, rest recovery</td><td>self</td></tr>
      <tr><td><code>popularityTriggers</code>, <code>aiFavorRatings</code>, <code>statSubstitutions</code></td><td>Popularity, AI Favor, using one stat for another</td><td>self, subject</td></tr>
    </tbody>
  </table>
  <p>
    Optional fields on a row: <code>disabled</code> (kept but off), <code>minRank</code> (ignored below that Rank of the skill or spell), <code>maxRank</code> (a ceiling), <code>usesPer: 'floor'</code> (once per floor, offered as a toggle) and <code>option</code> (a kind's sub-choice, such as a Rank die that a Critical Hit does not double).
  </p>

  <h3>Scope: Whose Rolls a Row Touches</h3>
  <ul>
    <li>A row on a <strong>skill, spell, attack or weapon</strong> applies only when that item is the one being used. Set <em>Applies to: every roll of the owner</em> (<code>scope: 'owner'</code>) for a buff-style row that should ride on the owner's other attacks too.</li>
    <li>Armour, other gear, buffs, debuffs, races, classes and rule tags apply to <strong>every roll of their owner</strong>.</li>
    <li>To limit any row to one skill, spell or item, add its identity tag to the condition, e.g. <code>id.spell.fireball</code>.</li>
  </ul>

  <h3>Conditions and Roles</h3>
  <p>A condition has three lists: <code>all</code> (every tag present), <code>any</code> (at least one) and <code>none</code> (none present). An empty condition always matches. A tag's prefix says <em>whose</em> tag it is:</p>
  <table class="cog-journal-table">
    <thead><tr><th>Prefix</th><th>Whose tag</th><th>Example</th></tr></thead>
    <tbody>
      <tr><td>(none)</td><td>The action: the item used, its skill, and situations</td><td><code>weaponGroup.edge</code></td></tr>
      <tr><td><code>self.</code></td><td>The row's owner</td><td><code>self.condition.fatigued</code></td></tr>
      <tr><td><code>subject.</code></td><td>The target of a damage roll, attack or check</td><td><code>subject.creature.undead</code></td></tr>
      <tr><td><code>attacker.</code></td><td>Whoever is hitting you (defense rows)</td><td><code>attacker.mob.boss</code></td></tr>
    </tbody>
  </table>
  <p>
    What an actor <em>is</em> comes from its own tags (Tags tab on the actor sheet: owners edit <code>creature.*</code>, the GM edits the rest), its kind, and the items it carries. Not every item counts:
  </p>
  <ul>
    <li>Its <strong>race, class, deity, sponsor and skills</strong> always count.</li>
    <li><strong>Gear</strong> counts only while equipped.</li>
    <li><strong>Buffs</strong> count only while not suppressed.</li>
    <li><strong>Debuffs</strong> always count.</li>
    <li>Attacks, spells, loot and unequipped gear never add tags to the actor.</li>
    <li>How hurt it is adds <code>resource.health_N</code> tags (page 14), and a mob with a registered boss tier is a <code>mob.boss</code> (page 16).</li>
  </ul>

  <div class="cog-journal-callout cog-journal-callout-info">
    <strong>Situations.</strong> The engine sets <code>situation.in_combat</code>, <code>situation.disadvantaged</code>, <code>situation.critical_hit</code>, <code>situation.amazing_success</code>, <code>situation.damage_effect</code> and <code>situation.same_size</code> itself; rolls in a race or chase also carry <code>contest.race</code> or <code>contest.chase</code>. Any other situation a row mentions (such as <code>situation.aiming</code>) appears as a toggle in the roll dialog. Press <strong>+ New situation</strong> in a condition editor to invent one for your table.
  </div>

  <h3>Once per Floor</h3>
  <p>
    A row set to <code>usesPer: 'floor'</code> can fire once per Floor. The roll dialog offers it as a toggle whose tag is <code>use.&lt;row key&gt;</code> (the <code>use</code> namespace, set only by the dialog, never carried by an item). Ticking it spends the row: the engine records the row's key in the actor's once-per-floor record, and the record clears when the Floor changes. Ticking a spent row asks for a Rule Break confirmation first; if you decline, the roll goes ahead without that row.
  </p>
</div>
`
      }
    },
    {
      name: "9. Per-Target Rows & Scalars",
      type: "text",
      title: { show: true, level: 1 },
      text: {
        format: 1,
        content: `
<div class="cog-journal-page">
  <h2>One Card, Many Targets</h2>
  <p>
    A damage row whose condition mentions a <code>subject.*</code> tag, a Critical Hit, an Amazing Success or <code>situation.same_size</code> is a <strong>per-target row</strong>. The roll keeps it aside on the damage card; when damage is applied, each target is judged on its own tags. One area attack can therefore hit every token differently. The card's <em>Per target</em> box lists those rows, and the breakdown names them for each target.
  </p>
  <ul>
    <li><strong>Areas:</strong> press <strong>Place Area</strong> on the card, then <strong>Apply</strong> with nothing targeted: every token inside the area is hit.</li>
    <li><strong>Critical Hits</strong> follow the apply button you press (crit or normal hit), not the original roll.</li>
    <li><strong>Ticked targets:</strong> with nothing targeted you may tick &ldquo;the target is undead&rdquo; in the roll dialog. When the card is later applied to a real token that already has a tag of the same family (e.g. another <code>creature.*</code> tag), the tick is dropped and the breakdown says so.</li>
  </ul>

  <h2>Scalars: &ldquo;This Much per Something&rdquo;</h2>
  <p>A row's number can scale with a count the engine works out:</p>
  <pre>
scaled = number &times; (base + per &times; n), kept between min and max
  </pre>
  <ul>
    <li><code>base</code> defaults to 0 for plain numbers and 1 for multipliers; <code>per</code> defaults to 1.</li>
    <li>Plain numbers round down; multipliers keep fractions and never drop below 0.</li>
    <li>Dice are never scaled. A scale on a row that has nothing to scale does nothing and shows a badge.</li>
  </ul>
  <table class="cog-journal-table">
    <thead><tr><th>Scalar</th><th>n is</th><th>Choices</th></tr></thead>
    <tbody>
      <tr><td><code>hpSlotsLost</code></td><td>Empty Health Bar slots</td><td>You, or the target (worked out per target)</td></tr>
      <tr><td><code>rank</code></td><td>A Rank</td><td>This item, the item used, the weapon skill, an owned item</td></tr>
      <tr><td><code>floor</code></td><td>The current Floor</td><td></td></tr>
      <tr><td><code>stat</code> / <code>statValue</code></td><td>Your modifier / score for a chosen stat</td><td></td></tr>
      <tr><td><code>count</code></td><td>Creatures or items matching a tag query</td><td>Party, allies, enemies, owned items, targets hit at once (per target)</td></tr>
      <tr><td><code>move</code></td><td>Your Move in feet (per 0.1 = &ldquo;per 10 ft&rdquo;)</td><td></td></tr>
    </tbody>
  </table>
  <div class="cog-journal-callout cog-journal-callout-alert">
    <strong>The party includes you.</strong> A <code>count</code> over the party counts every actor with the same Party field, the row's owner too. The query is written without a prefix: <code>creature.female</code>, not <code>subject.creature.female</code>.
  </div>
</div>
`
      }
    },
    {
      name: "10. Row Kinds, Moments & Rule Tags",
      type: "text",
      title: { show: true, level: 1 },
      text: {
        format: 1,
        get content() { return `
<div class="cog-journal-page">
  <h2>What a Row Can Do (Kinds)</h2>
  <table class="cog-journal-table">
    <thead><tr><th>Array</th><th>Kinds</th></tr></thead>
    <tbody>
      <tr><td>Damage</td><td><code>add</code> (flat, dice, stat or a Rank die), <code>multiply</code> (the whole damage; &times;0 is a real zero), <code>suppress_stat</code></td></tr>
      <tr><td>Defense</td><td><code>resistance</code>, <code>immunity</code>, <code>vulnerability</code>, <code>tempHp</code>, <code>reduction</code> (% and/or flat), <code>dr</code>, <code>evade</code>, <code>suppress_dr</code>, <code>evadeOutcome</code> (what a successful Evade does against an area), <code>reflect</code></td></tr>
      <tr><td>Attack / Check</td><td><code>bonus</code>, <code>advantage</code> (one reason; reasons net out), <code>assist</code> (the dice an assist skill rolls)</td></tr>
    </tbody>
  </table>
  <p>
    Unconditional resistance, immunity and DR rows, and every temp HP and Evade row, are folded into the sheet's derived numbers. Conditional defense rows are checked on each hit.
  </p>

  <h2>Moments: When Rows Are Read</h2>
  <p>
    Rows are read at the moments the engine already has: checks, to-hit, damage, defense, advancement, mana cost, recovery, popularity and derived stats, plus apply time (per target). Assists offered after an ally's check, a called bonus before an ally acts, the Evade result on an area card, Amazing Success effects and Playing to the Cameras are built-in moments too. A brand-new moment (&ldquo;at the start of my turn&rdquo;) needs a module or system code.
  </p>

  <h2>Rule Tags and Flags</h2>
  <p>
    A tag can carry <strong>rows</strong> and <strong>flags</strong>. Its rows act as rows on whatever carries the tag; its flags are yes/no switches the engine checks. Because the engine reads flags, never tag names, you can rename or replace a rule tag and keep its rule. The flags registered right now:
  </p>
${flagTableHtml()}
  <ul>
    <li>Open the Tag Manager and press <strong>Rules</strong> on a tag to see its rows and flags.</li>
    <li>The GM may edit them for this world; <strong>Reset to default</strong> removes the change.</li>
    <li>Order of precedence: built-in &lt; module &lt; world custom tag &lt; the GM's override.</li>
  </ul>
</div>
`; }
      }
    },
    {
      name: "11. Worked Example: One Cone, Three Targets",
      type: "text",
      title: { show: true, level: 1 },
      text: {
        format: 1,
        content: `
<div class="cog-journal-page">
  <h2>Worked Example: &ldquo;Wide Swing&rdquo;</h2>
  <p>
    A cone attack that does half damage to female targets and 10% more per female party member to male targets. Two rows, no code.
  </p>
  <ol>
    <li>Make three crawlers with the same Party field: the attacker and two allies. On each ally's Tags tab add <code>creature.female</code>.</li>
    <li>Make three mobs: one <code>creature.female</code>, one <code>creature.male</code>, one with neither. Put them in front of the attacker's token.</li>
    <li>On the attacker make a skill &ldquo;Wide Swing&rdquo; with a fixed 10 damage and a cone area, and a plain attack with the same damage.</li>
    <li>On Wide Swing press <strong>Add row</strong> (damage) twice:
      <ul>
        <li><strong>Multiply &times;0.5</strong>; condition: Target (subject) has <code>creature.female</code>.</li>
        <li><strong>Multiply</strong>, scale source <strong>Count</strong>, scope Party, where <code>creature.female</code>, per 0.1, base 1; condition: Target (subject) has <code>creature.male</code>.</li>
      </ul>
    </li>
    <li>Use Wide Swing, press <strong>Place Area</strong>, aim the cone over all three mobs. With nothing targeted, press <strong>Apply</strong>.</li>
  </ol>
  <div class="cog-journal-card">
    <h4>Result (before the mobs' DR):</h4>
    <ul>
      <li>Female mob: <strong>5</strong> (&times;0.5)</li>
      <li>Male mob: <strong>12</strong> (two female party members: &times;1.2)</li>
      <li>Untagged mob: <strong>10</strong></li>
    </ul>
    <p style="margin-bottom: 0; font-size: 13px;">
      The plain attack through the same cone does 10 to all three: Wide Swing's rows apply only to Wide Swing. If the attacker were also tagged <code>creature.female</code>, the party count would be 3 and the male mob would take 13.
    </p>
  </div>
  <p>The same two rows written as data:</p>
  <pre>
damageModifiers: [
  { mode: 'multiply', multiplier: 0.5,
    condition: { all: ['subject.creature.female'] } },
  { mode: 'multiply',
    scaleBy: { source: 'count', scope: 'party',
               where: { all: ['creature.female'] }, per: 0.1, base: 1 },
    condition: { all: ['subject.creature.male'] } }
]
  </pre>
</div>
`
      }
    },
    {
      name: "12. Namespace Reference",
      type: "text",
      title: { show: true, level: 1 },
      text: {
        format: 1,
        get content() { return namespaceReferenceHtml(); }
      }
    },
    {
      name: "13. Derived Tags",
      type: "text",
      title: { show: true, level: 1 },
      text: {
        format: 1,
        content: `
<div class="cog-journal-page">
  <h2>Derived Tags: Set the Field, Not the Tag</h2>
  <p>
    Many tags are never typed. The engine works them out from an item's fields every time it needs them and never saves them. They show on the Tags tab under <em>Derived &amp; Identity Tags</em>, read-only.
  </p>
  <div class="cog-journal-callout cog-journal-callout-alert">
    <strong>The rule:</strong> if a tag is derived, set the field that derives it. Typing <code>action.heal</code> by hand on an item with no healing does not make it heal; adding healing to the item adds the tag. The tag describes the item. It never configures it.
  </div>
  <table class="cog-journal-table">
    <thead><tr><th>Field on the item</th><th>Tags it derives</th></tr></thead>
    <tbody>
      <tr><td>Item type</td><td><code>kind.&lt;type&gt;</code>; gear that is a weapon also <code>kind.weapon</code>; an actor gets <code>kind.&lt;actor type&gt;</code></td></tr>
      <tr><td>Identifier</td><td>The identity tag, <code>id.&lt;type&gt;.&lt;identifier&gt;</code></td></tr>
      <tr><td>Governing stat; stat grants</td><td><code>stat.str</code>, <code>stat.dex</code> and the other stats</td></tr>
      <tr><td>Damage type, damage parts</td><td><code>element.fire</code> and the other damage types</td></tr>
      <tr><td>Check type (skill or spell)</td><td><code>action.attack</code> for Attack, <code>action.passive</code> for Passive, nothing for None</td></tr>
      <tr><td>Technique flags</td><td><code>kind.technique</code></td></tr>
      <tr><td>A race's heritage</td><td><code>heritage.&lt;id&gt;</code> (earth, alien, pet, or one a module registers)</td></tr>
      <tr><td>Reached rank breaks</td><td>Every tag listed on a break the item has reached</td></tr>
      <tr><td>Healing, Health-over-time, cleanse</td><td><code>action.heal</code>, <code>action.hot</code>, <code>action.cleanse</code>, <code>resource.hp-bars</code>, <code>duration.rounds</code></td></tr>
      <tr><td>Armor-Piercing, Ignore DR</td><td><code>action.armor_piercing</code>, <code>action.ignore_dr</code></td></tr>
      <tr><td>Critical multiplier, fumble debuff, On Hit parts</td><td><code>trigger.crit</code>, <code>trigger.fumble</code>, <code>trigger.on_hit</code>, <code>trigger.on_slot_loss</code></td></tr>
      <tr><td>Debuffs an attack, a technique or an area inflicts</td><td><code>action.inflict_debuff</code>; an attack also derives each <code>condition.&lt;x&gt;</code> it can inflict; a debuff item derives its own <code>condition.&lt;x&gt;</code></td></tr>
      <tr><td>Lifesteal, dispel</td><td><code>rule.lifesteal</code>, <code>action.dispel</code></td></tr>
      <tr><td>Weapon category</td><td><code>weaponGroup.&lt;group&gt;</code>. A weapon skill has no Skill Type field: it stores its own <code>weaponGroup.*</code> tag.</td></tr>
      <tr><td>Wield mode</td><td><code>wield.one_handed</code> or <code>wield.two_handed</code></td></tr>
      <tr><td>Class archetypes</td><td><code>archetype.&lt;name&gt;</code></td></tr>
      <tr><td>Area: radius, line length or the Has Area box; shape</td><td><code>shape.aoe</code>, <code>shape.&lt;shape&gt;</code>, <code>shape.splash</code>; any listed shape carrying the <code>area</code> flag also derives <code>shape.aoe</code></td></tr>
      <tr><td>Area target filter; a caster-anchored shape; an aura</td><td><code>target.&lt;filter&gt;</code>, <code>target.self</code></td></tr>
      <tr><td>Area that lingers and pulses</td><td><code>rule.hazard</code></td></tr>
      <tr><td>Delivery</td><td><code>delivery.&lt;mode&gt;</code>; an aura also <code>shape.aura</code></td></tr>
      <tr><td>Duration type</td><td><code>duration.&lt;type&gt;</code></td></tr>
      <tr><td>Temporary Health Bars</td><td><code>rule.temp-health-bars</code></td></tr>
      <tr><td>Light radii</td><td><code>rule.emits-light</code></td></tr>
      <tr><td>Contest settings</td><td><code>action.contested</code>, <code>action.opposed</code>, <code>contest.dc</code>, <code>contest.opposed</code>, <code>contest.&lt;stat&gt;</code></td></tr>
      <tr><td>Consumable outcomes</td><td><code>action.restore</code>, <code>action.heal</code>, <code>resource.mana</code>, <code>resource.hp-bars</code></td></tr>
      <tr><td>Grants</td><td><code>kind.skill</code>, <code>kind.spell</code>, and the stat tag of a stat grant</td></tr>
      <tr><td>Personal space and upgrade types</td><td><code>kind.personal_space</code>, <code>kind.upgrade</code> and the type tag</td></tr>
    </tbody>
  </table>
  <p>
    On an actor, the same idea applies: <code>mob.boss</code> is derived from a registered <code>mob.tier.&lt;id&gt;</code> (page 16), and <code>resource.health_N</code> comes from how hurt it is (page 14).
  </p>
</div>
`
      }
    },
    {
      name: "14. Check Types, Outcomes & Health",
      type: "text",
      title: { show: true, level: 1 },
      text: {
        format: 1,
        get content() { return checkOutcomeHtml(); }
      }
    },
    {
      name: "15. Interrupts & Triggers",
      type: "text",
      title: { show: true, level: 1 },
      text: {
        format: 1,
        get content() { return interruptHtml(); }
      }
    },
    {
      name: "16. Mobs & Bosses",
      type: "text",
      title: { show: true, level: 1 },
      text: {
        format: 1,
        get content() { return mobsHtml(); }
      }
    },
    {
      name: "17. Descriptive Tags & Perks",
      type: "text",
      title: { show: true, level: 1 },
      text: {
        format: 1,
        content: `
<div class="cog-journal-page">
  <h2>Descriptive Tags: Labels the GM Rules On</h2>
  <p>
    Some tags are marked <strong>descriptive</strong> (a grey badge in the Tag Manager and on the Tags tab). A descriptive tag is a label for people. It records that a crawler has a trait, a sense, an access or a perk, and the engine never reads it. The GM decides what it means at the table. Examples: <code>access.patron</code>, <code>sense.water_breathing</code>, <code>rule.taunt</code>, <code>rule.pet-skill</code>, <code>rule.offset-disadvantage</code>, <code>action.summon</code>.
  </p>

  <h3>Why a Descriptive Tag Cannot Carry Rows</h3>
  <p>
    A tag that carries rows or flags is behaviour, and behaviour is not descriptive. The Tag Manager refuses to give a descriptive tag rows or flags (<em>a descriptive tag cannot carry rows or flags</em>), and a tag that already has them is never shown as descriptive. The split keeps the promise on the label honest: if a tag has the badge, deleting it changes nothing the engine does.
  </p>

  <h3>Perk Tags</h3>
  <p>
    Perks the engine cannot run are registered as descriptive tags in the <code>rule.cog.*</code>, <code>access.*</code> and <code>sense.*</code> families. A race, class or item that grants a perk carries the tag; the tag's description holds the wording for the GM to rule on.
  </p>

  <h3>Turning a Perk into Rows</h3>
  <p>
    If a perk <em>can</em> be run, do not write a descriptive tag. Put rows on the item that grants it, and tag the rows' conditions with real tags.
  </p>
  <div class="cog-journal-card">
    <h4>Example: &ldquo;Bonus damage while fatigued enemies are near&rdquo; becomes a row</h4>
    <pre>
damageModifiers: [
  { mode: 'add', value: 2, damageType: 'Piercing',
    condition: { all: ['subject.condition.fatigued'] } }
]
    </pre>
    <p style="margin-bottom: 0; font-size: 13px;">
      The row lives on the race, class, gear or buff that grants the perk. Nothing is scraped from the perk's name or description, and a GM can open the item and see exactly what the engine will do. If the engine truly cannot express the perk, a descriptive tag is the honest answer.
    </p>
  </div>
</div>
`
      }
    },
    {
      name: "18. Extending from a Module",
      type: "text",
      title: { show: true, level: 1 },
      text: {
        format: 1,
        content: `
<div class="cog-journal-page">
  <h2>Adding Content and Mechanics from a Module</h2>
  <p>
    A module adds tags, namespaces, mechanics and content without touching the system. Everything registers from the <code>sprinter-rpg.registerContent</code> hook, which the system fires during <code>init</code> with the content registry. Whatever is registered appears in the item sheet's row editor and the Tag Manager with no further wiring. Prefix your ids (<code>studio-props.</code>) so they never collide with built-in ones.
  </p>

  <table class="cog-journal-table">
    <thead><tr><th>Call</th><th>Adds</th></tr></thead>
    <tbody>
      <tr><td><code>registry.registerTag(def)</code></td><td>A tag, with optional <code>rows</code> and <code>flags</code> (a rule tag), or <code>descriptive: true</code></td></tr>
      <tr><td><code>registry.registerTagNamespace(key, def)</code></td><td>A namespace. Add <code>identity: true</code> to let an actor's owner edit its tags, <code>partyTag: true</code> for tags that describe a creature</td></tr>
      <tr><td><code>registry.registerScalar(def)</code></td><td>A number a row can scale by</td></tr>
      <tr><td><code>registry.registerRowKind(arrayKey, def)</code></td><td>What a row does. Only the damage, defense, attack and check arrays accept module kinds</td></tr>
      <tr><td><code>registry.registerRuleFlag(def)</code></td><td>A yes/no gate a tag may carry</td></tr>
      <tr><td><code>registry.registerBossTier(def)</code></td><td>A boss tier and its <code>mob.tier.&lt;id&gt;</code> tag (page 16)</td></tr>
    </tbody>
  </table>

  <pre>
Hooks.on('sprinter-rpg.registerContent', (registry) => {
  registry.registerRuleFlag({ id: 'studio-props.hush', label: 'Hushed',
    hint: 'The carrier cannot be heckled.' });
  registry.registerTag({ id: 'studio-props.spotlit', label: 'Spotlit',
    namespace: 'rule', description: 'Nobody heckles you.',
    flags: ['studio-props.hush'] });
});
  </pre>

  <h3>Ground Rules</h3>
  <ul>
    <li><strong>Refusals are visible, never fatal.</strong> A bad definition, or one that loses on priority, returns <code>false</code> and logs a warning. Rows that name an unregistered scalar or kind do nothing and show a badge in the editor.</li>
    <li><strong>Priority.</strong> Every call takes <code>{ priority }</code> (default 10; built-in content is 0). A higher priority replaces an existing id; an equal or lower one is refused.</li>
    <li><strong>Gates read flags, not tags.</strong> Engine code asks whether something carries a flag; it never matches a <code>rule.*</code> id, so renaming or replacing a rule tag keeps its rule.</li>
    <li><strong>A GM can override a tag's behaviour</strong> in the Tag Manager without editing the module, and <em>Reset to default</em> returns it to what the module registered. Precedence: built-in, then module, then world custom tag, then the GM's override.</li>
    <li><strong>Custom situations need no module.</strong> A GM presses <strong>+ New situation</strong> in any condition editor and uses the tag in a row.</li>
    <li>A brand-new moment (&ldquo;at the start of my turn&rdquo;) is engine code, not a registration.</li>
  </ul>
  <p>
    Authoring rows, roles, scalars and the built-in kinds is covered on pages 8&ndash;11. The full registration notes live in the system's source repository (<code>docs/engine-extension.md</code>).
  </p>
</div>
`
      }
    }
  ]
};

/**
 * Materialise the journal data into plain create data. Page 5's `text.content` is a getter
 * (its lore text is localized when read, after i18n is ready), and Foundry's
 * `JournalEntryPage.cleanData` assigns to `text.content` on the source object, which throws on
 * an accessor property ("Cannot set property content … which has only a getter"). Resolving every
 * page into own data properties here keeps the create payload writable.
 * @returns {{ name: string, flags: object, pages: object[] }}
 */
export function tagSystemJournalPayload() {
  const flags = foundry.utils.deepClone(TAG_SYSTEM_JOURNAL_DATA.flags);
  // The guide is stamped with the installed system's version (system.json), not a string kept here.
  const version = globalThis.game?.system?.version;
  if (version) flags[SYSTEM_ID].version = String(version);
  return {
    name: TAG_SYSTEM_JOURNAL_DATA.name,
    flags,
    pages: TAG_SYSTEM_JOURNAL_DATA.pages.map((page) => ({
      name: page.name,
      type: page.type,
      title: { ...page.title },
      text: { format: page.text.format, content: String(page.text.content ?? '') }
    }))
  };
}

/**
 * Ensure the official Tag System Guide JournalEntry exists in the world.
 * If missing, creates it. If present, ensures pages are up to date.
 * @returns {Promise<JournalEntry|null>}
 */
export async function ensureTagSystemJournal() {
  const JournalEntryClass = CONFIG.JournalEntry?.documentClass
    ?? globalThis.foundry?.documents?.JournalEntry
    ?? globalThis.JournalEntry;

  if (!JournalEntryClass || !globalThis.game?.journal) {
    return null;
  }

  // Only GM users should attempt to create or populate world documents
  if (globalThis.game?.user && !globalThis.game.user.isGM) {
    const existing = globalThis.game.journal.find(j =>
      j.name === TAG_SYSTEM_JOURNAL_DATA.name ||
      j.flags?.[SYSTEM_ID]?.guideKey === "tagSystemGuide"
    );
    return existing || null;
  }

  let existing = null;
  if (typeof globalThis.game.journal.find === "function") {
    existing = globalThis.game.journal.find(j =>
      j.name === TAG_SYSTEM_JOURNAL_DATA.name ||
      j.flags?.[SYSTEM_ID]?.guideKey === "tagSystemGuide"
    );
  } else if (Array.isArray(globalThis.game.journal)) {
    existing = globalThis.game.journal.find(j =>
      j.name === TAG_SYSTEM_JOURNAL_DATA.name ||
      j.flags?.[SYSTEM_ID]?.guideKey === "tagSystemGuide"
    );
  }

  if (existing) {
    const pageCount = existing.pages?.size ?? (Array.isArray(existing.pages) ? existing.pages.length : 0);
    if (pageCount === 0 && typeof existing.createEmbeddedDocuments === "function") {
      try {
        await existing.createEmbeddedDocuments("JournalEntryPage", tagSystemJournalPayload().pages);
      } catch (err) {
        console.warn("Sprinter RPG | Could not populate pages for Tag System Journal:", err);
      }
    }
    return existing;
  }

  if (typeof JournalEntryClass.create === "function") {
    try {
      const entry = await JournalEntryClass.create(tagSystemJournalPayload(), { renderSheet: false });
      return entry;
    } catch (err) {
      console.warn("Sprinter RPG | Could not create Tag System Journal:", err);
    }
  }

  return null;
}

/**
 * Opens and renders the Tag System Guide journal entry sheet.
 * @returns {Promise<JournalEntrySheet|null>}
 */
export async function openTagSystemJournal() {
  let entry = null;
  if (globalThis.game?.journal) {
    if (typeof globalThis.game.journal.find === "function") {
      entry = globalThis.game.journal.find(j =>
        j.name === TAG_SYSTEM_JOURNAL_DATA.name ||
        j.flags?.[SYSTEM_ID]?.guideKey === "tagSystemGuide"
      );
    } else if (Array.isArray(globalThis.game.journal)) {
      entry = globalThis.game.journal.find(j =>
        j.name === TAG_SYSTEM_JOURNAL_DATA.name ||
        j.flags?.[SYSTEM_ID]?.guideKey === "tagSystemGuide"
      );
    }
  }

  if (!entry) {
    entry = await ensureTagSystemJournal();
  }

  if (entry?.sheet) {
    entry.sheet.render({ force: true });
    return entry.sheet;
  }
  return null;
}
