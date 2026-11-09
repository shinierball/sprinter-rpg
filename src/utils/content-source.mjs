/**
 * src/utils/content-source.mjs
 * The source stamp (7.7c): `flags['sprinter-rpg'].source = { theme, set }`, which theme and which set of it a
 * document came from. A pure reader of that structured flag (never a name, a pack label or a folder name), plus the
 * writer the spec collectors use and `sourceBadge`, the display data (icon, colour token, symbol, tooltip) a sheet, a list
 * or a picker shows. The display data lives in the content registry, keyed by id (`registerTheme` badge,
 * `registerSourceSet`); an unregistered theme or set still gets a badge.
 */
import { SYSTEM_ID } from '../constants.mjs';
import { contentRegistry } from '../content/registry.mjs';
import { catalogEntries } from '../content/catalog-lookup.mjs';
import { celestialAiPoopPayload, replacedRecordOf } from '../data/rules/celestial-ai-poop.mjs';

/** The set id of the documents the system ships in the `cog` theme. */
export const BUNDLED_SET_ID = 'bundled';

/** The pack-index field a list asks for to read a pack entry's stamp (a pack index returns only what is requested). */
export const SOURCE_INDEX_FIELD = `flags.${SYSTEM_ID}.source`;

const ID = /^[a-z0-9._-]{1,40}$/;
const USER_ID = /^[A-Za-z0-9]{16}$/;
const BY_NAME_MAX = 64;
const FALLBACK_ICON = 'fa-solid fa-puzzle-piece';
const FALLBACK_COLOR = '--cog-text-muted';

const isPlain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const validId = (v) => (typeof v === 'string' && ID.test(v) ? v : '');

const t = (key, data) => {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  if (data) return typeof i18n.format === 'function' ? i18n.format(key, data) : key;
  return typeof i18n.localize === 'function' ? i18n.localize(key) : key;
};

/**
 * The sanitised source stamp of a document, or null when it has none or it is malformed. Both ids must match
 * `/^[a-z0-9._-]{1,40}$/`; an array, a comma string or any other shape reads as no stamp. An `authorship` id (7.16)
 * is kept when it matches the same pattern and dropped otherwise, without touching theme and set. `by` (the id of the
 * user who made a homebrew document) is kept when it is 16 letters and digits, and `byName` (that user's name then) when
 * it is a string, cut to 64 characters; a malformed one is dropped and the stamp stays valid.
 * @param {object|null} doc a document, its data, or a catalog entry
 * @returns {{ theme: string, set: string, authorship?: string, by?: string, byName?: string }|null}
 */
export function readSourceStamp(doc) {
  let raw;
  try {
    raw = typeof doc?.getFlag === 'function' ? doc.getFlag(SYSTEM_ID, 'source') : undefined;
  } catch { raw = undefined; }
  raw ??= doc?.flags?.[SYSTEM_ID]?.source;
  if (!isPlain(raw)) return null;
  const theme = validId(raw.theme);
  const set = validId(raw.set);
  if (!theme || !set) return null;
  const out = { theme, set };
  const authorship = validId(raw.authorship);
  if (authorship) out.authorship = authorship;
  if (typeof raw.by === 'string' && USER_ID.test(raw.by)) out.by = raw.by;
  if (typeof raw.byName === 'string' && raw.byName.trim()) out.byName = raw.byName.trim().slice(0, BY_NAME_MAX);
  return out;
}

/**
 * The authorship id of a document's source stamp (7.16), or '' when it has none. An id that is not registered still
 * reads: the registry decides what an unknown id means.
 * @param {object|null} doc
 * @returns {string}
 */
export function readAuthorship(doc) {
  return readSourceStamp(doc)?.authorship ?? '';
}

/**
 * The rules that turn a document's content off, each `(doc, registry) => boolean`: its theme is off, or its authorship is
 * hidden by the `aiContent` setting (7.16f). `isContentOff` stays the one question lists ask.
 */
const OFF_RULES = [
  (doc, registry) => {
    const stamp = readSourceStamp(doc);
    return Boolean(stamp) && registry.isThemeOff(stamp.theme);
  },
  // A document with no stamp, no authorship or an unregistered authorship is never hidden.
  (doc, registry) => registry.isAuthorshipHidden?.(readAuthorship(doc)) === true
];

