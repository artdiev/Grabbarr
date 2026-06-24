// Builds the grab button, reflects the item's *arr status, and acts as a
// grab/remove toggle: when the item is already in the library, hovering arms a
// 2-click remove (undo an accidental grab). The button has a fixed, pre-computed
// width and slides its content left/right on state changes (toggle illusion).

import { checkSvg, spinnerSvg, trashSvg } from '../shared/icons';
import { sendMessage, TabMessage } from '../shared/messages';
import { STATUS_META } from '../shared/status-ui';
import { APP_FOR, AppKind, ItemStatus, MediaContext, REMOVE_CLICKS, SeasonInfo } from '../shared/types';
import { toggleSeasonMenu } from './season-menu';

const BUTTON_ID = 'grabbarr-button';

/** Where the button sits relative to the anchor: after it, or appended inside it. */
export type AnchorPlacement = 'after' | 'append';

// The currently-injected button's identity + reset hook. A background ITEM_REMOVED
// broadcast (e.g. the item was deleted from the popup) refreshes the page button.
let activeButton: { presentKey: () => string | undefined; reset: () => void } | null = null;

chrome.runtime.onMessage.addListener((msg: TabMessage) => {
    if (msg.type === 'ITEM_REMOVED' && activeButton && activeButton.presentKey() === msg.key) {
        activeButton.reset();
    }
});

// The button intentionally shows friendlier text than the popup for a few
// statuses ('added' is handled separately via `labelFor`). Everything else falls
// back to the shared STATUS_META labels so there's a single source of truth.
const STATUS_LABEL_OVERRIDE: Partial<Record<ItemStatus, string>> = {
    missing: 'In library',
    error: 'In library',
};

const statusLabel = (status: ItemStatus): string =>
    STATUS_LABEL_OVERRIDE[status] ?? STATUS_META[status].label;

function dataStateFor(status: ItemStatus): string {
    if (status === 'downloading' || status === 'queued') return 'downloading';
    return 'grabbed'; // present in the library → checkmark
}

function grabIcon(): HTMLImageElement {
    const icon = document.createElement('img');
    icon.src = chrome.runtime.getURL('icons/icon32.png');
    icon.alt = '';
    return icon;
}

// All button styling lives in the Shadow DOM, fully isolated from the host page.
const BUTTON_CSS = `
:host{all:initial}
.gb{display:inline-flex;align-items:center;justify-content:center;gap:9px;margin:0;box-sizing:border-box;
  padding:6px 15px;border:1px solid rgba(255,255,255,.14);border-radius:12px;cursor:pointer;position:relative;overflow:hidden;
  font:600 20px/1 ui-sans-serif,system-ui,sans-serif;color:#fff;background:#0f1115;
  box-shadow:0 1px 2px rgba(0,0,0,.25);transition:opacity .15s,background .15s}
.gb .grabbarr-inner{display:inline-flex;align-items:center;gap:9px;white-space:nowrap}
.gb.gb-locked .grabbarr-inner{position:absolute;inset:0;justify-content:center}
.gb img,.gb svg{width:24px;height:24px;display:block}
.gb .gb-spin{transform-origin:center;animation:gb-spin .7s linear infinite}
.gb:hover{background:#1c2128}
.gb[data-state="busy"]{cursor:default}
.gb[data-state="grabbed"]{background:#fff;color:#0f1115;cursor:default;
  box-shadow:0 1px 2px rgba(0,0,0,.25),inset 0 0 0 1px rgba(0,0,0,.08)}
.gb[data-state="grabbed"] svg{color:#16a34a}
.gb[data-state="downloading"]{background:#fef3c7;color:#0f1115;cursor:default}
.gb[data-state="downloading"] svg{color:#d97706}
.gb[data-state="error"]{background:#dc2626;color:#fff}
.gb[data-remove="armed"]{background:#dc2626;color:#fff;cursor:pointer}
.gb[data-remove="armed"] svg{color:#fff}
.gb[data-state="removing"]{background:#b91c1c;color:#fff;cursor:default}
.gb[data-state="removing"] svg{color:#fff}
@keyframes gb-spin{to{transform:rotate(360deg)}}
/* TV button and the season overlay share one width so they line up as one control. */
.gb-wrap{position:relative;display:inline-flex;--gb-menu-w:15rem}
.gb.gb-tv{width:var(--gb-menu-w)}
/* Font-relative sizes (em/rem) keep it scaling cleanly; min-width:0 + ellipsis on rows
   prevents a horizontal scrollbar at large font scales. */
.gb-menu{position:absolute;top:100%;left:0;margin-top:.4em;z-index:10;box-sizing:border-box;
  width:var(--gb-menu-w);max-width:92vw;
  background:#0f1115;color:#e6e8eb;border:1px solid rgba(255,255,255,.12);border-radius:.7em;
  box-shadow:0 10px 40px rgba(0,0,0,.5);font:600 13px/1.3 ui-sans-serif,system-ui,sans-serif;overflow:hidden}
.gb-menu *{box-sizing:border-box}
.gb-menu-title{padding:.7em .85em;border-bottom:1px solid rgba(255,255,255,.08);font-weight:700;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gb-menu-list{max-height:60vh;overflow-y:auto;overflow-x:hidden;padding:.3em}
.gb-menu-row{display:flex;align-items:center;gap:.6em;width:100%;text-align:left;background:transparent;
  border:0;color:inherit;font:inherit;padding:.55em;border-radius:.5em}
button.gb-menu-row{cursor:pointer}
button.gb-menu-row:hover{background:rgba(255,255,255,.08)}
button.gb-menu-row:disabled{cursor:default;opacity:.6}
.gb-menu-icon{width:1.25em;height:1.25em;flex:none;display:block}
.gb-menu-label{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gb-menu-state{flex:none;font-size:.92em;color:#8b93a1;font-weight:600;white-space:nowrap;
  display:inline-flex;align-items:center}
.gb-menu-row.gb-on .gb-menu-state{color:#16a34a}
.gb-menu-foot{padding:.3em;border-top:1px solid rgba(255,255,255,.08)}
.gb-menu-remove{display:flex;align-items:center;justify-content:center;gap:.5em;width:100%;border:0;
  border-radius:.5em;background:rgba(220,38,38,.15);color:#fca5a5;font:inherit;font-weight:700;
  padding:.6em;cursor:pointer}
.gb-menu-remove:hover{background:rgba(220,38,38,.25)}
.gb-menu-remove:disabled{cursor:default;opacity:.7}
.gb-menu svg{width:1.1em;height:1.1em;display:block}
.gb-menu .gb-spin{transform-origin:center;animation:gb-spin .7s linear infinite}`;

