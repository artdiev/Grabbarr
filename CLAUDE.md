# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Grabbarr is a Chrome Manifest V3 browser extension that adds a "grab" button to movie/TV pages on IMDb, TMDb, Rotten Tomatoes, and Kinopoisk. Clicking it resolves the title and adds it to a self-hosted Radarr (movies) or Sonarr (TV) instance. The toolbar popup shows a history of grabbed items with live status pulled from the `*arr` APIs; a full options page holds API keys, per-site toggles, and default quality-profile/root-folder selection.

## Commands

- `npm run dev` — Vite dev server with HMR (`@crxjs/vite-plugin`). Loads the unpacked extension from `dist/` while rebuilding on change.
- `npm run build` — `tsc --noEmit` type-check then `vite build` → emits a loadable `dist/`. crxjs generates `dist/manifest.json` from `src/manifest.config.ts` and content-hashes all bundles, so **never hand-edit `dist/`**.

No test or lint setup. To load: build (or `dev`), then `chrome://extensions` → Developer mode → "Load unpacked" → select `dist/`.

## Architecture

Built with Vite + TypeScript + Tailwind v4 (`@tailwindcss/vite`), **no UI framework** — the popup/options render via the tiny `el()` builder in `src/shared/dom.ts`. The manifest is defined in TypeScript at `src/manifest.config.ts` (crxjs `defineManifest`), which is the single source of truth for permissions, content-script matches, and entry points.

Four runtimes, all under `src/`:

- **`background/`** — service worker; the **only** place that talks to Radarr/Sonarr. `index.ts` is a typed message router (`GRAB`, `TEST_CONN`, `REFRESH_STATUS`). `arr-client.ts` wraps the shared v3 API (lookup/add/status/profiles/rootfolders/ping). `resolver.ts` turns a page's `MediaContext` into a lookup term and picks the best match.
- **`content/`** — injected into media pages. `adapters/` holds one `SiteAdapter` per site (imdb, tmdb, rottentomatoes, kinopoisk) plus `registry.ts`; `index.ts` picks the adapter for the URL, retries detection on a schedule (SPAs load late) and across SPA navigations via a `MutationObserver`, then `inject.ts` builds the button and sends the `GRAB` message. `overrides.ts` (`applyOverrides`) merges a user-defined `SiteOverride` over adapter output before injection; `picker.ts` is the in-page element picker (Shadow DOM) launched from the popup or an auto-prompt.
- **`popup/`** — main UI. Renders cached history instantly, then fires `REFRESH_STATUS` and updates status pills in place.
- **`options/`** — keys, per-site toggles, and "Test connection" which requests host permission for the URL then populates profile/root-folder dropdowns.
- **`shared/`** — `types.ts` (domain types; `APP_FOR` maps movie→radarr, tv→sonarr), `messages.ts` (typed `sendMessage` contract), `storage.ts`, `dom.ts`, `status-ui.ts`.

### Key cross-cutting details

