/**
 * src/sourcery/report.mjs
 * The plain-text import report the window copies to the clipboard (for a bug report). Pure. Ids, kinds, states, reasons,
 * books, file names and counts only: never a document name and never any text.
 */
import { summarizePlan } from './import-plan.mjs';

const clean = v => String(v ?? '').replace(/[\r\n\t]+/g, ' ').trim();

/**
 * @param {object} plan from `planImport`
 * @param {{ version?: string, date?: string }} [meta]
 * @returns {string}
 */
export function buildReport(plan, { version = '', date = new Date().toISOString().slice(0, 10) } = {}) {
  const summary = summarizePlan(plan);
  const lines = ['Sourcery import report', `System version: ${clean(version) || 'unknown'}`, `Date: ${clean(date)}`, '', 'Books:'];
  for (const b of summary.books) lines.push(b.provided ? `- ${b.id}: ${clean(b.file)}, matched ${b.pct}%${b.differs ? `, ${b.differs} start differently` : ''}` : `- ${b.id}: not provided${b.tablesWaiting ? `, ${b.tablesWaiting} ${b.tablesWaiting === 1 ? 'table' : 'tables'} waiting` : ''}`);
  lines.push('', 'Files not recognised as a rulebook:');
  if (summary.unrecognised.length) for (const f of summary.unrecognised) lines.push(`- ${clean(f.file)} (best match ${f.pct}%)`);
  else lines.push('- none');
  lines.push('', 'Files also matched, not used:');
  if (summary.alsoMatched.length) for (const f of summary.alsoMatched) lines.push(`- ${clean(f.file)} (${clean(f.book)})`);
  else lines.push('- none');
  const t = summary.totals;
  const f = summary.fields;
  lines.push('', `Documents asked: ${t.asked}; get text: ${t.withText}; empty: ${t.empty} (waiting for a book: ${t.waiting}, not found: ${t.notFound}, no recipe: ${t.noRecipe})`,
    `Fields: filled from the book: ${f.fromBook} (verified ${f.verified}, unverified ${f.unverified}); emptied and flagged: ${f.emptiedNow}; still our wording: ${f.keptOurs}; embedded item names from the book: ${f.itemNames}, embedded items kept and flagged: ${f.itemsKept}`, '', 'Entries (id, kind, state, reason, book):');
  for (const e of [...plan.entities, ...plan.tables]) {
    if (e.state === 'complete') continue;
    lines.push([e.id, e.kind, e.state, e.reason ?? '-', e.book ?? '-'].map(clean).join(', '));
  }
  return lines.join('\n');
}
