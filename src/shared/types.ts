// Shared domain types used across background, content, popup, and options.

export type MediaType = 'movie' | 'tv';

/** Which *arr app handles a given media type. */
export type AppKind = 'radarr' | 'sonarr';

export const APP_FOR: Record<MediaType, AppKind> = {
    movie: 'radarr',
    tv: 'sonarr',
};

/** Clicks required to confirm a removal (armed → "Remove" → "Confirm?" → done). */
export const REMOVE_CLICKS = 2;

/** Supported sites. Keep in sync with the adapter registry and manifest matches. */
export type SiteId = 'imdb' | 'tmdb' | 'rt' | 'kinopoisk';

export const SITES: { id: SiteId; label: string }[] = [
    { id: 'imdb', label: 'IMDb' },
    { id: 'tmdb', label: 'TMDb' },
    { id: 'rt', label: 'Rotten Tomatoes' },
    { id: 'kinopoisk', label: 'Kinopoisk' },
];

/** What a content-script adapter extracts from a page. */
export interface MediaContext {
    site: SiteId;
    mediaType: MediaType;
    imdbId?: string; // tt-prefixed when the page exposes it
    tmdbId?: number; // numeric TMDb id when the page exposes it (e.g. TMDb URL)
    title: string; // prefer the original-language title for matching
    year?: number;
}

/** Per-app connection + default add settings. */
export interface AppConfig {
    url: string;
    apiKey: string;
    qualityProfileId?: number;
    rootFolderPath?: string;
}

/**
 * User-supplied selectors that override an adapter's built-in parsing for a site.
 * Captured via the in-page element picker; any field left unset falls back to the
 * adapter's own detection.
 */
export interface SiteOverride {
    titleSelector?: string;
    yearSelector?: string;
    anchorSelector?: string;
    mediaType?: MediaType; // manual movie/tv override
}

export type SiteOverrides = Partial<Record<SiteId, SiteOverride>>;

export interface Config {
    radarr: AppConfig;
    sonarr: AppConfig;
    siteEnabled: Record<SiteId, boolean>;
    overrides: SiteOverrides;
    /** Optional TMDb API key — improves matching when a page exposes no IMDb/TMDb id. */
    tmdbApiKey: string;
}

export const DEFAULT_CONFIG: Config = {
    radarr: { url: '', apiKey: '' },
    sonarr: { url: '', apiKey: '' },
    siteEnabled: { imdb: true, tmdb: true, rt: true, kinopoisk: true },
    overrides: {},
    tmdbApiKey: '',
};

/** One season of a TV series, as shown in the on-page season menu. */
export interface SeasonInfo {
    seasonNumber: number; // 0 = Specials
    monitored: boolean; // false when the show isn't added to Sonarr yet
    episodeCount?: number; // aired episodes (when known)
    episodeFileCount?: number; // downloaded (only when the series is in the library)
}

export type ItemStatus =
    | 'added' // accepted by *arr, no download info yet
    | 'queued'
    | 'downloading'
    | 'partial' // some but not all episodes (series)
    | 'downloaded'
    | 'missing'
    | 'error';

/** A row in the popup history. */
export interface HistoryEntry {
    /** Stable local id (app + arr internal id). */
    key: string;
    app: AppKind;
    arrId: number; // *arr internal movie/series id
    title: string;
    year?: number;
    posterUrl?: string;
    site: SiteId;
    mediaType: MediaType;
    addedAt: number; // epoch ms
    status: ItemStatus;
}

/** Profiles/folders fetched from an *arr instance, shown in options dropdowns. */
export interface ArrChoices {
    qualityProfiles: { id: number; name: string }[];
    rootFolders: { path: string; freeSpace?: number }[];
}
