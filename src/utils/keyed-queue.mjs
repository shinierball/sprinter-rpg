/**
 * Runs async work one job at a time per key. Jobs under one key run in arrival order, each starting after the
 * one before has settled (a failed job does not stop the next); different keys run independently.
 * Used on the GM for read-modify-write relays (a message id, a stash uuid, an actor uuid).
 */
const queues = new Map();

/**
 * @template T
 * @param {string} key  what to serialise on; a missing key shares the `'none'` queue
 * @param {() => Promise<T>|T} fn
 * @returns {Promise<T>} the job's own result or rejection
 */
export function runKeyed(key, fn) {
  const id = String(key ?? 'none');
  const run = (queues.get(id) ?? Promise.resolve()).catch(() => {}).then(fn);
  queues.set(id, run);
  run.finally(() => { if (queues.get(id) === run) queues.delete(id); }).catch(() => {});
  return run;
}
