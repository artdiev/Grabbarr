import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import manifest from './src/manifest.config';

export default defineConfig({
    plugins: [
        tailwindcss(),
        crx({ manifest }),
    ],
    server: {
        // crxjs needs a stable port for HMR of content scripts
        port: 5173,
        strictPort: true,
        hmr: {
            port: 5173,
        },
    },
});
