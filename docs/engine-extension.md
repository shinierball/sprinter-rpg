# Extending the modifier engine from a module

A module adds mechanics without touching the system: a **scalar** (a number a row scales by), a **row kind** (what a row does), a **rule tag** (a tag that carries rows and flags) and a **rule flag** (a yes/no gate a tag can carry). All four register from the `sprinter-rpg.registerContent` hook, which the system fires during `init` with the content registry. Everything registered shows up in the item sheet's row editor and the Tag Manager with no further wiring.

The calls below are the ones a module makes to register a scalar, a row kind, a rule flag and a rule tag. Module ids are prefixed (`studio-props.`) so they never collide with core ones.

```js
import { damagePartOf } from '/systems/sprinter-rpg/src/utils/row-kinds.mjs';

Hooks.on('sprinter-rpg.registerContent', (registry) => {
  // 1. Scalar: a number a row's `scaleBy: { source: 'studio-props.applause' }` multiplies by.
  //    `needs` says what resolve() reads ('actor' = the row owner); resolve is synchronous and never writes.
  registry.registerScalar({
    id: 'studio-props.applause',
    label: 'Applause meter',
    needs: ['actor'],
    resolve: ({ actor }) => Number(actor?.flags?.['studio-props']?.applause) || 0,
    describe: () => 'per point of applause'
  });

  // 2. Row kind: what a `damageModifiers` row with `mode: 'studio-props.encore'` does.
  //    `fields` are the row fields the editor shows; `scaled` says which numbers a scaleBy may multiply.
  registry.registerRowKind('damageModifiers', {
    id: 'studio-props.encore',
    label: 'Encore (flat damage, doubled)',
    fields: ['value', 'damageType'],
    scaled: { value: 'whole' },
    apply: {
      damage(acc, row, ctx) {
        const part = damagePartOf({ ...row, value: (Number(row.value) || 0) * 2 }, { ...ctx, serial: ctx.serial ?? acc.addParts.length });
        if (part) acc.addParts.push(part);
      },
      target() {} // a roll-time kind: nothing is left to do per target
    }
  });

  // 3. Rule flag: a bare id a tag may list in `flags`; code reads it with hasRuleFlag(actorOrItemOrTags, id).
  registry.registerRuleFlag({ id: 'studio-props.hush', label: 'Hushed', hint: 'The carrier cannot be heckled.' });

  // 4. Rule tag: rows behave as rows on whatever carries the tag (equipped gear, an active buff, a skill, the actor);
  //    flags are the gates above. The 14 core flags (`no-damage-effects`, `requires-weapon`, `no-standalone-attack`, `no-redirect`, `area`, `ignores-dr`, `anti-piercing`, `no-hands`, `uncounted-ally`, `no-ranks`, `emits-light`, `zone`, `maneuver`, `mount`; see `RULE_FLAGS` in `src/utils/tag-behaviour.mjs`) work the same way.
  registry.registerTag({
    id: 'studio-props.spotlit',
    label: 'Spotlit',
    namespace: 'rule',
    description: 'Hits a little harder, and nobody heckles you.',
    rows: { damageModifiers: [{ label: 'Spotlit', mode: 'studio-props.encore', value: 1, scaleBy: { source: 'studio-props.applause' } }] },
    flags: ['studio-props.hush']
  });
});
```

Notes:

- **Refusals are visible, never fatal.** A bad definition, or one that loses on priority, returns `false` and logs a `Sprinter RPG | register... refused` warning (`registerScalar`, `registerRowKind`, `registerRuleFlag`, `registerBossTier`; `registerTag` warns on priority); rows that name an unregistered scalar or kind do nothing and show a badge in the editor.
- **Priority.** Every call takes `{ priority }` (default 10; core is 0). One rule for `registerScalar`, `registerRowKind`, `registerTag`, `registerRuleFlag` and `registerBossTier`: a higher priority replaces an existing id; an **equal or lower one is refused** (with a warning). The registry stamps `provider: 'module'` on scalars and row kinds.
- **Row-kind arrays share a table.** `attackModifiers` and `checkModifiers` are one table: a kind registered on either is available on both. Only `damageModifiers`, `defenseModifiers`, `attackModifiers` and `checkModifiers` accept module kinds.
- **Boss tiers.** `registry.registerBossTier({ id, label, statsPerLevel, hbBase, star?, default? }, { priority })` writes `CONFIG.COG.bossTiers[id]` and registers the `mob.tier.<id>` tag under the same priority rule. `getBossTierInfo` returns null for an unregistered id; the Mob Creator and the budget maths then use the registry's default tier (the one declaring `default: true`, else `floor`, else the first boss tier).
- **A GM can override a tag's behaviour** in the Tag Manager (stored in the `tagOverrides` world setting) without editing the module; "Reset to default" returns to what the module registered.
- **Rule tags on skills.** A skill that carries a rule tag (Aiming carries `rule.aiming-offset`) gets the tag's rows, and they are owner-wide: `scope` applies only to the skill's own rows. Limit a tag's rows with their conditions (`rule.aiming-offset` needs `situation.aiming` and a ranged attack).
- **Gates read flags, not tags.** Engine code asks `hasRuleFlag(subject, flag)`; it never matches a `rule.*` id, so renaming or replacing the tag keeps the rule.
- **Custom situations** need no module: a GM clicks "New situation" in any condition editor (or a module calls `registerCustomTag({ id: 'situation.live_audience', label: 'Live Audience', namespace: 'situation' })`) and uses the tag in a row condition; the roll dialog then offers it as a toggle.
- Authoring rows, roles, scalars and the built-in kinds: [conditional-modifiers.md](conditional-modifiers.md).
