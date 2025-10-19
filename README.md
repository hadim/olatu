# Wave Buoy Data Viewer 🌊

Real-time wave buoy data visualization webapp with automated data collection pipeline. Reads Parquet files directly in the browser for interactive time series analysis.

## Features

- 📊 **Interactive time series plots** with synchronized zooming across multiple metrics
- 📦 **Browser-native Parquet reading** - No backend required, streams data on-demand with Hyparquet
- ⏱️ **Full timeline range slider** - Select specific time periods (6h, 1d, 7d, 1m, all)
- 🤖 **Automated data pipeline** - Scheduled scraping and conversion via GitHub Actions
- 🎯 **Multiple synchronized subplots** - Different metrics with appropriate units
- 📱 **Responsive design** - Works on desktop and mobile

## Tech Stack

### Frontend

- **React 18** + **Vite** - Modern, fast build tool for static site generation
- **Hyparquet** - Lightweight (9.7kb) browser-based Parquet reader with chunk loading
- **Plotly.js** + **react-plotly.js** - Interactive charting with built-in range selectors
- **Deployment**: GitHub Pages (static hosting)

### Backend (Data Pipeline)

- **Python 3.13+** with **Pixi** - Fast conda-based package manager
- **Pandas** - Data manipulation and CSV processing
- **PyArrow** - High-performance Parquet file generation
- **Automation**: GitHub Actions (scheduled cron jobs)

## Quick Start

### Prerequisites

- Node.js 20+ and npm
- [Pixi](https://pixi.sh) package manager