- **ID resolution strategy** (`resolver.ts`): prefer the IMDb id scraped by the adapter (`term=imdb:tt...`, accepted by both Radarr `/movie/lookup` and Sonarr `/series/lookup`); fall back to `title year` search and pick by exact-year match. RT/Kinopoisk usually only yield title+year, so the resolved title is stored in history for the user to verify.
- **Adding a site** = add a `SiteAdapter` in `content/adapters/`, register it in `registry.ts`, and add the URL pattern to `SITE_MATCHES` in `manifest.config.ts`. Each adapter localizes that site's fragile DOM/URL selectors, so a site change breaks exactly one file (the usual cause of "button doesn't appear").
- **Storage split** (`shared/storage.ts`): config (keys, per-site toggles, default profile/folder) in `chrome.storage.sync`; history (capped at 200, newest-first, deduped by `app:arrId` key) in `chrome.storage.local`. `getConfig` defensively merges over `DEFAULT_CONFIG`.
- **`*arr` host permissions** (MV3): self-hosted Radarr/Sonarr live at arbitrary origins, so the manifest ships `optional_host_permissions: ['*://*/*']` and the options page calls `chrome.permissions.request` for the exact configured origin (must be in a click handler — a user gesture).
- **Status model** (`arr-client.ts`): movie → `hasFile` ⇒ downloaded, else queue check ⇒ downloading, else missing; series → episode-file stats ⇒ downloaded/partial, queue ⇒ downloading, else missing. Refreshed on popup open only (no background polling).
- **Button reflects library status**: on injection the content button fires `CHECK_STATUS`; the background's `findExisting` (`resolver.ts`) does one lookup and treats a result `id > 0` as already-added, then derives status. The button then renders a green SVG checkmark (`data-state="grabbed"`, white background) or an amber check (`downloading`) instead of the default indigo "Grab" state — the default color is deliberately non-green so the green check reads as a distinct state. `reflectExisting` only overrides the `idle` state, never an in-flight/just-grabbed button.
- **Grab/remove toggle + removal**: once an item is present, the in-page button is a toggle — hovering arms a red 2-click remove that reads "Remove" → "Confirm?" (`data-remove="armed"`); the popup history row mirrors this with a hover-armed red trash control showing the same "Remove" → "Confirm?" (the status moved into the metadata line: `‹status› · ‹site› · ‹app›`). The click count is the shared `REMOVE_CLICKS` (`shared/types.ts`). Both send the `REMOVE { app, arrId }` message; `handleRemove` (`background/index.ts`) calls `removeMovie`/`removeSeries` with **`deleteFiles=true`** (full undo) and prunes the history entry (`removeHistoryEntry`). The present button can't use the `disabled` attribute (disabled buttons don't fire hover/click), so `inject.ts` keeps it enabled and dispatches grab-vs-remove inside one click handler by current state.
- **Button sizing/animation**: the in-page button is fixed-width — `lockSize` (`inject.ts`) measures the widest possible label across all states once and pins `width`/`height`, then `gb-locked` makes the inner content absolutely positioned so state changes cross-slide (`swap`, Web Animations API) without resizing. SVG icons (`checkSvg`/`trashSvg`) live in `shared/icons.ts`, shared by the content button and the popup remove control.
- **Button style isolation**: the in-page button renders inside its own **Shadow DOM** (host `span#grabbarr-button`, all styling in `BUTTON_CSS` within the shadow), so host-page CSS (notably Rotten Tomatoes' generic `button {}`/slot styles) can't override it. The host's box is locked with inline `all:initial` styles so even `::slotted(...)` rules from a host web component can't pollute it. There is no longer any document-level button stylesheet in `content/index.ts`.
- **web_accessible_resources**: the content-script button loads `icons/icon32.png` via `chrome.runtime.getURL`, so that icon is explicitly declared web-accessible in `manifest.config.ts` (crxjs only auto-registers JS imports). The icon appearing in both the manifest icon set and WAR makes the build print a harmless "overwrites a previously emitted file" warning.

### Detection overrides (element picker)

When a site changes its markup and an adapter's selectors break, users can override detection per-site instead of waiting for a code fix:
- **`SiteOverride`** (`shared/types.ts`, stored in `config.overrides`, synced) holds CSS selectors for `title`/`year`/`anchor` plus a manual `mediaType`. `applyOverrides` (`content/overrides.ts`) composes detection field-by-field with priority **override → adapter → Open Graph** (`content/og.ts`: `og:title` cleaned of the site-name/`(year)` suffix, `og:type` mapped to movie/tv). All `querySelector`s are try/caught, so a grabbable item can come from any layer even when `adapter.detect()` returns `null`. Anchor is still adapter/override-only (OG can't supply a DOM anchor).
- **Picker** (`content/picker.ts`): a Shadow-DOM panel (page CSS can't touch it) that highlights elements on hover and captures a selector on click via **`@medv/finder`**, configured to prefer stable attributes (`data-testid`, `data-qa`, `itemprop`, `slot`, `role`) and skip content-specific ids / hashed classes so the selector generalizes across all of a site's pages.
- **Launch paths**: the popup queries the active tab with the tab-directed `GET_PAGE_STATE` message and shows "Fix detection on this page" → sends `ACTIVATE_PICKER`; the content script also shows an in-page "Set up" pill when detection fails after the retry loop. These tab-directed messages (`shared/messages.ts`, `sendToTab`) go popup→content via `chrome.tabs.sendMessage` (needs the `activeTab` permission), separate from the background `sendMessage` channel.
- Options has a "Custom detection" section listing customized sites with a per-site **Reset** (`clearOverride`).