function buildInner(visual: Element, labelText: string): HTMLSpanElement {
    const inner = document.createElement('span');
    inner.className = 'grabbarr-inner';
    const label = document.createElement('span');
    label.className = 'grabbarr-label';
    label.textContent = labelText;
    inner.append(visual, label);
    return inner;
}

export function injectButton(
    media: MediaContext,
    anchor: HTMLElement,
    placement: AnchorPlacement = 'after',
    slot?: string,
): void {
    if (document.getElementById(BUTTON_ID)) return;

    const appName = media.mediaType === 'movie' ? 'Radarr' : 'Sonarr';
    const idleLabel = `Grab to ${appName}`;

    // Render the button inside a Shadow DOM so site CSS (e.g. Rotten Tomatoes'
    // `button {}` / slot styles) can never override our styling or size. The host
    // is the only thing in the page; its box is locked down with inline styles so
    // even `::slotted(...)` rules can't pollute it.
    const host = document.createElement('span');
    host.id = BUTTON_ID;
    // Keep the (possibly slotted, e.g. Rotten Tomatoes) host's layout untouched —
    // the season menu anchors to an in-shadow wrapper, not the host.
    host.style.cssText = 'all:initial;display:inline-flex;vertical-align:middle;margin-left:12px';
    // Project the host into the named slot so it renders (web-component sites).
    if (slot) host.slot = slot;
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = BUTTON_CSS;
    root.append(style);

    // Wrapper is the positioned container for the season-menu popover, so we never
    // touch the host's positioning (which would break slotted hosts like RT).
    const wrap = document.createElement('span');
    wrap.className = 'gb-wrap';
    root.append(wrap);

    const btn = document.createElement('button');
    btn.className = 'gb';
    btn.type = 'button';
    btn.dataset.state = 'idle';
    btn.append(buildInner(grabIcon(), idleLabel));
    wrap.append(btn);

    let present: { app: AppKind; arrId: number; status: ItemStatus; key: string } | null = null;
    let removeCounter = 0;
    let tvSeasons: SeasonInfo[] = []; // TV only — cached season list for the menu

    /** Swap content with a horizontal slide. dir=+1 enters from the right, -1 from the left. */
    const swap = (visual: Element, text: string, dir: number): void => {
        const next = buildInner(visual, text);
        btn.append(next);
        const olds = [...btn.querySelectorAll('.grabbarr-inner')].slice(0, -1);
        next.animate(
            [
                { transform: `translateX(${dir * 100}%)`, opacity: 0 },
                { transform: 'translateX(0)', opacity: 1 },
            ],
            { duration: 200, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'backwards' },
        );
        for (const old of olds) {
            old.animate(
                [
                    { transform: 'translateX(0)', opacity: 1 },
                    { transform: `translateX(${-dir * 100}%)`, opacity: 0 },
                ],
                { duration: 200, easing: 'cubic-bezier(.4,0,.2,1)' },
            ).onfinish = () => old.remove();
        }
    };

    const toIdle = (dir = 1) => {
        present = null;
        removeCounter = 0;
        btn.dataset.state = 'idle';
        delete btn.dataset.remove;
        btn.title = idleLabel;
        swap(grabIcon(), idleLabel, dir);
    };

    // 'added' has no download info yet, so show where it lives ("In Radarr"/"In Sonarr").
    const labelFor = (status: ItemStatus) => (status === 'added' ? `In ${appName}` : statusLabel(status));

    const showPresent = (dir = 1) => {
        if (!present) return;
        btn.dataset.state = dataStateFor(present.status);
        delete btn.dataset.remove;
        btn.title = `${labelFor(present.status)} · hover to delete`;
        swap(checkSvg(), labelFor(present.status), dir);
    };

    // Two-click confirm: first armed click → "Confirm?", second → remove.
    const armLabel = (counter: number) => (counter === REMOVE_CLICKS ? 'Delete' : 'Confirm?');

    const showArmed = () => {
        btn.dataset.remove = 'armed';
        btn.title = 'Click to delete from your library';
        swap(trashSvg(), armLabel(removeCounter), -1);
    };

    /** Update the visible label in place (no slide) — used for the click countdown. */
    const setLabelText = (text: string) => {
        const inners = btn.querySelectorAll('.grabbarr-inner');
        const label = inners[inners.length - 1]?.querySelector('.grabbarr-label');
        if (label) label.textContent = text;
    };

    /** Swap just the icon in place (no slide) — used to show loading without a stage change. */
    const setVisual = (visual: Element) => {
        const inners = btn.querySelectorAll('.grabbarr-inner');
        inners[inners.length - 1]?.firstElementChild?.replaceWith(visual);
    };

    const markPresent = (status: ItemStatus, app: AppKind, arrId: number, key: string, dir = 1) => {
        present = { app, arrId, status, key };
        showPresent(dir);
    };

    const doRemove = async () => {
        if (!present) return;
        btn.dataset.state = 'removing';
        delete btn.dataset.remove;
        swap(trashSvg(), 'Deleting…', -1);
        try {
            const res = await sendMessage({
                type: 'REMOVE',
                app: present.app,
                arrId: present.arrId,
                key: present.key,
            });
            if (res.ok) {
                toIdle(-1);
            } else {
                btn.title = res.error ?? 'Delete failed';
                showPresent(1);
            }
        } catch (err) {
            btn.title = String(err);
            showPresent(1);
        }
    };

    const doGrab = async () => {
        btn.dataset.state = 'busy';
        setVisual(spinnerSvg()); // keep the label; just spin the icon, then slide to success
        try {
            const res = await sendMessage({ type: 'GRAB', media });
            if (res.ok && res.entry) {
                markPresent(res.entry.status, res.entry.app, res.entry.arrId, res.entry.key, 1);
            } else if (res.needsConfig) {
                btn.dataset.state = 'error';
                swap(grabIcon(), 'Configure first', 1);
            } else {
                btn.dataset.state = 'error';
                btn.title = ('error' in res && res.error) || 'Failed';
                swap(grabIcon(), 'Failed', 1);
            }
        } catch (err) {
            btn.dataset.state = 'error';
            btn.title = String(err);
            swap(grabIcon(), 'Failed', 1);
        }
    };

    // TV is season-aware: clicking opens the season menu (no hover-arm, no inline
    // remove). Movies keep the one-click grab + two-click hover-arm remove toggle.
    if (media.mediaType === 'tv') {
        btn.classList.add('gb-tv'); // fixed width matching the season overlay
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (btn.dataset.state === 'busy' || btn.dataset.state === 'removing') return;
            toggleSeasonMenu({
                button: btn,
                title: media.title,
                seasons: () => tvSeasons,
                present: () => !!present,
                load: async () => {
                    const res = await sendMessage({ type: 'CHECK_STATUS', media });
                    if (res.seasons) tvSeasons = res.seasons;
                    // Capture identity if the initial reflect hadn't resolved yet.
                    if (!present && res.present && res.status && res.arrId && res.key) {
                        markPresent(res.status, APP_FOR[media.mediaType], res.arrId, res.key, 1);
                    }
                },
                onRequest: async (season) => {
                    const res = await sendMessage({ type: 'REQUEST_SEASON', media, arrId: present?.arrId, season });
                    if (res.ok && res.entry) {
                        if (res.seasons) tvSeasons = res.seasons;
                        markPresent(res.entry.status, res.entry.app, res.entry.arrId, res.entry.key, 1);
                    }
                    return res;
                },
                onRemove: async () => {
                    if (!present) return { ok: false, error: 'Not in library' };
                    const res = await sendMessage({
                        type: 'REMOVE',
                        app: present.app,
                        arrId: present.arrId,
                        key: present.key,
                    });
                    if (res.ok) {
                        // No longer in the library: drop the monitored/downloaded state so a
                        // reopened menu shows every season as requestable again (issue: stale "Requested").
                        tvSeasons = tvSeasons.map((s) => ({ ...s, monitored: false, episodeFileCount: 0 }));
                        toIdle(-1);
                    }
                    return res;
                },
            });
        });
    } else {
        // Hover arms/disarms the remove flow while the item is present.
        btn.addEventListener('mouseenter', () => {
            if (!present || btn.dataset.state === 'removing') return;
            removeCounter = REMOVE_CLICKS;
            showArmed();
        });
        btn.addEventListener('mouseleave', () => {
            if (present && btn.dataset.remove === 'armed') {
                removeCounter = 0;
                showPresent(1);
            }
        });
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const state = btn.dataset.state;
            if (state === 'busy' || state === 'removing') return;
            if (present) {
                if (btn.dataset.remove !== 'armed') {
                    removeCounter = REMOVE_CLICKS; // e.g. touch devices with no hover
                    showArmed();
                    return;
                }
                removeCounter -= 1;
                if (removeCounter > 0) setLabelText(armLabel(removeCounter));
                else void doRemove();
                return;
            }
            void doGrab();
        });
    }

    if (placement === 'append') anchor.appendChild(host);
    else anchor.insertAdjacentElement('afterend', host);

    // Register this button so a removal elsewhere (popup / another tab) resets it.
    activeButton = {
        presentKey: () => present?.key,
        reset: () => {
            tvSeasons = tvSeasons.map((s) => ({ ...s, monitored: false, episodeFileCount: 0 }));
            toIdle(-1);
        },
    };

    // Movies pin a text-fit width; TV uses the fixed overlay-matching width (CSS).
    lockSize(btn, appName, media.mediaType !== 'tv');

    // Reflect existing *arr status without blocking injection.
    void reflectExisting(media, btn, markPresent, (s) => {
        tvSeasons = s ?? [];
    });
}

