import { defineConfig } from '@vite-pwa/assets-generator/config';

// Generates the raster PWA icons from public/pwa-icon.svg into public/ (run
// `npm run pwa-assets` when the logo changes). We COMMIT the output PNGs so the
// GitHub Pages build (`npm ci && npm run build`) stays deterministic and needs no
// `sharp` at build time. The manifest icon list lives in vite.config.js; the
// apple-touch-icon <link> is in index.html — both reference these filenames.
//
// The source SVG is already a full-bleed dark tile, so `transparent` icons are a
// solid on-brand square (serve as the `any` purpose). Maskable/apple get a small
// dark-backed padding so the "O" never clips inside the platform safe zone.
const dark = '#0A1622';

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    transparent: {
      sizes: [64, 192, 512],
      favicons: [[48, 'favicon-48.png']],
    },
    maskable: {
      sizes: [512],
      padding: 0.1,
      resizeOptions: { background: dark },
    },
    apple: {
      sizes: [180],
      padding: 0.06,
      resizeOptions: { background: dark },
    },
  },
  images: ['public/pwa-icon.svg'],
});
