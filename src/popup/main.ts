import '../styles.css';
import { gearSvg, refreshSvg, trashSvg } from '../shared/icons';
import { PageState, sendMessage, sendToTab } from '../shared/messages';
import { applyStatusUpdates, getHistory } from '../shared/storage';
import { clear, el } from '../shared/dom';
import { STATUS_META } from '../shared/status-ui';
import { HistoryEntry, ItemStatus, REMOVE_CLICKS, SITES } from '../shared/types';

const root = document.getElementById('app')!;
const siteLabel = (id: string) => SITES.find((s) => s.id === id)?.label ?? id;

// Spinner toggle for the refresh glyph; set when the header renders.
let setRefreshSpinning: ((on: boolean) => void) | null = null;
let refreshing = false;

function header(): HTMLElement {
    const refreshGlyph = refreshSvg(20);
    // Spin continuously while in flight, but always land on a full 360° boundary:
    // a stop request waits for the next `animationiteration` so even an instant
    // refresh still shows one complete spin instead of stopping mid-rotation.
    let spinning = false;
    setRefreshSpinning = (on) => {
        if (on) {
            spinning = true;
            refreshGlyph.classList.add('animate-spin');
            return;
        }
        spinning = false;
        if (!refreshGlyph.classList.contains('animate-spin')) return;
        refreshGlyph.addEventListener(
            'animationiteration',
            () => {
                if (!spinning) refreshGlyph.classList.remove('animate-spin');
            },
            { once: true },
        );
    };
    return el(
        'header',
        { class: 'flex items-center justify-between px-4 py-3 border-b border-white/10' },
        el(
            'div',
            { class: 'flex items-center gap-2' },
            el('img', { src: chrome.runtime.getURL('icons/icon128.png'), class: 'w-7 h-7', alt: '' }),
            el('h1', { class: 'text-sm font-semibold tracking-wide', text: 'Grabbarr' }),
        ),
        el(
            'div',
            { class: 'flex items-center gap-1' },
            iconButton(refreshGlyph, 'Refresh status', () => void runRefresh()),
            iconButton(gearSvg(20), 'Settings', () => chrome.runtime.openOptionsPage()),
        ),
    );
}

/** Run a status refresh, spinning the refresh glyph while it's in flight. */
async function runRefresh(): Promise<void> {
    if (refreshing) return;
    refreshing = true;
    setRefreshSpinning?.(true);
    try {
        await refresh();
    } finally {
        refreshing = false;
        setRefreshSpinning?.(false);
    }
}

function iconButton(icon: Node, title: string, onClick: () => void): HTMLElement {
    return el(
        'button',
        {
            class: 'w-10 h-10 rounded-md flex items-center justify-center text-zinc-300 hover:bg-white/10 hover:text-white transition',
            title,
            onClick,
        },
        icon,
    );
}

/** Status as a small coloured tag for the metadata line. */
function statusTag(status: ItemStatus): HTMLElement {
    const meta = STATUS_META[status];
    return el('span', {
        class: `status-tag px-1.5 py-0.5 rounded text-[10px] font-semibold ${meta.classes}`,
        text: meta.label,
    });
}

// Pre-measured (once) width of the widest remove label, so the pill never
// resizes between "Remove" and "Confirm?".
let removeLabelWidth = 0;
function measureRemoveLabelWidth(): number {
    if (removeLabelWidth) return removeLabelWidth;
    const probe = el('span', {
        style: 'position:absolute;visibility:hidden;white-space:nowrap;font-size:11px;font-weight:600',
    });
    document.body.append(probe);
    for (const t of ['Delete', 'Confirm?']) {
        probe.textContent = t;
        removeLabelWidth = Math.max(removeLabelWidth, probe.offsetWidth);
    }
    probe.remove();
    return removeLabelWidth;
}

/**
 * Always-visible red "Remove" pill (fixed width, no layout shift). Two clicks to
 * remove: "Remove" → "Confirm?" → done; leaving the control resets it.
 */
function removeControl(entry: HistoryEntry): HTMLElement {
    const slot = el('div', { class: 'flex items-center justify-end shrink-0' });
    const labelW = measureRemoveLabelWidth();
    let counter = REMOVE_CLICKS;
    let busy = false;

    const label = () => (counter === REMOVE_CLICKS ? 'Delete' : 'Confirm?');

    const render = (): void => {
        clear(slot);
        if (busy) {
            slot.append(el('span', { class: 'text-[11px] text-zinc-400', text: 'Deleting…' }));
            return;
        }
        slot.append(
            el(
                'button',
                {
                    class: 'h-7 px-2.5 gap-1.5 rounded-md flex items-center bg-red-600 hover:bg-red-500 text-white text-[11px] font-semibold transition',
                    title: 'Delete from library',
                    onMouseleave: reset,
                    onClick: step,
                },
                trashSvg(14),
                el('span', { class: 'text-center', style: `width:${labelW}px`, text: label() }),
            ),
        );
    };

    const reset = (): void => {
        if (busy || counter === REMOVE_CLICKS) return;
        counter = REMOVE_CLICKS;
        render();
    };
    const step = (): void => {
        counter -= 1;
        if (counter > 0) render();
        else void doRemove();
    };

    const doRemove = async (): Promise<void> => {
        busy = true;
        render();
        const res = await sendMessage({ type: 'REMOVE', app: entry.app, arrId: entry.arrId, key: entry.key });
        if (res.ok) {
            const li = slot.closest('li');
            if (li instanceof HTMLElement) {
                li.style.transition = 'opacity .2s';
                li.style.opacity = '0';
                setTimeout(() => li.remove(), 200);
            }
        } else {
            busy = false;
            counter = REMOVE_CLICKS;
            clear(slot);
            slot.append(el('span', { class: 'text-[11px] text-red-400', text: 'Failed', title: res.error ?? '' }));
            setTimeout(render, 2500);
        }
    };

    render();
    return slot;
}

