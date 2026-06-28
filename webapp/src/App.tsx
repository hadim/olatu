import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Header from './components/Header';
import StationBar from './components/StationBar';
import CurrentConditions from './components/CurrentConditions';
import TimeSeries from './components/TimeSeries';
import MiniMap from './components/MiniMap';
import Footer from './components/Footer';
import { useI18n } from './lib/i18n';
import { loadManifest, loadLatest, loadRecent, type Manifest, type Series } from './lib/data';
import { loadParquetTier, type Columnar } from './lib/parquet';
import { initialCampaign, persistCampaign, campaignUrl } from './lib/buoys';

interface Loaded {
  // The campaign these tiers belong to. Render only uses `data` when this matches the
  // currently-selected campaign, so a buoy switch can never pair the new campaign with
  // the old buoy's manifest/year-files (which would 404 on a cross-campaign file).
  campaign: string;
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
  const [campaign, setCampaignState] = useState<string>(initialCampaign);
  const [data, setData] = useState<Loaded | null>(null);
  const [history, setHistory] = useState<{ campaign: string; cols: Columnar } | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The build's stamp; used to detect when the HF dataset has a fresh upload so a
  // background refresh only swaps state when there is genuinely something new.
  const generatedAtRef = useRef<string | null>(null);
  // Always holds the campaign currently being shown, so async loads/refreshes started
  // for a now-superseded buoy can bail out instead of clobbering the new one.
  const campaignRef = useRef(campaign);
  campaignRef.current = campaign;

  const setCampaign = useCallback((c: string) => {
    if (c === campaignRef.current) return;
    persistCampaign(c);
    // Reflect the buoy in the address bar (?buoy=<id>) so the URL stays shareable.
    // replaceState (not pushState): no history spam, and the back button just leaves
    // the site normally instead of cycling buoys.
    try {
      window.history.replaceState({ campaign: c }, '', campaignUrl(c));
    } catch {
      /* history unavailable — state + storage still update */
    }
    setCampaignState(c);
  }, []);

  // Deep-link the buoy in the URL so a copied link opens the same buoy. On mount,
  // normalize the address bar to the initial buoy and remember it (a shared ?buoy= link,
  // having won initialCampaign(), becomes the persisted choice too).
  useEffect(() => {
    persistCampaign(campaign);
    try {
      window.history.replaceState({ campaign }, '', campaignUrl(campaign));
    } catch {
      /* non-fatal */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load (or reload, on buoy switch) the eager tiers for the selected campaign.
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    generatedAtRef.current = null;
    Promise.all([loadManifest(campaign), loadLatest(campaign), loadRecent(campaign)])
      .then(([manifest, latest, recent]) => {
        if (cancelled) return;
        generatedAtRef.current = manifest.generated_at;
        setData({ campaign, manifest, latest, recent });
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [campaign]);

  // Auto-refresh: the data refreshes on the HF dataset every ~30 min (refresh-data.yml).
  // Poll the manifest periodically (and whenever the tab regains focus); when its
  // generated_at advances, pull the fresh live tiers so the current-conditions banner
  // updates on its own — no page reload. Failures are non-fatal: we keep the last good
  // data. (The heavy history parquet is left as-is; daily means barely move in 30 min.)
  const refresh = useCallback(async () => {
    const c = campaignRef.current;
    try {
      const manifest = await loadManifest(c);
      if (c !== campaignRef.current) return; // buoy switched mid-flight
      if (manifest.generated_at === generatedAtRef.current) return;
      const [latest, recent] = await Promise.all([loadLatest(c), loadRecent(c)]);
      if (c !== campaignRef.current) return;
      generatedAtRef.current = manifest.generated_at;
      setData({ campaign: c, manifest, latest, recent });
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

  // Only treat loaded tiers as current when they belong to the selected campaign — this
  // is what makes a buoy switch race-free (no new-campaign + old-manifest pairing).
  const ready = data && data.campaign === campaign ? data : null;
  const histCols = history && history.campaign === campaign ? history.cols : null;

  // Reflect the selected buoy in the tab/title (nice for shared ?buoy= links). The
  // static index.html keeps the keyword-rich title for crawlers that don't run JS, and
  // the Open Graph/Twitter titles are static too, so link previews stay on-brand.
  useEffect(() => {
    document.title = ready ? `${ready.manifest.buoy.name} — Olatu` : 'Olatu';
  }, [ready?.manifest.buoy.name]);

  // Stable across the periodic banner refresh: identity only changes when a fresh build
  // arrives, so the charts' detail tiers aren't reloaded on every tick.
  const yearFiles = useMemo(
    () => Object.fromEntries((ready?.manifest.years ?? []).map((y) => [y.year, y.file])),
    [ready?.manifest],
  );
  const lastT = useMemo(
    () => (ready ? Math.floor(Date.parse(ready.manifest.span.end) / 1000) : 0),
    [ready?.manifest],
  );

  // Per-campaign history (daily means). Reloads when the buoy switches.
  useEffect(() => {
    let cancelled = false;
    setHistory(null);
    setHistoryError(null);
    loadParquetTier(campaign, 'daily.parquet', HISTORY_COLUMNS)
      .then((d) => {
        if (!cancelled) setHistory({ campaign, cols: d });
      })
      .catch((e) => {
        // charts are best-effort; the banner still works without history
        console.error('Failed to load history (daily.parquet):', e);
        if (!cancelled) setHistoryError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [campaign]);

  return (
    <div className="app">
      <Header buoy={ready?.manifest.buoy ?? null} />

      <main>
        <StationBar campaign={campaign} onSelect={setCampaign} />

        {error && <div className="state state--error">{t('state.error')}<br /><code>{error}</code></div>}
        {!error && !ready && <div className="state">{t('state.loading')}</div>}

        {ready && (
          <>
            <CurrentConditions latest={ready.latest} manifest={ready.manifest} />

            {histCols ? (
              <TimeSeries
                key={campaign}
                campaign={campaign}
                data={histCols}
                tz={ready.manifest.timezone}
                lastT={lastT}
                yearFiles={yearFiles}
              />
            ) : historyError ? (
              <div className="state state--error">{t('state.chartsError')}</div>
            ) : (
              <div className="state">{t('state.loading')}</div>
            )}

            <StationLocation manifest={ready.manifest} />
          </>
        )}
      </main>

      <Footer />
    </div>
  );
}
