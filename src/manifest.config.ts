import { defineManifest } from '@crxjs/vite-plugin';

// Hosts whose pages get the content script injected. Adding a site means adding
// an adapter (src/content/adapters) AND a matching entry here.
// Both `www.` and bare-domain variants: sites redirect between them (e.g. RT
// rottentomatoes.com → www.rottentomatoes.com), and matching only `www.` can miss
// the initial document so the content script never injects.
const SITE_MATCHES = [
    'https://www.imdb.com/title/*',
    'https://imdb.com/title/*',
    'https://www.themoviedb.org/movie/*',
    'https://www.themoviedb.org/tv/*',
    'https://themoviedb.org/movie/*',
    'https://themoviedb.org/tv/*',
    'https://www.rottentomatoes.com/m/*',
    'https://www.rottentomatoes.com/tv/*',
    'https://rottentomatoes.com/m/*',
    'https://rottentomatoes.com/tv/*',
    'https://www.kinopoisk.ru/film/*',
    'https://www.kinopoisk.ru/series/*',
    'https://kinopoisk.ru/film/*',
    'https://kinopoisk.ru/series/*',
];

// Distinct origins for the supported sites (deduped — Chromium/Edge reject a
// manifest with duplicate web_accessible_resources match patterns).
const SITE_ORIGINS = [...new Set(SITE_MATCHES.map((m) => new URL(m).origin + '/*'))];

export default defineManifest({
    manifest_version: 3,
    name: 'Grabbarr',
    description: 'Grab movies and TV shows from IMDb, TMDb, Rotten Tomatoes, and Kinopoisk to Radarr/Sonarr.',
    version: '1.0.0',
    icons: {
        16: 'icons/icon16.png',
        32: 'icons/icon32.png',
        48: 'icons/icon48.png',
        128: 'icons/icon128.png',
    },
    permissions: ['storage', 'activeTab'],
    // Fixed host for the optional TMDb resolver (no runtime permission prompt needed).
    host_permissions: ['https://api.themoviedb.org/*'],
    // Self-hosted Radarr/Sonarr live at arbitrary user-supplied origins, so we
    // request host access at runtime (chrome.permissions.request) for the exact
    // URL the user configures, rather than baking a broad grant into install.
    optional_host_permissions: ['*://*/*'],
    background: {
        service_worker: 'src/background/index.ts',
        type: 'module',
    },
    content_scripts: [
        {
            matches: SITE_MATCHES,
            js: ['src/content/index.ts'],
            run_at: 'document_end',
        },
    ],
    action: {
        default_popup: 'src/popup/index.html',
        default_icon: {
            16: 'icons/icon16.png',
            32: 'icons/icon32.png',
            48: 'icons/icon48.png',
            128: 'icons/icon128.png',
        },
    },
    options_page: 'src/options/index.html',
    // The content-script grab button loads this icon via chrome.runtime.getURL,
    // so it must be reachable from the host pages.
    web_accessible_resources: [
        {
            resources: ['icons/icon32.png'],
            matches: SITE_ORIGINS,
        },
    ],
});
