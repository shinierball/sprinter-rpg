# Modifier rows

Gear, buffs, debuffs, skills, spells, races, classes and rule tags carry **modifier rows**. A row does one thing (add damage, resist a type, grant a bonus) when its **condition** matches. Mechanics read the structured fields and tags only, never names, descriptions or notes.

Every row is edited on the item sheet: **Add row** picks the array and kind, the pill editor sets the condition, the scale block sets a scalar, and each row shows a "Reads as …" line. "Preview against target" (owner actor + first targeted token) lists which rows apply and their numbers without writing anything.

Module authors: [engine-extension.md](engine-extension.md) registers new scalars, row kinds, rule tags and flags.

## 1. The arrays

| Array | Kind field | Roles it sees | Modules may add kinds |
|---|---|---|---|
| `damageModifiers` | `mode` | `self`, `subject` | yes |
| `defenseModifiers` | `kind` | `self`, `attacker` | yes |
| `attackModifiers` | `kind` | `self`, `subject` | yes (shared table with checks) |
| `checkModifiers` | `kind` | `self`, `subject`, `attacker` | yes (shared table with attacks) |
| `craftModifiers` | `kind` | `self` | yes |
| `vehicleModifiers` | `kind` | `self` | yes |
| `manaCostModifiers` | `mode` | `self` | no |
| `recoveryModifiers` | (none) | `self` | no |
| `popularityTriggers` | (none) | `self`, `subject` | no |
| `aiFavorRatings` | (none) | `self`, `subject` | no |
| `statSubstitutions` | (none) | `self`, `subject` | no |
| `boxContents` | `kind` | `self` | yes (loot box prizes, not a modifier row; see below) |
| `magicProperties` | `property` | `self` | yes (magic item generator properties, not a modifier row; see below) |
| `requirements` | `kind` | `self` | yes (what a race or class needs, not a modifier row; see below) |

`attackModifiers` apply to attack rolls only; `checkModifiers` apply to every roll of a skill, attacks included, so a to-hit total is the check rows plus the attack rows. The two arrays share one kind table: a kind registered on one is available on both. The source of truth is `ROW_ARRAYS` in `src/utils/row-kinds.mjs`.

Skills and spells also have `rankDamageParts`: extra typed damage that the skill or spell itself deals from a minimum Rank. They are not modifier rows.

### Fields every row may carry

