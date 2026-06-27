import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Static site served from GitHub Pages under /olatu/.
// The generated data tiers live in public/data/ and are served as-is (dev + build).
export default defineConfig({
  base: '/olatu/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
});
