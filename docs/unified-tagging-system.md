# Sprinter RPG — Unified Tagging System Architecture & Taxonomy

## 1. Overview

Sprinter RPG has a comprehensive, data-driven **Unified Tagging System** that replaces legacy string matching, regex heuristics, and hardcoded mechanics with exact, namespaced keyword tags and set queries.

The tagging engine powers:
- Categorization and lookup across world items and compendium entries.
- Combat Technique applicability (e.g. *Mic Drop*, *Dirty Fighting*, *Toss*).
- Spell favored class detection and mana penalty calculation (+1 MP for non-favored classes).
- Structured Class and Race grants (skills, spells, choices, stat modifiers).
- Fast O(1) in-memory indexing and live mutation tracking.

---

## 2. Tag Taxonomy & Namespaces

Tags follow the lowercase dot-separated notation: `<namespace>.<identifier>`.

| Namespace | Purpose | Examples |
|---|---|---|
| `kind` | Core entity kind | `kind.spell`, `kind.skill`, `kind.attack`, `kind.gear`, `kind.class`, `kind.race` |
| `action` | Ability function | `action.attack`, `action.heal`, `action.passive`, `action.interrupt` |
| `element` | Damage types and schools | `element.fire`, `element.acid`, `element.bludgeoning`, `element.force` |
| `archetype` | Class archetypes | `archetype.mage`, `archetype.fighter`, `archetype.rogue`, `archetype.cleric` |
| `favored` | Spell favored archetype | `favored.mage`, `favored.fighter`, `favored.cleric`, `favored.druid` |
| `weapon` | Weapon type | `weapon.sword`, `weapon.dagger`, `weapon.bow`, `weapon.unarmed` |
| `weaponClass` | Category | `weaponClass.melee`, `weaponClass.ranged`, `weaponClass.unarmed` |
| `weaponProp` | Handling properties | `weaponProp.reach`, `weaponProp.thrown`, `weaponProp.versatile` |
| `skillGroup` | Skill disciplines | `skillGroup.combat`, `skillGroup.magic`, `skillGroup.survival`, `skillGroup.crafting` |
| `technique` | Combat technique target | `technique.unarmed`, `technique.pugilism`, `technique.wrestling` |
| `rule` | Special mechanics | `rule.no-damage-effects` (Unarmed Combat rule limitation) |
| `id` | Unique item identity | `id.skill.pugilism`, `id.spell.fireball`, `id.class.dcccls0000000032` |
| `custom` | User/Homebrew tags | `custom.quantum-flux`, `custom.infernal-brand` |

---

## 3. TagQuery Engine (`src/utils/tag-query.mjs`)

The `matchesTagQuery(targetTags, query)` function supports three query forms:

1. **Exact String Match**:
   ```javascript
   matchesTagQuery(item.allTags, 'element.fire');
   ```

2. **Array Conjunction (All Required)**:
   ```javascript
   matchesTagQuery(item.allTags, ['kind.spell', 'element.fire']);
   ```

3. **Structured Boolean Query Object**:
   ```javascript
   matchesTagQuery(item.allTags, {
     all: ['kind.skill'],
     any: ['weaponClass.unarmed', 'weapon.dagger'],
     none: ['rule.no-damage-effects']
   });
   ```

### Reference Expansion (`expandTagReferences`)

The `expandTagReferences(tags)` helper maps referencing tags to their counterparts. For instance, `favored.mage` automatically references `archetype.mage`, enabling caster archetype comparisons without string manipulation.

---

## 4. Tag Index Service (`src/apps/tag-index.mjs`)

The system initializes a global `TagIndex` singleton accessible via `game.cog.tags` and `game.sprinterRpg.tags`.

- **In-Memory Set Indexing**: Maps tag IDs to item document IDs for instantaneous lookups.
- **Filtering by Source and Type**: `game.cog.tags.find('element.fire', { type: 'spell', source: 'world' })`.
- **Live Mutation Tracking**: Reactively updates the index via Foundry lifecycle hooks (`createItem`, `updateItem`, `deleteItem`).

---

## 5. Structured Grants (`src/data/race-class-applier.mjs`)

Classes and Races define structured `system.grants` arrays:

```json
[
  { "kind": "stat", "stats": { "str": -2, "dex": -2, "int": 5, "cha": 5 } },
  { "kind": "skill", "name": "Lore", "rank": 2, "ref": "id.skill.lore" },
  { "kind": "choice", "count": 1, "query": { "all": ["kind.spell", "element.fire"] }, "rank": 3 },
  { "kind": "skillModifier", "stat": "dex", "delta": -3, "floor": 1 }
]
```

