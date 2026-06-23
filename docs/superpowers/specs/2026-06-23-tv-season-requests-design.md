# Grabbarr — TV Season Requests (design)

Date: 2026-06-23
Status: Approved (pending spec review)

## Problem

Grabbing a TV show currently adds the **whole series** to Sonarr (`addSeries` posts
`monitored: true`, `addOptions: { monitor: 'all', searchForMissingEpisodes: true }`).
There is no way to request a single season. `MediaContext` has no season concept and
the adapters only classify movie-vs-TV.

Goal: let the user request a specific season (or all) when grabbing a TV show, the same
way on every supported site, and manage seasons of a show that's already in Sonarr.

## Decisions (locked with the user)

1. **Season source:** the season list comes from Sonarr's own lookup/series record, not
   the page — so it works uniformly on IMDb/TMDb/RT/Kinopoisk regardless of whether the
   site has a season URL.
2. **Interaction:** pick-on-click. Clicking the grab button on a TV show opens a season
   menu (All seasons / Season 1 / Season 2 / …); the user chooses, then it's requested.
3. **Works added-or-not:** the menu is the primary TV interaction both before and after
   the show is in Sonarr. For an added show it shows which seasons are monitored and lets
   the user request more. **Series removal moves into the menu** (footer action).
4. **Movies unchanged:** movies keep the one-click `GRAB` + hover-arm two-click remove.
5. **Implementation shape:** Approach 1 — the menu is a popover inside the existing
   button's Shadow DOM; `CHECK_STATUS` (already run on page load) returns the season list
   so the menu opens instantly without a per-open fetch.

## Architecture

```
content/inject.ts  ── button (TV = menu trigger) ──► season popover (shadow DOM)
        │ REQUEST_SEASON / CHECK_STATUS / REMOVE           │ row click
        ▼                                                  ▼
background/index.ts ── handleRequestSeason / handleCheck ──► resolver.ts ──► arr-client.ts ──► Sonarr API
```

### Data model & messages (`src/shared/types.ts`, `src/shared/messages.ts`)

```ts
interface SeasonInfo {
  seasonNumber: number;        // 0 = Specials
  monitored: boolean;          // false when the show isn't added yet
  episodeCount?: number;       // aired episodes (when known)
  episodeFileCount?: number;   // downloaded (only when the series is in the library)
}
```

- Extend `CheckStatusResult` with `seasons?: SeasonInfo[]` (TV only).
- New background-directed message:
  ```ts
  interface RequestSeasonMessage { type: 'REQUEST_SEASON'; media: MediaContext; arrId?: number; season: number | 'all'; }
  interface RequestSeasonResult  { ok: boolean; entry?: HistoryEntry; seasons?: SeasonInfo[]; error?: string; }
  ```
