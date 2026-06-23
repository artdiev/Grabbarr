import { MediaContext } from '../../shared/types';
import { parseYear, SiteAdapter } from './types';

// Kinopoisk: /film/ (movie) and /series/ (TV). Titles are Russian; we send the
// original (Latin) title when Kinopoisk shows it, else the localised title, with
// the year — title+year resolution against the *arr instance.
export const kinopoiskAdapter: SiteAdapter = {
    id: 'kinopoisk',
    label: 'Kinopoisk',
    matches: (url) => /kinopoisk\.ru\/(film|series)\/\d+/.test(url),
    findAnchor: () =>
        document.querySelector<HTMLElement>('[data-tid] h1[itemprop="name"], h1[itemprop="name"]') ??
        document.querySelector<HTMLElement>('h1'),
    detect(): MediaContext | null {
        const m = location.href.match(/kinopoisk\.ru\/(film|series)\/\d+/);
        if (!m) return null;
        const mediaType = m[1] === 'series' ? 'tv' : 'movie';
        // Prefer the original-language title (better for *arr matching).
        const original = document
            .querySelector('[data-tid] span[itemprop], .styles_originalTitle__JaNKM')
            ?.textContent?.trim();
        const localized = document.querySelector('h1[itemprop="name"] span, h1[itemprop="name"]')
            ?.textContent?.trim();
        const title = original || localized;
        if (!title) return null;
        const imdbId = document
            .querySelector<HTMLAnchorElement>('a[href*="imdb.com/title/tt"]')
            ?.getAttribute('href')
            ?.match(/(tt\d+)/)?.[1];
        const yearText = document.querySelector('a[href*="/lists/movies/year--"]')?.textContent;
        return { site: 'kinopoisk', mediaType, imdbId, title, year: parseYear(yearText) };
    },
};
