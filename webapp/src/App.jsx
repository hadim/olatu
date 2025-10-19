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
    </div>
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
