#!/usr/bin/env node
// Builds data/movies.json from data/titles.txt, adding year + poster from TMDB.
//
//   TMDB_API_KEY=xxxx node scripts/enrich-tmdb.mjs            # only looks up new/changed titles
//   TMDB_API_KEY=xxxx node scripts/enrich-tmdb.mjs --refresh  # looks up everything again
//   node scripts/enrich-tmdb.mjs                              # no key: titles only, keeps earlier lookups
//
// TMDB_API_KEY may be the v3 "API Key" or the v4 "API Read Access Token".
// A line like "Psycho (1960)" in titles.txt shows as "Psycho" and prefers the 1960 film.
// Fix wrong matches in data/overrides.json, keyed by the title as shown (without the year):
//   { "Ghost": { "year": 1990 } }                       prefer the version from that year
//   { "West Wing": { "type": "tv", "query": "The West Wing" } }
//   { "Star Wars: Episode V": { "tmdbId": 1891 } }      pin an exact TMDB id
//   { "Some Title": { "skip": true } }                  no lookup, title only

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TITLES = join(root, 'data/titles.txt');
const OVERRIDES = join(root, 'data/overrides.json');
const OUT = join(root, 'data/movies.json');
const API = 'https://api.themoviedb.org/3';
const KEY = process.env.TMDB_API_KEY?.trim();
const REFRESH = process.argv.includes('--refresh');
// Gilmore Girls aired 2000–2007, so prefer versions released by then (e.g. Psycho 1960 over 1998 is decided by votes).
const LATEST_YEAR = 2007;

const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const slug = s => fold(s).replace(/['’]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const same = s => fold(s).replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^(the|a|an) /, '');

const titles = readFileSync(TITLES, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  .map(line => {
    const m = line.match(/^(.*?)\s*\((\d{4})\)$/);
    return m ? { title: m[1], year: Number(m[2]) } : { title: line, year: null };
  });
const overrides = existsSync(OVERRIDES) ? JSON.parse(readFileSync(OVERRIDES, 'utf8')) : {};
const previous = new Map();
if (existsSync(OUT)) for (const m of JSON.parse(readFileSync(OUT, 'utf8'))) previous.set(m.title, m);

const unknownOverrides = Object.keys(overrides).filter(t => !titles.some(x => x.title === t));
if (unknownOverrides.length) console.warn(`overrides.json names titles not in titles.txt: ${unknownOverrides.join(', ')}`);

async function tmdb(path, params = {}) {
  const url = new URL(API + path);
  const headers = { accept: 'application/json' };
  if (KEY.startsWith('eyJ')) headers.authorization = `Bearer ${KEY}`;
  else url.searchParams.set('api_key', KEY);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers });
    if (res.status === 429 && attempt < 5) { await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); continue; }
    if (res.status === 401) throw new Error('TMDB rejected the key (401). Check TMDB_API_KEY.');
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`TMDB ${res.status} for ${path}`);
    return res.json();
  }
}

const yearOf = r => Number((r.release_date || r.first_air_date || '').slice(0, 4)) || null;
const nameOf = r => r.title || r.name || '';

function choose(results, wanted, year) {
  const byVotes = (a, b) => (b.vote_count || 0) - (a.vote_count || 0);
  const gap = r => Math.abs((yearOf(r) || 0) - year);
  const exact = results.filter(r => same(nameOf(r)) === wanted || same(r.original_title || r.original_name || '') === wanted);
  if (year) {
    // a known year wins: closest year among exact titles, else the closest-year result within a year
    const pool = (exact.length ? exact : results).filter(r => gap(r) <= (exact.length ? 3 : 1));
    if (pool.length) return { hit: pool.sort((a, b) => gap(a) - gap(b) || byVotes(a, b))[0], exact: exact.length > 0 };
  }
  const inEra = exact.filter(r => (yearOf(r) || 0) <= LATEST_YEAR).sort(byVotes);
  if (inEra.length) return { hit: inEra[0], exact: true };
  if (exact.length) return { hit: exact.sort(byVotes)[0], exact: true };
  return results.length ? { hit: results[0], exact: false } : null;
}

async function lookup(title, hintYear, o) {
  const type = o.type === 'tv' ? 'tv' : 'movie';
  if (o.tmdbId) {
    const r = await tmdb(`/${type}/${o.tmdbId}`);
    return r && { r, type, exact: true };
  }
  const query = o.query || title;
  const wanted = same(query);
  const year = o.year || hintYear;
  const res = await tmdb(`/search/${type}`, { query, include_adult: 'false', language: 'en-US' });
  let pick = choose(res?.results || [], wanted, year);
  if (pick) return { r: pick.hit, type, exact: pick.exact };
  if (o.type) return null;
  // Not a film? A few tickets are TV shows (All in the Family, This Old House…).
  const tv = await tmdb('/search/tv', { query, language: 'en-US' });
  pick = choose(tv?.results || [], wanted, year);
  return pick && { r: pick.hit, type: 'tv', exact: pick.exact, fellBack: true };
}

const report = { inexact: [], tv: [], noPoster: [], missing: [] };
const ids = new Set();
const out = [];
let looked = 0;

for (const { title, year: hintYear } of titles) {
  const o = overrides[title] || {};
  let id = slug(title) || 'movie';
  while (ids.has(id)) id += '-2';
  ids.add(id);
  const entry = { id, title };
  const prev = previous.get(title);
  const sig = JSON.stringify({ ...o, hintYear });

  if (o.skip) {
    // title only
  } else if (prev?.tmdb && prev.sig === sig && !REFRESH) {
    Object.assign(entry, { year: prev.year, poster: prev.poster, tmdb: prev.tmdb, matched: prev.matched, sig });
  } else if (KEY) {
    const found = await lookup(title, hintYear, o);
    looked++;
    if (found) {
      entry.year = yearOf(found.r);
      entry.poster = found.r.poster_path || null;
      entry.tmdb = { type: found.type, id: found.r.id };
      entry.matched = nameOf(found.r);
      entry.sig = sig;
      if (!found.exact) report.inexact.push(`${title}  →  ${entry.matched} (${entry.year ?? '?'})`);
      else if (hintYear && entry.year && Math.abs(entry.year - hintYear) > 1) report.inexact.push(`${title} (${hintYear})  →  ${entry.matched} (${entry.year})`);
      if (found.fellBack) report.tv.push(`${title}  →  ${entry.matched}`);
    } else {
      report.missing.push(title);
    }
  } else if (prev) {
    Object.assign(entry, { year: prev.year, poster: prev.poster, tmdb: prev.tmdb, matched: prev.matched, sig: prev.sig });
  }
  if (prev?.img) Object.assign(entry, { img: prev.img, wiki: prev.wiki }); // posters from fetch-posters-wikipedia.mjs
  entry.year ??= prev?.year ?? hintYear;
  if (entry.tmdb && !entry.poster) report.noPoster.push(title);
  for (const k of Object.keys(entry)) if (entry[k] == null) delete entry[k];
  out.push(entry);
  if (looked && looked % 50 === 0) process.stdout.write(`  …${looked} looked up\n`);
}

writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');

console.log(`\nWrote ${out.length} movies to data/movies.json (${looked} looked up on TMDB${KEY ? '' : ' — no TMDB_API_KEY set, titles only'}).`);
const section = (label, list) => { if (list.length) console.log(`\n${label} (${list.length}):\n  ${list.join('\n  ')}`); };
section('Title differs from TMDB match — check these, fix in overrides.json', report.inexact);
section('Matched as a TV show', report.tv);
section('No poster on TMDB', report.noPoster);
section('Not found on TMDB', report.missing);
