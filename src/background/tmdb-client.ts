// Optional TMDb resolver. Used only when a page gives no usable IMDb/TMDb id (e.g.
// Kinopoisk in Russian) — TMDb's multi-language search + external-ids map a title or a
// tmdb id to stable ids the *arr apps understand. Every function degrades to null on a
// missing key, no match, or any error, so the resolver can fall back to title search.

import { MediaType } from '../shared/types';

const BASE = 'https://api.themoviedb.org/3';
const TIMEOUT_MS = 10_000;

export interface TmdbIds {
    tmdbId: number;
    imdbId?: string;
    tvdbId?: number;
}

async function get<T>(key: string, path: string, params: Record<string, string> = {}): Promise<T | null> {
    const qs = new URLSearchParams({ api_key: key, ...params }).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(`${BASE}${path}?${qs}`, { signal: controller.signal });
        if (!res.ok) return null;
        return (await res.json()) as T;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

function normalize(t: string): string {
    return t
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}

/** Resolve a tmdb id's external ids (imdb/tvdb). */
export async function externalIds(key: string, tmdbId: number, mediaType: MediaType): Promise<TmdbIds> {
    const ext = await get<{ imdb_id?: string; tvdb_id?: number }>(
        key,
        `/${mediaType === 'tv' ? 'tv' : 'movie'}/${tmdbId}/external_ids`,
    );
    return { tmdbId, imdbId: ext?.imdb_id || undefined, tvdbId: ext?.tvdb_id || undefined };
}

/** Map an IMDb id to TMDb (+ tvdb for series) via the find endpoint. */
export async function findByImdb(key: string, imdbId: string, mediaType: MediaType): Promise<TmdbIds | null> {
    const found = await get<{ movie_results?: { id: number }[]; tv_results?: { id: number }[] }>(
        key,
        `/find/${imdbId}`,
        { external_source: 'imdb_id' },
    );
    const hit = (mediaType === 'tv' ? found?.tv_results : found?.movie_results)?.[0];
    if (!hit) return null;
    return externalIds(key, hit.id, mediaType);
}

/** Resolve a (possibly localized) title + year to stable ids via TMDb search. */
export async function searchByTitle(
    key: string,
    title: string,
    year: number | undefined,
    mediaType: MediaType,
): Promise<TmdbIds | null> {
    const path = mediaType === 'tv' ? '/search/tv' : '/search/movie';
    const params: Record<string, string> = { query: title, include_adult: 'false' };
    if (year) params[mediaType === 'tv' ? 'first_air_date_year' : 'year'] = String(year);
    const data = await get<{
        results?: { id: number; title?: string; name?: string; original_title?: string; original_name?: string }[];
    }>(key, path, params);
    const results = data?.results ?? [];
    if (results.length === 0) return null;
    // Prefer a result whose (original) title matches; else take TMDb's top hit.
    const want = normalize(title);
    const best =
        results.find((r) => {
            const names = [r.title, r.name, r.original_title, r.original_name].filter(Boolean) as string[];
            return names.some((n) => normalize(n) === want);
        }) ?? results[0];
    return externalIds(key, best.id, mediaType);
}
