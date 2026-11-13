/**
 * src/data/item-from-words-examples.mjs
 * One original example per item type for the "Item from words" prompt: the request and a reply the checker accepts. Data,
 * not engine code: a reply names real tags and row kinds, as example content does.
 */

export const PROMPT_EXAMPLES = Object.freeze({
  gear: {
    request: 'A scarf that gives +1 Charisma and resistance to Ice damage. Make up a name.',
    reply: '{"type":"gear","name":"Polite Frost Scarf","description":"Knitted by a contestant who lost the feeling in her hands. The scarf does not mind.","system":{"slot":"neck","grants":[{"kind":"stat","stat":"cha","value":1}],"defenseModifiers":[{"kind":"resistance","damageType":"Ice"}]},"unexpressed":[]}'
  },
  weapon: {
    request: 'A club that gives +1 Strength and +2 to hit against dwarves. Make up a name.',
    reply: '{"type":"weapon","name":"Courtesy Club","description":"Issued to contestants who asked for a sword. The producers apologise for nothing.","system":{"tags":["weapon.club","weaponClass.melee"],"grants":[{"kind":"stat","stat":"str","value":1}],"attackModifiers":[{"kind":"bonus","value":2,"condition":{"all":["subject.creature.dwarf"],"any":[],"none":[]}}]},"unexpressed":[]}'
  },
  loot: {
    request: 'A biscuit that restores 5 Mana. Make up a name.',
    reply: '{"type":"loot","name":"Studio Audience Biscuit","description":"Handed out between takes. It tastes of applause.","system":{"lootType":"consumable","quantity":1,"outcomes":[{"type":"restore_resource","name":"Restore Mana","targetType":"self","weight":1,"resource":"mana","amount":5}]},"unexpressed":[]}'
  },
  buff: {
    request: 'A buff that gives +1 Dexterity and +1 DR for 10 minutes. Make up a name.',
    reply: '{"type":"buff","name":"Warm-Up Montage","description":"Somewhere, an upbeat song is playing. Only you can hear it.","system":{"durationConfig":{"type":"minutes","value":10},"grants":[{"kind":"stat","stat":"dex","value":1}],"defenseModifiers":[{"kind":"dr","value":1}]},"unexpressed":[]}'
  },
  debuff: {
    request: 'A Minor debuff: -1 Charisma and 1d4 Acid damage each round for 2 rounds. Make up a name.',
    reply: '{"type":"debuff","name":"Bad Review","description":"The critics were not kind. Neither is the acid.","system":{"severity":"Minor","damagePerRound":"1d4","damageType":"Acid","durationConfig":{"type":"rounds","value":2},"grants":[{"kind":"stat","stat":"cha","value":-1}]},"unexpressed":[]}'
  }
});
