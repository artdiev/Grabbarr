import '../styles.css';
import { sendMessage } from '../shared/messages';
import { clearOverride, getConfig, setConfig } from '../shared/storage';
import { clear, el } from '../shared/dom';
import { AppKind, ArrChoices, Config, DEFAULT_CONFIG, SITES, SiteId, SiteOverride } from '../shared/types';

const root = document.getElementById('app')!;

// Working copy + transient per-app data (connection state, fetched choices).
let config: Config = structuredClone(DEFAULT_CONFIG);
const choices: Partial<Record<AppKind, ArrChoices>> = {};
const conn: Partial<Record<AppKind, { ok: boolean; msg: string }>> = {};

const APPS: { app: AppKind; label: string; kind: string }[] = [
    { app: 'radarr', label: 'Radarr', kind: 'movies' },
    { app: 'sonarr', label: 'Sonarr', kind: 'TV shows' },
];

/** Request host permission for the user's *arr origin (needs a user gesture). */
async function ensureOriginPermission(url: string): Promise<boolean> {
    let origin: string;
    try {
        origin = new URL(url).origin + '/*';
    } catch {
        return false;
    }
    if (await chrome.permissions.contains({ origins: [origin] })) return true;
    return chrome.permissions.request({ origins: [origin] });
}

function field(labelText: string, input: HTMLElement): HTMLElement {
    return el(
        'label',
        { class: 'block' },
        el('span', { class: 'block mb-1 text-xs font-medium text-zinc-400', text: labelText }),
        input,
    );
}

const inputCls =
    'w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm outline-none focus:border-emerald-500/60';

function appSection(app: AppKind, label: string, kind: string): HTMLElement {
    const cfg = config[app];
    const c = choices[app];
    const status = conn[app];

    const urlInput = el('input', {
        class: inputCls,
        type: 'url',
        placeholder: 'http://localhost:7878',
        value: cfg.url,
        oninput: (e: Event) => (config[app].url = (e.target as HTMLInputElement).value.trim()),
    });
    const keyInput = el('input', {
        class: inputCls,
        type: 'password',
        placeholder: 'API key',
        value: cfg.apiKey,
        oninput: (e: Event) => (config[app].apiKey = (e.target as HTMLInputElement).value.trim()),
    });

    const profileSelect = el(
        'select',
        {
            class: `${inputCls} disabled:opacity-50`,
            disabled: !c,
            onchange: (e: Event) => (config[app].qualityProfileId = Number((e.target as HTMLSelectElement).value)),
        },
        ...(c
            ? c.qualityProfiles.map((p) =>
                  el('option', { value: String(p.id), selected: cfg.qualityProfileId === p.id, text: p.name }),
              )
            : [el('option', { text: 'Test connection to load…' })]),
    );

    const folderSelect = el(
        'select',
        {
            class: `${inputCls} disabled:opacity-50`,
            disabled: !c,
            onchange: (e: Event) => (config[app].rootFolderPath = (e.target as HTMLSelectElement).value),
        },
        ...(c
            ? c.rootFolders.map((r) =>
                  el('option', { value: r.path, selected: cfg.rootFolderPath === r.path, text: r.path }),
              )
            : [el('option', { text: 'Test connection to load…' })]),
    );

    const testBtn = el('button', {
        class: 'rounded-lg bg-white/10 hover:bg-white/15 px-3 py-2 text-sm font-medium transition',
        type: 'button',
        text: 'Test connection',
        onClick: () => void testConnection(app),
    });

    const statusEl = status
        ? el('span', {
              class: `text-xs ${status.ok ? 'text-emerald-400' : 'text-red-400'}`,
              text: status.msg,
          })
        : null;

    return el(
        'section',
        { class: 'rounded-xl border border-white/10 bg-white/[0.02] p-5 space-y-4' },
        el(
            'div',
            { class: 'flex items-baseline justify-between' },
            el('h2', { class: 'text-base font-semibold', text: label }),
            el('span', { class: 'text-xs text-zinc-500', text: `for ${kind}` }),
        ),
        field('Server URL', urlInput),
        field('API key', keyInput),
        el('div', { class: 'flex items-center gap-3' }, testBtn, statusEl),
        el(
            'div',
            { class: 'grid grid-cols-2 gap-3' },
            field('Quality profile', profileSelect),
            field('Root folder', folderSelect),
        ),
    );
}

function sitesSection(): HTMLElement {
    return el(
        'section',
        { class: 'rounded-xl border border-white/10 bg-white/[0.02] p-5' },
        el('h2', { class: 'text-base font-semibold mb-3', text: 'Sites' }),
        el(
            'div',
            { class: 'grid grid-cols-2 gap-2' },
            ...SITES.map((s) => siteToggle(s.id, s.label)),
        ),
    );
}

