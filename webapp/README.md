# Wave Buoy Data Viewer (React)

This React 18 + Vite application renders synchronized time series visualizations for wave buoy measurements directly in the browser. It reads the `data/wave_buoys_data.parquet` file with the lightweight [hyparquet](https://www.npmjs.com/package/hyparquet) parser and plots interactive charts using `react-plotly.js`.

## Getting started

```bash
cd webapp
npm install
npm run dev
```

The dev server runs on `http://localhost:5173` by default. Hot module replacement is enabled.

## Building for production

```bash
npm run build
npm run preview
```

The Vite build outputs static assets to `dist/`. The configuration copies `../data/wave_buoys_data.parquet` to `dist/data/` so the application can fetch it at runtime. Ensure the source file is present before building.

## Deployment

The Vite `base` option is `./` (relative), so the same `dist/` works at both the custom domain and the project path. The site is published to GitHub Pages by `.github/workflows/deploy.yml` and served at the custom domain **https://olatu.io** (a `CNAME` file in `public/` ships in the build artifact; it also stays reachable at `https://hadim.github.io/olatu/`).

## Project structure

- `src/App.jsx` orchestrates layout, campaign filtering, and renders the plot component.
- `src/components/DataLoader.jsx` streams the Parquet file with hyparquet, handling loading and error states.
- `src/components/WavePlot.jsx` renders four synchronized Plotly subplots with a common time axis, range slider, and range selector.
- `src/utils/dataParser.js` converts raw Parquet rows into typed JavaScript objects with `Date` instances and numeric values.
- `src/utils/downsample.js` limits the number of rendered points per trace to keep the UI responsive with long timelines.

## Notes

- The Parquet reader only requests the columns needed for visualization to reduce bandwidth.
- Filtering by campaign reuses the already loaded dataset; no additional network requests are issued.
- Plotly's interactive controls (zoom, pan, hover, download PNG) are available by default.
- The viewer defaults to the latest six hours and includes quick range buttons (6h, 12h, 1d, 3d, 10d, 1m, 6m, 1y, All). Data is downsampled to at most ~4k points per trace for smooth interaction on large files.
- The current deployment focuses on the Saint-Jean-de-Luz buoy campaign and links to the [CANDHIS data catalog](https://candhis.cerema.fr/_public_/campagne.php). The interface shows when the dataset was last refreshed based on the most recent timestamp.
