import { BOSS_TIERS } from '../mob-creation-rules.mjs';
import { TAG_NAMESPACES, HEALTH_FRACTION_STEPS, healthFractionTag, OUTCOME_TAGS } from '../tag-vocabulary.mjs';
import { COG_TAGS } from '../tag-catalog.mjs';
import { CHECK_TAGS, INTERRUPT_TRIGGERS, INTERCEPT_MODE_TAGS, NOT_VS_AREA_TAG, TRIGGER_MOMENTS, OFFER_ROLES } from '../../utils/tag/tag-mechanics.mjs';
import { RULE_FLAG_DEFS } from '../../utils/tag/tag-behaviour.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';

const code = (id) => `<code>${escapeAttr(id)}</code>`;
const labelOf = (id) => COG_TAGS.find((d) => d.id === id)?.label ?? id;

/**
 * Where each built-in namespace lives (the Namespace Reference page; `guideReader` holds what reads it). The grouping and the reader
 * text are hand-written; the namespace list itself comes from `TAG_NAMESPACES`, and `tests/journal-tag-system.test.mjs`
 * fails when this map and the registry disagree. A namespace a module registers is listed under its own group.
 */
export const NAMESPACE_GUIDE = Object.freeze({
  // Carried by items (typed on an item's Tags tab, or derived from its fields)
  kind: { group: 'item' },
  action: { group: 'item' },
  element: { group: 'item' },
  shape: { group: 'item' },
  delivery: { group: 'item' },
  duration: { group: 'item' },
  target: { group: 'item' },
  stat: { group: 'item' },
  archetype: { group: 'item' },
  favored: { group: 'item' },
  weapon: { group: 'item' },
  weaponClass: { group: 'item' },
  weaponGroup: { group: 'item' },
  weaponProp: { group: 'item' },
  wield: { group: 'item' },
  ammo: { group: 'item' },
  skillGroup: { group: 'item' },
  technique: { group: 'item' },
  rule: { group: 'item' },
  perk: { group: 'item' },
  trigger: { group: 'item' },
  interrupt: { group: 'item' },
  injury: { group: 'item' },
  companion: { group: 'item' },
  race: { group: 'item' },
  heritage: { group: 'item' },
  role: { group: 'item' },
  space: { group: 'item' },
  upgrade: { group: 'item' },
  scene: { group: 'context' },
  worship: { group: 'derived' },
  worships: { group: 'derived' },
  blessed: { group: 'item' },
  access: { group: 'item' },
  school: { group: 'item' },
  sense: { group: 'item' },
  usage: { group: 'item' },
  material: { group: 'item' },
  crafting: { group: 'item' },
  vehicle: { group: 'item' },
  pet: { group: 'item' },
  item: { group: 'item' },
  custom: { group: 'item' },
  // Carried by actors
  species: { group: 'actor' },
  mob: { group: 'actor' },
  creature: { group: 'actor' },
  // Derived only
  id: { group: 'derived' },
  condition: { group: 'derived' },
  resource: { group: 'derived' },
  contest: { group: 'derived' },
  // Context only
  check: { group: 'context' },
  outcome: { group: 'context' },
  situation: { group: 'context' },
  use: { group: 'context' },
  self: { group: 'context' },
  attacker: { group: 'context' },
  subject: { group: 'context' }
});

