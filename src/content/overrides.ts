// Merges a user-defined SiteOverride over an adapter's built-in detection.
// Overrides win field-by-field, and can produce a grabbable item even when the
// adapter's own detect() fails entirely (the whole point of the picker).

import { MediaContext, SiteOverride } from '../shared/types';
import { parseYear, SiteAdapter } from './adapters/types';
import { cleanOgTitle, ogMediaType, readOg } from './og';

/** Safe querySelector — invalid or stale selectors never throw. */
export function safeQuery(selector: string | undefined): HTMLElement | null {
    if (!selector) return null;
    try {
        return document.querySelector<HTMLElement>(selector);
    } catch {
        return null;
    }
}

function textOf(selector: string | undefined): string | undefined {
    return safeQuery(selector)?.textContent?.trim() || undefined;
}

export interface DetectionResult {
    media: MediaContext | null;
    anchor: HTMLElement | null;
}

export function applyOverrides(adapter: SiteAdapter, override: SiteOverride): DetectionResult {
    const detected = adapter.detect();
    const baseAnchor = adapter.findAnchor();
    // Open Graph is the cross-site fallback for title/type (priority: override → adapter → OG).
    const og = readOg();

    const title = textOf(override.titleSelector) ?? detected?.title ?? cleanOgTitle(og.title, og.siteName);
    const mediaType = override.mediaType ?? detected?.mediaType ?? ogMediaType(og.type);
    const year = parseYear(textOf(override.yearSelector)) ?? detected?.year ?? parseYear(og.title);
    const imdbId = detected?.imdbId;
    const anchor = safeQuery(override.anchorSelector) ?? baseAnchor;

    if (!title || !mediaType || !anchor) return { media: null, anchor: null };

    return {
        media: { site: adapter.id, mediaType, imdbId, title, year },
        anchor,
    };
}