function row(entry: HistoryEntry): HTMLElement {
    const poster = entry.posterUrl
        ? el('img', { src: entry.posterUrl, class: 'w-9 h-[54px] rounded object-cover bg-white/5', alt: '' })
        : el('div', { class: 'w-9 h-[54px] rounded bg-white/5' });
    return el(
        'li',
        { class: 'flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.03]', 'data-key': entry.key },
        poster,
        el(
            'div',
            { class: 'min-w-0 flex-1' },
            el('div', { class: 'truncate text-sm font-medium', text: `${entry.title}${entry.year ? ` (${entry.year})` : ''}` }),
            el(
                'div',
                { class: 'mt-1 flex items-center gap-1.5 text-[11px] text-zinc-400' },
                statusTag(entry.status),
                el('span', { text: '·' }),
                el('span', { text: siteLabel(entry.site) }),
                el('span', { text: '·' }),
                el('span', { text: entry.app === 'radarr' ? 'Radarr' : 'Sonarr' }),
            ),
        ),
        removeControl(entry),
    );
}

function emptyState(): HTMLElement {
    return el(
        'div',
        { class: 'px-6 py-12 text-center text-sm text-zinc-400' },
        el('p', { text: 'No grabs yet.' }),
        el('p', { class: 'mt-1 text-zinc-500', text: 'Open a movie or show on a supported site and hit Grab.' }),
    );
}

function render(history: HistoryEntry[]): void {
    clear(root);
    root.append(header());
    if (history.length === 0) {
        root.append(emptyState());
        return;
    }
    const list = el('ul', { class: 'max-h-[500px] overflow-y-auto divide-y divide-white/5' });
    history.forEach((e) => list.append(row(e)));
    root.append(list);
}

/**
 * Reconcile a recomputed status against the current one. A recently added item
 * (current status 'added') with no file yet hasn't failed, so never downgrade it
 * to 'missing' — keep 'added' until it actually advances.
 */
function reconcileStatus(current: ItemStatus, next: ItemStatus): ItemStatus {
    if (current === 'added' && next === 'missing') return 'added';
    return next;
}

async function refresh(): Promise<void> {
    const history = await getHistory();
    if (history.length === 0) return;
    const res = await sendMessage({
        type: 'REFRESH_STATUS',
        entries: history.map((e) => ({ key: e.key, app: e.app, arrId: e.arrId })),
    });
    const updates: Record<string, ItemStatus> = {};
    for (const e of history) {
        const raw = res.statuses[e.key];
        if (!raw) continue;
        const next = reconcileStatus(e.status, raw);
        if (next === e.status) continue;
        updates[e.key] = next;
        const tag = root.querySelector(`li[data-key="${CSS.escape(e.key)}"] .status-tag`);
        tag?.replaceWith(statusTag(next));
    }
    if (Object.keys(updates).length > 0) await applyStatusUpdates(updates);
}

/** Footer that launches the element picker on the active tab (supported pages only). */
async function detectionFooter(): Promise<HTMLElement | null> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return null;
    let state: PageState;
    try {
        state = await sendToTab(tab.id, { type: 'GET_PAGE_STATE' });
    } catch {
        return null; // no content script on this page (unsupported / restricted)
    }
    if (!state.supported) return null;
    const tabId = tab.id;
    return el(
        'footer',
        { class: 'border-t border-white/10 p-3' },
        el('button', {
            class: 'w-full rounded-lg bg-white/10 hover:bg-white/15 px-3 py-2 text-sm font-medium transition',
            text: state.detected ? 'Fix detection on this page' : 'Set up detection on this page',
            onClick: async () => {
                await sendToTab(tabId, { type: 'ACTIVATE_PICKER' });
                window.close(); // picker lives on the page
            },
        }),
    );
}

async function init(): Promise<void> {
    const history = await getHistory();
    render(history);
    void runRefresh(); // fire-and-forget; pills update in place, refresh glyph spins
    const footer = await detectionFooter();
    if (footer) root.append(footer);
}

void init();
