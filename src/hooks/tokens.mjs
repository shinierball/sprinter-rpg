/**
 * Token placement hooks.
 */
/**
 * Enforce linked actor data for player characters (crawlers) and companion pets,
 * and handle unlinked independent tokens with sequential naming for mobs.
 */
export function onPreCreateToken(tokenDoc, createData, options, userId) {
  const actor = tokenDoc.actor || game.actors?.get(tokenDoc.actorId);
  if (actor && ['crawler', 'pet', 'mercenary', 'mount_vehicle'].includes(actor.type)) {
    tokenDoc.updateSource({ actorLink: true });
  } else if (actor && actor.type === 'mob') {
    const updates = { actorLink: false };

    // Sequential unique naming upon placement or pasting onto a scene:
    // "Goblin" -> "Goblin 1", "Goblin 2", etc.
    // If copying/pasting "Goblin 2", base name is extracted as "Goblin" and increments to "Goblin 3".
    const rawName = tokenDoc.name || actor.name || 'Mob';
    const baseMatch = rawName.match(/^(.*?)(?:\s+(\d+))?$/);
    const baseName = (baseMatch ? baseMatch[1] : rawName).trim();

    const scene = tokenDoc.parent || canvas?.scene;
    let nextNum = 1;
    if (scene?.tokens) {
      const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`^${escaped}(?:\\s+(\\d+))?$`, 'i');
      const numbers = [];
      for (const t of scene.tokens) {
        if (t.id && t.id === tokenDoc.id) continue;
        const match = (t.name || '').match(regex);
        if (match) {
          numbers.push(match[1] ? parseInt(match[1], 10) : 1);
        }
      }
      if (numbers.length > 0) {
        nextNum = Math.max(...numbers) + 1;
      }
    }
    updates.name = `${baseName} ${nextNum}`;
    tokenDoc.updateSource(updates);
  }
}

export function registerTokenHooks() {
  Hooks.on('preCreateToken', onPreCreateToken);
}
