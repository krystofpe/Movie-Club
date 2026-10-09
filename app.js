// Stars Hollow Movie Club — a personal checklist of the poster's movies.
// Everything she marks lives in localStorage on her phone; backups are plain JSON files.

const STORE_KEY = 'smc.v1';
const UI_KEY = 'smc.ui';
const IMG_BASE = 'https://image.tmdb.org/t/p/';
const MILESTONES = [10, 25, 50, 100, 150, 200, 250, 300, 350, 400, 450];
const CHEERS = ['Copper boom!', 'Coffee, coffee, coffee!', 'Oy, the pride.', 'Kirk would be impressed.', 'Luke owes you a refill.'];
const LEAF_COLORS = ['#C98A8F', '#8A3B4A', '#9DB08F', '#C07F3E', '#E3A869', '#F2C46D'];
const POP_MS = 1400;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const els = {
  list: $('#list'),
  tpl: $('#card-tpl'),
  q: $('#q'),
  chips: $$('.chip'),
  sorts: $$('.sort'),
  tabs: $$('.tab'),
  screens: { list: $('#tab-list'), picker: $('#tab-picker'), stats: $('#tab-stats') },
  empty: $('#empty'),
  emptyHint: $('#empty-hint'),
  loadError: $('#load-error'),
  sheet: $('#sheet'),
  importDlg: $('#import-dlg'),
  confirmDlg: $('#confirm-dlg'),
  starsTpl: $('#stars-tpl'),
  importFile: $('#import-file'),
  toast: $('#toast'),
  bucket: $('#bucket'),
  kernels: $('#kernels'),
  spin: $('#spin-btn'),
  reveal: $('#reveal'),
};

let poster = [];          // movies from data/movies.json
let movies = [];          // poster + her own additions
const byId = new Map();
const cards = new Map();
let lastOrder = '';       // ids in current DOM order, to skip needless re-sorting
const store = loadStore();
const ui = loadUi();

// ---------- storage ----------

function cleanRecord(r) {
  if (!r || typeof r !== 'object') return null;
  const rec = {
    seen: r.seen === true,
    rating: Number.isInteger(r.rating) && r.rating >= 0 && r.rating <= 5 ? r.rating : 0,
    date: typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null,
    note: typeof r.note === 'string' ? r.note.slice(0, 300) : '',
    fav: r.fav === true,
    t: Number.isFinite(r.t) ? r.t : 0,
  };
  return rec.seen || rec.rating || rec.note || rec.fav ? rec : null;
}

function cleanItems(items) {
  const out = {};
  if (!items || typeof items !== 'object') return out;
  for (const [id, r] of Object.entries(items)) {
    if (id.length > 200) continue;
    const rec = cleanRecord(r);
    if (rec) out[id] = rec;
  }
  return out;
}

function cleanCustom(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(m => m && typeof m.id === 'string' && m.id.startsWith('u-') && typeof m.title === 'string' && m.title.trim())
    .map(m => ({ id: m.id.slice(0, 40), title: m.title.trim().slice(0, 200), year: Number.isInteger(m.year) && m.year > 1800 && m.year < 2200 ? m.year : null, custom: true }));
}

function loadStore() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    return { items: cleanItems(s.items), custom: cleanCustom(s.custom), tonight: typeof s.tonight === 'string' ? s.tonight : null };
  } catch {
    return { items: {}, custom: [], tonight: null };
  }
}

let warnedSave = false;
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, items: store.items, custom: store.custom.map(({ id, title, year }) => ({ id, title, year })), tonight: store.tonight }));
  } catch {
    if (!warnedSave) toast('This browser blocked saving — save a backup from Stats');
    warnedSave = true;
  }
}

function loadUi() {
  const d = { filter: 'all', sort: 'az', pool: 'todo', theme: null, q: '', tab: 'list' };
  try {
    const u = JSON.parse(localStorage.getItem(UI_KEY)) || {};
    if (['all', 'todo', 'watched', 'fav'].includes(u.filter)) d.filter = u.filter;
    if (['az', 'year', 'recent'].includes(u.sort)) d.sort = u.sort;
    if (['todo', 'fav', 'all'].includes(u.pool)) d.pool = u.pool;
    if (['light', 'late'].includes(u.theme)) d.theme = u.theme;
  } catch { /* defaults */ }
  return d;
}
function saveUi() {
  try { localStorage.setItem(UI_KEY, JSON.stringify({ filter: ui.filter, sort: ui.sort, pool: ui.pool, theme: ui.theme })); } catch { /* not important */ }
}

let askedPersist = false;
function askPersist() {
  if (askedPersist) return;
  askedPersist = true;
  navigator.storage?.persist?.().catch(() => {});
}

