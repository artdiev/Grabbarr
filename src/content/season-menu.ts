// The TV season menu: a popover (rendered inside the grab button's Shadow DOM)
// that lists seasons and lets the user request one, all, or remove the series.
// Styling lives in the button's BUTTON_CSS (inject.ts); this module owns the DOM.

import { el } from '../shared/dom';
import { spinnerSvg, trashSvg } from '../shared/icons';
import { RemoveResult, RequestSeasonResult } from '../shared/messages';
import { REMOVE_CLICKS, SeasonInfo } from '../shared/types';

export interface SeasonMenuOpts {
    button: HTMLElement; // the grab button; the popover anchors to its (positioned) wrapper
    title: string;
    seasons: () => SeasonInfo[]; // latest season state (re-read after each request)
    present: () => boolean; // whether the series is in the library (shows Remove)
    /** Fetch the freshest season list on open (resolves once `seasons()` is current). */
    load: () => Promise<void>;
    onRequest: (season: number | 'all') => Promise<RequestSeasonResult>;
    onRemove: () => Promise<RemoveResult>;
}

let active: { close: () => void } | null = null;

/** Open the menu, or close it if it's already open (button click = toggle). */
export function toggleSeasonMenu(opts: SeasonMenuOpts): void {
    if (active) {
        active.close();
        return;
    }
    open(opts);
}

function seasonLabel(n: number): string {
    return n === 0 ? 'Specials' : `Season ${n}`;
}

/** The same extension grab icon used on the page button, sized for a menu row. */
function grabIcon(): HTMLImageElement {
    const icon = document.createElement('img');
    icon.src = chrome.runtime.getURL('icons/icon32.png');
    icon.alt = '';
    icon.className = 'gb-menu-icon';
    return icon;
}

function open(opts: SeasonMenuOpts): void {
    const container = opts.button.parentElement!; // .gb-wrap (position:relative)
    const host = (opts.button.getRootNode() as ShadowRoot).host;
    const menu = el('div', { class: 'gb-menu' });
    let loading = false;
    let closed = false;

    const onDoc = (e: Event) => {
        // Clicks on the button/menu (inside our host) are handled internally.
        if (e.composedPath().includes(host)) return;
        close();
    };
    const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') close();
    };
    const close = () => {
        closed = true;
        menu.remove();
        document.removeEventListener('click', onDoc, true);
        document.removeEventListener('keydown', onKey, true);
        active = null;
    };

    /** A clickable request row that shows a spinner while in flight. */
    const requestRow = (label: string, state: string, season: number | 'all'): HTMLElement => {
        const stateEl = el('span', { class: 'gb-menu-state', text: state });
        const row = el(
            'button',
            {
                class: 'gb-menu-row',
                type: 'button',
                onClick: async () => {
                    if ((row as HTMLButtonElement).disabled) return;
                    (row as HTMLButtonElement).disabled = true;
                    stateEl.replaceChildren(spinnerSvg(14));
                    const res = await opts.onRequest(season);
                    if (res.ok) render();
                    else if (res.needsConfig) close(); // options page was opened
                    else {
                        stateEl.replaceChildren();
                        stateEl.textContent = 'Failed';
                        (row as HTMLButtonElement).disabled = false;
                    }
                },
            },
            grabIcon(),
            el('span', { class: 'gb-menu-label', text: label }),
            stateEl,
        );
        return row;
    };

    const render = (): void => {
        const list = el('div', { class: 'gb-menu-list' });
        list.append(requestRow('All seasons', 'Request', 'all'));
        const seasons = opts.seasons();
        if (seasons.length === 0 && loading) {
            list.append(
                el(
                    'div',
                    { class: 'gb-menu-row' },
                    spinnerSvg(14),
                    el('span', { class: 'gb-menu-label', text: 'Loading seasons…' }),
                ),
            );
        }
        for (const s of seasons) {
            const label = seasonLabel(s.seasonNumber);
            if (s.monitored) {
                const have = s.episodeFileCount;
                const total = s.episodeCount;
                const progress = total != null ? `${have ?? 0}/${total}` : 'Requested';
                list.append(
                    el(
                        'div',
                        { class: 'gb-menu-row gb-on' },
                        grabIcon(),
                        el('span', { class: 'gb-menu-label', text: label }),
                        el('span', { class: 'gb-menu-state', text: `✓ ${progress}` }),
                    ),
                );
            } else {
                list.append(requestRow(label, 'Request', s.seasonNumber));
            }
        }

        const children: Node[] = [el('div', { class: 'gb-menu-title', text: opts.title }), list];
        if (opts.present()) children.push(removeFooter());
        menu.replaceChildren(...children);
    };

    // Two-click "Delete series → Confirm?" footer (matches the movie button pattern).
    const removeFooter = (): HTMLElement => {
        let counter = REMOVE_CLICKS;
        const btn = el('button', { class: 'gb-menu-remove', type: 'button' }, trashSvg(14), el('span', { text: 'Delete series' }));
        const label = btn.querySelector('span')!;
        btn.addEventListener('click', async () => {
            if ((btn as HTMLButtonElement).disabled) return;
            counter -= 1;
            if (counter > 0) {
                label.textContent = 'Confirm?';
                return;
            }
            (btn as HTMLButtonElement).disabled = true;
            label.textContent = 'Deleting…';
            const res = await opts.onRemove();
            if (res.ok) close();
            else {
                label.textContent = 'Failed';
                counter = REMOVE_CLICKS;
                (btn as HTMLButtonElement).disabled = false;
            }
        });
        // Reset the confirm countdown when the cursor leaves the button.
        btn.addEventListener('mouseleave', () => {
            if (!(btn as HTMLButtonElement).disabled) {
                counter = REMOVE_CLICKS;
                label.textContent = 'Delete series';
            }
        });
        return el('div', { class: 'gb-menu-foot' }, btn);
    };

    loading = true; // fetch fresh seasons on open (initial CHECK_STATUS may not have landed)
    render();
    container.append(menu);
    active = { close };
    document.addEventListener('click', onDoc, true);
    document.addEventListener('keydown', onKey, true);

    void opts.load().finally(() => {
        loading = false;
        if (!closed) render();
    });
}