---

## 6. Favored Spell Mechanics

When an actor casts a spell (`actor.rollSpell(item)`):
1. Evaluates `favored.*` tags against the caster's archetype tags (`actor.getArchetypeTags()`).
2. If the caster has a class and does not match any of the spell's favored archetypes, a **+1 MP penalty** is applied.
3. Classless crawlers (Levels 1–2) and pets are explicitly exempted from the penalty by the rules.

---

## 7. Tag Manager UI (`COGTagManager`)

GMs and players can open the Tag Manager from the Items Directory sidebar via the **Tag Taxonomy** button or in code via `cog.openTagManager()`.

Features:
- Filter tags across the built-in namespaces (`kind`, `action`, `element`, `archetype`, etc.).
- Search tags by keyword or description.
- View live usage counts across world and compendium items.
- Register and delete custom world tags persisted in world settings (`sprinter-rpg.customTags`).

---

## 8. Item Sheet Binding & Weapon Attack Synthesis

### Item Sheet Tag Manager Binding
When opening `COGTagManager` from an item sheet (via the Tag Manager button in the Item Header or Tag Editor tab):
- The manager binds to `options.item`, displaying a Target Item banner.
- An interactive `Apply` checkbox column indicates tags currently assigned to `item.system.tags`.
- Checking or unchecking immediately updates the item document's tags via `item.update({'system.tags': [...]})`.
- The custom tag creation form includes an "Apply to item" option to immediately assign newly registered custom tags to the item.

### Weapon Attack Synthesis & Associated Skills
- All built-in weapon skills (`Bow`, `Shotgun`, `Axe`, `Rapier`, etc.) carry the `rule.requires-weapon` tag.
- `actor.getSynthesizedAttacks()` checks for `rule.requires-weapon` or `weapon.*` tags on skills: weapon skills requiring an equipped weapon are **never** synthesized as standalone attacks if no corresponding weapon is equipped. Standalone synthesized attacks are reserved strictly for unarmed/natural attacks (`weaponClass.unarmed`, `weaponClass.natural`, `Pugilism`, `Bite`, etc.).
- When attacking with a weapon with multiple associated skills (e.g. `['Aiming', 'Shotgun']`), `actor._resolveWeaponSkills()` uses tags to distinguish the primary combat weapon skill (`Shotgun`) from auxiliary passive skills (`Aiming`).
- In `actor.getAttackDamageParts()`, weapon item damage parts (e.g., 1d6 Fire) are **additive** to skill-based base damage (e.g., 3d10 Piercing), auxiliary passive bonuses (e.g., 3d4 Aiming bonus), and rank damage dice.



---

## 9. Mechanic Tags (aura, interrupt, free interrupt, trigger)

Aura, interrupt, free-interrupt and reactive-trigger behavior is decided only from an item's tag set (`item.allTags`). Item names, `notes`, `description` and the free-text `checkType` are never read for these decisions. The predicates live in `src/utils/tag-mechanics.mjs` (`isAuraItem`, `isInterruptItem`, `isFreeInterruptItem`, `getInterruptTrigger`, `getFreeInterruptRankBreak`).

| Mechanic | Tag(s) | Meaning |
|---|---|---|
| Aura | `delivery.aura` or `shape.aura` | Token-following, caster-centred, toggled on and off, cleared on expiry. `delivery: 'aura'` derives both. |
| Interrupt-capable | `action.interrupt` | Listed by `getAvailableInterrupts` (costs 1 Action). Only spell, skill, gear and attack items are listed. |
| Free interrupt | `action.free_interrupt` | Costs 0 Actions. Implies interrupt-capable. |
| Interrupt trigger | `trigger.on_attack`, `trigger.on_damage`, `trigger.on_foe_leave_reach`, `trigger.on_foe_enter_reach`, `trigger.on_ally_attack`, `trigger.on_ally_hit`, `trigger.on_ally_check`, `trigger.before_ally_action` | Picks when the interrupt is offered. An item may carry several; the first match in that order is its display trigger; no trigger tag means `any` ("Anytime"). Labels come from the tag registry. |
| Interrupt effect | `interrupt.redirect_attack`, `interrupt.intercept_hit`, `interrupt.not_vs_area` | Redirect moves the attack to the interrupter and re-checks the hit against the interrupter's Evade. Intercept makes the interrupter take the hit. `not_vs_area` hides the interrupt when the source attack is an area attack (`shape.aoe`). |
| No redirect | `rule.no-redirect` (on the attack) | No interrupt with a redirect or intercept effect is offered against this attack. |