// ---------- helpers ----------

const fold = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const searchKey = s => fold(s).replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const sortKey = s => searchKey(s).replace(/^(the|a|an) /, '');
const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD in local time
const mark = id => store.items[id] || { seen: false, rating: 0, date: null, note: '', fav: false, t: 0 };
const watchedCount = () => movies.reduce((n, m) => n + (mark(m.id).seen ? 1 : 0), 0);
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

// Google Analytics (set up in index.html, live site only). Events say what she did, never which movie.
const TAB_TITLES = { list: 'Checklist', picker: 'Movie Night', stats: 'Stats' };
const track = (name, params) => window.gtag?.('event', name, params);
function trackTab(tab) {
  window.gtag?.('set', { page_title: TAB_TITLES[tab] }); // so the events that follow count toward this tab too
  track('page_view');
}

function shortDate(iso) {
  const d = new Date(iso + 'T12:00:00');
  const opts = d.getFullYear() === new Date().getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', year: 'numeric' };
  return d.toLocaleDateString('en-US', opts);
}

const posterUrl = (m, size) => m.img || (m.poster ? IMG_BASE + size + m.poster : null);

function fillPoster(el, m, size) {
  const url = (m && posterUrl(m, size)) || '';
  if (el.dataset.src === url) return; // already showing this poster (or already found it broken)
  el.dataset.src = url;
  el.textContent = '';
  el.hidden = !url;
  if (!url) return;
  const img = new Image();
  img.alt = `Poster for ${m.title}`;
  img.decoding = 'async';
  img.crossOrigin = 'anonymous'; // a CORS (non-opaque) response is what lets sw.js cache the poster
  img.src = url;
  img.onerror = () => { el.hidden = true; };
  el.append(img);
}

const buzz = () => navigator.vibrate?.(12);
const motionMQ = matchMedia('(prefers-reduced-motion: reduce)');
const reducedMotion = () => motionMQ.matches;

function bump(el) {
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
}

// ---------- movies ----------

function prepare(m) {
  m.sortKey = sortKey(m.title);
  m.searchKey = searchKey(m.title);
  return m;
}

function rebuildMovies() {
  movies = [...poster, ...store.custom.map(prepare)];
  byId.clear();
  movies.forEach(m => byId.set(m.id, m));
}

// ---------- stars ----------

function mountStars(box) {
  box.append(els.starsTpl.content.cloneNode(true));
}

// paints a 5-star radio group; one tab stop per group (the chosen star, or the first when unrated)
function paintStars(box, rating) {
  $$('button', box).forEach((b, i) => {
    b.classList.toggle('on', i < rating);
    b.setAttribute('aria-checked', String(i + 1 === rating));
    b.tabIndex = i + 1 === rating || (!rating && i === 0) ? 0 : -1;
  });
}

