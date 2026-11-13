/**
 * Tag System journal page 3, "Make a Weapon That Works": the weapon sheet's choices worked on the Weapon Workshop example
 * documents, each linked by `@UUID` to its compiled `examples-items` document. Every number the page states is pinned by
 * `tests/content/journal-worked-examples.test.mjs` against what the engine rolls.
 */
import { SPECS as WEAPON_WORKSHOP } from '../../content/specs/examples/items/weapon-workshop.mjs';
import { exampleUuid } from '../../content/specs/examples/refs.mjs';

/** The examples pack the Weapon Workshop documents compile into. */
const WEAPON_EXAMPLES_PACK = 'examples-items';

/** `@UUID[…]{Name}` for a Weapon Workshop document, by identifier. */
function link(identifier) {
  const spec = WEAPON_WORKSHOP.find((s) => s.system.identifier === identifier);
  if (!spec) throw new Error(`Tag System journal: no Weapon Workshop document "${identifier}"`);
  return `@UUID[${exampleUuid(WEAPON_EXAMPLES_PACK, 'Item', spec._id)}]{${spec.name}}`;
}

export const WEAPON_PAGE = {
  name: "3. Make a Weapon That Works",
  type: "text",
  title: { show: true, level: 1 },
  text: {
    format: 1,
    content: `
<div class="cog-journal-page">
  <h2>Make a Weapon That Works</h2>
  <p>
    A weapon needs three things: the <strong>Skill used</strong> to attack with it, a <strong>weapon type</strong> tag, and how many <strong>hands</strong> it takes. Its damage comes from the Skill. Everything else on the sheet is optional. This page walks through the five documents of the <em>Weapon Workshop</em> example set; each name below opens the document in the Shiny Items compendium, folder Weapon Workshop.
  </p>

  <h3>Where to Start</h3>
  <ul>
    <li><strong>New weapon:</strong> press <strong>Create Item</strong> in the Items directory. The window asks <em>What are you making?</em>; pick <strong>Weapon</strong>. It asks for the name, the <em>Skills it is used with</em>, the <em>Hands</em> and the <em>Weapon type</em> (filled in from the first Skill), and hides the damage boxes behind <em>This weapon deals different damage than its Skill</em>.</li>
    <li><strong>An existing weapon:</strong> open its sheet. The <strong>Weapon</strong> section is open by default and holds the same choices in this order: <em>Skill used to attack</em>, <em>Weapon type</em>, <em>Hands</em>, <em>Damage</em>, <em>To-hit</em>.</li>
  </ul>
  <p>
    The numbers below are for a crawler with Strength 14 and Dexterity 12. Both scores give <code>+4</code>.
  </p>

  <h3>1. The Skill Used (<code>system.associatedSkills</code>)</h3>
  <p>
    A weapon lists its Skills in order of preference. The first one the attacker is trained in is used; the Attack Options window offers the rest under <em>Skill used</em>, so the attacker can pick another for one attack. Skills the attacker owns that match the weapon by type but are not listed are offered after the listed ones.
  </p>
  <div class="cog-journal-card">
    <h4>${link('prop-sabre-fencing')} (the Skill)</h4>
    <p>A weapon Skill: Dexterity, the <code>weapon.rapier</code> and <code>weaponClass.melee</code> tags, and a Base Damage of <code>1d6</code> + Dex Slashing. It has no rank breaks.</p>
    <h4>${link('prop-sabre')}</h4>
    <p style="margin-bottom: 0;">Lists one Skill, Prop Sabre Fencing. With the Skill at Rank 3 the crawler rolls <strong>1d20 + 7</strong> to hit (Rank 3 + Dex +4) and deals <strong>1d6 + 4 Slashing</strong>. At Rank 10 the to-hit is <strong>1d20 + 14</strong> and the damage is still <strong>1d6 + 4 Slashing</strong>: a Skill's Base Damage grows only through its rank breaks, and this one has none.</p>
  </div>
  <div class="cog-journal-card">
    <h4>${link('breakroom-broom')}</h4>
    <p style="margin-bottom: 0;">Lists two Skills a new world has, in this order: Quarterstaff Training (<code>1d6</code> + Str Bludgeoning), then Improvised Weapons Training (<code>1d4</code> + Str Bludgeoning). A crawler with Quarterstaff Training at Rank 2 rolls <strong>1d20 + 6</strong> and deals <strong>1d6 + 4 Bludgeoning</strong>. A crawler with only Improvised Weapons Training at Rank 2 also rolls <strong>1d20 + 6</strong>, and deals <strong>1d4 + 4 Bludgeoning</strong>. Trained in both, the staff is used unless the attacker picks the other.</p>
  </div>

  <h3>2. Untrained: Disadvantage, No Rank</h3>
  <p>
    An attacker trained in none of the listed Skills attacks untrained: at Disadvantage (<code>2d20kl</code>, keep the lower) and with no Rank added. The weapon still deals the first listed Skill's Base Damage. The Attack Options window shows the Skill as <em>(untrained: Disadvantage, no Rank)</em>.
  </p>
  <div class="cog-journal-callout cog-journal-callout-info">
    The same crawler without Prop Sabre Fencing swings the ${link('prop-sabre')} at <strong>2d20kl + 4</strong> (Dex +4, no Rank) and still deals <strong>1d6 + 4 Slashing</strong>. With neither of the Broom's Skills, the Broom rolls <strong>2d20kl + 4</strong> and deals Quarterstaff Training's <strong>1d6 + 4 Bludgeoning</strong>.
  </div>
  <p>
    Under <em>To-hit</em>, <em>Rank when no Skill applies</em> is for a weapon with no Skill listed. Leave it at 0 so an attacker without the Skill is shown the untrained Disadvantage.
  </p>

  <h3>3. The Weapon Type Tag</h3>
  <p>
    The type is a tag: <code>weapon.rapier</code>, <code>weapon.quarterstaff</code> and the rest, plus an optional group such as <code>weaponGroup.edge</code>. Skills and techniques that match by weapon type read it, and a technique's <code>appliesToQuery</code> (page 2) tests it. Pick the chips under <em>Weapon type</em> and <em>Weapon group</em>; hover a chip for its description. <strong>Use the Skill's</strong> copies the type and group of the Skill used to attack. Neither is derived from another field: the weapon carries what you pick.
  </p>
  <p>
    The ${link('prop-sabre')} carries <code>weapon.rapier</code> and <code>weaponClass.melee</code>, the same tags as its Skill. The ${link('breakroom-broom')} carries <code>weapon.quarterstaff</code>.
  </p>

  <h3>4. Hands</h3>
  <p>
    <em>Hands</em> is <strong>One-Handed</strong>, <strong>Two-Handed</strong> or <strong>Two-Handed (Disadvantage if 1-Handed)</strong>. The last shows a <em>Wielded one-handed (disadvantage)</em> box: ticked, the weapon takes one hand and its attacks roll at Disadvantage. The hands a weapon takes count against the wielder's hands, and derive <code>wield.one_handed</code> or <code>wield.two_handed</code> (page 13). The three Prop Sabres are One-Handed.
  </p>

  <h3>5. Base Damage and Bonus Damage</h3>
  <p>
    The <em>Damage</em> section shows what the default Skill rolls. Two optional things change it, and they behave differently:
  </p>
  <table class="cog-journal-table">
    <thead><tr><th></th><th>Different base damage</th><th>Bonus damage</th></tr></thead>
    <tbody>
      <tr><td>Stored as</td><td><code>system.baseDamage</code> on the weapon</td><td>The weapon's own <code>add</code> rows (<code>damageModifiers</code>), under Modifiers</td></tr>
      <tr><td>What it does</td><td>Replaces only the boxes you fill (dice, stat, damage type); a blank box keeps the Skill's</td><td>Added on top of the base damage, on every hit with this weapon</td></tr>
      <tr><td>With Rank</td><td>Grows with the Skill's rank breaks, as the Skill's own Base Damage does</td><td>Does not grow with Rank</td></tr>
    </tbody>
  </table>
  <div class="cog-journal-card">
    <h4>The three sabres, same crawler, Prop Sabre Fencing at Rank 3</h4>
    <ul style="margin-bottom: 0;">
      <li>${link('prop-sabre')}: neither. <strong>1d6 + 4 Slashing</strong>.</li>
      <li>${link('sponsor-weighted-prop-sabre')}: a Different base damage that fills only the dice, <code>1d10</code>. The stat and type still come from the Skill: <strong>1d10 + 4 Slashing</strong>.</li>
      <li>${link('pyrotechnic-prop-sabre')}: one bonus damage row, <code>1d4</code> Fire. <strong>1d6 + 4 Slashing</strong> plus <strong>1d4 Fire</strong>, each rolled as its own damage type.</li>
    </ul>
  </div>
  <p>
    Do not copy the Skill's dice into bonus damage: they would be rolled twice. The check below warns when a bonus row repeats the Skill's Base Damage.
  </p>

  <h3>6. What's Missing</h3>
  <p>
    Every item sheet opens with a <strong>What's missing</strong> list when something would stop the item working, and a fix button on a line that has one. Each line is <em>broken</em> (it will not work as it should), a <em>warning</em> or a <em>note</em>. The five Weapon Workshop documents list nothing.
  </p>
  <p>A new weapon with no Skill and no type lists two broken lines:</p>
  <ul>
    <li><em>No Skill is listed. Anyone using this weapon attacks untrained, at Disadvantage.</em></li>
    <li><em>No weapon type is set, so Skills and techniques that match by weapon type will not match this weapon.</em></li>
  </ul>
  <p>
    Add Prop Sabre Fencing and the first line goes; the second gains <strong>Add the suggested tags</strong>, which adds the Skill's <code>weapon.rapier</code>. Created from the setup window with a broken line, the weapon asks <em>Create anyway?</em> first; creating it anyway records no Rule Break.
  </p>
</div>
`
  }
};
