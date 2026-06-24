import { MediaContext } from '../../shared/types';
import { parseYear, SiteAdapter } from './types';

// Rotten Tomatoes renders the hero via the <media-hero> web component using named
// slots — the title is a light-DOM node with `slot="title"`, projected into
// <slot name="title">. The selector MUST be scoped to the hero: RT's header nav
// megamenu contains many earlier `[slot="title"]` promos ("Movies in Theaters",
// etc.), so an unscoped `[slot="title"]` matches a hidden nav item instead and the
// button injects into a collapsed dropdown (invisible on the page).
// Type is reliably inferred from the URL (/m/ = movie, /tv/ = series). RT rarely
// exposes an IMDb id, so we resolve by title+year (the design's fallback path).
const HERO = 'media-hero, [data-qa="section:media-hero"]';
const TITLE_SELECTOR = 'media-hero [slot="title"], [data-qa="section:media-hero"] [slot="title"]';

export const rtAdapter: SiteAdapter = {
    id: 'rt',
    label: 'Rotten Tomatoes',
    matches: (url) => /rottentomatoes\.com\/(m|tv)\//.test(url),
    findAnchor: () => document.querySelector<HTMLElement>(TITLE_SELECTOR),
    // The button must be a slotted sibling of the title to render inside the host.
    anchorPlacement: 'after',
    anchorSlot: 'title',
    detect(): MediaContext | null {
        const m = location.href.match(/rottentomatoes\.com\/(m|tv)\//);
        if (!m) return null;
        const mediaType = m[1] === 'm' ? 'movie' : 'tv';
        const title = document.querySelector(TITLE_SELECTOR)?.textContent?.trim();
        if (!title) return null;
        // The hero lists several `[slot="metadata-prop"]` chips (rating, year, runtime);
        // the first is the rating ("R"), so scan all of them for the release year.
        const hero = document.querySelector(HERO);
        const metaText = hero
            ? [...hero.querySelectorAll('[slot="metadata-prop"]')].map((el) => el.textContent ?? '').join(' ')
            : '';
        return { site: 'rt', mediaType, title, year: parseYear(metaText) };
    },
};
