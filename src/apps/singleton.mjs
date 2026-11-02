/**
 * Lazily creates and returns the one instance of an app class, cached on the
 * class's static `instance` property.
 * @template T
 * @param {{ new(): T, instance: T|null }} cls
 * @returns {T}
 */
export function getSingleton(cls) {
  if (!cls.instance) cls.instance = new cls();
  return cls.instance;
}
