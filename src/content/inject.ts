// Builds the grab button, reflects the item's *arr status, and acts as a
// grab/remove toggle: when the item is already in the library, hovering arms a
// 2-click remove (undo an accidental grab). The button has a fixed, pre-computed
// width and slides its content left/right on state changes (toggle illusion).

import { checkSvg, spinnerSvg, trashSvg } from '../shared/icons';
import { sendMessage } from '../shared/messages';
import { APP_FOR, AppKind, ItemStatus, MediaContext, REMOVE_CLICKS } from '../shared/types';

const BUTTON_ID = 'grabbarr-button';

/** Where the button sits relative to the anchor: after it, or appended inside it. */
export type AnchorPlacement = 'after' | 'append';

const STATUS_LABEL: Record<ItemStatus, string> = {
    added: 'Added',
    queued: 'Queued',
    downloading: 'Downloading',
    partial: 'Partial',
    downloaded: 'Downloaded',
    missing: 'In library',
    error: 'In library',
};

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
.gb{display:inline-flex;align-items:center;justify-content:center;gap:9px;margin:0;
  padding:6px 15px;border:0;border-radius:12px;cursor:pointer;position:relative;overflow:hidden;
  font:600 20px/1 ui-sans-serif,system-ui,sans-serif;color:#fff;background:#4f46e5;
  box-shadow:0 1px 2px rgba(0,0,0,.25);transition:opacity .15s,background .15s}
.gb .grabbarr-inner{display:inline-flex;align-items:center;gap:9px;white-space:nowrap}
.gb.gb-locked .grabbarr-inner{position:absolute;inset:0;justify-content:center}
.gb img,.gb svg{width:24px;height:24px;display:block}
.gb .gb-spin{transform-origin:center;animation:gb-spin .7s linear infinite}
.gb:hover{background:#4338ca}
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
@keyframes gb-spin{to{transform:rotate(360deg)}}`;

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
    host.style.cssText = 'all:initial;display:inline-flex;vertical-align:middle;margin-left:12px';
    // Project the host into the named slot so it renders (web-component sites).
    if (slot) host.slot = slot;
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = BUTTON_CSS;
    root.append(style);

    const btn = document.createElement('button');
    btn.className = 'gb';
    btn.type = 'button';
    btn.dataset.state = 'idle';
    btn.append(buildInner(grabIcon(), idleLabel));
    root.append(btn);

    let present: { app: AppKind; arrId: number; status: ItemStatus } | null = null;
    let removeCounter = 0;

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
    const labelFor = (status: ItemStatus) => (status === 'added' ? `In ${appName}` : STATUS_LABEL[status]);

    const showPresent = (dir = 1) => {
        if (!present) return;
        btn.dataset.state = dataStateFor(present.status);
        delete btn.dataset.remove;
        btn.title = `${labelFor(present.status)} · hover to remove`;
        swap(checkSvg(), labelFor(present.status), dir);
    };

    // Two-click confirm: first armed click → "Confirm?", second → remove.
    const armLabel = (counter: number) => (counter === REMOVE_CLICKS ? 'Remove' : 'Confirm?');

    const showArmed = () => {
        btn.dataset.remove = 'armed';
        btn.title = 'Click to remove from your library';
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

    const markPresent = (status: ItemStatus, app: AppKind, arrId: number, dir = 1) => {
        present = { app, arrId, status };
        showPresent(dir);
    };

    const doRemove = async () => {
        if (!present) return;
        btn.dataset.state = 'removing';
        delete btn.dataset.remove;
        swap(trashSvg(), 'Removing…', -1);
        try {
            const res = await sendMessage({ type: 'REMOVE', app: present.app, arrId: present.arrId });
            if (res.ok) {
                toIdle(-1);
            } else {
                btn.title = res.error ?? 'Remove failed';
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
                markPresent(res.entry.status, res.entry.app, res.entry.arrId, 1);
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

    if (placement === 'append') anchor.appendChild(host);
    else anchor.insertAdjacentElement('afterend', host);

    lockSize(btn, appName);

    // Reflect existing *arr status without blocking injection.
    void reflectExisting(media, btn, markPresent);
}

/**
 * Fix the button's width/height to fit the widest label it can ever show, so it
 * never resizes between states. Measured with the inner in static flow, before
 * `gb-locked` makes inners absolutely-positioned (for the overlapping slide).
 */
function lockSize(btn: HTMLButtonElement, appName: string): void {
    const label = btn.querySelector<HTMLElement>('.grabbarr-label');
    if (!label) return;
    const original = label.textContent;
    const candidates = [
        `Grab to ${appName}`,
        `In ${appName}`,
        'Removing…',
        'Configure first',
        'Failed',
        'Remove',
        'Confirm?',
        ...Object.values(STATUS_LABEL),
    ];
    let maxW = 0;
    for (const text of candidates) {
        label.textContent = text;
        maxW = Math.max(maxW, btn.offsetWidth);
    }
    label.textContent = original;
    btn.style.width = `${maxW}px`;
    btn.style.height = `${btn.offsetHeight}px`;
    btn.classList.add('gb-locked');
}

async function reflectExisting(
    media: MediaContext,
    btn: HTMLButtonElement,
    markPresent: (status: ItemStatus, app: AppKind, arrId: number, dir?: number) => void,
): Promise<void> {
    try {
        const res = await sendMessage({ type: 'CHECK_STATUS', media });
        // Only override the idle state — never clobber an in-flight/just-grabbed button.
        if (res.present && res.status && res.arrId && btn.dataset.state === 'idle') {
            markPresent(res.status, APP_FOR[media.mediaType], res.arrId, 1);
        }
    } catch {
        // Background unreachable or app misconfigured — leave the button grabbable.
    }
}

export { BUTTON_ID };