- `GRAB` becomes the movie-only path (kept as-is). `REMOVE` is unchanged (used by the
  menu's "Remove series" action and by movies). All TV adds/requests flow through
  `REQUEST_SEASON` (with `season: 'all'` for the whole series).

### Background (`src/background/arr-client.ts`, `resolver.ts`, `index.ts`)

`arr-client.ts` adds:
- `getSeries(cfg, id)` → series record incl. `seasons[]` (monitored + per-season `statistics`).
- `updateSeries(cfg, series)` → `PUT /api/v3/series/{id}`.
- `seasonSearch(cfg, seriesId, seasonNumber)` → `POST /api/v3/command {name:'SeasonSearch', seriesId, seasonNumber}`.

`resolver.ts` adds `resolveAndRequestSeason(cfg, media, season, arrId?)`:
- **Not in library:** add the series. `'all'` → current behavior (`monitor:'all'`,
  `searchForMissingEpisodes`). Season `N` → add with `addOptions.monitor:'none'` and
  `seasons[]` flags so only `N` is `monitored:true`, then `seasonSearch(N)`.
- **In library:** `getSeries` → set season `N` (or all) `monitored:true` → `updateSeries`
  → `seasonSearch(N)` (or whole-series search for `'all'`).
- Returns the refreshed `seasons[]` + the added/updated item (id/title/year/poster).

`index.ts`:
- `handleCheck` (TV): attach `seasons` — from `getSeries` when present (with per-season
  stats), else from the lookup best result (`seasons` = numbers, `monitored:false`).
- New `handleRequestSeason`: config check (`needsConfig: 'sonarr'` when Sonarr unset) →
  `resolveAndRequestSeason` → upsert the history entry → return `{ ok, entry, seasons }`.

### On-page season menu (`src/content/inject.ts`)

Gated on `media.mediaType === 'tv'`; movies are untouched.

- **Button (TV):** not added → "Grab to Sonarr ▾"; added → status pill ("In Sonarr" /
  "Downloaded" ▾, green check). A single click opens the popover (no hover-arm, no
  two-click on the button itself for TV).
- **Popover** (in the button's Shadow DOM, anchored below it):
  - Header: show title.
  - "All seasons" row → requests/monitors everything.
  - One row per season (`Season N`, `Specials` for 0): left = label + state
    ("not added" / "Requested" / progress like `6/10`); right = action — unmonitored
    shows **＋ Request**, monitored shows a check (display-only in v1).
  - Footer: **Remove series** — two-step "Remove → Confirm?" (reuses the existing pattern).
- Data is the cached `CHECK_STATUS` season list (instant). If absent (race) it shows a
  brief loading state and fetches; if Sonarr is unconfigured it shows "Configure Sonarr"
  → opens options.
- Clicking a season (or "All seasons") sends `REQUEST_SEASON`; the row spins, then flips
  to "Requested" with refreshed state, and the button status updates from the result.
- Dismiss on outside-click or Esc; long lists scroll (max-height).

### Status & history

- A TV show remains **one history entry** keyed `sonarr:<arrId>`; requesting more seasons
  updates that entry rather than adding rows.
- `getSeriesStatus` computes from **monitored seasons only**: sum
  `episodeFileCount`/`episodeCount` across seasons where `monitored === true`, then
  downloaded / partial / missing as today (queue check unchanged). A fully-grabbed single
  monitored season then reads "Downloaded" instead of being stuck "Partial".

## Error handling & edge cases

- Sonarr not configured → `needsConfig: 'sonarr'` → options page opens.
- No lookup match → inline error in the menu; nothing added.
- Request failure → row reverts with a brief error tint; series state unchanged.
- Concurrent clicks → in-flight row disabled; duplicate clicks ignored.
- Specials (season 0) → listed as "Specials" (v1 includes it).
- Already-monitored season → display-only in v1 (no un-monitor / no re-search).
- Movies → `GRAB` + hover-arm two-click remove unchanged.
- Overrides / Open Graph / element picker → still only classify `mediaType: 'tv'`; feed
  the same flow. Popover lives in the existing button shadow root, so site CSS can't touch it.

## Out of scope (v1)

- Un-monitoring or re-searching an already-monitored season from the menu.
- Episode-level requests.
- Per-season rows in the popup history (history stays one row per series).
- Season-aware behavior for movies (n/a).

## Affected files

- New: `src/content/season-menu.ts` — the popover (build/render/anchor/dismiss + row
  request actions). Keeps the already-large `inject.ts` focused; the menu is opened from
  `inject.ts` for the TV branch and owns its own DOM/state.
- Modified: `src/shared/types.ts`, `src/shared/messages.ts`, `src/background/arr-client.ts`,
  `src/background/resolver.ts`, `src/background/index.ts`, `src/content/inject.ts`
  (TV button becomes a menu trigger; movie path unchanged), and minor wiring in
  `src/content/index.ts` to pass the cached `CheckStatusResult` seasons to the menu.

## Verification

1. `npm run build` clean; load unpacked.
2. TV show not in Sonarr → click → menu lists seasons (all "not added") → pick "Season 2"
   → Sonarr adds the series with only S2 monitored and runs a SeasonSearch; button shows
   status; popup history shows one row.
3. Reopen the menu on that show → S2 shows "Requested"/progress, others "not added" →
   request "All seasons" → remaining seasons monitored + searched.
4. "Remove series" in the footer (two-click) removes the series (deleteFiles=true) and the
   history row.
5. Movie page → unchanged one-click grab + hover-arm remove.
6. Sonarr unconfigured → menu prompts to configure (opens options).
7. Status: a show with only S2 monitored and fully downloaded reads "Downloaded".
