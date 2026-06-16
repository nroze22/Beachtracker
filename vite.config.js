import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Project is served from https://<user>.github.io/beachtracker/ on GitHub Pages,
// so the base path must match the repo name. Override with BASE_PATH for other hosts
// (e.g. BASE_PATH=/ when serving from a custom domain or a tunnel root).
const base = process.env.BASE_PATH ?? '/Beachtracker/';

// A human-readable build stamp so the running app can show exactly which version
// is loaded (handy for spotting a stale PWA cache). Uses the CI commit + date.
const sha = (process.env.GITHUB_SHA || 'dev').slice(0, 7);
const buildId = `${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${sha}`;

export default defineConfig({
  base,
  define: {
    __BUILD__: JSON.stringify(buildId)
  },
  server: {
    host: true,
    port: 5173
  },
  build: {
    target: 'es2020',
    sourcemap: true
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'],
      manifest: {
        name: 'BeachTracker',
        short_name: 'BeachTracker',
        description: 'Live wildlife, ship & plane spotter for the beach.',
        theme_color: '#0b1f33',
        background_color: '#0b1f33',
        display: 'standalone',
        orientation: 'any',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // The TF.js model weights are large; cache them so the app works offline
        // after the first successful load (important for spotty beach-house wifi).
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,png,svg,json,bin}'],
        runtimeCaching: [
          {
            // COCO-SSD model files are fetched from the TF Hub / Google storage CDN.
            urlPattern: ({ url }) =>
              url.href.includes('tfhub.dev') ||
              url.href.includes('storage.googleapis.com') ||
              url.href.includes('kaggle'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'tfjs-models',
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      },
      devOptions: { enabled: false }
    })
  ]
});