// arrow keys move between the stars of one group
function starKeys(e) {
  const btn = e.target.closest('.stars button');
  const step = btn && { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
  if (!step) return;
  e.preventDefault();
  const btns = $$('button', btn.parentElement);
  btns[Math.min(4, Math.max(0, btns.indexOf(btn) + step))].focus();
}

// ---------- cards ----------

function buildCard(m) {
  const li = els.tpl.content.firstElementChild.cloneNode(true);
  li.dataset.id = m.id;
  mountStars($('.stars', li));
  cards.set(m.id, li);
  fillCard(m);
  return li;
}

// title, year and the labels that mention the title (so a rename updates them too)
function fillCard(m) {
  const li = cards.get(m.id);
  if (!li) return;
  $('.movie-open', li).textContent = m.title;
  $('.movie-year', li).textContent = m.year || '';
  $('.stars', li).setAttribute('aria-label', `Rating for ${m.title}`);
  $('.note', li).setAttribute('aria-label', `Note for ${m.title}`);
  $('.fav', li).setAttribute('aria-label', `Favorite: ${m.title}`);
  $('.edit', li).setAttribute('aria-label', `Open ${m.title}`);
  $('.check', li).setAttribute('aria-label', `Watched: ${m.title}`);
  updateCard(m.id);
}

function updateCard(id) {
  const li = cards.get(id);
  if (!li) return;
  const r = mark(id);
  $('.check', li).setAttribute('aria-pressed', String(r.seen));
  $('.fav', li).setAttribute('aria-pressed', String(r.fav));
  paintStars($('.stars', li), r.rating);
  const pill = $('.pill', li);
  pill.hidden = !r.seen;
  pill.textContent = r.date ? `watched ${shortDate(r.date)}` : 'watched';
  const note = $('.note', li);
  if (document.activeElement !== note) note.value = r.note;
}

// ---------- view ----------

function compare(a, b) {
  if (ui.sort === 'year') {
    const d = (a.year || 9999) - (b.year || 9999);
    if (d) return d;
  } else if (ui.sort === 'recent') {
    const ra = mark(a.id), rb = mark(b.id);
    if (ra.seen !== rb.seen) return ra.seen ? -1 : 1;
    if (ra.seen) {
      const d = (rb.date || '').localeCompare(ra.date || '') || rb.t - ra.t;
      if (d) return d;
    }
  }
  return a.sortKey.localeCompare(b.sortKey);
}

// resort = false when only the search text changed: the query never affects the order
function applyView(resort = true) {
  const q = searchKey(ui.q);
  let shown = 0;
  for (const m of movies) {
    const r = mark(m.id);
    const ok = (ui.filter === 'all' || (ui.filter === 'todo' && !r.seen) || (ui.filter === 'watched' && r.seen) || (ui.filter === 'fav' && r.fav))
      && (!q || m.searchKey.includes(q) || (r.note && searchKey(r.note).includes(q)));
    cards.get(m.id).hidden = !ok;
    if (ok) shown++;
  }
  if (resort) {
    const ordered = [...movies].sort(compare);
    const order = ordered.map(m => m.id).join();
    if (order !== lastOrder) {
      els.list.append(...ordered.map(m => cards.get(m.id)));
      lastOrder = order;
    }
  }
  els.empty.hidden = shown > 0;
  if (!shown) {
    const hints = {
      all: 'add your first movie with the button above',
      todo: 'you watched everything — oy with the poodles already!',
      watched: 'tick off a movie and it lands here',
      fav: 'tap a heart to save a favorite',
    };
    els.emptyHint.textContent = q ? `no matches for “${ui.q.trim()}”` : hints[ui.filter];
  }
}

function updateStats() {
  const total = movies.length;
  const seen = watchedCount();
  const left = total - seen;
  $('#watched-count').textContent = seen;
  $('#total-count').textContent = total;
  $('#to-go').textContent = toGo(left);
  $('#cup-fill').style.setProperty('--level', total ? seen / total : 0);
  updatePools();
  if (!els.screens.stats.hidden) renderStats();
}

const toGo = left => (left ? `${plural(left, 'cozy night')} to go` : 'all caught up, put the kettle on');

// ---------- actions ----------

function setMark(id, patch) {
  const prev = mark(id);
  const next = cleanRecord({ ...prev, ...patch, t: Date.now() });
  if (next) store.items[id] = next;
  else delete store.items[id];
  save();
  updateCard(id);
  trackMark(prev, mark(id));
}

// every mark change (card or sheet) passes through setMark, so this is the one place to count them
function trackMark(a, b) {
  if (b.seen && !a.seen) track('mark_watched');
  if (b.rating && b.rating !== a.rating) track('rate_movie', { rating: b.rating });
  if (b.fav && !a.fav) track('favorite');
  if (b.note && b.note !== a.note) track('write_note');
}

function toggleWatched(id) {
  const before = watchedCount();
  const r = mark(id);
  buzz();
  setMark(id, r.seen ? { seen: false, date: null } : { seen: true, date: today() });
  updateStats();
  if (!r.seen) {
    askPersist();
    celebrate(before, watchedCount());
  }
  // in a filtered or sorted view the card may no longer belong; let the check land first
  if (ui.filter !== 'all' || ui.sort === 'recent') setTimeout(applyView, 600);
}

function celebrate(before, after) {
  if (after <= before) return;
  if (after === movies.length) {
    leaves(40);
    toast('Every movie watched. Oy with the poodles already!');
  } else if (MILESTONES.includes(after)) {
    leaves(26);
    toast(`${after} movies watched. ${CHEERS[MILESTONES.indexOf(after) % CHEERS.length]}`);
  }
}

function setRating(id, n, btn) {
  const value = mark(id).rating === n ? 0 : n;
  buzz();
  setMark(id, { rating: value });
  if (value && btn) bump(btn);
}

function toggleFav(id, btn) {
  const fav = !mark(id).fav;
  buzz();
  setMark(id, { fav });
  if (fav) bump(btn);
  updatePools();
  if (ui.filter === 'fav') setTimeout(applyView, 400);
}

const noteTimers = new Map();
function saveNote(id, value) {
  clearTimeout(noteTimers.get(id));
  noteTimers.delete(id);
  const note = value.trim();
  if (note !== mark(id).note) setMark(id, { note });
}

// ---------- tabs ----------

function showTab(tab) {
  if (ui.tab === tab) {
    scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
    return;
  }
  ui.tab = tab;
  for (const [k, el] of Object.entries(els.screens)) el.hidden = k !== tab;
  els.tabs.forEach(t => (t.dataset.tab === tab ? t.setAttribute('aria-current', 'page') : t.removeAttribute('aria-current')));
  if (tab === 'stats') renderStats();
  if (tab === 'picker') renderPicker();
  if (tab === 'list') applyView();
  scrollTo({ top: 0 });
  trackTab(tab);
}

// ---------- movie night ----------

const picker = { phase: 'idle', pickId: null, timer: 0 };

function poolList(pool) {
  return movies.filter(m => (pool === 'todo' ? !mark(m.id).seen : pool === 'fav' ? mark(m.id).fav : true));
}

function updatePools() {
  for (const k of ['todo', 'fav', 'all']) $(`[data-pool-count="${k}"]`).textContent = poolList(k).length;
  $$('.pool').forEach(p => p.setAttribute('aria-pressed', String(p.dataset.pool === ui.pool)));
  const empty = poolList(ui.pool).length === 0;
  els.spin.hidden = empty;
  $('#pool-empty').hidden = !empty;
  $('#pool-empty').textContent = ui.pool === 'fav' ? 'no favorites yet — heart a few on the checklist' : ui.pool === 'todo' ? 'nothing left unwatched!' : 'the list is empty';
}

function renderPicker() {
  updatePools();
  const t = store.tonight && byId.get(store.tonight);
  $('#tonight').hidden = !t;
  if (t) $('#tonight-title').textContent = t.title;
  const popping = picker.phase === 'popping';
  els.bucket.classList.toggle('is-popping', popping);
  els.spin.disabled = popping;
  els.spin.textContent = popping ? 'Popping…' : picker.phase === 'reveal' ? 'Pop another' : 'Pop a movie';
  const m = picker.pickId && byId.get(picker.pickId);
  els.reveal.hidden = !(picker.phase === 'reveal' && m);
  if (m && picker.phase === 'reveal') {
    const r = mark(m.id);
    fillPoster($('#r-poster'), m, 'w342');
    $('#r-title').textContent = m.title;
    $('#r-year').textContent = m.year || '';
    $('#r-year').hidden = !m.year;
    $('#r-note').hidden = !r.note;
    $('#r-note').textContent = r.note ? `“${r.note}”` : '';
    $('#r-watch').textContent = store.tonight === m.id ? "Saved as tonight's pick" : "Let's watch it!";
    $('#r-mark').textContent = r.seen ? 'Watched' : 'Mark as watched';
  }
}

function spin() {
  const pool = poolList(ui.pool);
  if (!pool.length || picker.phase === 'popping') return;
  buzz();
  track('popcorn_spin', { pool: ui.pool });
  const choose = () => {
    let opts = pool.filter(m => m.id !== picker.pickId);
    if (!opts.length) opts = pool;
    picker.pickId = opts[Math.floor(Math.random() * opts.length)].id;
    picker.phase = 'reveal';
    els.kernels.textContent = '';
    renderPicker();
    leaves(26);
    els.reveal.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  };
  if (reducedMotion()) { choose(); return; }
  picker.phase = 'popping';
  els.kernels.textContent = '';
  for (let i = 0; i < 12; i++) {
    const ang = ((-160 + (140 / 11) * i) * Math.PI) / 180;
    const d = 70 + ((i * 37) % 50);
    const k = document.createElement('span');
    k.style.setProperty('--dx', `${Math.cos(ang) * d}px`);
    k.style.setProperty('--dy', `${Math.sin(ang) * d}px`);
    k.style.animationDelay = `${(i % 6) * 0.11}s`;
    els.kernels.append(k);
  }
  renderPicker();
  clearTimeout(picker.timer);
  picker.timer = setTimeout(choose, POP_MS);
}

function setPool(pool) {
  ui.pool = pool;
  saveUi();
  if (picker.phase !== 'popping') picker.phase = 'idle';
  renderPicker();
}

// ---------- stats ----------

function renderStats() {
  const total = movies.length;
  const watched = movies.filter(m => mark(m.id).seen);
  const pct = total ? watched.length / total : 0;
  const C = 2 * Math.PI * 48;
  $('#ring-fg').style.strokeDasharray = `${C * pct} ${C}`;
  $('#ring-pct').textContent = pct > 0 && pct < 0.01 ? '<1%' : `${Math.round(pct * 100)}%`;
  $('#ring-count').textContent = `${watched.length} of ${total} watched`;
  $('#ring-sub').textContent = toGo(total - watched.length);

  const rated = watched.filter(m => mark(m.id).rating);
  $('#t-watched').textContent = watched.length;
  $('#t-avg').textContent = rated.length ? (rated.reduce((a, m) => a + mark(m.id).rating, 0) / rated.length).toFixed(1) : '–';

  const dec = {};
  for (const m of movies) {
    if (!m.year) continue;
    const k = Math.floor(m.year / 10) * 10;
    const d = (dec[k] ||= { t: 0, w: 0, r: 0, rn: 0 });
    d.t++;
    const r = mark(m.id);
    if (r.seen) {
      d.w++;
      if (r.rating) { d.r += r.rating; d.rn++; }
    }
  }
  const keys = Object.keys(dec).map(Number).sort((a, b) => a - b);
  const maxT = Math.max(1, ...keys.map(k => dec[k].t));
  let fave = null;
  for (const k of keys) {
    const d = dec[k];
    if (!d.w) continue;
    const score = d.w * 10 + (d.rn ? d.r / d.rn : 0);
    if (!fave || score > fave.score) fave = { k, score };
  }
  $('#t-decade').textContent = fave ? `’${String(fave.k).slice(2)}s` : '–';

  const box = $('#decades');
  box.textContent = '';
  for (const k of keys) {
    const d = dec[k];
    const row = document.createElement('div');
    row.className = 'decade';
    row.innerHTML = '<span class="decade-label"></span><div class="decade-bar"><i class="t"></i><i class="w"></i></div><span class="decade-ratio"></span>';
    row.firstChild.textContent = `${k}s`;
    $('.t', row).style.width = `${(d.t / maxT) * 100}%`;
    $('.w', row).style.width = `${(d.w / maxT) * 100}%`;
    row.lastChild.textContent = `${d.w}/${d.t}`;
    row.setAttribute('role', 'img');
    row.setAttribute('aria-label', `${k}s: ${d.w} of ${d.t} watched`);
    box.append(row);
  }

  const top = [...rated]
    .sort((a, b) => mark(b.id).rating - mark(a.id).rating || (mark(b.id).date || '').localeCompare(mark(a.id).date || ''))
    .slice(0, 5);
  const ol = $('#top');
  ol.textContent = '';
  top.forEach((m, i) => {
    const li = document.createElement('li');
    li.innerHTML = '<span class="top-rank"></span><span><span class="top-title"></span> <span class="top-year"></span></span><span class="top-stars" role="img"></span>';
    $('.top-rank', li).textContent = i + 1;
    $('.top-title', li).textContent = m.title;
    $('.top-year', li).textContent = m.year || '';
    const n = mark(m.id).rating;
    $('.top-stars', li).textContent = '★'.repeat(n);
    $('.top-stars', li).setAttribute('aria-label', plural(n, 'star'));
    ol.append(li);
  });
  $('#top-empty').hidden = top.length > 0;
}

// ---------- movie sheet (open / edit / add) ----------

let editing = null; // { mode: 'add' } | { mode: 'edit', id, draft }

function openSheet(mode, id) {
  const m = id && byId.get(id);
  if (mode === 'edit' && !m) return;
  const custom = mode === 'add' || m?.custom;
  editing = { mode, id, draft: m ? { ...mark(m.id) } : null };
  $('#s-title').textContent = mode === 'add' ? 'Add a movie' : m.title;
  $('#s-year').hidden = mode === 'add' || !m.year;
  $('#s-year').textContent = m?.year || '';
  const link = $('#s-link');
  link.hidden = !(m?.wiki || m?.tmdb);
  if (m?.wiki) {
    link.href = `https://en.wikipedia.org/wiki/${encodeURIComponent(m.wiki.replace(/ /g, '_'))}`;
    link.textContent = 'Read on Wikipedia';
  } else if (m?.tmdb) {
    link.href = `https://www.themoviedb.org/${m.tmdb.type}/${m.tmdb.id}`;
    link.textContent = 'More on TMDB';
  }
  fillPoster($('#s-poster'), m, 'w342');
  for (const f of ['#s-toggles', '#f-rating', '#f-note']) $(f).hidden = mode === 'add';
  $('#f-title').hidden = !custom;
  $('#f-year').hidden = !custom;
  $('#s-in-title').value = m?.custom ? m.title : '';
  $('#s-in-year').value = m?.custom && m.year ? m.year : '';
  $('#s-in-note').value = editing.draft?.note || '';
  $('#s-in-date').max = today();
  $('#s-remove').hidden = !(mode === 'edit' && m?.custom);
  syncSheet();
  els.sheet.showModal();
  // focus the heading, not the first field, so no keyboard or date picker pops up uninvited
  (mode === 'add' ? $('#s-in-title') : $('#s-title')).focus();
}

function syncSheet() {
  const d = editing?.draft;
  if (!d) { $('#f-date').hidden = true; return; }
  $('#s-watched').setAttribute('aria-pressed', String(d.seen));
  $('#s-fav').setAttribute('aria-pressed', String(d.fav));
  $('#f-date').hidden = !d.seen;
  $('#s-in-date').value = d.date || '';
  paintStars($('#s-rating'), d.rating);
}

function buildSheetStars() {
  const box = $('#s-rating');
  mountStars(box);
  box.addEventListener('click', e => {
    const b = e.target.closest('button');
    const d = editing?.draft;
    if (!b || !d) return;
    const n = Number(b.dataset.star);
    d.rating = d.rating === n ? 0 : n;
    buzz();
    syncSheet();
    if (d.rating) bump(b);
  });
  box.addEventListener('keydown', starKeys);
}

function saveSheet() {
  if (!editing) return;
  const { mode, id, draft } = editing;
  const m = id && byId.get(id);
  const custom = mode === 'add' || m?.custom;
  if (custom) {
    const title = $('#s-in-title').value.trim();
    if (!title) {
      toast('Add a title first');
      $('#s-in-title').focus();
      return;
    }
    const y = parseInt($('#s-in-year').value, 10);
    const year = y > 1800 && y < 2200 ? y : null;
    const key = searchKey(title);
    const dupe = movies.find(x => x !== m && x.searchKey === key && (!year || !x.year || x.year === year));
    if (dupe) {
      toast('That one is already on the list');
      return;
    }
    if (mode === 'add') {
      const nm = prepare({ id: `u-${Date.now().toString(36)}`, title, year, custom: true });
      store.custom.push(nm);
      rebuildMovies();
      els.list.append(buildCard(nm));
      toast('Added to the list');
      track('add_movie');
    } else {
      prepare(Object.assign(m, { title, year })); // m is the object held in store.custom
      fillCard(m);
    }
    save();
    lastOrder = '';
  }
  if (m && draft) {
    const before = watchedCount();
    const date = $('#s-in-date').value;
    draft.note = $('#s-in-note').value.trim();
    if (draft.seen) draft.date = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : draft.date || today();
    else draft.date = null;
    const cur = mark(m.id);
    if (['seen', 'date', 'rating', 'fav', 'note'].some(k => draft[k] !== cur[k])) {
      setMark(m.id, draft);
      if (draft.seen) askPersist();
      celebrate(before, watchedCount());
    }
  }
  els.sheet.close();
  updateStats();
  applyView();
  if (!els.screens.picker.hidden) renderPicker();
}

function removeCustom() {
  const id = editing?.id;
  const m = id && byId.get(id);
  if (!m?.custom) return;
  store.custom = store.custom.filter(x => x.id !== id);
  delete store.items[id];
  if (store.tonight === id) store.tonight = null;
  if (picker.pickId === id) { picker.pickId = null; picker.phase = 'idle'; }
  save();
  cards.get(id)?.remove();
  cards.delete(id);
  rebuildMovies();
  lastOrder = '';
  els.sheet.close();
  updateStats();
  applyView();
  toast('Removed from the list');
}

// ---------- backup ----------

async function exportBackup() {
  const data = { app: 'stars-hollow-movie-club', version: 1, saved: new Date().toISOString(), items: store.items, custom: store.custom.map(({ id, title, year }) => ({ id, title, year })), tonight: store.tonight };
  const name = `movie-club-backup-${today()}.json`;
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  // Phones get the share sheet (Save to Files, Drive, Messages); elsewhere a download.
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Movie Club backup' });
      toast('Backup saved');
      track('backup_save');
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Backup saved');
  track('backup_save');
}

let pending = null;
async function readBackup(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    data = null;
  }
  if (data?.app !== 'stars-hollow-movie-club' || !data.items || typeof data.items !== 'object') {
    toast('That file isn’t a Movie Club backup');
    return;
  }
  pending = { items: cleanItems(data.items), custom: cleanCustom(data.custom), tonight: typeof data.tonight === 'string' ? data.tonight : null };
  const seen = Object.values(pending.items).filter(r => r.seen).length;
  const when = typeof data.saved === 'string' && !Number.isNaN(Date.parse(data.saved))
    ? ` from ${new Date(data.saved).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
    : '';
  $('#i-summary').textContent = `This backup${when} has ${plural(seen, 'watched movie')}. Combine keeps the newest version of each movie. Replace swaps this phone’s list for the backup.`;
  els.importDlg.showModal();
}

function applyImport(mode) {
  if (!pending) return;
  if (mode === 'replace') {
    store.items = pending.items;
    store.custom = pending.custom;
    store.tonight = pending.tonight;
  } else {
    for (const [id, r] of Object.entries(pending.items)) {
      if (!store.items[id] || r.t >= store.items[id].t) store.items[id] = r;
    }
    const have = new Set(store.custom.map(c => c.id));
    store.custom.push(...pending.custom.filter(c => !have.has(c.id)));
    store.tonight ||= pending.tonight;
  }
  pending = null;
  save();
  els.importDlg.close();
  renderAll();
  toast(`Backup restored — ${plural(watchedCount(), 'movie')} watched`);
  track('backup_restore', { mode });
}

async function resetAll() {
  const ok = await confirmSheet({
    title: 'Clear all marks?',
    text: 'Every tick, rating, note and favorite on this phone will be gone; movies you added stay. There is no undo, so save a backup first if you might want them back.',
    button: 'Clear everything',
  });
  if (!ok) return;
  store.items = {};
  store.tonight = null;
  save();
  renderAll();
  toast('All marks cleared');
  track('clear_marks');
}

// ---------- confirm sheet ----------

// Resolves true when the confirm button closed the sheet (its form has method="dialog").
function confirmSheet({ title, text, button }) {
  const dlg = els.confirmDlg;
  $('#c-title').textContent = title;
  $('#c-text').textContent = text;
  $('#c-ok').textContent = button;
  dlg.returnValue = '';
  dlg.showModal();
  $('#c-cancel').focus();
  return new Promise(resolve => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
}

// ---------- toast & leaves ----------

let toastTimer;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('is-on'), 2400);
}

function leaves(count) {
  if (reducedMotion()) return;
  const box = document.createElement('div');
  box.className = 'leaves';
  box.setAttribute('aria-hidden', 'true');
  let longest = 0;
  for (let i = 0; i < count; i++) {
    const sz = 10 + ((i * 7) % 12);
    const star = i % 5 === 0;
    const dur = 2.4 + (i % 5) * 0.35;
    const delay = (i % 8) * 0.09;
    longest = Math.max(longest, dur + delay);
    const s = document.createElement('span');
    Object.assign(s.style, {
      left: `${(i * 37 + Math.random() * 20) % 100}%`,
      width: `${sz}px`,
      height: `${sz}px`,
      background: LEAF_COLORS[i % LEAF_COLORS.length],
      borderRadius: star ? '50%' : '0 100% 0 100%',
    });
    s.style.setProperty('--dx', `${((i * 53) % 120) - 60}px`);
    s.style.setProperty('--rot', `${((i * 97) % 720) - 360}deg`);
    s.style.setProperty('--dur', `${dur}s`);
    s.style.setProperty('--delay', `${delay}s`);
    box.append(s);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), longest * 1000 + 200);
}

// ---------- theme ----------

const systemLate = matchMedia('(prefers-color-scheme: dark)');
const isLate = () => (ui.theme ? ui.theme === 'late' : systemLate.matches);

function applyTheme() {
  const late = isLate();
  if (ui.theme) document.documentElement.dataset.theme = ui.theme;
  else delete document.documentElement.dataset.theme;
  document.documentElement.classList.toggle('is-late', late);
  $('#theme-label').textContent = late ? 'Morning' : 'Late night';
  $('#theme-btn').setAttribute('aria-label', late ? 'Switch to the morning theme' : 'Switch to the late night theme');
  $('meta[name="theme-color"]').content = late ? '#2B191C' : '#F6EDE0';
}

// ---------- wiring ----------

function renderAll() {
  rebuildMovies();
  // drop cards for movies that no longer exist, add cards for new ones
  for (const [id, li] of cards) if (!byId.has(id)) { li.remove(); cards.delete(id); }
  for (const m of movies) if (cards.has(m.id)) fillCard(m); else els.list.append(buildCard(m));
  lastOrder = '';
  updateStats();
  applyView();
  if (!els.screens.picker.hidden) renderPicker();
}

function wire() {
  els.list.addEventListener('click', e => {
    const li = e.target.closest('.movie');
    if (!li) return;
    const id = li.dataset.id;
    const star = e.target.closest('.stars button');
    if (star) setRating(id, Number(star.dataset.star), star);
    else if (e.target.closest('.check')) toggleWatched(id);
    else if (e.target.closest('.fav')) toggleFav(id, e.target.closest('.fav'));
    else if (e.target.closest('.edit, .movie-open')) openSheet('edit', id);
  });
  els.list.addEventListener('keydown', e => {
    if (e.target.classList.contains('note') && e.key === 'Enter') e.target.blur();
    else starKeys(e);
  });
  els.list.addEventListener('input', e => {
    if (!e.target.classList.contains('note')) return;
    const id = e.target.closest('.movie').dataset.id;
    clearTimeout(noteTimers.get(id));
    noteTimers.set(id, setTimeout(() => saveNote(id, e.target.value), 500));
  });
  els.list.addEventListener('focusout', e => {
    if (e.target.classList.contains('note')) saveNote(e.target.closest('.movie').dataset.id, e.target.value);
  });
  els.q.addEventListener('input', () => { ui.q = els.q.value; applyView(false); });
  els.q.addEventListener('keydown', e => { if (e.key === 'Enter') els.q.blur(); });
  els.chips.forEach(c => c.addEventListener('click', () => {
    ui.filter = c.dataset.filter;
    els.chips.forEach(x => x.setAttribute('aria-pressed', String(x === c)));
    saveUi();
    applyView();
  }));
  els.sorts.forEach(s => s.addEventListener('click', () => {
    ui.sort = s.dataset.sort;
    els.sorts.forEach(x => x.setAttribute('aria-pressed', String(x === s)));
    saveUi();
    applyView();
  }));
  $('#add-btn').addEventListener('click', () => openSheet('add'));
  els.tabs.forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));

  $('#theme-btn').addEventListener('click', () => {
    ui.theme = isLate() ? 'light' : 'late';
    saveUi();
    applyTheme();
  });
  systemLate.addEventListener('change', applyTheme);

  // movie night
  $$('.pool').forEach(p => p.addEventListener('click', () => setPool(p.dataset.pool)));
  els.spin.addEventListener('click', spin);
  $('#r-again').addEventListener('click', spin);
  $('#r-watch').addEventListener('click', () => {
    if (!picker.pickId) return;
    store.tonight = picker.pickId;
    save();
    renderPicker();
    toast("Tonight's pick is set");
    track('tonight_pick');
  });
  $('#r-mark').addEventListener('click', () => {
    const id = picker.pickId;
    if (!id || mark(id).seen) return;
    toggleWatched(id);
    renderPicker();
    toast('Marked as watched');
  });
  $('#tonight-clear').addEventListener('click', () => {
    store.tonight = null;
    save();
    renderPicker();
  });

  // sheets
  $('#sheet-form').addEventListener('submit', e => { e.preventDefault(); saveSheet(); });
  $('#s-cancel').addEventListener('click', () => els.sheet.close());
  $('#s-remove').addEventListener('click', removeCustom);
  $('#s-watched').addEventListener('click', () => {
    const d = editing?.draft;
    if (!d) return;
    d.seen = !d.seen;
    d.date = d.seen ? d.date || today() : null;
    buzz();
    syncSheet();
  });
  $('#s-fav').addEventListener('click', () => {
    const d = editing?.draft;
    if (!d) return;
    d.fav = !d.fav;
    buzz();
    syncSheet();
    if (d.fav) bump($('#s-fav'));
  });
  $('#s-in-date').addEventListener('change', e => { if (editing?.draft && e.target.value) editing.draft.date = e.target.value; });
  $('#s-in-year').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); });
  els.sheet.addEventListener('close', () => { editing = null; });
  for (const d of [els.sheet, els.importDlg, els.confirmDlg]) {
    d.addEventListener('click', e => { if (e.target === d) d.close(); }); // tap on the dimmed backdrop
  }

  // backup
  $('#export-btn').addEventListener('click', exportBackup);
  $('#import-btn').addEventListener('click', () => els.importFile.click());
  els.importFile.addEventListener('change', () => {
    const f = els.importFile.files?.[0];
    els.importFile.value = '';
    if (f) readBackup(f);
  });
  $('#i-merge').addEventListener('click', () => applyImport('merge'));
  $('#i-replace').addEventListener('click', () => applyImport('replace'));
  $('#i-cancel').addEventListener('click', () => els.importDlg.close());
  els.importDlg.addEventListener('close', () => { pending = null; });
  $('#reset-btn').addEventListener('click', resetAll);

  // another tab changed the data
  addEventListener('storage', e => {
    if (e.key !== STORE_KEY) return;
    Object.assign(store, loadStore());
    renderAll();
  });
}

async function init() {
  trackTab(ui.tab);
  applyTheme();
  buildSheetStars();
  wire();
  els.chips.forEach(c => c.setAttribute('aria-pressed', String(c.dataset.filter === ui.filter)));
  els.sorts.forEach(s => s.setAttribute('aria-pressed', String(s.dataset.sort === ui.sort)));
  try {
    const res = await fetch('data/movies.json');
    if (!res.ok) throw new Error(res.status);
    poster = (await res.json()).map(prepare);
  } catch {
    els.loadError.hidden = false;
    return;
  }
  rebuildMovies();
  $('#credit-wiki').hidden = !poster.some(m => m.img);
  $('#credit-tmdb').hidden = !poster.some(m => m.poster);
  const frag = document.createDocumentFragment();
  movies.forEach(m => frag.append(buildCard(m)));
  els.list.append(frag);
  updateStats();
  applyView();
}

init();

if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
