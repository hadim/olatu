import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  'significant_period_s',
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
  // The build's stamp; used to detect when the HF dataset has a fresh upload so a
  // background refresh only swaps state when there is genuinely something new.
  const generatedAtRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadManifest(), loadLatest(), loadRecent()])
      .then(([manifest, latest, recent]) => {
        if (cancelled) return;
        generatedAtRef.current = manifest.generated_at;
        setData({ manifest, latest, recent });
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-refresh: the data refreshes on the HF dataset every ~30 min (refresh-data.yml).
  // Poll the manifest periodically (and whenever the tab regains focus); when its
  // generated_at advances, pull the fresh live tiers so the current-conditions banner
  // updates on its own — no page reload. Failures are non-fatal: we keep the last good
  // data. (The heavy history parquet is left as-is; daily means barely move in 30 min.)
  const refresh = useCallback(async () => {
    try {
      const manifest = await loadManifest();
      if (manifest.generated_at === generatedAtRef.current) return;
      const [latest, recent] = await Promise.all([loadLatest(), loadRecent()]);
      generatedAtRef.current = manifest.generated_at;
      setData({ manifest, latest, recent });
    } catch (e) {
      console.error('Background data refresh failed:', e);
    }
  }, []);

  useEffect(() => {
    const REFRESH_MS = 5 * 60_000;
    const id = window.setInterval(refresh, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [refresh]);

  // Stable across the periodic banner refresh: identity only changes when a fresh build
  // arrives, so the charts' detail tiers aren't reloaded on every tick.
  const yearFiles = useMemo(
    () => Object.fromEntries((data?.manifest.years ?? []).map((y) => [y.year, y.file])),
    [data?.manifest],
  );
  const lastT = useMemo(
    () => (data ? Math.floor(Date.parse(data.manifest.span.end) / 1000) : 0),
    [data?.manifest],
  );

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
              <TimeSeries
                data={history}
                tz={data.manifest.timezone}
                lastT={lastT}
                yearFiles={yearFiles}
              />
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
