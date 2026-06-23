import { MediaContext } from '../../shared/types';
import { parseYear, SiteAdapter } from './types';

// Rotten Tomatoes renders the hero via a web component using named slots — the
// title is a light-DOM node with `slot="title"`, projected into <slot name="title">.
// Type is reliably inferred from the URL (/m/ = movie, /tv/ = series). RT rarely
// exposes an IMDb id, so we resolve by title+year (the design's fallback path).
const TITLE_SELECTOR = '[slot="title"], [data-qa="score-panel-title"], h1.title';

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
        const metaText =
            document.querySelector('[slot="metadata-prop"], [data-qa="score-panel-subtitle"]')
                ?.textContent ?? '';
        return { site: 'rt', mediaType, title, year: parseYear(metaText) };
    },
};
