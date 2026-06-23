import { defineManifest } from '@crxjs/vite-plugin';

// Hosts whose pages get the content script injected. Adding a site means adding
// an adapter (src/content/adapters) AND a matching entry here.
const SITE_MATCHES = [
    'https://www.imdb.com/title/*',
    'https://www.themoviedb.org/movie/*',
    'https://www.themoviedb.org/tv/*',
    'https://www.rottentomatoes.com/m/*',
    'https://www.rottentomatoes.com/tv/*',
    'https://www.kinopoisk.ru/film/*',
    'https://www.kinopoisk.ru/series/*',
];

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
            matches: SITE_MATCHES.map((m) => new URL(m).origin + '/*'),
        },
    ],
});
