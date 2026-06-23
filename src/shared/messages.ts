// Typed message contracts between content/popup/options and the background worker.

import type {
    AppKind,
    ArrChoices,
    HistoryEntry,
    ItemStatus,
    MediaContext,
    SeasonInfo,
    SiteId,
} from './types';

export interface GrabMessage {
    type: 'GRAB';
    media: MediaContext;
}
export interface GrabResult {
    ok: boolean;
    needsConfig?: AppKind; // set when the relevant app isn't configured
    entry?: HistoryEntry;
    error?: string;
}

export interface TestConnMessage {
    type: 'TEST_CONN';
    app: AppKind;
    url: string;
    apiKey: string;
}
export interface TestConnResult {
    ok: boolean;
    version?: string;
    choices?: ArrChoices;
    error?: string;
}

export interface RefreshStatusMessage {
    type: 'REFRESH_STATUS';
    entries: { key: string; app: AppKind; arrId: number }[];
}
export interface RefreshStatusResult {
    statuses: Record<string, ItemStatus>; // keyed by HistoryEntry.key
}

/** Asked by the content script on page load: is this item already in the *arr library? */
export interface CheckStatusMessage {
    type: 'CHECK_STATUS';
    media: MediaContext;
}
export interface CheckStatusResult {
    configured: boolean; // the relevant app has a URL + key
    present: boolean; // already exists in the library
    status?: ItemStatus;
    arrId?: number;
    key?: string; // canonical history key for this item (so the button can remove it)
    seasons?: SeasonInfo[]; // TV only — the show's season list (for the season menu)
}

/** Remove an item from its *arr app (toggle-off / undo an accidental grab). */
export interface RemoveMessage {
    type: 'REMOVE';
    app: AppKind;
    arrId: number;
    key: string; // canonical history key to prune (identity is the item, not the arrId)
}
export interface RemoveResult {
    ok: boolean;
    error?: string;
}

/** Request a TV season (or the whole series) — add or monitor + search in Sonarr. */
export interface RequestSeasonMessage {
    type: 'REQUEST_SEASON';
    media: MediaContext;
    arrId?: number; // set when the series is already in the library
    season: number | 'all';
}
export interface RequestSeasonResult {
    ok: boolean;
    needsConfig?: AppKind;
    entry?: HistoryEntry;
    seasons?: SeasonInfo[]; // refreshed season state after the request
    error?: string;
}

export type Message =
    | GrabMessage
    | TestConnMessage
    | RefreshStatusMessage
    | CheckStatusMessage
    | RemoveMessage
    | RequestSeasonMessage;

/** Narrow helper so the background router can switch on `msg.type` safely. */
export type ResultFor<M extends Message> = M extends GrabMessage
    ? GrabResult
    : M extends TestConnMessage
      ? TestConnResult
      : M extends RefreshStatusMessage
        ? RefreshStatusResult
        : M extends CheckStatusMessage
          ? CheckStatusResult
          : M extends RemoveMessage
            ? RemoveResult
            : M extends RequestSeasonMessage
              ? RequestSeasonResult
              : never;

export function sendMessage<M extends Message>(msg: M): Promise<ResultFor<M>> {
    return chrome.runtime.sendMessage(msg) as Promise<ResultFor<M>>;
}

// ── Tab-directed messages ────────────────────────────────────────────────────
// These go popup → the active tab's content script (chrome.tabs.sendMessage),
// a different channel from the background `sendMessage` above.

export interface GetPageStateMessage {
    type: 'GET_PAGE_STATE';
}
export interface PageState {
    supported: boolean; // a known adapter matches this URL
    site?: SiteId;
    detected: boolean; // detection (incl. overrides) currently yields a grabbable item
}

export interface ActivatePickerMessage {
    type: 'ACTIVATE_PICKER';
}

export type TabMessage = GetPageStateMessage | ActivatePickerMessage;

export type TabResultFor<M extends TabMessage> = M extends GetPageStateMessage
    ? PageState
    : M extends ActivatePickerMessage
      ? { ok: boolean }
      : never;

export function sendToTab<M extends TabMessage>(tabId: number, msg: M): Promise<TabResultFor<M>> {
    return chrome.tabs.sendMessage(tabId, msg) as Promise<TabResultFor<M>>;
}
