import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
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
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
