import { useEffect, useMemo, useState } from 'react';
import DataLoader from './components/DataLoader.jsx';
import WavePlot from './components/WavePlot.jsx';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const RANGE_OPTIONS = [
  { label: '6h', durationMs: 6 * HOUR_MS },
  { label: '12h', durationMs: 12 * HOUR_MS },
  { label: '1d', durationMs: 1 * DAY_MS },
  { label: '3d', durationMs: 3 * DAY_MS },
  { label: '10d', durationMs: 10 * DAY_MS },
  { label: '1m', durationMs: 30 * DAY_MS },
  { label: '6m', durationMs: 182 * DAY_MS },
  { label: '1y', durationMs: 365 * DAY_MS },
  { label: 'All', durationMs: null }
];
const DEFAULT_RANGE_MS = RANGE_OPTIONS[3].durationMs;

export default function App() {
  const [rangeMs, setRangeMs] = useState(DEFAULT_RANGE_MS);

  return (
    <div>
      <header>
        <h1>Wave Buoy Data Viewer</h1>
        <p className="description">
          Explore synchronized time series for wave height, wave period, direction, spread, and sea surface temperature.
        </p>
        <p className="data-meta">
          Data source:{' '}
          <a href="https://candhis.cerema.fr/_public_/campagne.php" target="_blank" rel="noopener noreferrer">
            CANDHIS campaign catalog
          </a>
        </p>
      </header>

      <DataLoader>
        {({ data, campaignIds }) => (
          <ViewerContent data={data} campaignIds={campaignIds} rangeMs={rangeMs} onRangeChange={setRangeMs} />
        )}
      </DataLoader>

      <SiteFooter />
    </div>
  );
}

const REPO_URL = 'https://github.com/hadim/olatu';

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <a className="gh-link" href={REPO_URL} target="_blank" rel="noopener noreferrer">
        <GitHubMark />
        <span>Open source on GitHub</span>
      </a>
      <span className="footer-sep" aria-hidden="true">·</span>
      <a href={`${REPO_URL}/issues`} target="_blank" rel="noopener noreferrer">
        Report a bug or contribute
      </a>
      <span className="footer-sep" aria-hidden="true">·</span>
      <span className="footer-attribution">
        Data ©{' '}
        <a href="https://candhis.cerema.fr" target="_blank" rel="noopener noreferrer">
          Cerema / CANDHIS
        </a>
      </span>
    </footer>
  );
}

function ViewerContent({ data, campaignIds, rangeMs, onRangeChange }) {
  const selectedCampaign = campaignIds.length ? campaignIds[0] : null;
  const [manualRange, setManualRange] = useState(null);

  useEffect(() => {
    setManualRange(null);
  }, [selectedCampaign]);

  const campaignData = useMemo(() => {
    if (!selectedCampaign) {
      return [];
    }

    return data.filter((row) => row.campaign_id === selectedCampaign);
  }, [data, selectedCampaign]);

  const latestTimestamp = campaignData.length
    ? campaignData[campaignData.length - 1].datetime
    : null;

  const presetRange = useMemo(() => {
    if (!latestTimestamp || rangeMs === null) {
      return null;
    }

    const start = new Date(latestTimestamp.getTime() - rangeMs);
    return [start, latestTimestamp];
  }, [latestTimestamp, rangeMs]);

  const focusRange = manualRange ?? presetRange;

  const hasData = campaignData.length > 0;

  return (
    <section>
      <p className="campaign-name">Saint-Jean-de-Luz buoy (campaign {selectedCampaign ?? 'N/A'})</p>
      <p className="last-updated">
        {latestTimestamp
          ? `Last updated: ${latestTimestamp.toLocaleString()}`
          : 'Last updated: unavailable'}
      </p>

      <div className="range-buttons">
        <span>Time range</span>
        {RANGE_OPTIONS.map((option) => (
          <button
            key={option.label}
            type="button"
            className={manualRange === null && option.durationMs === rangeMs ? 'active' : ''}
            onClick={() => {
              onRangeChange(option.durationMs);
              setManualRange(null);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>

      {hasData ? (
        <WavePlot
          data={campaignData}
          focusRange={focusRange}
          onFocusRangeChange={setManualRange}
        />
      ) : (
        <div className="loading">No data available for the selected campaign.</div>
      )}
    </section>
  );
}
