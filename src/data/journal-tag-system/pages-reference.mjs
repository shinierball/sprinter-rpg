import { namespaceReferenceHtml, checkOutcomeHtml, interruptHtml, mobsHtml } from './reference-tables.mjs';

export const REFERENCE_PAGES = [
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
];