/**
 * Whether a document is off, so a picker, creator or manager leaves it out: its source stamp names a theme that is turned
 * off, or an authorship the `aiContent` setting hides. An unstamped or malformed document is never off; the primary theme never is.
 * @param {object|null} doc a document, its data, or a catalog entry
 * @param {object} [registry=contentRegistry]
 * @returns {boolean}
 */
export function isContentOff(doc, registry = contentRegistry) {
  try {
    return OFF_RULES.some((rule) => rule(doc, registry));
  } catch {
    return false;
  }
}

/**
 * The definitions a picker, creator or manager OFFERS: `catalogEntries` without the ones that are off (`isContentOff`) (a theme turned off,
 * or an authorship the `aiContent` setting hides, 7.16f). Lookups by reference (`findCatalogEntry`, `catalogEntries`) still
 * resolve a hidden document; only a list a person chooses from uses this.
 * @param {string} kind
 * @returns {object[]}
 */
export function offeredEntries(kind) {
  return catalogEntries(kind).filter(def => !isContentOff(def));
}

/**
 * What happens when a document from a reference would land on an actor (a grant, a prize, a condition, a crafted output).
 * A document of a theme that is off does not arrive: Celestial AI Poop does, recording it. Looking a reference up still
 * works (the reference store resolves an off theme); this is the check at the landing. The poop payload is built by
 * `buildPayload` and is never stamped, so it is never itself off.
 * @param {object|null} data creation data or a document
 * @param {import('../content/registry.mjs').COGContentRegistry} [registry=contentRegistry]
 * @param {{ replacedAt?: number }} [options]
 * @returns {{ off: false }|{ off: true, poop: object }}
 */
export function landingFor(data, registry = contentRegistry, options = {}) {
  if (!isPlain(data) && typeof data?.toObject !== 'function') return { off: false };
  if (!isContentOff(data, registry)) return { off: false };
  return { off: true, poop: celestialAiPoopPayload(replacedRecordOf(data, options)) };
}

/**
 * `dataArray` as it should be created: each entry from an off theme replaced by its Celestial AI Poop payload, the rest
 * untouched (same objects, same order). The one call every path that creates an embedded item from a reference makes.
 * @param {object[]} dataArray
 * @param {import('../content/registry.mjs').COGContentRegistry} [registry=contentRegistry]
 * @returns {object[]}
 */
export function landItems(dataArray, registry = contentRegistry) {
  if (!Array.isArray(dataArray)) return dataArray;
  return dataArray.map((data) => {
    const landing = landingFor(data, registry);
    return landing.off ? landing.poop : data;
  });
}

/**
 * The referenceable document of an off theme that `ref` names (an `_id` or identifier), or null. Catalog lookups do not
 * answer for a theme that is off, but the reference store still does (the example spells and skills a bundled document
 * names); a path that would create a document from `ref` and found nothing in the catalog asks here, so an off theme's
 * document arrives as Celestial AI Poop instead of as a bare stand-in named by its identifier.
 * @param {string} kind a reference kind ('skills', 'spells', 'buffs', 'debuffs', ...)
 * @param {string} ref
 * @param {import('../content/registry.mjs').COGContentRegistry} [registry=contentRegistry]
 * @returns {object|null}
 */
export function findOffReference(kind, ref, registry = contentRegistry) {
  const entry = registry?.getReference?.(kind, typeof ref === 'string' ? ref.trim() : '') ?? null;
  return entry && isContentOff(entry, registry) ? entry : null;
}

/** `{ theme, set }` plus a valid `authorship`. */
function cleanStamp(stamp) {
  return readSourceStamp({ flags: { [SYSTEM_ID]: { source: stamp } } });
}

/**
 * A copy of `data` carrying `stamp` (flags merged, nothing else touched). An existing valid stamp stays.
 * @param {object} data a spec or document data
 * @param {{ theme: string, set: string }} stamp
 * @returns {object}
 */
export function withSourceStamp(data, stamp) {
  if (!isPlain(data) || !validId(stamp?.theme) || !validId(stamp?.set)) return data;
  if (readSourceStamp(data)) return data;
  const flags = isPlain(data.flags) ? data.flags : {};
  const own = isPlain(flags[SYSTEM_ID]) ? flags[SYSTEM_ID] : {};
  return { ...data, flags: { ...flags, [SYSTEM_ID]: { ...own, source: cleanStamp(stamp) } } };
}

