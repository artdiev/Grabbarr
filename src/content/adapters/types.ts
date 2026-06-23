import { MediaContext, SiteId } from '../../shared/types';

/** A site adapter localises one site's fragile URL/DOM selectors. */
export interface SiteAdapter {
    id: SiteId;
    label: string;
    /** True if this adapter handles the given page URL. */
    matches(url: string): boolean;
    /**
     * Extract media info from the current DOM, or null if the page isn't a
     * recognised movie/TV page (yet — SPAs load late, so this is retried).
     */
    detect(): MediaContext | null;
    /** Element to attach the grab button next to (usually the title). */
    findAnchor(): HTMLElement | null;
    /** How the button sits relative to the anchor. Default 'after'. */
    anchorPlacement?: 'after' | 'append';
    /**
     * When the anchor lives inside a web component that renders via named slots,
     * the button must carry this `slot` to be projected (otherwise a non-slotted
     * light-DOM sibling never shows). e.g. Rotten Tomatoes' title slot.
     */
    anchorSlot?: string;
}

export function parseYear(text: string | null | undefined): number | undefined {
    const m = text?.match(/(19|20)\d{2}/);
    return m ? Number(m[0]) : undefined;
}
