// Resolves a page's MediaContext to a stable canonical id, then to a precise *arr
// lookup. Strategy: page IMDb/TMDb id → optional TMDb-key resolution → original
// title+year. History identity is the canonical id (tmdb/tvdb/imdb), not the
// mutable *arr internal id.

import { AppConfig, MediaContext, MediaType, SeasonInfo } from '../shared/types';
import {
    AddedItem,
    addMovie,
    addSeries,
    getSeries,
    LookupResult,
    lookupMovie,
    lookupSeries,
    seasonSearch,
    seriesSearch,
    SeriesRecord,
    toSeasonInfo,
    updateSeries,
} from './arr-client';
import { externalIds, searchByTitle } from './tmdb-client';

/** Lowercase, strip diacritics and non-alphanumerics so titles compare cleanly. */
function normalizeTitle(title: string): string {
    return title
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '') // drop combining diacritics
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}

/**
 * Dependency-free title match: equal after normalization, or one strongly
 * contains the other (guards against subtitle/edition differences while still
 * rejecting unrelated titles). Empty strings never match.
 */
function titlesMatch(a: string, b: string): boolean {
    const na = normalizeTitle(a);
    const nb = normalizeTitle(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
    return shorter.length >= 4 && longer.startsWith(shorter);
}

/**
 * Build a precise *arr lookup term, pinning a stable id first:
 *   1. page IMDb id  → `imdb:tt…`
 *   2. page TMDb id (movie) → `tmdb:<id>`
 *   3. TMDb key: map the tmdb id / search the (original) title → imdb/tvdb/tmdb
 *   4. fall back to the original-language title + year
 */
export async function resolveLookupTerm(
    media: MediaContext,
    mediaType: MediaType,
    tmdbKey: string,
): Promise<string> {
    if (media.imdbId) return `imdb:${media.imdbId}`;
    if (media.tmdbId && mediaType === 'movie') return `tmdb:${media.tmdbId}`;

    if (tmdbKey) {
        const ids = media.tmdbId
            ? await externalIds(tmdbKey, media.tmdbId, mediaType)
            : await searchByTitle(tmdbKey, media.title, media.year, mediaType);
        if (ids) {
            if (ids.imdbId) return `imdb:${ids.imdbId}`;
            if (mediaType === 'tv' && ids.tvdbId) return `tvdb:${ids.tvdbId}`;
            if (mediaType === 'movie') return `tmdb:${ids.tmdbId}`;
        }
    }
    return media.year ? `${media.title} ${media.year}` : media.title;
}

/** Did we resolve via a precise external id (vs a fuzzy title term)? */
function resolvedById(media: MediaContext, term: string): boolean {
    return !!media.imdbId || term.startsWith('imdb:') || term.startsWith('tmdb:') || term.startsWith('tvdb:');
}

/** Choose the lookup result that best matches the page. */
function pickBest(results: LookupResult[], media: MediaContext, byId: boolean): LookupResult | undefined {
    if (results.length === 0) return undefined;
    // An id-based term yields the authoritative item first.
    if (byId) return results[0];
    const titleMatches = results.filter((r) => titlesMatch(r.title, media.title));
    if (media.year) {
        const both = titleMatches.find((r) => r.year === media.year);
        if (both) return both;
    }
    if (titleMatches.length > 0) return titleMatches[0];
    return results[0];
}

/** Canonical, mutation-stable history key from the matched *arr item's external ids. */
export function canonicalKey(mediaType: MediaType, result: LookupResult, arrId: number): string {
    if (mediaType === 'movie') {
        if (result.tmdbId) return `tmdb:${result.tmdbId}`;
        if (result.imdbId) return `imdb:${result.imdbId}`;
        return `radarr:${arrId}`;
    }
    if (result.tvdbId) return `tvdb:${result.tvdbId}`;
    if (result.imdbId) return `imdb:${result.imdbId}`;
    if (result.tmdbId) return `tmdb:${result.tmdbId}`;
    return `sonarr:${arrId}`;
}

function posterUrl(item: { images?: { coverType: string; remoteUrl?: string; url?: string }[] }): string | undefined {
    const poster = item.images?.find((i) => i.coverType === 'poster');
    return poster?.remoteUrl ?? poster?.url;
}

function addedFrom(s: { id: number; title: string; year?: number; images?: LookupResult['images'] }): AddedItem {
    return { id: s.id, title: s.title, year: s.year, posterUrl: posterUrl(s) };
}

async function lookup(
    cfg: AppConfig,
    mediaType: MediaType,
    media: MediaContext,
    tmdbKey: string,
): Promise<{ best?: LookupResult; byId: boolean }> {
    const term = await resolveLookupTerm(media, mediaType, tmdbKey);
    const byId = resolvedById(media, term);
    const results = mediaType === 'movie' ? await lookupMovie(cfg, term) : await lookupSeries(cfg, term);
    return { best: pickBest(results, media, byId), byId };
}

export interface ResolveOutcome {
    added: AddedItem;
    key: string;
}

export async function resolveAndAdd(
    cfg: AppConfig,
    mediaType: MediaType,
    media: MediaContext,
    tmdbKey: string,
): Promise<ResolveOutcome> {
    const { best } = await lookup(cfg, mediaType, media, tmdbKey);
    if (!best) throw new Error(`No ${mediaType} match for "${media.title}"`);
    const added = mediaType === 'movie' ? await addMovie(cfg, best) : await addSeries(cfg, best);
    return { added, key: canonicalKey(mediaType, best, added.id) };
}

/**
 * Report whether the item is already in the library. Returns its *arr id and the
 * canonical key, or null. Title-guarded for fuzzy (non-id) matches so an unrelated
 * already-added item is never reported as present.
 */
export async function findExisting(
    cfg: AppConfig,
    mediaType: MediaType,
    media: MediaContext,
    tmdbKey: string,
): Promise<{ arrId: number; key: string } | null> {
    const { best, byId } = await lookup(cfg, mediaType, media, tmdbKey);
    const id = typeof best?.id === 'number' ? best.id : 0;
    if (!best || id <= 0) return null;
    if (!byId && !titlesMatch(best.title, media.title)) return null;
    return { arrId: id, key: canonicalKey(mediaType, best, id) };
}

/**
 * TV view for CHECK_STATUS: resolve the show, report presence + canonical key, and
 * return its season list (per-season stats when added, just numbers otherwise).
 */
export async function inspectTv(
    cfg: AppConfig,
    media: MediaContext,
    tmdbKey: string,
): Promise<{ arrId: number | null; key?: string; seasons: SeasonInfo[]; series?: SeriesRecord }> {
    const { best, byId } = await lookup(cfg, 'tv', media, tmdbKey);
    const id = typeof best?.id === 'number' ? best.id : 0;
    const present = !!best && id > 0 && (byId || titlesMatch(best.title, media.title));
    if (present && best) {
        const series = await getSeries(cfg, id);
        return { arrId: id, key: canonicalKey('tv', best, id), seasons: toSeasonInfo(series.seasons), series };
    }
    // Not in the library: a lookup result's `monitored` flags are just the default
    // add-config, not real state, so force them false (every season is requestable).
    const seasons = toSeasonInfo(best?.seasons).map((s) => ({ ...s, monitored: false }));
    return { arrId: null, key: best ? canonicalKey('tv', best, 0) : undefined, seasons };
}

/**
 * Add or update a series to request `season` (a number, or 'all'), then search.
 * Works whether or not the series is already in the library.
 */
export async function resolveAndRequestSeason(
    cfg: AppConfig,
    media: MediaContext,
    season: number | 'all',
    tmdbKey: string,
    arrId?: number,
): Promise<{ added: AddedItem; seasons: SeasonInfo[]; key: string }> {
    let series: SeriesRecord | undefined;
    if (arrId) {
        series = await getSeries(cfg, arrId);
    } else {
        const { best, byId } = await lookup(cfg, 'tv', media, tmdbKey);
        if (!best) throw new Error(`No series match for "${media.title}"`);
        const existingId = typeof best.id === 'number' ? best.id : 0;
        if (existingId > 0 && (byId || titlesMatch(best.title, media.title))) {
            series = await getSeries(cfg, existingId);
        } else {
            // Not in the library: a fresh add (addSeries handles per-season monitor + search).
            const added = await addSeries(cfg, best, season);
            const created = await getSeries(cfg, added.id);
            return {
                added: addedFrom(created),
                seasons: toSeasonInfo(created.seasons),
                key: canonicalKey('tv', best, added.id),
            };
        }
    }

    // Already in the library: flip monitoring for the requested season(s), then search.
    for (const s of series.seasons) {
        if (season === 'all' || s.seasonNumber === season) s.monitored = true;
    }
    const updated = await updateSeries(cfg, series);
    if (season === 'all') await seriesSearch(cfg, updated.id);
    else await seasonSearch(cfg, updated.id, season);
    return {
        added: addedFrom(updated),
        seasons: toSeasonInfo(updated.seasons),
        key: canonicalKey('tv', updated, updated.id),
    };
}
