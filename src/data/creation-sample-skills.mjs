/**
 * Sprinter RPG - Sample Skills
 * The 44 skills the sample backgrounds (`creation-samples.mjs`) offer, for a world on the default `shiny` theme. Each
 * is a plain skill spec: an identifier, a name, the stat it rolls with and a short description. They add no mechanics
 * beyond rank + stat. Written for this system; nothing here comes from a rulebook. The samples provider compiles them
 * through `buildPayload` and registers them as the `shiny` skill catalog (`shiny-content-provider.mjs`).
 */

const def = (identifier, name, stat, text) => ({ identifier, name, stat, text });

const DEFS = [
  def('haggling', 'Haggling', 'cha', 'You can make any price tag feel like an opening offer. The vendor will still win, but they will remember it.'),
  def('perception', 'Perception', 'int', 'You notice the exit sign, the loose tile and the camera that is following you. Usually in that order.'),
  def('sprinting', 'Sprinting', 'dex', 'Running away, but with form. Judges score the arms.'),
  def('small-talk', 'Small Talk', 'cha', 'You can discuss the weather with anything that has ears, and several things that do not.'),
  def('eavesdropping', 'Eavesdropping', 'int', 'You hear conversations that were not meant for you, and you keep the good ones.'),
  def('endurance', 'Endurance', 'con', 'You keep going well past the point where a reasonable person would sit down and file a complaint.'),
  def('repair', 'Repair', 'int', 'Given tape, a screwdriver and a little contempt, a broken thing becomes a slightly different thing.'),
  def('electronics', 'Electronics', 'int', 'You know which wire does what, and you have a theory about the wire that does not.'),
  def('scavenging', 'Scavenging', 'int', 'One crawler\'s rubble is your shopping list. You always check the second drawer.'),
  def('intimidate', 'Intimidate', 'cha', 'You can look at someone until they remember an appointment elsewhere.'),
  def('bookkeeping', 'Bookkeeping', 'int', 'The numbers always add up eventually. You are the reason they do it quietly.'),
  def('climbing', 'Climbing', 'str', 'Walls are only floors that have gotten ideas. You use the ideas.'),
  def('jumping', 'Jumping', 'dex', 'You cover gaps by declining to acknowledge them.'),
  def('crowd-work', 'Crowd Work', 'cha', 'You read a room of strangers and give it what it did not know it wanted. Applause is optional, but noted.'),
  def('stage-presence', 'Stage Presence', 'cha', 'People look where you are standing, and you have made peace with that.'),
  def('investigation', 'Investigation', 'int', 'You assemble small, dull facts into one uncomfortable conclusion.'),
  def('persuasion', 'Persuasion', 'cha', 'You are at your best when the other party believes the idea was theirs.'),
  def('swimming', 'Swimming', 'str', 'You stay on the surface of things that are trying to be the bottom.'),
  def('first-aid', 'First Aid', 'int', 'You know which bleeding is the urgent kind, and you stay calm about the other kind.'),
  def('deception', 'Deception', 'cha', 'You lie with such commitment that it becomes a performance, and performances are protected.'),
  def('juggling', 'Juggling', 'dex', 'Several objects stay in the air because you refuse to let any of them land first.'),
  def('throwing', 'Throwing', 'dex', 'You release things in the right direction at the right moment, and both are harder than they sound.'),
  def('wrestling', 'Wrestling', 'str', 'A close-quarters discipline of leverage, patience and apologizing afterwards.'),
  def('knot-tying', 'Knot Tying', 'dex', 'Your knots hold when you need them to and let go when you ask nicely.'),
  def('map-reading', 'Map Reading', 'int', 'You can tell which way is up on a diagram that has no up.'),
  def('survival', 'Survival', 'con', 'Food, water, shelter and spite: you can find three of the four anywhere.'),
  def('lockpicking', 'Lockpicking', 'dex', 'A lock is a polite request. You are very good at asking twice.'),
  def('research', 'Research', 'int', 'You know where the answer is written down, and how many people ahead of you in line have not read it.'),
  def('negotiation', 'Negotiation', 'cha', 'You leave a table with a deal both sides call fair and neither side enjoys.'),
  def('camera-awareness', 'Camera Awareness', 'int', 'You always know where the lens is. This changes how you stand, which changes everything.'),
  def('baton', 'Baton', 'str', 'You are trained to use a short stick with confidence and paperwork.'),
  def('cooking', 'Cooking', 'int', 'You turn ingredients into dinner under time pressure and an audience of one.'),
  def('knife-work', 'Knife Work', 'dex', 'You handle a blade with the speed of someone who has been shouted at in a kitchen.'),
  def('driving', 'Driving', 'dex', 'You operate things with wheels, and you have a strong opinion about the person in front of you.'),
  def('read-people', 'Read People', 'int', 'Everyone has a tell. Yours is that you are always looking for theirs.'),
  def('lifting', 'Lifting', 'str', 'You know to bend the knees and to ask what is in the box after you have already picked it up.'),
  def('rope-work', 'Rope Work', 'dex', 'You secure, haul, lower and swing with a length of cord, and you coil it afterwards.'),
  def('puzzle-solving', 'Puzzle Solving', 'int', 'Locked doors and cryptic notes are a conversation, and you enjoy being the one who finishes it.'),
  def('heckler-management', 'Heckler Management', 'cha', 'Someone shouts from the back. You have a line ready, and a second one for after the laugh.'),
  def('stealth', 'Stealth', 'dex', 'You move through a space the way a rumor does: everywhere, and with no one able to say when.'),
  def('tracking', 'Tracking', 'int', 'You follow what something left behind: a footprint, a smell or a very specific mess.'),
  def('parkour', 'Parkour', 'dex', 'The route is whatever is between you and where you are going, including the parts not meant for feet.'),
  def('chemistry', 'Chemistry', 'int', 'You mix things on purpose. Sometimes the purpose is the one you intended.'),
  def('hold-your-liquor', 'Hold Your Liquor', 'con', 'You can take a drink, take another and still be the one who remembers the evening accurately.')
];

/** @type {Readonly<Record<string, { name: string, identifier: string, stat: string, text: string }>>} by identifier */
export const SAMPLE_SKILLS = Object.freeze(Object.fromEntries(DEFS.map(d => [d.identifier, { name: d.name, identifier: d.identifier, stat: d.stat, text: d.text }])));

/** The skill specs `buildPayload` compiles into the `shiny` skill catalog. */
export const SAMPLE_SKILL_SPECS = Object.freeze(Object.values(SAMPLE_SKILLS).map(sk => Object.freeze({
  type: 'skill',
  name: sk.name,
  system: { identifier: sk.identifier, stat: sk.stat, description: `<p>${sk.text}</p>` }
})));
