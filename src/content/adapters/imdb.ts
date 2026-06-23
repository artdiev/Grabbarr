import { MediaContext } from '../../shared/types';
import { parseYear, SiteAdapter } from './types';

// IMDb: movies and series share /title/ttNNN. The episodes link in the metadata
// block distinguishes a series. The IMDb id comes straight from the URL.
export const imdbAdapter: SiteAdapter = {
    id: 'imdb',
    label: 'IMDb',
    matches: (url) => /imdb\.com\/title\/tt\d+/.test(url),
    findAnchor: () => document.querySelector<HTMLElement>('[data-testid="hero__pageTitle"]'),
    // Append inside the title block so the button rides alongside the title text.
    anchorPlacement: 'append',
    detect(): MediaContext | null {
        const imdbId = location.href.match(/title\/(tt\d+)/)?.[1];
        const titleEl = document.querySelector('[data-testid="hero__pageTitle"]');
        const title = titleEl?.textContent?.trim();
        if (!imdbId || !title) return null;
        const isTv =
            !!document.querySelector('[data-testid="hero-title-block__metadata"] a[href*="/episodes"]') ||
            !!document.querySelector('a[href*="episodes"][aria-label*="episode" i]');
        const yearText = document
            .querySelector('[data-testid="hero-title-block__metadata"] li a')
            ?.textContent;
        return {
            site: 'imdb',
            mediaType: isTv ? 'tv' : 'movie',
            imdbId,
            title,
            year: parseYear(yearText),
        };
    },
};