/**
 * Carries the source stamp of the definition `def` (a catalog entry, pack document or world item) onto item creation
 * data `data`, in place, for a path that builds the data field by field. A stamp already on `data` stays.
 * @param {object} data item creation data
 * @param {object|null} def
 * @returns {object} `data`
 */
export function carrySourceStamp(data, def) {
  const stamp = readSourceStamp(def);
  if (!stamp || !isPlain(data) || readSourceStamp(data)) return data;
  const flags = isPlain(data.flags) ? data.flags : {};
  data.flags = { ...flags, [SYSTEM_ID]: { ...(isPlain(flags[SYSTEM_ID]) ? flags[SYSTEM_ID] : {}), source: stamp } };
  return data;
}

/**
 * A copy of a spec with the stamp on it and on every embedded item (`items`) that has no stamp of its own.
 * @param {object} spec
 * @param {{ theme: string, set: string, authorship?: string }} stamp
 * @returns {object}
 */
export function stampSpec(spec, stamp) {
  const out = withSourceStamp(spec, stamp);
  if (!isPlain(out) || !Array.isArray(out.items)) return out;
  return { ...out, items: out.items.map((item) => withSourceStamp(item, stamp)) };
}

/**
 * The badge for a document: icon, colour token, symbol, label and tooltip, or null when it has no valid stamp.
 * An unregistered theme or set still gets one (puzzle piece, muted text token, the set id in capitals cut to three
 * letters, the raw ids in the tooltip).
 * @param {object|null} doc
 * @param {import('../content/registry.mjs').COGContentRegistry} [registry=contentRegistry]
 * `authorship` (7.16e) is `{ id, label, icon }` for a registered mark in the stamp, else null, and the tooltip then
 * gains a second line in words ("Written with AI", "AI-written, edited by a person", "Written by a person").
 * @returns {{ theme: string, set: string, icon: string, color: string, symbol: string, label: string, tooltip: string, authorship: { id: string, label: string, icon: string }|null, off: boolean }|null}
 */
export function sourceBadge(doc, registry = contentRegistry) {
  const stamp = readSourceStamp(doc);
  if (!stamp) return null;
  const theme = registry?.getThemes?.()[stamp.theme] ?? null;
  const set = registry?.getSourceSet?.(stamp.theme, stamp.set) ?? null;
  const own = theme ? null : registry?.getSourceTheme?.(stamp.theme) ?? null;
  const badge = isPlain(theme?.badge) ? theme.badge : isPlain(own?.badge) ? own.badge : null;
  const icon = typeof badge?.icon === 'string' && badge.icon ? badge.icon : FALLBACK_ICON;
  const color = typeof badge?.color === 'string' && badge.color ? badge.color : FALLBACK_COLOR;
  const themeLabel = theme?.label || own?.label || stamp.theme;
  const symbol = set?.symbol || own?.symbol || stamp.set.replace(/[^a-z0-9]/g, '').toUpperCase().slice(0, 3);
  let label = set?.label || stamp.set;
  let tooltip;
  if (own) {
    const name = String(globalThis.game?.users?.get?.(stamp.by)?.name || stamp.byName || '');
    label = name ? t('COG.Source.HomebrewLabel', { name }) : themeLabel;
    tooltip = name ? t('COG.Source.HomebrewBy', { name }) : themeLabel;
  } else if (!theme || !set) tooltip = t('COG.Source.TooltipUnknown', { theme: stamp.theme, set: stamp.set });
  else if (set.note) tooltip = t('COG.Source.Tooltip', { theme: themeLabel, set: set.note });
  else if (set.release) tooltip = t('COG.Source.TooltipRelease', { theme: themeLabel, set: set.label, release: set.release });
  else tooltip = t('COG.Source.Tooltip', { theme: themeLabel, set: set.label });
  const mark = stamp.authorship ? registry?.getAuthorship?.(stamp.authorship) ?? null : null;
  const authorship = mark ? { id: mark.id, label: t(mark.label), icon: mark.icon } : null;
  if (authorship) tooltip = `${tooltip}\n${authorship.label}`;
  const off = Boolean(registry?.isThemeOff?.(stamp.theme));
  if (off) tooltip = t('COG.Source.TooltipOff', { tooltip });
  return { theme: stamp.theme, set: stamp.set, icon, color, symbol, label, tooltip, authorship, off };
}
