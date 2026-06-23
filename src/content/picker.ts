// In-page element picker. Runs inside a Shadow DOM so the page's CSS (and our own
// injected button styles) can't interfere. Lets the user point at the title/year/
// anchor elements; captured selectors are stored as a per-site override.

import { finder } from '@medv/finder';
import { clearOverride, getOverride, setOverride } from '../shared/storage';
import { getConfig } from '../shared/storage';
import { MediaType, SiteOverride } from '../shared/types';
import { SiteAdapter } from './adapters/types';
import { applyOverrides } from './overrides';

const HOST_ID = 'grabbarr-picker-host';
const Z = 2147483600;

type PickField = 'title' | 'year' | 'anchor';
type SelectorKey = 'titleSelector' | 'yearSelector' | 'anchorSelector';
const SELECTOR_KEY: Record<PickField, SelectorKey> = {
    title: 'titleSelector',
    year: 'yearSelector',
    anchor: 'anchorSelector',
};

let active: PickerInstance | null = null;

export interface PickerCallbacks {
    /** Re-run injection after the override changes (save/reset). */
    onApplied: () => void;
}

export async function openPicker(adapter: SiteAdapter, cb: PickerCallbacks): Promise<void> {
    if (active) {
        active.focus();
        return;
    }
    const config = await getConfig();
    active = new PickerInstance(adapter, { ...getOverride(config, adapter.id) }, cb);
}

export function closePicker(): void {
    active?.destroy();
    active = null;
}

class PickerInstance {
    private host: HTMLDivElement;
    private root: ShadowRoot;
    private overlay!: HTMLDivElement;
    private panel!: HTMLDivElement;
    private banner!: HTMLDivElement;
    private arming: PickField | null = null;

    // Bound capture-phase handlers (so we can detach them precisely).
    private onMove = (e: MouseEvent) => this.handleMove(e);
    private onClick = (e: MouseEvent) => this.handleClick(e);
    private onKey = (e: KeyboardEvent) => this.handleKey(e);
    private onCtx = (e: MouseEvent) => this.cancelArm(e);

    constructor(
        private adapter: SiteAdapter,
        private working: SiteOverride,
        private cb: PickerCallbacks,
    ) {
        this.host = document.createElement('div');
        this.host.id = HOST_ID;
        this.root = this.host.attachShadow({ mode: 'open' });
        document.documentElement.appendChild(this.host);
        this.render();
    }

    focus(): void {
        this.panel.animate([{ transform: 'scale(1.02)' }, { transform: 'scale(1)' }], { duration: 150 });
    }

    destroy(): void {
        this.stopArming();
        this.host.remove();
    }

    // ── Rendering ────────────────────────────────────────────────────────────

    private render(): void {
        this.root.replaceChildren();
        const style = document.createElement('style');
        style.textContent = CSS_TEXT;
        this.root.append(style);

        this.overlay = div('gb-overlay');
        this.banner = div('gb-banner');
        this.banner.style.display = 'none';
        this.panel = div('gb-panel');
        this.root.append(this.overlay, this.banner, this.panel);
        this.renderPanel();
    }

    private renderPanel(): void {
        this.panel.replaceChildren();
        const siteLabel = this.adapter.label;

        const header = div('gb-header');
        header.append(text('strong', 'Grabbarr · customize detection'), text('span', siteLabel, 'gb-site'));
        const closeBtn = button('×', 'gb-close', () => closePicker());
        closeBtn.title = 'Close';
        header.append(closeBtn);

        const body = div('gb-body');
        body.append(
            this.fieldRow('title', 'Title'),
            this.fieldRow('year', 'Year'),
            this.mediaTypeRow(),
            this.fieldRow('anchor', 'Button location'),
            this.previewRow(),
        );

        const footer = div('gb-footer');
        footer.append(
            button('Save', 'gb-primary', () => void this.save()),
            button('Use built-in', 'gb-ghost', () => void this.reset()),
            button('Cancel', 'gb-ghost', () => closePicker()),
        );

        this.panel.append(header, body, footer);
    }

