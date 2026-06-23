// Open Graph fallback. og:type / og:title / og:site_name are present on all the
// supported sites, so they're a reliable last-resort source for media type and
// title when an adapter's own selectors miss.

import { MediaType } from '../shared/types';

export interface OgInfo {
    type?: string;
    title?: string;
    siteName?: string;
}

export function readOg(): OgInfo {
    const get = (prop: string) =>
        document
            .querySelector<HTMLMetaElement>(`meta[property="${prop}"], meta[name="${prop}"]`)
            ?.content?.trim() || undefined;
    return { type: get('og:type'), title: get('og:title'), siteName: get('og:site_name') };
}

/** Map an og:type (e.g. video.movie, video.tv_show, video.episode) to our MediaType. */
export function ogMediaType(type?: string): MediaType | undefined {
    if (!type) return undefined;
    const t = type.toLowerCase();
    if (t.includes('movie')) return 'movie';
    if (t.includes('tv') || t.includes('show') || t.includes('series') || t.includes('episode')) {
        return 'tv';
    }
    return undefined;
}

// Site-name suffixes commonly appended to og:title, beyond whatever og:site_name says.
const KNOWN_SITE_NAMES = ['IMDb', 'The Movie Database', 'TMDB', 'Rotten Tomatoes', 'Kinopoisk', 'Кинопоиск'];

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Strip a trailing " - Site Name" / " | TMDB" and a trailing "(YYYY)" from an og:title. */
export function cleanOgTitle(title?: string, siteName?: string): string | undefined {
    if (!title) return undefined;
    let t = title.trim();
    for (const name of [siteName, ...KNOWN_SITE_NAMES].filter((n): n is string => !!n)) {
        t = t.replace(new RegExp(`\\s*[-|–—:]\\s*${escapeRegExp(name)}\\s*$`, 'i'), '');
    }
    t = t.replace(/\s*\((?:19|20)\d{2}\)\s*$/, ''); // trailing release year, kept in the year field
    return t.trim() || undefined;
}
