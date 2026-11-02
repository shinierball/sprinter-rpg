/**
 * src/content/specs/examples/creation-loadouts.mjs
 * The original example starter loadouts: one spell, one unarmed
 * package and one potion, each embedding its own payload spec as `fallback`. The reader (src/content/creation-loadouts.mjs)
 * offers them for a slot only when no provider registered an entry for that slot (answer 120 (a)). They are not catalog
 * documents, are not in `EXAMPLE_ITEM_SPECS`, and are never registered.
 */

export const EXAMPLE_CREATION_LOADOUTS = Object.freeze([
  {
    id: 'example.pyrotechnic-cue',
    slot: 'spell',
    name: 'Pyrotechnic Cue',
    spellIdentifier: 'pyrotechnic-cue',
    fallback: {
      name: 'Pyrotechnic Cue',
      img: 'icons/svg/fire.svg',
      system: {
        identifier: 'pyrotechnic-cue', rank: 1, stat: 'int', manaCost: 3, range: '30 feet', duration: 'Instantaneous',
        cooldown: { value: 0, unit: '' }, checkType: 'attack', baseDamage: { dice: '1d6', stat: 'int', damageType: 'Fire' }, delivery: 'target',
        tags: ['kind.spell', 'action.attack', 'element.fire', 'stat.int', 'delivery.target'],
        description: '<p>The stage manager says "go", and a jet of stage fire answers. Single target, no refunds.</p>'
      }
    }
  },
  {
    id: 'example.backstage-brawling',
    slot: 'unarmed',
    name: 'Backstage Brawling',
    label: 'Backstage Brawling with Mic Drop (+1d4 base damage)',
    skillIdentifier: 'backstage-brawling',
    effectIdentifier: 'mic-drop',
    fallback: {
      skill: {
        name: 'Backstage Brawling',
        img: 'icons/svg/combat.svg',
        system: {
          identifier: 'backstage-brawling', rank: 0, stat: 'dex', isAttack: true, hasDamage: true,
          baseDamage: { dice: '1d2', stat: 'str', damageType: 'Bludgeoning' },
          tags: ['kind.skill', 'action.attack', 'element.bludgeoning', 'stat.dex', 'skillGroup.combat', 'weaponClass.unarmed', 'weaponGroup.hand_to_hand'],
          notes: 'Unarmed fighting learned between takes, where nobody was filming.'
        }
      },
      effect: {
        name: 'Mic Drop',
        img: 'icons/svg/sound.svg',
        system: {
          identifier: 'mic-drop', rank: 0, stat: 'str', checkType: 'passive', isTechnique: true, isAttack: false, hasDamage: false,
          appliesToQuery: { all: [], any: ['id.skill.backstage-brawling'], none: [] },
          techniqueConfig: { isDamageEffect: true, damageBonus: '1d4', description: 'Deal +1d4 base damage.' },
          tags: ['kind.skill', 'kind.technique', 'action.passive', 'stat.str', 'weaponGroup.hand_to_hand'],
          notes: 'A Damage Effect for Backstage Brawling: the punch lands, the room goes quiet.'
        }
      }
    }
  },
  {
    id: 'example.mana-spritzer',
    slot: 'potion',
    name: 'Green Room Mana Spritzer',
    itemRef: 'green-room-mana-spritzer',
    fallback: {
      name: 'Green Room Mana Spritzer',
      img: 'icons/svg/pill.svg',
      system: {
        identifier: 'green-room-mana-spritzer', quantity: 1, lootType: 'consumable', executionMode: 'all',
        outcomes: [{ name: 'Refill Mana', type: 'restore_resource', resource: 'mana', mode: 'full', targetType: 'self' }],
        tags: ['kind.loot', 'action.restore', 'resource.mana'],
        description: '<p>Complimentary, lukewarm, and somehow it refills your mana completely.</p>'
      }
    }
  }
]);
