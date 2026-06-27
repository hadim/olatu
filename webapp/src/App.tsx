import { useEffect, useState } from 'react';
import Header from './components/Header';
import CurrentConditions from './components/CurrentConditions';
import TimeSeries from './components/TimeSeries';
import MiniMap from './components/MiniMap';
import Footer from './components/Footer';
import { useI18n } from './lib/i18n';
import { loadManifest, loadLatest, loadRecent, type Manifest, type Series } from './lib/data';
import { loadParquetTier, type Columnar } from './lib/parquet';

interface Loaded {
  manifest: Manifest;
  latest: Series;
  recent: Series;
}

const HISTORY_COLUMNS = [
  'significant_wave_height_m',
  'max_wave_height_m',
  'peak_period_s',
  'peak_direction_deg',
  'peak_directional_spread_deg',
  'sea_temperature_c',
];

function StationLocation({ manifest }: { manifest: Manifest }) {
  const b = manifest.buoy;
  return (
    <section className="station-location">
      <MiniMap lat={b.lat} lon={b.lon} label={b.name} />
      <StationFacts manifest={manifest} />
    </section>
  );
}

function StationFacts({ manifest }: { manifest: Manifest }) {
  const { t } = useI18n();
  const b = manifest.buoy;
  return (
    <dl className="station-facts">
      <div>
        <dt>{t('station.position')}</dt>
        <dd>{b.lat.toFixed(4)}°N, {Math.abs(b.lon).toFixed(4)}°W</dd>
      </div>
      <div>
        <dt>{t('station.depth')}</dt>
        <dd>{b.water_depth_m != null ? `${b.water_depth_m} m` : t('station.notPublished')}</dd>
      </div>
      <div>
        <dt>{t('station.sensor')}</dt>
        <dd>{b.sensor}</dd>
      </div>
      <div>
        <dt>{t('station.operator')}</dt>
        <dd>{b.operator}</dd>
      </div>
    </dl>
  );
}

export default function App() {
  const { t } = useI18n();
  const [data, setData] = useState<Loaded | null>(null);
  const [history, setHistory] = useState<Columnar | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadManifest(), loadLatest(), loadRecent()])
      .then(([manifest, latest, recent]) => {
        if (!cancelled) setData({ manifest, latest, recent });
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadParquetTier('daily.parquet', HISTORY_COLUMNS)
      .then((d) => {
        if (!cancelled) setHistory(d);
      })
      .catch((e) => {
        // charts are best-effort; the banner still works without history
        console.error('Failed to load history (daily.parquet):', e);
        if (!cancelled) setHistoryError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app">
      <Header buoy={data?.manifest.buoy ?? null} />

      <main>
        {error && <div className="state state--error">{t('state.error')}<br /><code>{error}</code></div>}
        {!error && !data && <div className="state">{t('state.loading')}</div>}

        {data && (
          <>
            <CurrentConditions latest={data.latest} manifest={data.manifest} />

            {history ? (
              <TimeSeries data={history} tz={data.manifest.timezone} />
            ) : historyError ? (
              <div className="state state--error">{t('state.chartsError')}</div>
            ) : (
              <div className="state">{t('state.loading')}</div>
            )}

            <StationLocation manifest={data.manifest} />
          </>
        )}
      </main>

      <Footer />
    </div>
  );
}
