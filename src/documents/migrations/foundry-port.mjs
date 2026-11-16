/**
 * The real world port of the migration runner (`world-migration.mjs` lists the methods): the stored sources from the `init`
 * capture, world packs read raw over the socket, writes through Foundry's document API, pack locks and world settings.
 *
 * What Foundry does that this port works around (the migration design, D4a and D5, and its recorded spike):
 * - Every write carries `diff: false`: the client would otherwise diff the update against its cleaned copy and drop a
 *   kind change load-time cleaning already coerced. `nodeToUpdate` makes the update minimal instead.
 * - A refused update (it fails validation, or a pre-update hook returns false) is left out without a throw, so the ids
 *   each call returns are compared with the ids it was sent.
 * - An update of an invalid document is stored, then Foundry's response handler throws on every client; so an invalid
 *   document is written alone and counted written when its stored source, read back, holds the migrated values.
 * - The children of an invalid document (a world or world-pack document, or an embedded one) cannot be written through
 *   the throwaway instance Foundry holds for it: they are deferred to the next load. A world pack's raw read does not say
 *   which documents load invalid, so the port finds out when it resolves the live document.
 * - A node is written only where its live value still equals the baseline (Foundry's own cleaning of the capture): a key
 *   another client wrote since `init` keeps their value.
 * - A node whose live document cannot be found is counted unchanged only when it is gone: deleted since the capture
 *   (missing from its live collection), or a token delta Foundry no longer keeps. The items of a token whose base actor
 *   is gone have no synthetic actor to be written through: they are deferred, naming the scene and token, so the
 *   watermark waits until the GM deletes or relinks the token. Any other miss is a failure with its reason.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { nodeToUpdate, storedHoldsNode, FIELD_KIND } from '../../utils/migrations/node-to-update.mjs';
import { capturedSources, releaseCapturedSources, embeddedTable } from './stored-sources.mjs';

const ACTOR_DELTA = 'ActorDelta';
const TOKEN = 'Token';
const ADVENTURE = 'Adventure';
const WORLD_PACKAGE = 'world';
const MODULE_PACKAGE = 'module';

const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The node's own source inside a top-level source, found by its path through the embedded table. */
function locate(top, path, embedded) {
  let current = top;
  for (let i = 1; i < path.length && current; i += 1) {
    const key = embedded[path[i - 1].documentName]?.[path[i].documentName];
    const value = key ? current[key] : undefined;
    current = Array.isArray(value) ? value.find((entry) => entry?._id === path[i].id) : value;
  }
  return isPlain(current) ? current : null;
}

/** What a schema field is, for `nodeToUpdate` (TypeDataField is an ObjectField in Foundry, so it is tested first). */
function kindOf(field, fields) {
  if (!field) return null;
  if ((fields?.TypeDataField && field instanceof fields.TypeDataField) || (fields?.SchemaField && field instanceof fields.SchemaField)) {
    return FIELD_KIND.SCHEMA;
  }
  if (fields?.ObjectField && field instanceof fields.ObjectField) return FIELD_KIND.OBJECT;
  return FIELD_KIND.VALUE;
}

const idsOf = (documents) => new Set((documents ?? []).map((doc) => doc?.id ?? doc?._id).filter(Boolean));

/** Why `resolve` found no live document to write: gone (nothing to do), deferred to a later load, or a failure. */
const MISS = Object.freeze({ GONE: 'gone', DEFERRED: 'deferred', FAILED: 'failed' });

const miss = (kind, reason = '') => ({ miss: kind, reason });

/** Why the children of an invalid document wait. */
const invalidParentReason = (label) => `${label} does not load; this document is updated on a later load, once it does`;

/**
 * Build the port over a running Foundry world.
 * @param {object} [game]
 * @param {object} [deps] seams, each defaulting to Foundry's own
 * @param {object} [deps.config] `CONFIG`
 * @param {(request: object) => Promise<object>} [deps.dispatch] sends a `modifyDocument` request (`SocketInterface.dispatch`)
 * @param {object|null} [deps.capture] the `init` capture (`capturedSources()`)
 * @param {boolean} [deps.readStored] for a collection the capture does not hold, read its stored sources from the database
 *   (the raw `get` the pack read uses) instead of answering the client's cleaned copies: a console run, long after `init`
 * @param {() => void} [deps.release] drops the capture
 * @param {object} [deps.fields] `foundry.data.fields`
 */
