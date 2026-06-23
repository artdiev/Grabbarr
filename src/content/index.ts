// Content entry: pick the adapter for this URL, wait for the page to populate
// (these are all SPAs), apply any user override, then inject the grab button.
// Also hosts the element picker (launched from the popup or the auto-prompt).

import { PageState, TabMessage } from '../shared/messages';
import { getConfig, getOverride, isSiteEnabled } from '../shared/storage';
import { adapterForUrl } from './adapters/registry';
import { SiteAdapter } from './adapters/types';
import { BUTTON_ID, injectButton } from './inject';
import { openPicker } from './picker';
import { applyOverrides } from './overrides';

const PROMPT_ID = 'grabbarr-prompt';

/** Resolve adapter + override for the current page, if any. */
async function currentDetection(): Promise<{
    adapter: SiteAdapter;
    media: ReturnType<typeof applyOverrides>['media'];
    anchor: HTMLElement | null;
} | null> {
    const adapter = adapterForUrl(location.href);
    if (!adapter) return null;
    const config = await getConfig();
    if (!isSiteEnabled(config, adapter.id)) return { adapter, media: null, anchor: null };
    const { media, anchor } = applyOverrides(adapter, getOverride(config, adapter.id));
    return { adapter, media, anchor };
}

async function tryInject(): Promise<boolean> {
    if (document.getElementById(BUTTON_ID)) return true;
    const adapter = adapterForUrl(location.href);
    if (!adapter) return false;

    const config = await getConfig();
    if (!isSiteEnabled(config, adapter.id)) return true; // disabled → done, never inject

    const { media, anchor } = applyOverrides(adapter, getOverride(config, adapter.id));
    if (!media || !anchor) return false;

    injectButton(media, anchor, adapter.anchorPlacement, adapter.anchorSlot);
    document.getElementById(PROMPT_ID)?.remove();
    return true;
}

// SPA-friendly: retry on a short schedule, then offer the picker if still unresolved.
function run(): void {
    let attempts = 0;
    const maxAttempts = 20; // ~10s
    const tick = async () => {
        attempts++;
        const done = await tryInject();
        if (done) return;
        if (attempts < maxAttempts) {
            setTimeout(tick, 500);
        } else {
            void maybePrompt();
        }
    };
    void tick();
}

let promptDismissed = false;

/** When a supported, enabled page can't be parsed, nudge the user to set it up. */
async function maybePrompt(): Promise<void> {
    if (promptDismissed || document.getElementById(PROMPT_ID) || document.getElementById(BUTTON_ID)) return;
    const det = await currentDetection();
    if (!det || det.media) return; // unsupported, disabled, or actually fine

    const pill = document.createElement('div');
    pill.id = PROMPT_ID;
    Object.assign(pill.style, {
        position: 'fixed',
        bottom: '18px',
        right: '18px',
        zIndex: '2147483000',
        display: 'flex',
        gap: '8px',
        alignItems: 'center',
        background: '#0f1115',
        color: '#e6e8eb',
        border: '1px solid rgba(255,255,255,.12)',
        borderRadius: '999px',
        padding: '8px 10px 8px 14px',
        font: '600 13px/1 system-ui,sans-serif',
        boxShadow: '0 8px 28px rgba(0,0,0,.5)',
    });
    const label = document.createElement('span');
    label.textContent = "Grabbarr can't read this page";
    const fix = document.createElement('button');
    fix.textContent = 'Set up';
    Object.assign(fix.style, {
        border: '0',
        borderRadius: '999px',
        background: '#37c871',
        color: '#06210f',
        padding: '5px 12px',
        fontWeight: '700',
        cursor: 'pointer',
    });
    fix.addEventListener('click', () => {
        pill.remove();
        void openPicker(det.adapter, { onApplied: reinject });
    });
    const close = document.createElement('button');
    close.textContent = '×';
    Object.assign(close.style, {
        border: '0',
        background: 'transparent',
        color: '#aab1bd',
        fontSize: '16px',
        cursor: 'pointer',
    });
    close.addEventListener('click', () => {
        promptDismissed = true;
        pill.remove();
    });
    pill.append(label, fix, close);
    document.documentElement.appendChild(pill);
}

function reinject(): void {
    document.getElementById(BUTTON_ID)?.remove();
    run();
}

run();

// Re-run on SPA navigations (URL changes without full reload).
let lastUrl = location.href;
new MutationObserver(() => {
    if (location.href !== lastUrl) {
        lastUrl = location.href;
        promptDismissed = false;
        document.getElementById(BUTTON_ID)?.remove();
        document.getElementById(PROMPT_ID)?.remove();
        run();
    }
}).observe(document, { subtree: true, childList: true });

// ── Popup-directed messages ──────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg: TabMessage, _sender, sendResponse) => {
    if (msg.type === 'GET_PAGE_STATE') {
        void currentDetection().then((det): void => {
            const state: PageState = {
                supported: !!det,
                site: det?.adapter.id,
                detected: !!det?.media,
            };
            sendResponse(state);
        });
        return true;
    }
    if (msg.type === 'ACTIVATE_PICKER') {
        const adapter = adapterForUrl(location.href);
        if (adapter) void openPicker(adapter, { onApplied: reinject });
        sendResponse({ ok: !!adapter });
        return true;
    }
    return false;
});
