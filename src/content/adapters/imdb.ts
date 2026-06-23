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
        // The first `<li> a` in the metadata block is often a type/rating link
        // (e.g. "TV Series"), not the year. Prefer the release-info link whose
        // text is the year (a range like "2019–2024" for series — parseYear
        // grabs the first), then fall back to scanning the block's text.
        const metadata = document.querySelector('[data-testid="hero-title-block__metadata"]');
        const releaseLink = metadata?.querySelector('a[href*="releaseinfo"]');
        const year =
            parseYear(releaseLink?.textContent) ?? parseYear(metadata?.textContent);
        return {
            site: 'imdb',
            mediaType: isTv ? 'tv' : 'movie',
            imdbId,
            title,
            year,
        };
    },
};
