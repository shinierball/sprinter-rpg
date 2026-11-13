import { WEAPON_PAGE } from './page-weapon.mjs';

/** Localized lore text, resolved when the page content is read (after i18n is ready), not at import. */
function localizeGuide(key) {
  return globalThis.game?.i18n?.localize?.(key) ?? key;
}

export const AUTHORING_PAGES = [
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
    Welcome to the <strong>Sprinter RPG Tagging System</strong>! In Sprinter RPG, all game mechanics, weapon associations, technique activations, spell mana costs, and character progression are powered by <em>exact, namespaced tags</em> rather than hardcoded text, magic strings, or fragile regular expressions (well almost all of them).
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
    <li>Open any Item sheet (Gear, which covers weapons and armour, Spell, Skill, Class, Race, Buff, Debuff, Loot).</li>
    <li>Click the <strong>Tags</strong> tab on the sheet to view:
      <ul>
        <li><strong>Explicit Tags:</strong> Assigned tags that you can add or remove via input.</li>
        <li><strong>Derived &amp; Identity Tags:</strong> Read-only tags the engine works out from the item's fields (e.g. <code>element.fire</code> from a Base Damage whose type is Fire, <code>wield.one_handed</code> from a weapon's Hands) together with its unique identity tag (e.g. <code>id.gear.prop-sabre</code>). Page 13 lists where each comes from. To change one, change the field, not the tag.</li>
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
    A technique carries an <code>appliesToQuery</code>: a tag query (<code>all</code> / <code>any</code> / <code>none</code>) the attack's tags must match for the technique to apply. A technique for edged weapons asks for <code>weaponGroup.edge</code>, which a weapon carries when its <em>Weapon group</em> chip is picked (or copied from its Skill with <em>Use the Skill's</em>; page 3). One with no query rides any attack. The weapon recommendation list on a technique uses the same query.
  </p>
</div>
`
      }
    },
    WEAPON_PAGE,
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
    <li>A weapon Skill attacks only through a weapon. A Skill is a weapon Skill when it carries a <code>weapon.*</code> type tag (as <em>Prop Sabre Fencing</em> carries <code>weapon.rapier</code>) or the rule tag <code>rule.requires-weapon</code>.</li>
    <li>If a crawler has Prop Sabre Fencing at Rank 15 but no weapon that uses it equipped (the Prop Sabre is stowed in their backpack), <strong>no attack is listed for the Skill</strong> on the sheet. Equip the sabre and its attack appears, rolled with the Skill (page 3).</li>
    <li><strong>Unarmed & Natural Attacks:</strong> Skills tagged with <code>weaponClass.unarmed</code> or <code>weaponClass.natural</code> (like <em>Knuckle Sandwich</em>, <em>Claw Swipe</em>, <em>Chomp</em>) need no equipped weapon and remain available at all times. Both tags carry the no-hands flag, so these attacks take no hand.</li>
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
      <tr>
        <td><strong>rank_raise</strong></td>
        <td><code>{ "kind": "rank_raise", "identifier": "aiming", "floor": 10, "value": 2 }</code></td>
        <td>A fixed row only. A rank below <code>floor</code> (N) acts as N; a rank at or above N is raised by <code>value</code> (M). It reads the rank after gear and other bonuses. A <code>tag</code> or a <code>query</code> can replace the <code>identifier</code>. Use it on a buff or gear; the row applies to a skill or spell the character owns, or to one a <code>skill</code> or <code>spell</code> row of the same source grants.</td>
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
    }
];
