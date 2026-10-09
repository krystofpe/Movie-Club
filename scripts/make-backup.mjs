#!/usr/bin/env node
// Turns a plain list of watched movies into a Movie Club backup file that the app can restore
// (Stats → Restore a backup → Combine with this phone). Nothing here touches the app's data.
//
//   node scripts/make-backup.mjs watched.txt                 # writes movie-club-backup-YYYY-MM-DD.json
//   node scripts/make-backup.mjs watched.txt out.json
//
// One movie per line in the list; lines starting with # are ignored. Optional fields after the
// title, separated by |: a 1–5 star rating, a YYYY-MM-DD date watched, a note, and "fav".
//   Rocky
//   The Lake House | 5
//   Mean Girls | 3 | 2024-11-02 | with popcorn | fav
// Titles are matched to data/movies.json ignoring case, accents, punctuation and a leading "The".
// Each record is written with t: 0, so when combined on the phone her own marks always win.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [listPath, outArg] = process.argv.slice(2);
if (!listPath) {
  console.error('usage: node scripts/make-backup.mjs watched.txt [out.json]');
  process.exit(1);
}
const today = new Date().toLocaleDateString('sv-SE');
const outPath = outArg || `movie-club-backup-${today}.json`;

const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const same = s => fold(s).replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^(the|a|an) /, '');

const movies = JSON.parse(readFileSync(join(root, 'data/movies.json'), 'utf8'));
const byKey = new Map();
for (const m of movies) byKey.set(same(m.title), m);

const items = {};
const report = { missing: [], fuzzy: [], dupes: [] };
const lines = readFileSync(listPath, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

for (const line of lines) {
  const [title, ...rest] = line.split('|').map(s => s.trim());
  const key = same(title);
  let m = byKey.get(key);
  if (!m) {
    // one poster title that starts with or contains the typed one (e.g. "Kill Bill" → "Kill Bill Vol. 1")
    const hits = movies.filter(x => same(x.title).startsWith(key) || same(x.title).includes(` ${key} `));
    if (hits.length === 1) { m = hits[0]; report.fuzzy.push(`${title}  →  ${m.title}`); }
    else if (hits.length > 1) { report.missing.push(`${title}  (ambiguous: ${hits.map(x => x.title).join(', ')})`); continue; }
    else { report.missing.push(title); continue; }
  }
  if (items[m.id]) { report.dupes.push(m.title); continue; }
  const rec = { seen: true, rating: 0, date: null, note: '', fav: false, t: 0 };
  for (const f of rest) {
    if (/^[1-5]$/.test(f)) rec.rating = Number(f);
    else if (/^\d{4}-\d{2}-\d{2}$/.test(f)) rec.date = f;
    else if (/^fav(ou?rite)?$/i.test(f)) rec.fav = true;
    else if (f) rec.note = f.slice(0, 300);
  }
  items[m.id] = rec;
}

const backup = { app: 'stars-hollow-movie-club', version: 1, saved: new Date().toISOString(), items, custom: [], tonight: null };
writeFileSync(outPath, JSON.stringify(backup, null, 1) + '\n');

const n = Object.keys(items).length;
const rated = Object.values(items).filter(r => r.rating).length;
console.log(`Wrote ${outPath}: ${n} watched movies (${rated} with a rating) out of ${lines.length} lines.`);
const section = (label, list) => { if (list.length) console.log(`\n${label} (${list.length}):\n  ${list.join('\n  ')}`); };
section('Matched loosely — check these', report.fuzzy);
section('Listed twice — kept the first', report.dupes);
section('Not on the poster — fix the spelling, or add them in the app with Add', report.missing);