| Field | Meaning |
|---|---|
| `label` | Text on the card and in breakdowns. Humans only. |
| `mode` / `kind` | The row kind (section 5). |
| `option` | A kind's sub-choice, e.g. `add` rows: `standard` or `rank` (a Rank die, not doubled on a crit). Blank means the kind's default. |
| `condition` | `{ all, any, none }` tag lists (section 3). Empty matches everything. |
| `scaleBy` | A scalar (section 4). |
| `scope` | Damage, attack and check rows on a skill, spell, attack item or weapon: `item` (default) or `owner` (section 2). |
| `disabled` | The row is kept but never applies. |
| `minRank` | On a skill or spell: the row is ignored while its Rank is below this. |
| `maxRank` | A ceiling against the skill the roll is for (or the spell or technique's own Rank). |
| `usesPer: 'floor'` | Once per floor: the roll dialog offers a `use.<row>` toggle, and the row applies only when it is ticked. |

## 2. Scope: whose rolls a row touches

A row on any active source (equipped gear, an active buff, an owned skill, the race, the class, a rule tag) is collected for every roll of its owner. Two things narrow that:

- **Scope.** A damage, attack or check row on a **skill, spell, attack item or weapon** applies only when that item is the action being rolled. Set `scope: 'owner'` ("Applies to: every roll of the owner" in the editor) for a buff-style row that should ride on the owner's other attacks too. Armour and other gear, buffs, debuffs, races, classes, rank breaks and rule tags are always owner-wide and have no "Applies to" control.
- **Conditions.** `id.<type>.<identifier>` in `condition.all` limits any row to one skill, spell or item, e.g. `id.spell.fireball`. Items are matched by `system.identifier`, never by name.

## 3. Conditions, contexts and roles

Every roll builds one context (`buildRollContext`, `src/utils/roll/roll-context.mjs`). A row's condition is matched against its tags:

| Prefix | Means | Example |
|---|---|---|
| none | the **action**: the item used and its skill (`kind.*`, `weaponGroup.*`, `element.*`, `shape.*`, `id.*`, …) and situations | `weaponGroup.edge` |
| `self.` | the row's **owner**: identity tags, `condition.*` debuffs, health fraction | `self.condition.fatigued` |
| `subject.` | the **other party** for damage, to-hit and checks (the target) | `subject.creature.undead` |
| `attacker.` | the **hitter**, for defense rows and Evade | `attacker.mob.tier.neighborhood` |

The roles an array sees are listed in section 1; the editor only offers those. What an actor **is**: its `system.tags`, `kind.<type>`, `mob.boss` for a boss tier, archetype tags and the tags of its race, class, deity and sponsor, plus `condition.*` debuffs and health-fraction tags. `system.tags` is edited on the actor sheet's Tags tab: the owner may change tags in identity namespaces (`creature`, and any namespace a module flags `identity: true`), the GM any tag that is not derived.

**Situations** are unprefixed tags in the `situation.` namespace:

- The engine sets eight itself: `situation.in_combat`, `situation.disadvantaged` (the net roll is Disadvantage), `situation.critical_hit`, `situation.amazing_success` (not on a Critical Hit), `situation.damage_effect` (the attack uses a Damage Effect), `situation.specialty` (the item you make, or your target, carries the rolling skill's chosen specialty) and `situation.same_size` (attacker and target the same size; a roll may also tick it by hand) and `situation.intercepting` (a defence row only: the holder caught the hit for an ally). A roll inside a racing or chasing contest also carries `contest.race` or `contest.chase`.
- Any other situation a row mentions is offered in the roll dialog as a toggle (e.g. `situation.aiming`). A situation flagged `maneuver` is listed under Maneuvers in the Attack Options pop-up.
- "+ New situation" in any condition editor creates a world situation tag on the spot.

The roll dialog also lets the roller tick `subject.*` tags when nothing is targeted ("the thing I'm hitting is undead").

## 4. Per target

A damage row whose condition mentions `subject.*`, `situation.critical_hit`, `situation.amazing_success` or `situation.same_size` is a **target row**. The roll leaves it out of the frozen numbers, stores it on the damage card and rolls its dice once as a standby part. When damage is applied, each target is judged on its own tags, so one card can hit every token in an area differently. The card's "Per target" box lists those rows, and the breakdown names each row per target.

- **Crit** is decided by the apply button pressed (the card has a crit / normal-hit pair), not by the original roll; crit-conditioned rows follow the button.
- **Area targets** come from the placed area's Region: Apply with nothing targeted hits the tokens inside it.
- **Ticked subjects** (an untargeted roll's ticked `subject.<ns>.<tag>`) are kept at apply only when the real target has no tag in the same namespace (everything before the last dot, e.g. `creature`). A ticked `subject.creature.female` applied to a `creature.male` token is dropped, and the breakdown says "Ticked … dropped". The same tick on an untagged token is kept.
- To-hit rows with target tags are judged per target in the same way.

## 5. Kinds

The kind decides what a row does. Built-ins (labels as in the editor):

| Array | Kind | Fields | Notes |
|---|---|---|---|
| damage | `add` | value, dice, stat, damageType, option | `damageType` blank = the action's own type; option `rank` = a Rank die |
| damage | `multiply` | multiplier, damageType | Multiplies the whole damage, flat bonuses included; stacks multiplicatively with other multipliers and crits; x0 is a real zero |
| damage | `suppress_stat` | damageType | Zeroes the stat modifier on matching parts |
| defense | `resistance`, `immunity`, `vulnerability` | damageType | |
| defense | `tempHp` | value | |
| defense | `reduction` | percent, flat, rounding, damageType | Reduction % and/or flat, typed or not |
| defense | `dr` | value | Damage Resistance; reduces every type |
| defense | `evade` | value | Evade bonus |
| defense | `suppress_dr` | damageType | |
| defense | `effectImmunity` | none (the row's condition names the effect) | A Debuff or contested Skill or Spell the condition matches does not land; an empty condition is immune to nothing |
| defense | `evadeOutcome` | option (`full`, `half`, `none`) | What a successful Evade does against an area attack |
| defense | `reflect` | value, flat | When one blow costs the holder at least `value` Health Bar slots, the attacker may lose `flat` slots |
| defense | `attackerAdvantage` | option (`advantage`, `disadvantage`) | Whoever attacks the holder rolls with Advantage (or Disadvantage); a mob attacker's Difficulty on the holder moves 5 per net step. Debuffs that leave their bearer open to attack carry it |
| defense | `healthBarScale` | value (default 2) | Each Health Bar slot holds `value` times its HP: damage reaching the bar is divided by it, rounded down; the highest factor wins |
| attack / check | `bonus` | value, dice, stat | |
| attack / check | `advantage` | advantage | One Advantage or Disadvantage reason; reasons net out (more Advantage → 2d20kh, more Disadvantage → 2d20kl, equal → 1d20) |
| check | `assist` | dice, option (`replace`, `add`) | Changes the dice an assist skill rolls; never touches ordinary checks |
| check | `reroll` | none | After the roll the roller may roll the check again and keep the new result; the source item's cooldown gates each use (3.44) |
| check | `degreeShift` | value, option (`failOnly`, `any`) | After the roll the roller may move the result's degree `value` steps (default 1); a Fail never shifts past Near Miss into a success |
| attack / check | `waive` | option (a `rollPenalties` id; `driver` is built in) | The named engine roll penalty does not apply to the rolls the row matches |
| vehicle | `moveAdd` | value | Adds feet to a Move. A vehicle's is read by `vehicleMoveOf` from its installed gear and active buffs and its driver's skills; a creature's by `creatureMoveOf` from its debuffs in force, buffs, gear and skills |
| vehicle | `moveMultiply` | multiplier | Multiplies a Move after the additions; matching rows multiply, so two halving debuffs leave a quarter. A creature's stored Move is never changed; the sheet shows the Move now beside it |
| craft | `maxBonus` | value | The highest enchantment bonus level the holder crafts; the highest matching row wins, no matching row is no limit, and a craft above it asks a Rule Break |
| craft | `time` | multiplier | Multiplies the hours of a craft; matching rows multiply |
| craft | `batchTime` | multiplier | Multiplies the minutes a batch adds for each extra unit; matching rows multiply |
| craft | `rebuild` | none | A Repair check can rebuild a destroyed item without a Rule Break; condition it on `item.destroyed` |
| craft | `tableTier` | multiplier | Multiplies the crafting table's tier for the step; matching rows multiply, `0` means tables give no bonus (the step still needs a table and a space) |
| craft | `bonusValue` | value | Adds to every number an enchantment writes (grants `stat`/`skill`/`rank_bonus` `value`, and each row kind's `scaled: 'whole'` field), with no extra Difficulty or time; matching rows add |
| craft | `materials` | multiplier | Multiplies each material line and the Misc. Junk of a step, rounded up; matching rows multiply, `0` means none |
| craft | `batchAny` | none | Any blueprint may be batched at the step, even one not marked batchable |
| craft | `unlockRecipes` | none | Crafts a blueprint tagged `crafting.recipe.<id>`; the row's condition names the recipes it unlocks, and a locked recipe with no such row asks a Rule Break |
| craft | `salvage` | value | A failed step salvages `value` tiers better; matching rows add |

`craftModifiers` rows sit on skills, worn gear and the space upgrades of a personal space (a crafting table, or an attachment tagged `crafting.attachment.<id>`). Their conditions read the craft check's tags (`check.crafting`, `crafting.mode.*`, the table type, the output's tags). A skill's rows apply only when that skill rolls the step, unless `scope: 'owner'`.

`boxContents` is not a modifier array: it is the list of prizes in a loot box (`system.box.contents[]` on a loot item whose `lootType` is `box`), so it has no condition, scope or scale, and no editor of the modifier family. Its kinds are `item` (an item by uuid or identifier), `spell` (a Tome of the spell), `gold` (a number or a dice formula), `table` (rolls a RollTable) `magicItem` (a generated magic item) and `choice` (the opener picks one candidate of a tag `query`, of an `itemType`: an item, a Tome for a spell, a potion for a skill); a module adds a kind with `registerRowKind('boxContents', def)` and an `apply.boxOpen` handler (and `apply.boxChoose` when the opener must pick first). The kinds are descriptors until the open engine reads them.

`magicProperties` is not a modifier array either: each "row" is the `magic` option (`{ kind: 'magic', property, damageTypes? }`) of a rolled property table row, read by the magic item generator (`src/utils/crafting/magic-item.mjs`) and never stored on a document. Its kinds are `stat`, `skill`, `passiveSkill`, `spell`, `dr`, `resistance`, `buff` and `restore`. A kind's `apply.magicItem(option, ctx)` returns `{ template, line }` (an enchantment template and the reveal's one-liner) or `null`, which records the row's own words as a pending ledger entry for the GM to finish; `buff` and `restore` always do. A module adds a kind with `registerRowKind('magicProperties', def)`.

`requirements` is not a modifier array either: it is what a Race or Class needs before a crawler takes it (`system.requirements[]`), so it has no condition, scope or scale and no editor of the modifier family. Rows are joined with AND; inside a row, `options` and `query` mean any one. Its kinds are `stat` (a Stat's unenhanced score is at least `value`; gear and buffs never count), `skillRank` (an owned Skill, one of a list, or any Skill matching a tag query is at least Rank `value`), `popularity`, `floor`, `race` and `class` (a reference, a list or a tag query on the held one), `achievement` (an owned achievement), `tags` (the actor's tags with the candidate applied match a tag query: needs, needs one of, cannot have) `note` (a condition the system cannot judge: the GM decides, never unmet), `worship` (a worshipped god, any, named, one of a list or matching a tag query, at tier at least `value`: 2 is Devotee, 3 is Zealot), `noWorship` (the crawler worships no god) and `patron` (a god, any or named, is the crawler's patron). Starting or leaving worship asks a Rule Break when it would break a race or class row of these kinds. A kind's `apply.require(row, ctx)` is pure and reads only `ctx.subject`; it returns `{ status: 'met'|'unmet'|'unchecked', have?, need?, shortfall? }`. An unmet row asks a Rule Break and never blocks. A module adds a kind with `registerRowKind('requirements', def)` and `apply.require`.

Mana cost (`add`, `multiply`), recovery, popularity, AI Favor and stat-substitution rows each have one fixed shape.

**Static policy (defense kinds).** `prepareDerivedData` is synchronous, so some defense rows are folded into the bearer's derived stats:

- `unconditional` (`resistance`, `immunity`, `dr`): folded in when the row has no condition, checked per hit otherwise.
- `derived` (`tempHp`, `evade`): always derived-stat rows.
- `never` (everything else): checked per hit, against the attack's tags.

**Stages.** At roll time, damage rows feed the `damage` stage and target rows the `target` stage; defense rows feed `defense` (per hit), `derived`, `evade` and `reflect`; roll rows feed `rollBonus`, `rollAdvantage`, `assist`, `afterRoll` (reroll, degree shift) and `waive`; vehicle rows feed `move`.

A row whose kind is not registered (a removed module) does nothing, logs one warning and shows a badge in the editor.

## 6. Scalars: "this much per something"

`scaleBy` multiplies a row's number by a count the engine works out:

```
scaled = number × (base + per × n), then clamped to [min, max]
```

- `base` defaults to 0 for whole numbers and 1 for factors (multipliers). `per` defaults to 1.
- Whole numbers round down; factors keep 6 decimals and never go below 0.
- Only the fields a kind marks as scalable change: `add` value, `multiply` multiplier, `reduction` flat, `dr` value, `bonus` value, mana-cost value and multiplier, recovery multiplier, popularity value. Dice on an `add` row are not scaled (the editor warns). A `scaleBy` on a kind with nothing to scale is inert and badged.

| Scalar | n is | Scopes |
|---|---|---|
| `hpSlotsLost` | empty Health Bar slots | `self` (default), `subject` (at apply, per target) |
| `rank` | a Rank | `source` (this item, default), `item` (the item used), `skill` (the weapon skill), `owned` |
| `floor` | the current Floor | |
| `stat` | the owner's modifier for a chosen stat | |
| `statValue` | the owner's score for a chosen stat | |
| `count` | creatures or items matching a `where` query | `party` (default), `allies`, `enemies`, `items`, `targets` (at apply: targets hit at once) |
| `move` | the owner's Move in feet (`per: 0.1` = per 10 ft) | |
| `worshipTier` | the Tier of Devotion (1-3) of a worshipped god; 0 when the god is not worshipped | `source` (default: the god whose gift carries the row), `highest` (the highest god worshipped) |

- **Party includes the owner.** `count` with scope `party` counts every actor sharing `details.party` with the owner, the owner too. There is no "party minus me" scope yet; if the owner matches `where`, they are counted.
- `where` is matched against what each actor **is** (identity tags, `condition.*`, health fraction), unprefixed: write `creature.female`, not `subject.creature.female`.
- **Roll time vs apply time.** Most scopes resolve when the roll is made. Scopes listed in a scalar's `applyScopes` (`hpSlotsLost` `subject`, `count` `targets`) wait for each target at apply; the card shows the recipe and the number appears per target. "Preview against target" shows "Target a token to see the number" until one is targeted.

## 7. Moments: when rows are read

Rows hook only moments the engine already has. The roll context phases (`ROLL_PHASES`): `check`, `toHit`, `damage`, `defense`, `advancement`, `manaCost`, `recovery`, `popularity`, `derived`. On top of those:

- **Apply time**, per target: target rows, apply-time scalars, conditional defense rows, the Evade link (an area damage card applies the target's Evade result through `evadeOutcome`) and Amazing Success effects.
- **After a d20 check** (`trigger.on_ally_check`): allies with an `action.interrupt` skill carrying the trigger are offered an assist that amends the card.
- **Before an ally acts** (`trigger.before_ally_action`): a called bonus stored on the ally, offered as a toggle on their next roll.
- **Playing to the Cameras**: a crawler's per-roll choice that adds one Disadvantage reason; the Popularity and AI Favor award is worked out once the result is known.

A new moment ("when a template is placed", "at the start of my turn") is engine code, not a row.

## 8. Rule tags and flags

A tag may carry `rows` and `flags`. Its rows behave as rows on whatever carries the tag (equipped gear, an active buff, an owned skill, the actor) and are owner-wide. Its flags are yes/no gates the engine reads with `hasRuleFlag(subject, flag)`; code never matches a `rule.*` id, so a renamed or replaced tag keeps the rule.

The 19 core flags (`RULE_FLAGS`, `src/utils/tag/tag-behaviour.mjs`): `no-damage-effects`, `requires-weapon`, `no-standalone-attack`, `no-redirect`, `area`, `ignores-dr`, `anti-piercing`, `no-hands`, `uncounted-ally`, `no-ranks`, `emits-light`, `zone`, `maneuver`, `mount`, `mounted-only`, `works-in-zero-zone`, `no-actions` (acting is a Rule Break confirm; Dying and Dead carry it), `no-healing` (healing the bearer is a Rule Break confirm), `forfeits-action` (the next Action is lost: a "Forfeited" slot is recorded and the debuff ends).

Example: `rule.aiming-offset` carries rows conditioned on `situation.aiming` and a ranged attack: Disadvantage, a to-hit bonus of the carrier's Rank (scalar `rank`), and `1d4` damage at Ranks 1, 5, 10 and 15 (four `add` rows with `minRank`). A skill that carries the tag gets the whole behaviour with no code.

**Precedence.** core (priority 0) < module (default 10) < world custom tag < the `tagOverrides` world setting. In the Tag Manager, **Rules** on a tag shows its rows and flags; the GM may edit them (stored as an override for this world) and **Reset to default** removes the override.

## 9. Worked example: a cone that treats targets differently

A skill whose area damage is halved against female targets and gets 10% more per female party member against male targets. Two rows, no code.

```js
damageModifiers: [
  { label: 'Half vs females', mode: 'multiply', multiplier: 0.5,
    condition: { all: ['subject.creature.female'] } },
  { label: '+10% per female in the party vs males', mode: 'multiply',
    scaleBy: { source: 'count', scope: 'party', where: { all: ['creature.female'] }, per: 0.1, base: 1 },
    condition: { all: ['subject.creature.male'] } }
]
```

In the UI on a fresh world:

1. Make three crawlers with the same Party field: the caster and two allies. On each ally's sheet, Tags tab, add `creature.female`.
2. Make three mobs: one `creature.female`, one `creature.male`, one untagged. Place them in front of the caster's token.
3. On the caster, make a skill "Wide Swing" with a fixed 10 damage and a cone area, and a plain attack with the same damage.
4. On Wide Swing, **Add row** twice (damage):
   - Multiply, x0.5, condition "Target (subject)" has `creature.female`.
   - Multiply, scale source Count, scope Party, where `creature.female`, per 0.1, base 1; condition "Target (subject)" has `creature.male`.
5. Use Wide Swing, press **Place Area**, aim the cone over the three mobs. With nothing targeted, press **Apply**.
6. The female mob loses 5, the male mob 12 (two female party members: ×1.2), the untagged mob 10, before the mobs' DR. The breakdown names each row per target.
7. Use the plain attack through the same cone: all three lose 10. The rows are scoped to Wide Swing (section 2).

If the caster were also tagged `creature.female`, the party count would be 3 and the male mob would lose 13.

## 10. More examples

| Want | Where | Row |
|---|---|---|
| +2 to all damage | ring (gear) | `add`, value 2, empty condition |
| +2 to edged weapons | gear or buff | `add`, value 2, `all: ['weaponGroup.edge']` |
| +5 to one spell | gear or buff | `add`, value 5, `all: ['id.spell.<identifier>']` |
| x2 while wielding two-handed | stance buff | `multiply`, 2, `all: ['wield.two_handed']` |
| No stat bonus with edged weapons | race | `suppress_stat`, `all: ['weaponGroup.edge']` |
| +1 damage per Floor | buff | `add`, value 1, scale `floor` |
| Resist fire from bosses only | armour | `resistance`, fire, `all: ['attacker.mob.boss']` |
| Advantage while not Fatigued | buff | `advantage`, `none: ['self.condition.fatigued']` |

Tags often used in conditions: `weaponGroup.*` (typed on the weapon or its Skill; never derived), `wield.one_handed` / `wield.two_handed` (from the wield mode for that roll), `weaponClass.*` (`melee`, `ranged`, `natural`, `unarmed`), `element.*`, `shape.*`, `kind.*`, `id.<type>.<identifier>`.
