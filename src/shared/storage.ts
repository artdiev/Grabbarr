// Typed wrappers over chrome.storage. Config lives in `sync` (small, roams with
// the user); history lives in `local` (can grow, bounded below).

import { Config, DEFAULT_CONFIG, HistoryEntry, ItemStatus, SiteId, SiteOverride } from './types';

const CONFIG_KEY = 'config';
const HISTORY_KEY = 'history';
const HISTORY_CAP = 10;

export async function getConfig(): Promise<Config> {
    const { [CONFIG_KEY]: stored } = await chrome.storage.sync.get(CONFIG_KEY);
    return mergeConfig(stored as Partial<Config> | undefined);
}

export async function setConfig(config: Config): Promise<void> {
    await chrome.storage.sync.set({ [CONFIG_KEY]: config });
}

/** Defensive merge so older/partial stored configs still load with defaults. */
function mergeConfig(stored: Partial<Config> | undefined): Config {
    return {
        radarr: { ...DEFAULT_CONFIG.radarr, ...stored?.radarr },
        sonarr: { ...DEFAULT_CONFIG.sonarr, ...stored?.sonarr },
        siteEnabled: { ...DEFAULT_CONFIG.siteEnabled, ...stored?.siteEnabled },
        overrides: { ...stored?.overrides },
    };
}

export function isSiteEnabled(config: Config, site: SiteId): boolean {
    return config.siteEnabled[site] ?? true;
}

export function getOverride(config: Config, site: SiteId): SiteOverride {
    return config.overrides[site] ?? {};
}

/** Persist a site's override (read-modify-write of the whole config). */
export async function setOverride(site: SiteId, override: SiteOverride): Promise<void> {
    const config = await getConfig();
    config.overrides[site] = override;
    await setConfig(config);
}

export async function clearOverride(site: SiteId): Promise<void> {
    const config = await getConfig();
    delete config.overrides[site];
    await setConfig(config);
}

export async function getHistory(): Promise<HistoryEntry[]> {
    const { [HISTORY_KEY]: stored } = await chrome.storage.local.get(HISTORY_KEY);
    return Array.isArray(stored) ? (stored as HistoryEntry[]) : [];
}

/** Insert newest-first, dedupe by key, cap length. */
export async function addHistoryEntry(entry: HistoryEntry): Promise<HistoryEntry[]> {
    const history = await getHistory();
    const next = [entry, ...history.filter((e) => e.key !== entry.key)].slice(0, HISTORY_CAP);
    await chrome.storage.local.set({ [HISTORY_KEY]: next });
    return next;
}

export async function setHistory(history: HistoryEntry[]): Promise<void> {
    await chrome.storage.local.set({ [HISTORY_KEY]: history.slice(0, HISTORY_CAP) });
}

export async function removeHistoryEntry(key: string): Promise<void> {
    const history = await getHistory();
    await setHistory(history.filter((e) => e.key !== key));
}

/**
 * Atomically apply status updates by re-reading the latest history, so it never
 * resurrects entries removed concurrently nor drops ones added concurrently.
 * Only keys still present are touched; unknown keys are skipped.
 */
export async function applyStatusUpdates(statuses: Record<string, ItemStatus>): Promise<void> {
    const history = await getHistory();
    let changed = false;
    for (const e of history) {
        const next = statuses[e.key];
        if (next && next !== e.status) {
            e.status = next;
            changed = true;
        }
    }
    if (changed) await setHistory(history);
}
