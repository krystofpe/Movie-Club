# Stars Hollow Movie Club

A phone app for the Stars Hollow Movie Club poster, styled after the *Movie Night Nook* design. It has three tabs:

- **Checklist:** all 463 poster movies. Tick off what you've watched, rate it from one to five stars, heart your favorites, and jot a little note on each card. **Add** puts movies that aren't on the poster on the list.
- **Movie Night:** the popcorn bucket picks a movie from *To watch*, *Favorites* or *Everything*, and can save it as tonight's pick.
- **Stats:** progress, average rating, favorite decade, watched-by-decade bars, a top-5, and backup buttons.

The **Late night** button switches to a dim burgundy theme. Until it's tapped, the app follows the phone's dark mode.

It's a static web app (plain HTML, CSS and JavaScript, no build step). It installs to the home screen and works offline. Everything you mark is stored on the phone itself. There is no account and no server. The live site counts visits with Google Analytics (see *Analytics*), but no movie titles or notes are sent.

## Run it locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Use a local server rather than opening `index.html` directly: the app loads `data/movies.json` with `fetch`, and the offline mode needs `http://localhost` or HTTPS.

## Put it on the phone

1. Publish the folder with GitHub Pages: push to a GitHub repo, then **Settings → Pages → Deploy from a branch → `main` / root**. The free plan needs a public repo. Only the movie list is published; her marks never leave the phone.
2. Open the Pages URL on the phone.
   - **iPhone:** Safari → Share → **Add to Home Screen**. It has to be Safari.
   - **Android:** Chrome → ⋮ → **Install app** (or **Add to Home screen**).
3. Open it from the home screen icon. It runs full screen and works offline.

## Backups

Marks, notes, favorites and added movies live in the browser storage of that one phone. Clearing Safari's website data, or switching phones, erases them. **Stats → Keep it safe → Save a backup** writes a small `movie-club-backup-YYYY-MM-DD.json` file; on a phone this opens the share sheet, so it can go to Files, iCloud Drive, Google Drive or a message. **Restore a backup** reads it back. It can either combine with the phone's current list (the newest version of each movie wins) or replace it.

### Starting from a list

If some movies were already watched before the app existed (say, colored in on the paper poster), there is no need to tap them one by one. Put them in a text file, one per line, with an optional star rating, date, note and `fav` after a `|`:

```
Rocky | 4
The Lake House | 5 | 2024-11-02 | with popcorn | fav
Dumbo
```

Then `node scripts/make-backup.mjs watched.txt` writes a `movie-club-backup-YYYY-MM-DD.json` for those movies and lists any title it couldn't find on the poster. Send the file to the phone and restore it with **Combine with this phone**: anything already marked on the phone is kept, and only the movies from the file are added. `watched.txt` and the generated backups are ignored by git, so the list never ends up in the public repo.

On iPhone, Safari can delete storage for sites that aren't used for several weeks. A home-screen app is exempt, which is another reason to install it rather than use it in a browser tab.

## Editing a movie

Tap a movie's title (or the pencil) to open it. The sheet shows the poster, and that's where everything about the movie can be changed: **Watched** and the date watched, **Favorite**, the star rating and the note. **Save** keeps the changes; **Cancel** throws them away. The same things (except the date) can also be changed straight on the card.

For a movie she added with **Add**, the sheet also edits its title and year, and **Remove** deletes it. The poster's own movies can't be renamed or removed in the app: their titles come from `data/titles.txt` (see *Changing the list*).

## Posters

Posters come from each film's English Wikipedia article. No key or account is needed:

```sh
node scripts/fetch-posters-wikipedia.mjs            # movies without a poster yet
node scripts/fetch-posters-wikipedia.mjs --refresh  # look everything up again
```

The script tries the articles "Title (Year film)", "Title (film)" and "Title". It keeps the first one whose short description says it's a film or show, and takes that article's lead image. 445 of the 463 movies have a poster. The other 18 are remakes with no year to choose between them, TV shows whose article has no image, or obscure titles. The script lists them, and lists any match whose year it couldn't confirm. To fix a wrong or missing one, name the exact article in `data/overrides.json`:

```json
{
  "King Kong": { "wiki": "King Kong (1933 film)" },
  "Suspense": { "wiki": false }
}
```

Posters show only when a movie is opened and on the Movie Night result, not on the checklist cards. Each one is saved for offline use the first time it's shown.

### Years and TMDB (optional)

444 movies already have a year in `data/titles.txt`. `scripts/enrich-tmdb.mjs` turns that file into `data/movies.json`, so run it after editing the list (no key needed for that). With a free [TMDB](https://www.themoviedb.org) key (Settings → API) it also adds TMDB years and posters:

```sh
TMDB_API_KEY=your_key_here node scripts/enrich-tmdb.mjs
```

The same `data/overrides.json` holds TMDB fixes: `"type": "tv"`, `"query"`, `"year"`, `"tmdbId"` or `"skip": true`. Wikipedia posters are kept when the TMDB script runs, and are used in preference to TMDB ones. If you switch to TMDB posters, the app shows TMDB's required attribution on the Stats tab automatically.

## Changing the list

Edit `data/titles.txt` (one title per line, optional `(Year)` at the end), then run `node scripts/enrich-tmdb.mjs` and `node scripts/fetch-posters-wikipedia.mjs`. Each movie's saved marks are keyed by an id made from its title. Fixing a typo in a title therefore resets that one movie's mark, and nothing else.

## Analytics

The live site sends usage to Google Analytics 4 (property *Movie Club*, measurement ID `G-KQB9ENWBYL`, set in `index.html`). It runs only on `krystofpe.github.io`, so a local copy sends nothing. The tabs don't change the URL, so `app.js` sends a page view for each tab: *Checklist*, *Movie Night* and *Stats*. Events are tagged with the tab they happened on:

| Event | When |
| --- | --- |
| `mark_watched`, `rate_movie` (`rating`), `favorite`, `write_note` | A movie is ticked, rated, hearted or given a note, on its card or in its sheet |
| `popcorn_spin` (`pool`), `tonight_pick` | The popcorn bucket picks a movie, and it's saved as tonight's pick |
| `add_movie` | A movie that isn't on the poster is added |
| `backup_save`, `backup_restore` (`mode`), `clear_marks` | The buttons under *Keep it safe* |

The events say what was done, never to which movie, and never carry note text. Visits made offline aren't counted. To see `rating`, `pool` or `mode` in the reports, register them in GA under **Admin → Custom definitions** (Czech UI: **Správce → Vlastní definice**).

## Files

| Path | What it is |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | The app |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and home-screen install |
| `fonts/` | Playfair Display (headings), Nunito (text) and Caveat (handwriting), all under the SIL Open Font License |
| `data/titles.txt` | The poster's movies, transcribed from the PDF |
| `data/overrides.json` | Manual fixes for Wikipedia and TMDB matching |
| `data/movies.json` | Generated by the two scripts in `scripts/`; the app reads this |
| `scripts/make-backup.mjs` | Turns a plain list of watched titles into a backup file the app can restore |

After changing app files, bump `APP_CACHE` in `sw.js` (e.g. `smc-app-v3` → `smc-app-v4`) so installed copies pick up the new version on their next launch.

## Credits

Movie list from the *Stars Hollow Movie Club* poster by [Veronika Tralo](https://veronikatralo.com). Release years cross-checked against Laura Parker-Saladino's [Letterboxd list](https://letterboxd.com/lesaladino/list/every-movie-referenced-watched-in-gilmore/) of movies referenced in *Gilmore Girls*. Poster images from Wikipedia; each belongs to its film's studio or distributor.
