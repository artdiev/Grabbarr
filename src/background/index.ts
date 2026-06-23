// Service-worker message router: the single place that talks to Radarr/Sonarr.

import {
    CheckStatusResult,
    GrabResult,
    Message,
    RefreshStatusResult,
    RemoveResult,
    RequestSeasonResult,
    TestConnResult,
} from '../shared/messages';
import { addHistoryEntry, getConfig, removeHistoryEntry } from '../shared/storage';
import { APP_FOR, AppKind, HistoryEntry, ItemStatus, MediaContext } from '../shared/types';
import {
    ArrError,
    getChoices,
    getMovieStatus,
    getSeriesStatus,
    ping,
    removeMovie,
    removeSeries,
    seriesStatusFrom,
} from './arr-client';
import { findExisting, inspectTv, resolveAndAdd, resolveAndRequestSeason } from './resolver';

chrome.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
    // Each handler is async; returning true keeps the channel open.
    void handle(msg).then(sendResponse).catch((e) => sendResponse({ error: String(e) }));
    return true;
});

async function handle(msg: Message): Promise<unknown> {
    switch (msg.type) {
        case 'GRAB':
            return handleGrab(msg.media);
        case 'TEST_CONN':
            return handleTestConn(msg.url, msg.apiKey);
        case 'REFRESH_STATUS':
            return handleRefresh(msg.entries);
        case 'CHECK_STATUS':
            return handleCheck(msg.media);
        case 'REMOVE':
            return handleRemove(msg.app, msg.arrId, msg.key);
        case 'REQUEST_SEASON':
            return handleRequestSeason(msg.media, msg.season, msg.arrId);
    }
}

async function handleRequestSeason(
    media: MediaContext,
    season: number | 'all',
    arrId?: number,
): Promise<RequestSeasonResult> {
    const config = await getConfig();
    const app: AppKind = APP_FOR[media.mediaType]; // 'sonarr' for TV
    const cfg = config[app];
    if (!cfg.url || !cfg.apiKey) {
        chrome.runtime.openOptionsPage();
        return { ok: false, needsConfig: app };
    }
    try {
        const { added, seasons, key } = await resolveAndRequestSeason(
            cfg,
            media,
            season,
            config.tmdbApiKey,
            arrId,
        );
        const entry = buildEntry(key, app, added, media);
        await addHistoryEntry(entry);
        return { ok: true, entry, seasons };
    } catch (e) {
        return { ok: false, error: (e as Error).message };
    }
}

async function handleRemove(app: AppKind, arrId: number, key: string): Promise<RemoveResult> {
    const config = await getConfig();
    const cfg = config[app];
    if (!cfg.url || !cfg.apiKey) return { ok: false, error: 'Not configured' };
    try {
        if (app === 'radarr') await removeMovie(cfg, arrId, true);
        else await removeSeries(cfg, arrId, true);
        await removeHistoryEntry(key);
        void broadcastRemoved(key);
        return { ok: true };
    } catch (e) {
        // If the item is already gone from *arr (e.g. a duplicate/stale history row,
        // or removed out-of-band), treat it as removed and still prune the row so it
        // can't dangle un-deletable. Only a 404 means "not there"; other errors are real.
        if (e instanceof ArrError && e.status === 404) {
            await removeHistoryEntry(key);
            void broadcastRemoved(key);
            return { ok: true };
        }
        return { ok: false, error: (e as Error).message };
    }
}

/** Tell every tab's content script the item was removed, so its button refreshes. */
async function broadcastRemoved(key: string): Promise<void> {
    try {
        const tabs = await chrome.tabs.query({});
        for (const t of tabs) {
            if (t.id != null) chrome.tabs.sendMessage(t.id, { type: 'ITEM_REMOVED', key }).catch(() => {});
        }
    } catch {
        // No tabs permission / no content scripts — the page refreshes on next load.
    }
}

async function handleCheck(media: MediaContext): Promise<CheckStatusResult> {
    const config = await getConfig();
    const app: AppKind = APP_FOR[media.mediaType];
    const cfg = config[app];
    if (!cfg.url || !cfg.apiKey) return { configured: false, present: false };
    try {
        if (media.mediaType === 'tv') {
            // One lookup yields both presence and the season list for the menu.
            const { arrId, key, seasons, series } = await inspectTv(cfg, media, config.tmdbApiKey);
            if (!arrId || !series) return { configured: true, present: false, key, seasons };
            return {
                configured: true,
                present: true,
                arrId,
                key,
                status: await seriesStatusFrom(cfg, series),
                seasons,
            };
        }
        const found = await findExisting(cfg, media.mediaType, media, config.tmdbApiKey);
        if (!found) return { configured: true, present: false };
        return {
            configured: true,
            present: true,
            arrId: found.arrId,
            key: found.key,
            status: await getMovieStatus(cfg, found.arrId),
        };
    } catch {
        return { configured: true, present: false };
    }
}

async function handleGrab(media: MediaContext): Promise<GrabResult> {
    const config = await getConfig();
    const app: AppKind = APP_FOR[media.mediaType];
    const appCfg = config[app];
    if (!appCfg.url || !appCfg.apiKey) {
        chrome.runtime.openOptionsPage();
        return { ok: false, needsConfig: app };
    }
    try {
        const { added, key } = await resolveAndAdd(appCfg, media.mediaType, media, config.tmdbApiKey);
        const entry = buildEntry(key, app, added, media);
        await addHistoryEntry(entry);
        return { ok: true, entry };
    } catch (e) {
        return { ok: false, error: (e as Error).message };
    }
}

/** Build a history entry keyed by the canonical id (not the mutable *arr id). */
function buildEntry(
    key: string,
    app: AppKind,
    added: { id: number; title: string; year?: number; posterUrl?: string },
    media: MediaContext,
): HistoryEntry {
    return {
        key,
        app,
        arrId: added.id,
        title: added.title,
        year: added.year ?? media.year,
        posterUrl: added.posterUrl,
        site: media.site,
        mediaType: media.mediaType,
        addedAt: Date.now(),
        status: 'added',
    };
}

async function handleTestConn(url: string, apiKey: string): Promise<TestConnResult> {
    const cfg = { url, apiKey };
    try {
        const status = await ping(cfg);
        const choices = await getChoices(cfg);
        return { ok: true, version: status.version, choices };
    } catch (e) {
        return { ok: false, error: (e as Error).message };
    }
}

async function handleRefresh(
    entries: { key: string; app: AppKind; arrId: number }[],
): Promise<RefreshStatusResult> {
    const config = await getConfig();
    const statuses: Record<string, ItemStatus> = {};
    await Promise.all(
        entries.map(async (e) => {
            const cfg = config[e.app];
            if (!cfg.url || !cfg.apiKey) {
                statuses[e.key] = 'error';
                return;
            }
            try {
                statuses[e.key] =
                    e.app === 'radarr'
                        ? await getMovieStatus(cfg, e.arrId)
                        : await getSeriesStatus(cfg, e.arrId);
            } catch {
                statuses[e.key] = 'error';
            }
        }),
    );
    return { statuses };
}
