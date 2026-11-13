/**
 * src/utils/item-from-words/prompt-text.mjs
 * The fixed wording of the item prompt (step doc 7.43 section 2.8). English on purpose: the prompt is written for the
 * user's own chatbot, not for the Foundry UI, so none of it is a lang key. The per-type examples are in src/data/item-from-words-examples.mjs.
 */

export const PROMPT_INTRO = 'You are filling in a form for a tabletop RPG item. Reply with one JSON object and nothing else.';

/** The intro of a prompt written for one item type; `{type}` and `{label}` are filled from the vocabulary's one type. */
export const PROMPT_INTRO_TYPED = 'You are filling in a form for a tabletop RPG item of type "{type}" ({label}). Reply with one JSON object and nothing else.';

/**
 * The rules, each with what the vocabulary must hold for it to print (all of them): `rows` (a condition-bearing row array),
 * `weaponTags`, `outcomes`, `drBonus` (a type field at that path). A prompt for the whole vocabulary meets every need.
 */
export const PROMPT_RULES = Object.freeze([
  { needs: [], text: 'Use only the fields, kinds and ids listed under VOCABULARY. Do not invent a field, a kind, an id or a tag.' },
  { needs: [], text: 'Numbers are the ones in the request. Do not add bonuses the request does not ask for.' },
  { needs: [], text: '"name": use the name given. If the request asks you to make one up, or gives none, invent a short original one.' },
  { needs: [], text: '"description": one to three plain sentences, no HTML, no markdown.' },
  { needs: [], text: 'A skill, spell, buff or debuff is named by its id from the lists. If it is not listed, write its plain name.' },
  { needs: [], text: 'Anything asked for that the vocabulary cannot express goes in "unexpressed" as short text. Never drop it silently and never approximate it with a different mechanic.' },
  { needs: ['drBonus'], text: 'Plain damage reduction ("3 DR") on gear or a weapon is system.drBonus.' },
  { needs: ['rows'], text: 'A "dr" row gives damage reduction as a row (a buff or debuff uses one). DR that applies only sometimes ("+2 DR against bosses") is a "dr" row with a condition.' },
  { needs: ['rows'], text: 'A bonus that applies only sometimes gets "condition": {"all": [...], "any": [...], "none": [...]} built from the TAGS list. "all" = every tag must hold, "any" = at least one, "none" = must not hold.' },
  { needs: ['rows'], text: 'A tag about the creature being attacked is written "subject.<tag>" (damage, attack and check rows). A tag about the creature attacking the wearer is written "attacker.<tag>" (defense and check rows). A situation.* or check.* tag has no prefix. Use only the prefixes listed for that row array.' },
  { needs: ['rows'], text: '"+N to a skill" or "+N Ranks" is a "skill" grant; "+N to hit" is an attackModifiers bonus row; "+N to <skill> checks" is a checkModifiers bonus row.' },
  { needs: ['rows'], text: 'Damage rows (damageModifiers) name their kind in "mode"; every other row array names it in "kind".' },
  { needs: ['rows'], text: 'A tag "self.<tag>" is about the wearer or owner ("while fatigued" is self.condition.fatigued). A bare condition.* tag on an attack, damage or check row never matches.' },
  { needs: ['weaponTags'], text: 'A weapon always gets one weaponClass.* tag (melee or ranged) besides its weapon.* tag; the system does not derive it.' },
  { needs: ['outcomes'], text: 'Every outcome sets "targetType"; a potion, or anything the user takes themselves, is "self".' },
  { needs: ['rows'], text: 'If no listed tag means what the request says, do not pick a near miss: leave the row out and put the request\'s words in "unexpressed".' }
]);

export const PROMPT_SHAPE = '{ "type": ..., "name": ..., "description": ..., "system": { ... }, "unexpressed": [ ... ] }';

/** What a draft field means in words, by its path (the type-level fields; a row field has no entry). Appended to the field's notes. */
export const PROMPT_FIELD_NOTES = Object.freeze({
  quantity: 'how many',
  value: 'the price',
  drBonus: 'flat damage reduction, the "3 DR" of the rules',
  critMultiplier: 'damage multiplier on a Critical Hit',
  executionMode: '"all" runs every effect; "random" picks one effect by weight'
});

/** Words that replace the bare type of a text field that holds a formula. */
export const PROMPT_FIELD_TYPE_WORDS = Object.freeze({
  healingPerRound: 'a dice formula or number, Health per round',
  damagePerRound: 'a dice formula or number, Health per round'
});

/** Section headings, in order. */
export const PROMPT_HEADINGS = Object.freeze({
  rules: 'RULES',
  shape: 'SHAPE',
  vocabulary: 'VOCABULARY',
  tags: 'TAGS (for conditions only)',
  example: 'EXAMPLE',
  request: 'REQUEST'
});
