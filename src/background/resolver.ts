// Turns a page's MediaContext into the *arr lookup term and picks the best match.
// Strategy (per design): prefer the IMDb id (`imdb:tt...`), fall back to title+year.

import { AppConfig, MediaContext, MediaType } from '../shared/types';
import { AddedItem, addMovie, addSeries, LookupResult, lookupMovie, lookupSeries } from './arr-client';

export function lookupTerm(media: MediaContext): string {
    if (media.imdbId) return `imdb:${media.imdbId}`;
    return media.year ? `${media.title} ${media.year}` : media.title;
}

/** Choose the lookup result that best matches the page. */
function pickBest(results: LookupResult[], media: MediaContext): LookupResult | undefined {
    if (results.length === 0) return undefined;
    // When we resolved by IMDb id the first result is authoritative.
    if (media.imdbId) return results[0];
    // Otherwise prefer an exact year match, then fall back to the top result.
    if (media.year) {
        const exact = results.find((r) => r.year === media.year);
        if (exact) return exact;
    }
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
    return id > 0 ? id : null;
}
