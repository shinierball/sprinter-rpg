import { flagTableHtml } from './reference-tables.mjs';

export const ENGINE_PAGES = [
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
      <tr><td><code>craftModifiers</code></td><td>Crafting limits and speed-ups: a skill's highest bonus level, hours, batch minutes</td><td>self</td></tr>
      <tr><td><code>vehicleModifiers</code></td><td>A vehicle's Move: feet added or a multiplier, from its upgrades and buffs and its driver's skill Ranks</td><td>self</td></tr>
      <tr><td><code>boxContents</code></td><td>The prizes in a loot box (not a modifier row): no condition or scale</td><td>self</td></tr>
      <tr><td><code>magicProperties</code></td><td>The properties of a generated magic item, read from a rolled table row (not a modifier row, not stored on items)</td><td>self</td></tr>
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
    <strong>Situations.</strong> The engine sets <code>situation.in_combat</code>, <code>situation.disadvantaged</code>, <code>situation.critical_hit</code>, <code>situation.amazing_success</code>, <code>situation.damage_effect</code>, <code>situation.specialty</code> (the item you make, or your target, carries the rolling skill's chosen specialty) and <code>situation.same_size</code> itself; rolls in a race or chase also carry <code>contest.race</code> or <code>contest.chase</code>. Any other situation a row mentions (such as <code>situation.aiming</code>) appears as a toggle in the roll dialog. Press <strong>+ New situation</strong> in a condition editor to invent one for your table.
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
      <tr><td>Attack / Check</td><td><code>bonus</code>, <code>advantage</code> (one reason; reasons net out), <code>assist</code> (the dice an assist skill rolls), <code>waive</code> (an engine roll penalty does not apply); Check also <code>reroll</code> and <code>degreeShift</code> (offered after the roll)</td></tr>
      <tr><td>Vehicle</td><td><code>moveAdd</code> (feet added to a vehicle's Move), <code>moveMultiply</code> (Move multiplier)</td></tr>
      <tr><td>Craft</td><td><code>maxBonus</code> (the highest bonus level crafted), <code>time</code> (hours multiplier), <code>batchTime</code> (batch minutes multiplier), <code>rebuild</code> (a Repair may rebuild a destroyed item), <code>tableTier</code> (table tier multiplier), <code>bonusValue</code> (extra bonus value on enchantments)</td></tr>
      <tr><td>Box contents</td><td><code>item</code> (an item), <code>spell</code> (a Tome of the spell), <code>gold</code> (a number or dice formula), <code>table</code> (rolls a table), <code>magicItem</code> (a generated magic item), <code>choice</code> (the opener picks one thing that matches a tag query)</td></tr>
      <tr><td>Magic item properties</td><td><code>stat</code> (a Stat bonus), <code>skill</code> (Skill Ranks), <code>passiveSkill</code> (a passive skill at the floor's number), <code>spell</code> (a spell, 2 hours of cooldown per Rank), <code>dr</code> (+1 DR), <code>resistance</code> (a listed damage type), <code>buff</code> and <code>restore</code> (recorded for the GM to finish)</td></tr>
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
    }
];