/** The hand-written text of what reads a built-in namespace: markup of ours, a switch of literals so the escaping rail proves it. `''` for a namespace with none. */
function guideReader(ns) {
  switch (ns) {
    case 'kind': return 'The type of every document. <code>kind.core</code> (no Ranks), <code>kind.technique</code> and <code>kind.weapon</code> gate sheet and roll behaviour.';
    case 'action': return 'Attack, passive, heal, interrupt: which buttons and rolls an item gets. Entries such as <code>action.summon</code> are descriptive.';
    case 'element': return 'The damage type of a packet; resistance, immunity and vulnerability rows match it.';
    case 'shape': return 'Area geometry and the Place Area button. Any shape carrying the <code>area</code> flag also derives <code>shape.aoe</code>.';
    case 'delivery': return 'Placed, aura, self or target: how an effect is delivered. Auras pulse.';
    case 'duration': return 'Floor-clock durations and rest durations.';
    case 'target': return 'Who an area affects.';
    case 'stat': return 'The governing stat of an item; conditions and stat substitutions test it.';
    case 'archetype': return 'A class or race names its archetypes; spell Favored costs compare against them.';
    case 'favored': return 'The spell Favored check (the +1 MP penalty). Falls back to the matching <code>archetype.&lt;name&gt;</code>.';
    case 'weapon': return 'The weapon family; weapon skills find their gear by it.';
    case 'weaponClass': return 'Melee, ranged, unarmed, natural. Unarmed and natural attacks need no wielded weapon.';
    case 'weaponGroup': return 'A weapon family group, typed on a weapon and on its Skill (never derived); technique queries and row conditions test it.';
    case 'weaponProp': return 'Handling traits such as reach and thrown; range checks.';
    case 'wield': return 'One-handed or two-handed. Derived for weapons; a flexible two-hander is rewritten at roll time.';
    case 'ammo': return 'Typed on an ammunition stack; a weapon or Skill names the kinds it takes in its ammunition query, and each Attack spends units from an owned stack that matches.';
    case 'skillGroup': return 'Skill pickers and lists (the contest tracker lists movement skills first); the animal-skill lockout.';
    case 'technique': return 'Names the skill a combat technique targets.';
    case 'rule': return 'Rule tags carry rows and flags the engine reads, or a named engine rule reads them.';
    case 'perk': return 'A race, class or benefit perk the engine cannot run. Descriptive: it carries no rows or flags and the system applies nothing for it; the tag shows the perk\'s text, and the GM adjudicates it.';
    case 'trigger': return 'Interrupt offers (page 15) and the derived on-hit, critical and fumble triggers.';
    case 'interrupt': return 'What an interrupt does to the attack that triggered it (page 15).';
    case 'injury': return 'Marks a debuff as an injury and its severity; Mend Injury removes by it and rest durations read it.';
    case 'companion': return 'Pet, vehicle, mount; the mount flag lets a pet be ridden.';
    case 'race': return '<code>race.form</code> marks a race that is only a transformation form: the race pickers leave it out, and an affliction names it to change a victim into it.';
    case 'heritage': return 'Derived from the heritage a race names (a registry id: earth, alien, pet, or one a module registers), never stored; a class can require one, and no other rule reads it.';
    case 'role': return 'Crew stations on vehicles and mounts; mercenary roles are descriptive.';
    case 'space': return 'The kind of personal space a space item is.';
    case 'upgrade': return 'The kind of upgrade a space upgrade is; the training and rest upgrades read it.';
    case 'scene': return 'Set on a scene by the Safe Room checkbox in Scene Config; a crawler token on such a scene opens loot boxes without a Rule Break.';
    case 'worship': return 'Worship state, derived from a deity bond (<code>worship.active</code>, <code>worship.tier.1</code> to <code>worship.tier.3</code>) and carried by the buffs and debuffs a god gives (<code>worship.boon</code>, <code>worship.smite</code>, <code>worship.benefit</code>, <code>worship.divine</code>, <code>worship.fallen</code>).';
    case 'worships': return '<code>worships.&lt;deity identifier&gt;</code>: the actor worships that god. Derived from a deity bond; typed on a mob or an NPC.';
    case 'blessed': return '<code>blessed.&lt;deity identifier&gt;</code>: gear blessed by that god. Registered for every deity that exists.';
    case 'access': return 'Descriptive: access to a club, guild or facility. The GM adjudicates it (page 17).';
    case 'school': return 'Descriptive: a spell\'s school or theme (illusion, healing, mind control). It shows as a line on the cast card; no rule reads it, and the GM adjudicates it (page 17).';
    case 'sense': return 'Descriptive: darkvision, water breathing and the like (page 17).';
    case 'usage': return 'How an item is used up. <code>usage.reusable</code> never changes, <code>usage.rechargeable</code> counts charges and stays at 0, <code>usage.consumable</code> is spent and leaves junk. <code>usage.restorable</code> makes the junk remember what it was, so a recharge can restore it. No tag means gear is reusable, anything with charges is rechargeable, and other loot is consumable.';
    case 'material': return '<code>material.crafting</code> marks loot as a crafting reagent and <code>material.misc_junk</code> the baseline Misc. Junk. The junk a used-up consumable leaves behind carries both; the crafting rules (row 3.15) read them.';
    case 'crafting': return '<code>crafting.table.&lt;type&gt;</code> is the type of a crafting table (a space upgrade), read by prefix: a blueprint\'s <code>tables</code> query names the types it needs and the lowest tier applies. <code>crafting.attachment.&lt;id&gt;</code> marks an attachment a blueprint may require. <code>crafting.coupon.table</code> marks loot that adds a table tier. <code>crafting.mode.*</code> is carried by a crafting check\'s context only.';
    case 'vehicle': return '<code>vehicle.skill.driving</code> and <code>vehicle.skill.chopper</code> mark the skills a vehicle kind finds by tag query; <code>vehicle.kind.&lt;id&gt;</code> is derived on a vehicle; <code>vehicle.upgrade.&lt;id&gt;</code> marks gear installed on one (crafting reads it for default skills). <code>vehicle.check.&lt;id&gt;</code> and <code>vehicle.explosion</code> are carried by a roll\'s context only (3.44).';
    case 'pet': return '<code>pet.skill.riding</code> marks the skill that rides a mount (the rider rules find it by tag); <code>pet.check.&lt;kind&gt;</code> is carried by a pet check\'s context only.';
    case 'item': return '<code>item.broken</code> (repairable) and <code>item.destroyed</code> (permanent) mark gear that crafting or the over-enchanting hazard broke. Equipping either asks a Rule Break. <code>item.trap</code> and <code>item.explosive</code> are descriptive: crafting rows may test them on the item being made.';
    case 'custom': return 'Yours. Whatever rows or flags you give a custom tag, the engine runs.';
    case 'species': return 'A crawler\'s origin at induction; the crawler creator and the animal-skill lockout read it.';
    case 'mob': return 'Mob and boss classification: boss tier, unique, summoned, minion (page 16).';
    case 'creature': return 'What a creature is. Per-target rows test it as <code>subject.creature.&lt;x&gt;</code>; owners may edit it on their own sheet.';
    case 'id': return 'The identity tag of an item, <code>id.&lt;type&gt;.&lt;identifier&gt;</code>. Grants, queries and rows use it to name one item.';
    case 'condition': return 'Comes from a debuff\'s identifier, and from the debuffs an attack can inflict. Rows test <code>self.condition.&lt;x&gt;</code>.';
    case 'resource': return 'Mana, Health Bars and temporary bars on healing and restoring items; <code>resource.health_N</code> on an actor that is hurt (page 14).';
    case 'contest': return 'From an item\'s contest settings, plus the race, chase and skill-challenge tags the engine sets on a leg or stage\'s roll (page 14).';
    case 'check': return 'What kind of roll this is. Only a roll\'s context carries it (page 14).';
    case 'outcome': return 'The degree of a finished check. Only cards carry it (page 14).';
    case 'situation': return 'A circumstance the engine cannot see; offered as a roll-dialog toggle, or set by the engine (page 8).';
    case 'use': return '<code>use.&lt;row key&gt;</code>: the once-per-Floor toggle (page 8).';
    case 'self': return 'Role prefix: a tag of the row\'s owner (page 8).';
    case 'attacker': return 'Role prefix: a tag of whoever is hitting you (page 8).';
    case 'subject': return 'Role prefix: a tag of the other party of a roll (page 8).';
    default: return '';
  }
}


