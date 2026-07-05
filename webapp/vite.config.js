import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Build stamp: the deployed commit + its date, surfaced discreetly in the footer so a
// visitor (and we) can tell exactly which build is live. Read from git at build time;
// falls back gracefully when git isn't available (e.g. a tarball build). CI checks out
// the repo, so `git` resolves the pushed commit that triggered the Pages deploy.
// execFileSync (no shell) with a fixed argument list — nothing here is user input.
function git(args, fallback = '') {
  try {
    return execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return fallback;
  }
}
const commitHash = git(['rev-parse', '--short', 'HEAD'], 'dev');
const commitDate = git(['log', '-1', '--format=%cI'], '');

// Static site for GitHub Pages. A RELATIVE base ('./') makes one build work both at
// the apex custom domain (https://olatu.io/) and at the project path
// (https://hadim.github.io/olatu/), so flipping the domain never breaks asset URLs.
// Assets referenced via import.meta.env.BASE_URL (favicon, map mosaics) resolve
// relative to the document. Data tiers are fetched from an absolute HF URL (data.ts).
export default defineConfig({
  base: './',
  // Inlined at build time (see the git() helper above). Read in the footer build stamp.
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash),
    __COMMIT_DATE__: JSON.stringify(commitDate),
  },
  plugins: [
    react(),
    tailwindcss(),
    // Compile-time, tree-shaken i18n (EN/FR/ES). Output is generated into src/paraglide
    // (gitignored). Locale detection: a saved choice (localStorage) → the browser's
    // preferred language → English; switching is no-reload so chart range/zoom survives.
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/paraglide',
      strategy: ['localStorage', 'preferredLanguage', 'baseLocale'],
      cookieName: 'olatu_locale',
    }),
    // PWA: make Olatu installable (Add to Home Screen) on Android/iOS/desktop and give
    // it an offline shell (specs/0010). Workbox precaches the built app shell; the SW
    // auto-updates silently (`autoUpdate` → skipWaiting + reload on a new deploy), which
    // pairs cleanly with the app's own live data polling. Icons are pre-generated and
    // committed under public/ (`npm run pwa-assets`), so CI needs no `sharp`. The
    // manifest icon list mirrors those filenames.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // og.png is a 112 KB link-preview image and pwa-icon.svg is the icon SOURCE —
      // neither is needed offline, so keep them out of the precache.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        globIgnores: ['**/og.png', '**/pwa-icon.svg'],
        cleanupOutdatedCaches: true,
        // Cross-origin GETs the SW should shape. Data tiers come from the HF bucket:
        // NetworkFirst keeps the live refresh authoritative online while serving the
        // last-known JSON offline (parquet range requests return 206 → not cached, so
        // history charts stay online-only; the current-conditions banner works offline).
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.hostname === 'huggingface.co' &&
              url.pathname.includes('/buckets/hadim/olatu/resolve/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'olatu-data',
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 64, maxAgeSeconds: 7 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.hostname === 'fonts.googleapis.com',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-stylesheets',
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.hostname === 'fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 16, maxAgeSeconds: 365 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      // start_url/scope stay relative so one build installs correctly both at the apex
      // (https://olatu.io/) and the project path (https://hadim.github.io/olatu/), like
      // the relative Vite `base` above. theme/background match the dark app canvas.
      manifest: {
        name: 'Olatu — live wave & swell buoys',
        short_name: 'Olatu',
        description:
          'Live & historical sea state — wave height, swell period & direction, sea temperature and tides — from the CANDHIS wave buoys of the French Atlantic coast.',
        lang: 'en',
        dir: 'ltr',
        categories: ['weather', 'sports', 'utilities'],
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'any',
        theme_color: '#0a1622',
        background_color: '#0a1622',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        screenshots: [
          {
            src: 'og.png',
            sizes: '1200x630',
            type: 'image/png',
            form_factor: 'wide',
            label: 'Olatu — buoy map and live sea-state dashboard',
          },
        ],
      },
      // Keep the dev server as-is; test the SW via `npm run build && npm run preview`.
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
