// Thin Radarr/Sonarr API client. Both apps share the v3 API shape, so movie and
// series calls differ only in the resource path and a few payload fields.

import { AppConfig, ArrChoices, ItemStatus } from '../shared/types';

const TIMEOUT_MS = 12_000;

export class ArrError extends Error {}

function baseUrl(cfg: AppConfig): string {
    return cfg.url.trim().replace(/\/+$/, '');
}

async function request<T>(cfg: AppConfig, path: string, init: RequestInit = {}): Promise<T> {
    if (!cfg.url || !cfg.apiKey) throw new ArrError('Not configured');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(`${baseUrl(cfg)}${path}`, {
            ...init,
            signal: controller.signal,
            headers: {
                'X-Api-Key': cfg.apiKey,
                'Content-Type': 'application/json',
                ...(init.headers ?? {}),
            },
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new ArrError(`HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
        }
        // Some POSTs (already-exists) still return JSON; 201/200 both fine.
        return (await res.json()) as T;
    } catch (e) {
        if (e instanceof ArrError) throw e;
        if ((e as Error).name === 'AbortError') throw new ArrError('Request timed out');
        throw new ArrError((e as Error).message || 'Network error');
    } finally {
        clearTimeout(timer);
    }
}

/** DELETE returns an empty body, so it can't go through `request` (which parses JSON). */
async function del(cfg: AppConfig, path: string): Promise<void> {
    if (!cfg.url || !cfg.apiKey) throw new ArrError('Not configured');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(`${baseUrl(cfg)}${path}`, {
            method: 'DELETE',
            signal: controller.signal,
            headers: { 'X-Api-Key': cfg.apiKey },
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new ArrError(`HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
        }
    } catch (e) {
        if (e instanceof ArrError) throw e;
        if ((e as Error).name === 'AbortError') throw new ArrError('Request timed out');
        throw new ArrError((e as Error).message || 'Network error');
    } finally {
        clearTimeout(timer);
    }
}

export function removeMovie(cfg: AppConfig, id: number, deleteFiles: boolean): Promise<void> {
    return del(cfg, `/api/v3/movie/${id}?deleteFiles=${deleteFiles}&addImportExclusion=false`);
}

export function removeSeries(cfg: AppConfig, id: number, deleteFiles: boolean): Promise<void> {
    return del(cfg, `/api/v3/series/${id}?deleteFiles=${deleteFiles}&addImportExclusion=false`);
}

export interface ArrStatusInfo {
    version: string;
    appName: string;
}

export function ping(cfg: AppConfig): Promise<ArrStatusInfo> {
    return request<ArrStatusInfo>(cfg, '/api/v3/system/status');
}

export async function getChoices(cfg: AppConfig): Promise<ArrChoices> {
    const [qualityProfiles, rootFolders] = await Promise.all([
        request<{ id: number; name: string }[]>(cfg, '/api/v3/qualityprofile'),
        request<{ path: string; freeSpace?: number }[]>(cfg, '/api/v3/rootfolder'),
    ]);
    return {
        qualityProfiles: qualityProfiles.map((p) => ({ id: p.id, name: p.name })),
        rootFolders: rootFolders.map((r) => ({ path: r.path, freeSpace: r.freeSpace })),
    };
}

// ── Lookup ────────────────────────────────────────────────────────────────
// Both endpoints accept a free-text `term`, including `imdb:tt123` syntax.

export interface LookupResult {
    id?: number; // library id when the item is already added (0/undefined otherwise)
    title: string;
    year?: number;
    images?: { coverType: string; remoteUrl?: string; url?: string }[];
    [k: string]: unknown;
}

export function lookupMovie(cfg: AppConfig, term: string): Promise<LookupResult[]> {
    return request<LookupResult[]>(cfg, `/api/v3/movie/lookup?term=${encodeURIComponent(term)}`);
}

export function lookupSeries(cfg: AppConfig, term: string): Promise<LookupResult[]> {
    return request<LookupResult[]>(cfg, `/api/v3/series/lookup?term=${encodeURIComponent(term)}`);
}

// ── Add ─────────────────────────────────────────────────────────────────────

export interface AddedItem {
    id: number;
    title: string;
    year?: number;
    posterUrl?: string;
}

function posterFrom(item: LookupResult): string | undefined {
    const poster = item.images?.find((i) => i.coverType === 'poster');
    return poster?.remoteUrl ?? poster?.url;
}

export async function addMovie(cfg: AppConfig, lookup: LookupResult): Promise<AddedItem> {
    const movie = await request<{ id: number; title: string; year?: number }>(cfg, '/api/v3/movie', {
        method: 'POST',
        body: JSON.stringify({
            ...lookup,
            qualityProfileId: cfg.qualityProfileId ?? 1,
            rootFolderPath: cfg.rootFolderPath ?? '/movies',
            monitored: true,
            minimumAvailability: 'released',
            addOptions: { searchForMovie: true },
        }),
    });
    return { id: movie.id, title: movie.title, year: movie.year, posterUrl: posterFrom(lookup) };
}

export async function addSeries(cfg: AppConfig, lookup: LookupResult): Promise<AddedItem> {
    const series = await request<{ id: number; title: string; year?: number }>(cfg, '/api/v3/series', {
        method: 'POST',
        body: JSON.stringify({
            ...lookup,
            qualityProfileId: cfg.qualityProfileId ?? 1,
            rootFolderPath: cfg.rootFolderPath ?? '/tv',
            monitored: true,
            seasonFolder: true,
            addOptions: { searchForMissingEpisodes: true, monitor: 'all' },
        }),
    });
    return { id: series.id, title: series.title, year: series.year, posterUrl: posterFrom(lookup) };
}

// ── Status ───────────────────────────────────────────────────────────────────

async function isInQueue(cfg: AppConfig, idField: 'movieId' | 'seriesId', id: number): Promise<boolean> {
    try {
        const queue = await request<{ records?: { movieId?: number; seriesId?: number }[] }>(
            cfg,
            '/api/v3/queue?pageSize=200',
        );
        return (queue.records ?? []).some((r) => r[idField] === id);
    } catch {
        return false;
    }
}

export async function getMovieStatus(cfg: AppConfig, id: number): Promise<ItemStatus> {
    const movie = await request<{ hasFile?: boolean }>(cfg, `/api/v3/movie/${id}`);
    if (movie.hasFile) return 'downloaded';
    if (await isInQueue(cfg, 'movieId', id)) return 'downloading';
    return 'missing';
}

export async function getSeriesStatus(cfg: AppConfig, id: number): Promise<ItemStatus> {
    const series = await request<{ statistics?: { episodeCount?: number; episodeFileCount?: number } }>(
        cfg,
        `/api/v3/series/${id}`,
    );
    const total = series.statistics?.episodeCount ?? 0;
    const have = series.statistics?.episodeFileCount ?? 0;
    if (total > 0 && have >= total) return 'downloaded';
    if (await isInQueue(cfg, 'seriesId', id)) return 'downloading';
    if (have > 0) return 'partial';
    return 'missing';
}