function namespaceTable(groupKey) {
  const rows = Object.entries(TAG_NAMESPACES)
    .filter(([ns]) => (NAMESPACE_GUIDE[ns]?.group ?? 'module') === groupKey)
    .map(([ns, def]) => {
      const marks = [def.identity ? 'identity' : '', def.partyTag ? 'party' : ''].filter(Boolean).join(', ');
      const reader = guideReader(ns) || escapeAttr(def.description);
      return `      <tr><td>${code(ns)}</td><td>${escapeAttr(def.label)}${marks ? ` <em>(${marks})</em>` : ''}</td><td>${reader}</td></tr>`;
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

/** One group's heading, intro and table; `title` and `intro` are markup of ours, passed as literals. */
function groupSection(key, title, intro) {
  const table = namespaceTable(key);
  return table ? `\n  <h3>${title}</h3>\n  <p>${intro}</p>${table}\n` : '';
}

export function namespaceReferenceHtml() {
  const count = Object.keys(TAG_NAMESPACES).length;
  const sections = [
    groupSection('item', 'Carried by items', 'Typed on an item\'s Tags tab, or derived from its fields. Actors pick them up through the items they carry (page 8).'),
    groupSection('actor', 'Carried by actors', 'Typed on the actor\'s own Tags tab. <strong>Identity</strong> namespaces are the ones an actor\'s owner may edit; <strong>party</strong> namespaces describe an actor, so a row condition must say whose tag it is (<code>self.</code>, <code>subject.</code>, <code>attacker.</code>) and the row editor warns when it does not.'),
    groupSection('derived', 'Derived only', 'Worked out by the engine from fields and state. Set the field, not the tag (page 13).'),
    groupSection('context', 'Context only', 'Never carried by an item or an actor. They exist inside a roll or on a card, and rows test them.'),
    groupSection('module', 'Registered by modules or the world', 'Added with <code>registerTagNamespace</code> (page 18). The engine reads them only if the module that added them says how.')
  ].join('');
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

export function flagTableHtml() {
  const rows = Object.values(RULE_FLAG_DEFS).map((d) =>
    `      <tr><td>${code(d.id)}</td><td>${escapeAttr(d.label)}</td><td>${escapeAttr(d.hint)}</td></tr>`).join('\n');
  return `  <table class="cog-journal-table">
    <thead><tr><th>Flag</th><th>Name</th><th>What the engine does</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>`;
}

const idList = (ids) => ids.map((id) => `<li>${code(id)}: ${escapeAttr(labelOf(id))}</li>`).join('\n    ');

export function checkOutcomeHtml() {
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
    A finished d20 check against a Difficulty has a degree. The card carries the matching tag, and card-side readers test it: an assist skill's <code>when</code> query decides whether an assist is offered on an ally's card, and interrupt offers read the same card. A card with no Difficulty yet is pending, so a query that lists an outcome passes and the GM adjudicates. Popularity does not read outcome tags; it listens to events (<code>crit</code>, <code>critFail</code>, <code>kill</code>, <code>amazing</code>).
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
    A skill or attack with contest settings derives <code>contest.dc</code> or <code>contest.opposed</code>, and <code>contest.&lt;stat&gt;</code> for the stat it is rolled against. The engine adds <code>contest.race</code>, <code>contest.chase</code> or <code>contest.challenge</code> to a roll made for a leg of a race or chase, or a stage of a skill challenge.
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
  [TRIGGER_MOMENTS.beforeCheck]: 'in an ally\'s pre-roll dialog, before the check is rolled',
  [TRIGGER_MOMENTS.turn]: 'on the assister\'s own turn',
  [TRIGGER_MOMENTS.move]: 'when a foe\'s token moves'
});
const OFFER_TEXT = Object.freeze({
  [OFFER_ROLES.TARGET]: 'the creature being attacked',
  [OFFER_ROLES.ALLY]: 'an ally of the creature being attacked or of the roller',
  [OFFER_ROLES.FOE]: 'a foe of the mover'
});

export function interruptHtml() {
  const interruptIds = new Set(INTERRUPT_TRIGGERS.map((t) => t.tag));
  const derived = COG_TAGS.filter((d) => d.namespace === 'trigger' && !interruptIds.has(d.id)).map((d) => d.id);
  const rows = INTERRUPT_TRIGGERS.map((t) =>
    `      <tr><td>${code(t.tag)}</td><td>${escapeAttr(labelOf(t.tag))}</td><td>${escapeAttr(OFFER_TEXT[t.offerTo] ?? t.offerTo)}</td><td>${escapeAttr(MOMENT_TEXT[t.moment] ?? t.moment)}</td><td>${t.requiresHit ? 'only if the attack hit' : 'hit or miss'}</td></tr>`).join('\n');
  const modes = INTERCEPT_MODE_TAGS.map((m) => `<li>${code(m.tag)}: ${escapeAttr(labelOf(m.tag))} (mode <code>${escapeAttr(m.mode)}</code>)</li>`).join('\n    ');
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
    <li>${code(NOT_VS_AREA_TAG)}: ${escapeAttr(labelOf(NOT_VS_AREA_TAG))}. The interrupt is not offered against an area attack.</li>
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


export function mobsHtml() {
  const tiers = Object.values(globalThis.CONFIG?.COG?.bossTiers ?? BOSS_TIERS)
    .filter((t) => t?.boss !== false)
    .map((t) => `      <tr><td>${code(t.tag ?? `mob.tier.${t.id}`)}</td><td>${escapeAttr(t.label)}</td></tr>`).join('\n');
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
    <li><code>mob.minion</code>: a minion, under another creature's command. On a buff, the buff's caster is its controller; a buff aimed at a pet reaches a creature holding it. Its Actions in a fight wait for its controller's command.</li>
    <li><code>rule.self-directed</code>: on a minion buff, the minion needs no command from its controller.</li>
    <li><code>rule.command-check</code>: on a minion buff, each new command costs its controller an Action and an Unopposed handling check, and reaches only that minion (the split spell's copies).</li>
    <li><code>rule.command-together</code>: with <code>rule.command-check</code>, a Success commanding one creature commands every creature holding a copy from the same cast.</li>
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
