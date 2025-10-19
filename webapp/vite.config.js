import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Vite configuration for GitHub Pages deployment and data asset copying
export default defineConfig(({ mode }) => {
  const dataFileName = mode === 'production' ? 'wave_buoys_data_prod.parquet' : 'wave_buoys_data.parquet';
  const candidatePath = path.resolve(__dirname, `../data/${dataFileName}`);
  const fallbackPath = path.resolve(__dirname, '../data/wave_buoys_data.parquet');
  const resolvedSource = fs.existsSync(candidatePath) ? candidatePath : fallbackPath;

  return {
    base: '/wave-buoys-viewer/',
    plugins: [
      react(),
      viteStaticCopy({
        targets: [
          {
            src: resolvedSource,
            dest: 'data',
            rename: dataFileName
          }
        ]
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
  };
});