/**
 * Fix the button's width/height to fit the widest label it can ever show, so it
 * never resizes between states. Measured with the inner in static flow, before
 * `gb-locked` makes inners absolutely-positioned (for the overlapping slide).
 */
function lockSize(btn: HTMLButtonElement, appName: string, pinWidth: boolean): void {
    const label = btn.querySelector<HTMLElement>('.grabbarr-label');
    if (!label) return;
    const original = label.textContent;
    // Only the (movie) text-fit path needs to measure the widest label; TV gets its
    // width from CSS (matching the overlay), so it just needs the height pinned.
    const candidates = [
        `Grab to ${appName}`,
        `In ${appName}`,
        'Deleting…',
        'Configure first',
        'Failed',
        'Delete',
        'Confirm?',
        ...(Object.keys(STATUS_META) as ItemStatus[]).map(statusLabel),
    ];

    // If layout isn't ready yet (slotted host not projected, a display:none
    // ancestor, etc.) offsetWidth/Height reads 0. Pinning that would make the button
    // permanently zero-sized, so retry on later frames and only pin once we get
    // a positive measurement.
    const MAX_ATTEMPTS = 30;
    const attempt = (n: number): void => {
        let maxW = 0;
        if (pinWidth) {
            for (const text of candidates) {
                label.textContent = text;
                maxW = Math.max(maxW, btn.offsetWidth);
            }
            label.textContent = original;
        }
        const height = btn.offsetHeight;
        if ((pinWidth && maxW === 0) || height === 0) {
            if (n < MAX_ATTEMPTS) requestAnimationFrame(() => attempt(n + 1));
            return;
        }
        if (pinWidth) btn.style.width = `${maxW}px`;
        btn.style.height = `${height}px`;
        btn.classList.add('gb-locked');
    };
    attempt(0);
}

async function reflectExisting(
    media: MediaContext,
    btn: HTMLButtonElement,
    markPresent: (status: ItemStatus, app: AppKind, arrId: number, key: string, dir?: number) => void,
    setSeasons: (seasons?: SeasonInfo[]) => void,
): Promise<void> {
    try {
        const res = await sendMessage({ type: 'CHECK_STATUS', media });
        setSeasons(res.seasons); // TV: cache the season list for the menu (undefined → none)
        // Only override the idle state — never clobber an in-flight/just-grabbed button.
        if (res.present && res.status && res.arrId && res.key && btn.dataset.state === 'idle') {
            markPresent(res.status, APP_FOR[media.mediaType], res.arrId, res.key, 1);
        }
    } catch {
        // Background unreachable or app misconfigured — leave the button grabbable.
    }
}

export { BUTTON_ID };
