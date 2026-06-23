// Turns a page's MediaContext into the *arr lookup term and picks the best match.
// Strategy (per design): prefer the IMDb id (`imdb:tt...`), fall back to title+year.

import { AppConfig, MediaContext, MediaType } from '../shared/types';
import { AddedItem, addMovie, addSeries, LookupResult, lookupMovie, lookupSeries } from './arr-client';

export function lookupTerm(media: MediaContext): string {
    if (media.imdbId) return `imdb:${media.imdbId}`;
    return media.year ? `${media.title} ${media.year}` : media.title;
}

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
    // Require the shorter title to be a meaningful prefix-ish chunk of the longer
    // one, not a tiny incidental substring.
    return shorter.length >= 4 && longer.startsWith(shorter);
}

/** Choose the lookup result that best matches the page. */
function pickBest(results: LookupResult[], media: MediaContext): LookupResult | undefined {
    if (results.length === 0) return undefined;
    // When we resolved by IMDb id the first result is authoritative.
    if (media.imdbId) return results[0];
    // No id: never select on year alone. Prefer a result whose title matches.
    const titleMatches = results.filter((r) => titlesMatch(r.title, media.title));
    if (media.year) {
        // Best case: title AND year both line up.
        const both = titleMatches.find((r) => r.year === media.year);
        if (both) return both;
    }
    // Fall back to the best title match, then the first result.
    if (titleMatches.length > 0) return titleMatches[0];
    return results[0];
}

export interface ResolveOutcome {
    added: AddedItem;
}

export async function resolveAndAdd(
    cfg: AppConfig,
    mediaType: MediaType,
    media: MediaContext,
): Promise<ResolveOutcome> {
    const term = lookupTerm(media);
    const results = mediaType === 'movie' ? await lookupMovie(cfg, term) : await lookupSeries(cfg, term);
    const best = pickBest(results, media);
    if (!best) throw new Error(`No ${mediaType} match for "${media.title}"`);
    const added = mediaType === 'movie' ? await addMovie(cfg, best) : await addSeries(cfg, best);
    return { added };
}

/**
 * The *arr lookup endpoints return the library `id` (>0) on a result that's
 * already added, so a single lookup tells us whether the item exists.
 */
export async function findExisting(
    cfg: AppConfig,
    mediaType: MediaType,
    media: MediaContext,
): Promise<number | null> {
    const term = lookupTerm(media);
    const results = mediaType === 'movie' ? await lookupMovie(cfg, term) : await lookupSeries(cfg, term);
    const best = pickBest(results, media);
    const id = typeof best?.id === 'number' ? best.id : 0;
    if (id <= 0) return null;
    // Resolving by IMDb id is authoritative; otherwise the matched title must
    // reasonably equal the page title so CHECK_STATUS can't flag an unrelated
    // already-added item as present (which a two-click Remove would then delete).
    if (!media.imdbId && best && !titlesMatch(best.title, media.title)) return null;
    return id;
}