export function foundryPort(game = globalThis.game, {
  config = globalThis.CONFIG,
  dispatch = (request) => globalThis.foundry.helpers.SocketInterface.dispatch('modifyDocument', request),
  capture = capturedSources(),
  readStored = false,
  release = releaseCapturedSources,
  fields = globalThis.foundry?.data?.fields
} = {}) {
  const embedded = embeddedTable(config);
  /** The top-level source each node was planned from, by `pack|documentName|id`. */
  const tops = new Map();
  /** Built baselines, by the same key (null when the source could not be built). */
  const baselines = new Map();
  /** Nodes already written, so a retry after a batch threw does not send them again. */
  const writtenNodes = new WeakSet();

  const topKey = (pack, documentName, id) => `${pack ?? ''}|${documentName}|${id}`;
  const remember = (pack, documentName, sources) => {
    for (const source of sources) tops.set(topKey(pack, documentName, source._id), source);
  };
  const classOf = (documentName) => config?.[documentName]?.documentClass;

  /** What this client would hold for the node had nobody written since the capture: Foundry's cleaning of the capture. */
  function baselineOf(node, pack) {
    const top = node.path[0];
    const key = topKey(pack, top.documentName, top.id);
    if (!baselines.has(key)) {
      let built = null;
      try {
        const source = tops.get(key);
        const cls = classOf(top.documentName);
        if (source && cls?.fromSource) {
          built = cls.fromSource(structuredClone(source), { pack: pack ?? null, strict: false, dropInvalidEmbedded: true }).toObject();
        }
      } catch (error) {
        console.warn(`Sprinter RPG | migration: could not rebuild the loaded copy of ${top.documentName}.${top.id}; its newer edits are not checked:`, error);
      }
      baselines.set(key, built);
    }
    const built = baselines.get(key);
    return built ? locate(built, node.path, embedded) : null;
  }

  /**
   * The live document of a top-level step: an invalid world document through `getInvalid`; a pack document through
   * `getDocument`, which returns an invalid one too and records it in `invalidDocumentIds`
   * (client/documents/collections/compendium-collection.mjs `getDocuments`).
   */
  async function topDocument(step, pack) {
    if (pack) {
      const collection = game.packs?.get(pack);
      const doc = (await collection?.getDocument?.(step.id)) ?? null;
      return { doc, invalid: Boolean(doc?.invalid || collection?.invalidDocumentIds?.has(step.id)) };
    }
    const collection = game.collections?.get(step.documentName);
    if (collection?.invalidDocumentIds?.has(step.id)) return { doc: collection.getInvalid(step.id), invalid: true };
    return { doc: collection?.get(step.id) ?? null, invalid: false };
  }

  /** A token and its scene, for a GM reading the console. */
  const describeToken = (token) => `token "${token?.name ?? token?.id}" (${token?.uuid}) in scene "${token?.parent?.name ?? token?.parent?.id}"`;

  /**
   * Find a node's live document and how to write it, or why there is none (`{ miss, reason }`, `miss` one of `MISS`).
   * @returns {Promise<{ target: object, invalid: boolean, group: string, send: Function, sentId: string, wrap?: Function }|{ miss: string, reason: string }>}
   */
  async function resolve(node, pack, options) {
    const { doc: top, invalid: topInvalid } = await topDocument(node.path[0], pack);
    if (!top) return miss(MISS.GONE);
    let current = top;
    let parent = null;
    let invalid = topInvalid;
    for (const step of node.path.slice(1)) {
      // A child of an invalid document would be written through the throwaway instance Foundry holds for its parent.
      if (invalid) return miss(MISS.DEFERRED, invalidParentReason(current.uuid ?? `${node.path[0].documentName}.${node.path[0].id}`));
      parent = current;
      if (step.documentName === ACTOR_DELTA) {
        // Reading `delta` materialises a lazy delta. It is null only when Foundry keeps none (`ActorDeltaField.initialize`):
        // the token was linked, or lost its actor id, since the capture, and Foundry would discard the write. Gone.
        current = current.delta ?? null;
        if (!current) return miss(MISS.GONE);
        continue;
      }
      const collection = current.getEmbeddedCollection?.(step.documentName);
      if (!collection) return miss(MISS.FAILED, `${current.uuid} has no ${step.documentName} collection`);
      if (collection.invalidDocumentIds?.has(step.id)) {
        current = collection.getInvalid(step.id);
        invalid = true;
      } else {
        current = collection.get(step.id) ?? null;
      }
      if (!current) return miss(MISS.GONE);
    }
    const name = node.documentName;
    const embeddedOptions = { ...options };
    delete embeddedOptions.pack;

    if (node.path.length === 1) {
      if (invalid) return { target: current, invalid, group: `invalid|${node.path[0].id}`, send: ([update]) => current.update(update, options), sentId: current.id };
      const cls = classOf(name);
      return { target: current, invalid, group: `top|${name}`, send: (updates) => cls.updateDocuments(updates, options), sentId: current.id };
    }
    if (name === ACTOR_DELTA) {
      // Through the scene: an update through the token's actor would be pruned by the Actor schema.
      const token = parent;
      const scene = token.parent;
      return {
        target: current,
        invalid,
        group: `delta|${scene.uuid}`,
        wrap: (update) => ({ _id: token.id, delta: update }),
        send: (updates) => scene.updateEmbeddedDocuments(TOKEN, updates, embeddedOptions),
        sentId: token.id
      };
    }
    if (parent.documentName === ACTOR_DELTA) {
      // A delta's own item or effect: through the token's synthetic actor, which Foundry stores in the delta. The loop
      // above read `token.delta`, which materialised a lazy delta; and at `ready` Foundry has released the lazy guard
      // (`TokenDocument._preventActorDeltaAccess`, client/game.mjs:928), so `token.actor` is the synthetic actor. It is
      // null when the base actor is gone or does not load (`ActorDelta.applyDelta` needs one): nothing to write through.
      const token = parent.parent;
      const actor = token?.actor;
      if (!actor) {
        if (token?.baseActor) return miss(MISS.FAILED, `${describeToken(token)} has no synthetic actor`);
        return miss(MISS.DEFERRED, `the actor of ${describeToken(token)} is gone or does not load; delete the token or link it to an actor, and a later load updates this document`);
      }
      return {
        target: current,
        invalid,
        group: `${invalid ? `invalid|${current.id}` : 'synthetic'}|${token.uuid}|${name}`,
        send: (updates) => actor.updateEmbeddedDocuments(name, updates, embeddedOptions),
        sentId: current.id
      };
    }
    return {
      target: current,
      invalid,
      group: `${invalid ? `invalid|${current.id}` : 'embedded'}|${parent.uuid}|${name}`,
      send: (updates) => parent.updateEmbeddedDocuments(name, updates, embeddedOptions),
      sentId: current.id
    };
  }

  function buildUpdate(node, resolved, pack) {
    const live = resolved.target._source ?? {};
    const schema = resolved.target.constructor?.schema ?? classOf(node.documentName)?.schema;
    const fieldKind = (path) => kindOf(schema?.getField?.(path, { source: live }), fields);
    const baseline = resolved.invalid ? null : baselineOf(node, pack);
    return nodeToUpdate(node, { live, baseline, fieldKind });
  }

  /** Read the stored source of a node back from the database (the raw `get` the pack read uses). */
  async function readBack(node, pack) {
    const top = node.path[0];
    const operation = { query: { _id: top.id } };
    if (pack) operation.pack = pack;
    const response = await dispatch({ type: top.documentName, action: 'get', operation });
    const stored = response?.result?.[0];
    return stored ? locate(stored, node.path, embedded) : null;
  }

  return {
    embedded,

    async sources(documentName) {
      const collection = game.collections?.get(documentName);
      const invalidIds = [...(collection?.invalidDocumentIds ?? [])];
      const present = (id) => Boolean(collection?.has?.(id) || collection?.invalidDocumentIds?.has(id));
      if (capture && Object.prototype.hasOwnProperty.call(capture, documentName)) {
        const sources = capture[documentName].filter((source) => present(source._id));
        remember(null, documentName, sources);
        return { sources, invalidIds, cleaned: false };
      }
      if (readStored) {
        // The database's own copy: the raw `get` answers a world collection too, uncleaned (the recorded spike, item 2).
        const response = await dispatch({ type: documentName, action: 'get', operation: { query: {} } });
        const sources = (response?.result ?? []).filter((source) => present(source?._id));
        remember(null, documentName, sources);
        return { sources, invalidIds, cleaned: false };
      }
      const sources = structuredClone(collection?._source ?? []);
      remember(null, documentName, sources);
      return { sources, invalidIds, cleaned: true };
    },

    async packs(documentNames) {
      const all = [...(game.packs ?? [])];
      const walked = all.filter((pack) => documentNames.includes(pack.documentName));
      const notWalked = all.filter((pack) => (pack.documentName === ADVENTURE && pack.metadata?.packageType !== 'system')
        || (walked.includes(pack) && pack.metadata?.packageType === MODULE_PACKAGE));
      if (notWalked.length) {
        console.info(`Sprinter RPG | migration: module and adventure compendiums are not updated: ${notWalked.map((pack) => pack.collection).join(', ')}`);
      }
      const out = [];
      for (const pack of walked.filter((entry) => entry.metadata?.packageType === WORLD_PACKAGE)) {
        const response = await dispatch({ type: pack.documentName, action: 'get', operation: { pack: pack.collection, query: {} } });
        const sources = response?.result ?? [];
        remember(pack.collection, pack.documentName, sources);
        out.push({ id: pack.collection, documentName: pack.documentName, locked: Boolean(pack.locked), sources });
      }
      return out;
    },

    async setLocked(packId, locked) {
      const pack = game.packs?.get(packId);
      if (!pack) throw new Error(`the compendium ${packId} is gone`);
      // configure() throws for a user who does not own the pack (an Assistant GM, or lowered pack ownership).
      await pack.configure({ locked });
    },

    async write(nodes, options = {}) {
      const pack = options.pack ?? null;
      const sendOptions = { ...options, diff: false, render: false };
      if (!pack) delete sendOptions.pack;
      const result = { written: [], refused: [], deferred: [], failed: [], unchanged: [] };

      const groups = new Map();
      for (const node of nodes) {
        if (writtenNodes.has(node)) { result.written.push(node); continue; }
        if (node.invalid && node.path.length > 1) {
          result.deferred.push({ node, reason: invalidParentReason(`${node.path[0].documentName}.${node.path[0].id}`) });
          continue;
        }
        const resolved = await resolve(node, pack, sendOptions);
        if (resolved.miss === MISS.GONE) { result.unchanged.push(node); continue; }
        if (resolved.miss === MISS.DEFERRED) { result.deferred.push({ node, reason: resolved.reason }); continue; }
        if (resolved.miss) { result.failed.push({ node, error: new Error(resolved.reason) }); continue; }
        const update = buildUpdate(node, resolved, pack);
        if (!update) { result.unchanged.push(node); continue; }
        const group = resolved.invalid ? `${resolved.group}|${groups.size}` : resolved.group;
        if (!groups.has(group)) groups.set(group, { invalid: resolved.invalid, send: resolved.send, items: [] });
        groups.get(group).items.push({ node, resolved, update });
      }

      // Valid documents first, then each invalid one alone (Foundry stores its write, then its response handler throws).
      const ordered = [...groups.values()].sort((a, b) => Number(a.invalid) - Number(b.invalid));
      for (const group of ordered) {
        if (group.invalid) {
          // Stored, then Foundry's response handler throws: the read-back decides.
          const [{ node, resolved, update }] = group.items;
          let error = null;
          try {
            await group.send([resolved.wrap ? resolved.wrap(update) : { ...update, _id: resolved.sentId }]);
          } catch (rejection) {
            error = rejection;
          }
          let stored = null;
          try { stored = await readBack(node, pack); } catch (readError) { error ??= readError; }
          if (stored && storedHoldsNode(stored, node)) {
            writtenNodes.add(node);
            result.written.push(node);
          } else {
            result.failed.push({ node, error: error ?? new Error('the stored document does not hold the migrated values') });
          }
          continue;
        }
        const updates = group.items.map(({ resolved, update }) => (resolved.wrap ? resolved.wrap(update) : { ...update, _id: resolved.sentId }));
        const returned = idsOf(await group.send(updates));
        for (const { node, resolved } of group.items) {
          if (returned.has(resolved.sentId)) {
            writtenNodes.add(node);
            result.written.push(node);
          } else {
            result.refused.push(node);
          }
        }
      }
      return result;
    },

    async worldSettings() {
      const prefix = `${SYSTEM_ID}.`;
      const out = [];
      for (const setting of game.settings?.storage?.get('world') ?? []) {
        if (typeof setting?.key !== 'string' || !setting.key.startsWith(prefix)) continue;
        try {
          out.push({ key: setting.key.slice(prefix.length), value: JSON.parse(setting._source.value) });
        } catch (error) {
          console.warn(`Sprinter RPG | migration: the stored value of ${setting.key} is not JSON; its migrations skip it:`, error);
        }
      }
      return out;
    },

    async setSetting(key, value, options = {}) {
      await game.settings.set(SYSTEM_ID, key, value, options);
    },

    async deleteSetting(key, options = {}) {
      const full = `${SYSTEM_ID}.${key}`;
      const setting = [...(game.settings?.storage?.get('world') ?? [])].find((entry) => entry?.key === full);
      if (setting) await setting.delete(options);
    },

    release() {
      release();
    }
  };
}