### Interrupt offers on attack cards

Offers are chosen only by trigger tags (`INTERRUPT_TRIGGERS` in `src/utils/tag-mechanics.mjs`, `collectInterruptOffers` in `src/utils/interrupts.mjs`):

| Trigger | Offered to | Needs the attack to hit |
|---|---|---|
| `trigger.on_attack`, no trigger (`any`) | the attacked actor | no |
| `trigger.on_damage` | the attacked actor | yes |
| `trigger.on_ally_attack` | an ally of the attacked actor | no |
| `trigger.on_ally_hit` | an ally of the attacked actor | yes |
| `trigger.on_foe_leave_reach`, `trigger.on_foe_enter_reach` | offered when a foe's token moves out of or into reach, not on attack cards | n/a |
| `trigger.on_ally_check` | offered on an ally's d20 check card, not on attack cards | n/a |
| `trigger.before_ally_action` | offered on the assisting actor's own turn, not on attack cards | n/a |

Ally means a living combatant on the same side as the attacked actor, other than the attacker. Side comes from the single rule `isMobSide` in `src/utils/combat-sides.mjs` (crawlers and pets are crawler side; mounts, vehicles and mercenaries follow token disposition and default to the crawler side; npcs are mob side). Each button is shown only to the interrupter's owners and the GM.

Ally offers are range limited by `system.interrupt.range` (feet, 0 = no limit) measured from `system.interrupt.rangeFrom` (`defender` or `attacker`). Skills and spells add `rankBreaks.rankN.interrupt.rangeBonus` once the rank break is reached. If a token cannot be found the distance is unknown and the interrupt is offered.

Built-in interrupts are tag data in `src/data/core-interrupts.mjs` (currently Evade only). Taunt, Catcher and Intervene are not built-ins; they are skills that must be acquired.

### Rank-gated tags

Skills and spells (and, through their free-form `rankBreaks`, attacks and gear) accept `system.rankBreaks.rankN.tags`. When the item's rank reaches a break (`rankBreaks.rankN.rank`, or 5/10/15/20 for the fixed slots), every tag in that break joins the item's derived tags. This is how "at Rank 10 this becomes a free interrupt" is expressed. Edit them on the item sheet under "Tags Gained at This Rank". Unknown tag ids are allowed.

Because the derivation depends on rank, a compendium entry (rank 0/1) does not show rank-gated tags in the Tag Index.

### Skill and spell roles

Skills and spells have no type or category fields. `checkType` derives `action.attack` (`attack`) and `action.passive` (`passive`); `system.healing.hasHealing` derives `action.heal`; a spell's interrupt role is its stored `action.interrupt` / `action.free_interrupt` tag. `spellRole(spell)` in `src/utils/tag-mechanics.mjs` reads those tags (first match: attack, heal, free interrupt, interrupt, passive, else none).

A skill's weapon group and discipline are stored tags: `weaponGroup.*` (`edge`, `bashing`, `reach`, `ranged`, `hand_to_hand`, ...) and `skillGroup.*` (`combat`, `strike`, `defensive`, `utility`, `social`, `movement`, ...). `skillGroupLabel(skill)` picks the label to show: the first `weaponGroup.*` tag, else the first `skillGroup.*` tag other than combat and utility, else combat, else utility. A spell's descriptive school is a `school.*` tag, read only by the catalog, the cast card line and the Spell Manager search.

### Race heritage and size

A race's `system.heritage` is a `CONFIG.COG.heritages` id (`earth`, `alien`, `pet`; `ContentRegistry.registerHeritage` adds more). It derives a `heritage.<id>` tag that is never stored, so a class can `require` a heritage. Size is a lowercase `CONFIG.COG.sizes` id (`medium`) in every size field; the registry holds the order number, label, token size and Race Creator cost (`ContentRegistry.registerSize` adds more).

### Item usage

An item's `usage.*` tags (`usage.consumable`, `usage.reusable`, `usage.rechargeable`, `usage.restorable`) say how it is spent.

### Removed flags

`system.trigger`, `system.isInterrupt`, `system.isFreeInterrupt`, `system.isAura`, `system.area.isAura`, `techniqueConfig.isInterrupt` and `rankBreaks.*.isFreeInterrupt` are not schema fields and are no longer read. Use tags.
