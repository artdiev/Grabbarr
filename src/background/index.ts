// Service-worker message router: the single place that talks to Radarr/Sonarr.

import {
    CheckStatusResult,
    GrabResult,
    Message,
    RefreshStatusResult,
    RemoveResult,
    TestConnResult,
} from '../shared/messages';
import { addHistoryEntry, getConfig, removeHistoryEntry } from '../shared/storage';
import { APP_FOR, AppKind, HistoryEntry, ItemStatus, MediaContext } from '../shared/types';
import { getChoices, getMovieStatus, getSeriesStatus, ping, removeMovie, removeSeries } from './arr-client';
import { findExisting, resolveAndAdd } from './resolver';

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
            return handleRemove(msg.app, msg.arrId);
    }
}

async function handleRemove(app: AppKind, arrId: number): Promise<RemoveResult> {
    const config = await getConfig();
    const cfg = config[app];
    if (!cfg.url || !cfg.apiKey) return { ok: false, error: 'Not configured' };
    try {
        if (app === 'radarr') await removeMovie(cfg, arrId, true);
        else await removeSeries(cfg, arrId, true);
        await removeHistoryEntry(`${app}:${arrId}`);
        return { ok: true };
    } catch (e) {
        return { ok: false, error: (e as Error).message };
    }
}

async function handleCheck(media: MediaContext): Promise<CheckStatusResult> {
    const config = await getConfig();
    const app: AppKind = APP_FOR[media.mediaType];
    const cfg = config[app];
    if (!cfg.url || !cfg.apiKey) return { configured: false, present: false };
    try {
        const arrId = await findExisting(cfg, media.mediaType, media);
        if (!arrId) return { configured: true, present: false };
        const status =
            app === 'radarr' ? await getMovieStatus(cfg, arrId) : await getSeriesStatus(cfg, arrId);
        return { configured: true, present: true, arrId, status };
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
        const { added } = await resolveAndAdd(appCfg, media.mediaType, media);
        const entry: HistoryEntry = {
            key: `${app}:${added.id}`,
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
        await addHistoryEntry(entry);
        return { ok: true, entry };
    } catch (e) {
        return { ok: false, error: (e as Error).message };
    }
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
