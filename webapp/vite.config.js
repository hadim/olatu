import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Static site for GitHub Pages. A RELATIVE base ('./') makes one build work both at
// the apex custom domain (https://olatu.io/) and at the project path
// (https://hadim.github.io/olatu/), so flipping the domain never breaks asset URLs.
// Assets referenced via import.meta.env.BASE_URL (favicon, map mosaics) resolve
// relative to the document. Data tiers are fetched from an absolute HF URL (data.ts).
export default defineConfig({
  base: './',
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
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
