/**
 * src/data/item-setup/kinds/studios.mjs
 * Kinds that have a studio of their own: the modal hands over to it instead of asking anything.
 */
import { registerSetupKind } from '../registry.mjs';

registerSetupKind({ id: 'class', icon: 'fa-graduation-cap', order: 50, studio: 'class' });
registerSetupKind({ id: 'race', icon: 'fa-dna', order: 60, studio: 'race' });