function siteToggle(id: SiteId, label: string): HTMLElement {
    const checkbox = el('input', {
        type: 'checkbox',
        class: 'accent-emerald-500 w-4 h-4',
        checked: config.siteEnabled[id],
        onchange: (e: Event) => (config.siteEnabled[id] = (e.target as HTMLInputElement).checked),
    });
    return el(
        'label',
        { class: 'flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm cursor-pointer' },
        checkbox,
        el('span', { text: label }),
    );
}

function saveBar(): HTMLElement {
    const msg = el('span', { class: 'text-sm text-emerald-400', text: '' });
    const btn = el('button', {
        class: 'rounded-lg bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-semibold px-5 py-2 text-sm transition',
        type: 'button',
        text: 'Save settings',
        onClick: async () => {
            await setConfig(config);
            msg.textContent = 'Saved!';
            setTimeout(() => (msg.textContent = ''), 2000);
        },
    });
    return el('div', { class: 'flex items-center gap-3 pt-2' }, btn, msg);
}

async function testConnection(app: AppKind): Promise<void> {
    const { url, apiKey } = config[app];
    if (!url || !apiKey) {
        conn[app] = { ok: false, msg: 'Enter URL and API key first' };
        return render();
    }
    conn[app] = { ok: true, msg: 'Testing…' };
    render();
    const granted = await ensureOriginPermission(url);
    if (!granted) {
        conn[app] = { ok: false, msg: 'Permission denied for that URL' };
        return render();
    }
    const res = await sendMessage({ type: 'TEST_CONN', app, url, apiKey });
    if (res.ok && res.choices) {
        choices[app] = res.choices;
        conn[app] = { ok: true, msg: `Connected${res.version ? ` (v${res.version})` : ''}` };
        // Default selections to the first option when none chosen yet.
        config[app].qualityProfileId ??= res.choices.qualityProfiles[0]?.id;
        config[app].rootFolderPath ??= res.choices.rootFolders[0]?.path;
    } else {
        conn[app] = { ok: false, msg: res.error ?? 'Connection failed' };
    }
    render();
}

function overrideSummary(o: SiteOverride): string {
    const parts: string[] = [];
    if (o.titleSelector) parts.push('title');
    if (o.yearSelector) parts.push('year');
    if (o.anchorSelector) parts.push('button location');
    if (o.mediaType) parts.push(`type=${o.mediaType}`);
    return parts.length ? `Custom: ${parts.join(', ')}` : 'Custom';
}

function overridesSection(): HTMLElement | null {
    const customized = SITES.filter((s) => {
        const o = config.overrides[s.id];
        return o && Object.keys(o).length > 0;
    });
    return el(
        'section',
        { class: 'rounded-xl border border-white/10 bg-white/[0.02] p-5' },
        el('h2', { class: 'text-base font-semibold mb-1', text: 'Custom detection' }),
        el('p', {
            class: 'text-xs text-zinc-500 mb-3',
            text: 'Overrides captured with the on-page element picker. Open a supported page and use “Fix detection on this page” in the popup to create them.',
        }),
        customized.length === 0
            ? el('p', { class: 'text-sm text-zinc-400', text: 'No custom detection saved.' })
            : el(
                  'div',
                  { class: 'space-y-2' },
                  ...customized.map((s) =>
                      el(
                          'div',
                          { class: 'flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2' },
                          el(
                              'div',
                              { class: 'min-w-0 flex-1' },
                              el('div', { class: 'text-sm font-medium', text: s.label }),
                              el('div', { class: 'text-[11px] text-zinc-400', text: overrideSummary(config.overrides[s.id]!) }),
                          ),
                          el('button', {
                              class: 'rounded-lg bg-white/10 hover:bg-red-500/20 hover:text-red-300 px-3 py-1.5 text-xs font-medium transition',
                              text: 'Reset',
                              onClick: async () => {
                                  await clearOverride(s.id);
                                  delete config.overrides[s.id];
                                  render();
                              },
                          }),
                      ),
                  ),
              ),
    );
}

function render(): void {
    clear(root);
    root.append(
        el(
            'div',
            { class: 'space-y-6' },
            el('h1', { class: 'text-xl font-bold', text: 'Grabbarr settings' }),
            ...APPS.map((a) => appSection(a.app, a.label, a.kind)),
            sitesSection(),
            overridesSection(),
            saveBar(),
        ),
    );
}

async function init(): Promise<void> {
    config = await getConfig();
    render();
}

void init();
