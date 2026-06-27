import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy, normalizePath } from 'vite-plugin-static-copy';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = normalizePath(path.resolve(__dirname, '../data'));

// Vite config for GitHub Pages (served under /olatu/) + copying the generated
// data tiers (../data: manifest/latest/recent.json, year/*.parquet, hourly/daily)
// into the build output at /data.
export default defineConfig({
  base: '/olatu/',
  plugins: [
    react(),
    viteStaticCopy({
      targets: [{ src: `${dataDir}/*`, dest: 'data' }]
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  server: {
    fs: {
      allow: ['..']
    }
  }
});
