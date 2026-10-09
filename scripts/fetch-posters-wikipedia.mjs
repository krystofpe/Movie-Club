#!/usr/bin/env node
// Adds poster images from English Wikipedia to data/movies.json. No API key needed.
//
//   node scripts/fetch-posters-wikipedia.mjs            # only movies that have no poster yet
//   node scripts/fetch-posters-wikipedia.mjs --refresh  # look everything up again
//
// For each movie it tries the Wikipedia articles "Title (Year film)", "Title (film)" and "Title",
// and takes the first one whose short description says it's a film or TV show.
// The article's lead image is used as the poster. A wrong or missing match is fixed in
// data/overrides.json, keyed by the title as shown in the app:
//   { "King Kong": { "wiki": "King Kong (1933 film)" } }   use exactly this article
//   { "Suspense": { "wiki": false } }                      no poster
// "query" and "type": "tv" overrides (also used by the TMDB script) are honoured here too.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'data/movies.json');
const OVERRIDES = join(root, 'data/overrides.json');
const API = 'https://en.wikipedia.org/w/api.php';
const UA = 'StarsHollowMovieClub/1.0 (personal, non-commercial movie checklist)';
const REFRESH = process.argv.includes('--refresh');
const SCREEN = /\b(film|movie|television|tv|sitcom|series|documentary|miniseries|musical|cartoon|short|comedy|drama|western|thriller|horror|romance|animated|noir)\b/i;

if (!existsSync(OUT)) {
  console.error('data/movies.json is missing. Run node scripts/enrich-tmdb.mjs first.');
  process.exit(1);
}
const movies = JSON.parse(readFileSync(OUT, 'utf8'));
const overrides = existsSync(OVERRIDES) ? JSON.parse(readFileSync(OVERRIDES, 'utf8')) : {};

function candidates(m) {
  const o = overrides[m.title] || {};
  if (o.wiki === false) return [];
  if (typeof o.wiki === 'string') return [o.wiki];
  const t = o.query || m.title;
  const list = [];
  if (o.type === 'tv') return [`${t} (TV series)`, `${t} (American TV series)`, t];
  if (m.year) list.push(`${t} (${m.year} film)`);
  list.push(`${t} (film)`, t);
  return [...new Set(list)];
}

async function query(titles) {
  const url = new URL(API);
  Object.entries({
    action: 'query', format: 'json', formatversion: '2', redirects: '1',
    prop: 'pageimages|pageprops|description', piprop: 'thumbnail', pithumbsize: '400', pilicense: 'any',
    titles: titles.join('|'),
  }).forEach(([k, v]) => url.searchParams.set(k, v));
  for (let attempt = 0; ; attempt++) {
    await sleep(1200); // stay well under Wikipedia's rate limit for anonymous clients
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      const wait = Number(res.headers.get('retry-after')) || 5 * (attempt + 1);
      process.stdout.write(`  Wikipedia asked to slow down; waiting ${wait}s\n`);
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`Wikipedia API ${res.status}`);
    const q = (await res.json()).query || {};
    // follow normalisation and redirects so each asked title points at its page
    const hop = new Map([...(q.normalized || []), ...(q.redirects || [])].map(x => [x.from, x.to]));
    const pages = new Map((q.pages || []).map(p => [p.title, p]));
    const out = new Map();
    for (const t of titles) {
      let cur = t;
      for (let i = 0; i < 4 && hop.has(cur); i++) cur = hop.get(cur);
      out.set(t, pages.get(cur));
    }
    return out;
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const save = () => writeFileSync(OUT, JSON.stringify(movies, null, 1) + '\n');
const yearIn = s => Number((s || '').match(/\b(18|19|20)\d{2}\b/)?.[0]) || null;

function accept(page, m, asked) {
  if (!page || page.missing || page.invalid || !page.thumbnail?.source) return false;
  if (page.pageprops && 'disambiguation' in page.pageprops) return false;
  const pinned = typeof overrides[m.title]?.wiki === 'string';
  if (pinned) return true;
  const desc = page.description || '';
  if (!SCREEN.test(desc) && !SCREEN.test(page.title)) return false;
  // a plain-title article for a known year must not be a different version
  const dy = yearIn(desc);
  if (m.year && dy && !asked.includes(`(${m.year} film)`) && Math.abs(dy - m.year) > 1) return false;
  return true;
}

const todo = movies.filter(m => REFRESH || !m.img);
const queues = new Map(todo.map(m => [m, candidates(m)]));
const report = { plain: [], yearFromWiki: [], missing: [] };
let found = 0;

for (let round = 0; ; round++) {
  const asks = [...queues].filter(([, c]) => c.length).map(([m, c]) => [m, c.shift()]);
  if (!asks.length) break;
  for (let i = 0; i < asks.length; i += 50) {
    const batch = asks.slice(i, i + 50);
    const pages = await query([...new Set(batch.map(([, t]) => t))]);
    for (const [m, asked] of batch) {
      const page = pages.get(asked);
      if (!accept(page, m, asked)) continue;
      const hadYear = !!m.year;
      m.img = page.thumbnail.source.split('?')[0];
      m.wiki = page.title;
      queues.delete(m);
      found++;
      if (!m.year) {
        const y = yearIn(page.description) || yearIn(page.title);
        if (y) { m.year = y; report.yearFromWiki.push(`${m.title} → ${y} (${page.title})`); }
      }
      // flag matches whose year couldn't be cross-checked against the poster list
      const checked = asked.includes(' film)') || (hadYear && yearIn(page.description));
      if (!checked && typeof overrides[m.title]?.wiki !== 'string') {
        report.plain.push(`${m.title}  →  ${page.title} — ${page.description || 'no description'}`);
      }
    }
  }
  save(); // keep progress if a later round fails
  process.stdout.write(`  round ${round + 1}: ${found} posters so far\n`);
}
for (const m of queues.keys()) report.missing.push(m.title);

save();

console.log(`\n${found} posters added from Wikipedia; ${movies.filter(m => m.img).length} of ${movies.length} movies now have one.`);
const section = (label, list) => { if (list.length) console.log(`\n${label} (${list.length}):\n  ${list.join('\n  ')}`); };
section('Year not confirmed — check these are the right film or show', report.plain);
section('Year taken from Wikipedia', report.yearFromWiki);
section('No poster found — pin an article in overrides.json as { "wiki": "Exact Article Title" }', report.missing);
