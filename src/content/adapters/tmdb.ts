import { MediaContext } from '../../shared/types';
import { parseYear, SiteAdapter } from './types';

// TMDb: type is in the URL (/movie/ or /tv/). The IMDb id is exposed via the
// external-links sidebar (an anchor to imdb.com/title/ttNNN) when present.
export const tmdbAdapter: SiteAdapter = {
    id: 'tmdb',
    label: 'TMDb',
    matches: (url) => /themoviedb\.org\/(movie|tv)\/\d+/.test(url),
    findAnchor: () =>
        document.querySelector<HTMLElement>('.header_poster_wrapper h2 a, section.header h2 a, h2.title a') ??
        document.querySelector<HTMLElement>('.header_poster_wrapper h2, section.header h2'),
    detect(): MediaContext | null {
        const m = location.href.match(/themoviedb\.org\/(movie|tv)\/(\d+)/);
        if (!m) return null;
        const mediaType = m[1] === 'tv' ? 'tv' : 'movie';
        const tmdbId = Number(m[2]); // the TMDb id is right in the URL — the stable id
        const titleEl =
            document.querySelector('section.header h2 a') ??
            document.querySelector('.title h2 a') ??
            document.querySelector('section.header h2');
        const title = titleEl?.textContent?.trim();
        if (!title) return null;
        const imdbHref = document
            .querySelector<HTMLAnchorElement>('a[href*="imdb.com/title/tt"]')
            ?.getAttribute('href');
        const imdbId = imdbHref?.match(/(tt\d+)/)?.[1];
        const yearText = document.querySelector('.release_date, span.tag.release_date')?.textContent;
        return { site: 'tmdb', mediaType, imdbId, tmdbId, title, year: parseYear(yearText) };
    },
};