    private fieldRow(field: PickField, label: string): HTMLElement {
        const row = div('gb-row');
        const sel = this.working[SELECTOR_KEY[field]] as string | undefined;
        const preview = sel ? (this.safeText(sel) ?? '(no match yet)') : '— using built-in —';
        row.append(
            div('gb-label', label),
            text('div', preview, 'gb-value'),
            button(sel ? 'Re-pick' : 'Pick', 'gb-pick', () => this.arm(field)),
        );
        return row;
    }

    private mediaTypeRow(): HTMLElement {
        const row = div('gb-row');
        row.append(div('gb-label', 'Type'));
        const group = div('gb-seg');
        (['movie', 'tv'] as MediaType[]).forEach((t) => {
            const b = button(t === 'movie' ? 'Movie' : 'TV show', '', () => {
                this.working.mediaType = t;
                this.renderPanel();
            });
            if (this.working.mediaType === t) b.classList.add('gb-on');
            group.append(b);
        });
        const auto = button('Auto', '', () => {
            delete this.working.mediaType;
            this.renderPanel();
        });
        if (!this.working.mediaType) auto.classList.add('gb-on');
        group.append(auto);
        row.append(div('gb-value'), group);
        return row;
    }

    private previewRow(): HTMLElement {
        const { media } = applyOverrides(this.adapter, this.working);
        const row = div('gb-preview');
        if (media) {
            row.classList.add('gb-ok');
            row.textContent = `✓ ${media.title}${media.year ? ` (${media.year})` : ''} · ${
                media.mediaType === 'movie' ? 'Movie → Radarr' : 'TV → Sonarr'
            }`;
        } else {
            row.classList.add('gb-bad');
            row.textContent = '✗ Not enough to grab yet — pick a title (and set the type).';
        }
        return row;
    }

    private safeText(selector: string): string | undefined {
        try {
            return document.querySelector(selector)?.textContent?.trim() || undefined;
        } catch {
            return undefined;
        }
    }

    // ── Picking ────────────────────────────────────────────────────────────────

    private arm(field: PickField): void {
        this.arming = field;
        this.panel.style.opacity = '0.25';
        this.panel.style.pointerEvents = 'none';
        this.banner.textContent = `Click the ${field} element · Esc to cancel`;
        this.banner.style.display = 'block';
        document.addEventListener('mousemove', this.onMove, true);
        document.addEventListener('click', this.onClick, true);
        document.addEventListener('keydown', this.onKey, true);
        document.addEventListener('contextmenu', this.onCtx, true);
    }

    private stopArming(): void {
        this.arming = null;
        this.overlay.style.display = 'none';
        this.panel.style.opacity = '';
        this.panel.style.pointerEvents = '';
        this.banner.style.display = 'none';
        document.removeEventListener('mousemove', this.onMove, true);
        document.removeEventListener('click', this.onClick, true);
        document.removeEventListener('keydown', this.onKey, true);
        document.removeEventListener('contextmenu', this.onCtx, true);
    }

    /** Element under the cursor, or null if it's part of our own UI. */
    private targetAt(e: MouseEvent): HTMLElement | null {
        if (e.composedPath().includes(this.host)) return null;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        return el instanceof HTMLElement ? el : null;
    }

    private handleMove(e: MouseEvent): void {
        const el = this.targetAt(e);
        if (!el) {
            this.overlay.style.display = 'none';
            return;
        }
        const r = el.getBoundingClientRect();
        Object.assign(this.overlay.style, {
            display: 'block',
            top: `${r.top}px`,
            left: `${r.left}px`,
            width: `${r.width}px`,
            height: `${r.height}px`,
        });
    }

    private handleClick(e: MouseEvent): void {
        const el = this.targetAt(e);
        if (!this.arming) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (!el) return;
        const selector = generateSelector(el);
        this.working[SELECTOR_KEY[this.arming]] = selector;
        this.stopArming();
        this.renderPanel();
    }

    private handleKey(e: KeyboardEvent): void {
        if (e.key === 'Escape') this.cancelArm(e);
    }

    private cancelArm(e: Event): void {
        if (!this.arming) return;
        e.preventDefault();
        this.stopArming();
        this.renderPanel();
    }

    // ── Persist ──────────────────────────────────────────────────────────────

    private async save(): Promise<void> {
        await setOverride(this.adapter.id, this.working);
        this.cb.onApplied();
        closePicker();
    }

    private async reset(): Promise<void> {
        await clearOverride(this.adapter.id);
        this.working = {};
        this.cb.onApplied();
        this.renderPanel();
    }
}

// Configured so the selector generalises across every page of a site: skip
// content-specific ids and hashed/numeric class names; prefer stable attributes.
function generateSelector(el: HTMLElement): string {
    try {
        return finder(el, {
            idName: () => false,
            className: (name) => /^[a-zA-Z][\w-]*$/.test(name) && !/\d{2,}/.test(name) && name.length < 30,
            tagName: () => true,
            attr: (name, value) =>
                ['data-testid', 'data-qa', 'itemprop', 'slot', 'role'].includes(name) && value.length < 60,
        });
    } catch {
        return el.tagName.toLowerCase();
    }
}

// ── tiny DOM helpers (shadow-local; can't reuse shared/dom which targets light DOM)
function div(cls: string, txt?: string): HTMLDivElement {
    const d = document.createElement('div');
    d.className = cls;
    if (txt) d.textContent = txt;
    return d;
}
function text<K extends keyof HTMLElementTagNameMap>(tag: K, txt: string, cls = ''): HTMLElement {
    const e = document.createElement(tag);
    e.textContent = txt;
    if (cls) e.className = cls;
    return e;
}
function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener('click', onClick);
    return b;
}

const CSS_TEXT = `
:host{all:initial}
.gb-overlay{position:fixed;z-index:${Z};pointer-events:none;display:none;
  background:rgba(55,200,113,.18);border:2px solid #37c871;border-radius:4px;
  box-shadow:0 0 0 9999px rgba(0,0,0,.02)}
.gb-banner{position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:${Z + 2};
  background:#111418;color:#fff;padding:8px 14px;border-radius:999px;font:600 13px/1 system-ui,sans-serif;
  box-shadow:0 6px 20px rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.1)}
.gb-panel{position:fixed;top:16px;right:16px;z-index:${Z + 1};width:320px;
  background:#0f1115;color:#e6e8eb;border:1px solid rgba(255,255,255,.12);border-radius:14px;
  font:13px/1.4 system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.55);overflow:hidden}
.gb-header{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.08)}
.gb-header strong{font-size:13px;font-weight:700}
.gb-site{margin-left:auto;font-size:11px;color:#8b93a1}
.gb-close{margin-left:8px;background:transparent;border:0;color:#aab1bd;font-size:18px;line-height:1;cursor:pointer;padding:0 4px}
.gb-close:hover{color:#fff}
.gb-body{padding:8px 14px}
.gb-row{display:flex;align-items:center;gap:8px;padding:7px 0}
.gb-label{width:64px;flex:none;color:#8b93a1;font-size:12px}
.gb-value{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#cfd4db;font-size:12px}
.gb-pick{flex:none;background:rgba(255,255,255,.08);border:0;color:#e6e8eb;border-radius:8px;
  padding:5px 10px;font-size:12px;font-weight:600;cursor:pointer}
.gb-pick:hover{background:rgba(255,255,255,.15)}
.gb-seg{display:flex;gap:4px;flex:none}
.gb-seg button{background:rgba(255,255,255,.06);border:0;color:#cfd4db;border-radius:7px;padding:5px 8px;
  font-size:12px;font-weight:600;cursor:pointer}
.gb-seg button.gb-on{background:#37c871;color:#06210f}
.gb-preview{margin-top:6px;padding:8px 10px;border-radius:8px;font-size:12px;font-weight:600;white-space:normal}
.gb-preview.gb-ok{background:rgba(55,200,113,.14);color:#6ee7a0}
.gb-preview.gb-bad{background:rgba(220,38,38,.14);color:#fca5a5}
.gb-footer{display:flex;gap:8px;padding:12px 14px;border-top:1px solid rgba(255,255,255,.08)}
.gb-footer button{flex:1;border:0;border-radius:9px;padding:8px;font-size:13px;font-weight:700;cursor:pointer}
.gb-primary{background:#37c871;color:#06210f}
.gb-primary:hover{background:#2faa61}
.gb-ghost{background:rgba(255,255,255,.07);color:#e6e8eb}
.gb-ghost:hover{background:rgba(255,255,255,.13)}
`;
