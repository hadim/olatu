import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Header from './components/Header';
import StationBar from './components/StationBar';
import CurrentConditions from './components/CurrentConditions';
import TimeSeries from './components/TimeSeries';
import Footer from './components/Footer';
import ConsentBanner from './components/ConsentBanner';
import LegalPage from './pages/LegalPage';
import { BannerSkeleton, ChartsSkeleton, StationLocationSkeleton } from './components/Skeletons';
import DataStatus from './components/DataStatus';
import { useRoute } from '@/lib/route';
import { initAnalytics } from '@/lib/analytics';
import { useLocale } from '@/lib/i18n';
import { m } from '@/paraglide/messages';
import { loadEager, loadManifest, loadLatest, loadRecent, loadTidesForManifest, loadWindEager, loadWindLatest, type Eager, type Manifest, type Series, type WindData, type WindManifest } from './lib/data';
import type { Tides } from './lib/tides';
import { loadParquetTier, loadWindParquetTier, type Columnar } from './lib/parquet';
import { initialCampaign, persistCampaign, campaignUrl, buoyInfo } from './lib/buoys';
import { stationForBuoy, hasStationOverride, persistStation, clearStation, stationsForBuoy } from './lib/stations';

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

const WIND_HISTORY_COLUMNS = [
  'wind_speed_ms',
  'wind_gust_ms',
  'wind_direction_deg',
  'wind_gust_direction_deg',
  'air_temperature_c',
  'precipitation_mm',
  'humidity_pct',
  'pressure_msl_hpa',
];

// The page shell. On a phone the SHELL is the only thing that pays for the screen edge (spec
// 0017 §2): the cards inside it shrink their own padding instead of stacking a third inset.
const PAGE = 'mx-auto max-w-[1100px] px-3 pb-12 pt-5 sm:px-5';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-[0.2rem]">
      <dt className="text-[0.76rem] uppercase tracking-[0.06em] text-faint">{label}</dt>
      <dd className="m-0 font-mono text-[0.95rem] text-fg">{children}</dd>
    </div>
  );
}

// Compact station facts strip (the static locator map was dropped — the top locator map
// is now interactive and flies to the selected buoy, so a second static map was redundant;
// water depth was always "not published" for these buoys, so it's dropped too). See spec 0007.
function StationFacts({ manifest }: { manifest: Manifest }) {
  const b = manifest.buoy;
  return (
    <dl className="mt-6 m-0 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] content-center gap-4 rounded-2xl border border-line px-[1.3rem] py-[1.1rem]">
      <Fact label={m.station_position()}>{b.lat.toFixed(4)}°N, {Math.abs(b.lon).toFixed(4)}°W</Fact>
      <Fact label={m.station_sensor()}>{b.sensor}</Fact>
      <Fact label={m.station_operator()}>{b.operator}</Fact>
    </dl>
  );
}

export default function App() {
  useLocale();
  const route = useRoute();
  const [campaign, setCampaignState] = useState<string>(initialCampaign);

  // Restore analytics for a returning visitor who already granted consent (no-op otherwise;
  // the gtag script is never fetched before an explicit "Accept"). See spec 0011.
  useEffect(() => {
    initAnalytics();
  }, []);
  const [data, setData] = useState<Loaded | null>(null);
  const [history, setHistory] = useState<{ campaign: string; cols: Columnar } | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  // Tide extrema (marée). Best-effort + campaign-tagged like `history`; absent for a buoy
  // with no key/site, in which case the banner strip + chart panel show the empty-state.
  const [tides, setTides] = useState<{ campaign: string; tides: Tides } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Soft failure: the page IS showing data (painted from the local cache) but the network
  // copy didn't arrive. Distinct from `error`, which means "nothing to show at all".
  const [refreshError, setRefreshError] = useState(false);
  // The build's stamp; used to detect when the HF dataset has a fresh upload so a
  // background refresh only swaps state when there is genuinely something new.
  const generatedAtRef = useRef<string | null>(null);
  // Always holds the campaign currently being shown, so async loads/refreshes started
  // for a now-superseded buoy can bail out instead of clobbering the new one.
  const campaignRef = useRef(campaign);
  campaignRef.current = campaign;

  // Paired wind station (spec 0013). Resolved per buoy = manifest default (nearest station) OR
  // the user's persisted per-buoy override. Loaded + tagged {campaign, station} like tides so a
  // buoy/station switch never pairs mismatched data.
  const [wind, setWind] = useState<{ campaign: string; station: string; data: WindData } | null>(null);
  const [windHistory, setWindHistory] = useState<{ campaign: string; station: string; cols: Columnar } | null>(null);
  // Bumped after a station pick to re-derive the resolved station from storage.
  const [stationTick, setStationTick] = useState(0);
  const stationRef = useRef<string | null>(null);

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

  // Pick a wind station for the current buoy: persist as a per-buoy override, or clear the
  // override when the choice IS the manifest default (so it keeps tracking the default). The
  // stationTick bump re-derives the resolved station, which reloads the wind tiers. Spec 0013.
  const onSelectStation = useCallback((id: string, isDefault: boolean) => {
    const c = campaignRef.current;
    if (isDefault) clearStation(c);
    else persistStation(c, id);
    setStationTick((t) => t + 1);
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
  //
  // Stale-while-revalidate (spec 0019): `loadEager`'s callback hands over the copy stored on
  // this device — the page paints the buoy you were looking at last time, right away — and the
  // promise then resolves with the network copy, or `null` when it is byte-identical (nothing
  // to re-render). A network failure is only fatal when nothing was painted.
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    generatedAtRef.current = null;
    let painted = false;
    const apply = (e: Eager) => {
      if (cancelled) return;
      generatedAtRef.current = e.manifest.generated_at;
      setData({ campaign, manifest: e.manifest, latest: e.latest, recent: e.recent });
    };
    loadEager(campaign, (e) => {
      painted = true;
      apply(e);
    })
      .then((e) => {
        if (cancelled) return;
        if (e) apply(e);
        setRefreshError(false);
      })
      .catch((e) => {
        if (cancelled) return;
        if (painted) setRefreshError(true); // cached data stands; say so instead of blanking it
        else setError(e instanceof Error ? e.message : String(e));
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
      setRefreshError(false);
      if (manifest.generated_at === generatedAtRef.current) return;
      const [latest, recent] = await Promise.all([loadLatest(c), loadRecent(c)]);
      if (c !== campaignRef.current) return;
      generatedAtRef.current = manifest.generated_at;
      setData({ campaign: c, manifest, latest, recent });
      // Refresh the paired station's live readings on the same cadence (the 6-min feed grows
      // every run); best-effort, campaign+station-guarded so a switch mid-flight can't cross data.
      const st = stationRef.current;
      if (st) {
        const wl = await loadWindLatest(st).catch(() => null);
        if (wl && st === stationRef.current && c === campaignRef.current) {
          setWind((w) => (w && w.station === st && w.campaign === c ? { campaign: c, station: st, data: { ...w.data, latest: wl } } : w));
        }
      }
    } catch (e) {
      console.error('Background data refresh failed:', e);
      setRefreshError(true);
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
  const tideData = tides && tides.campaign === campaign ? tides.tides : null;

  // Resolved wind station for this buoy: the user's per-buoy override, else the manifest default
  // (nearest station). null → no station in range → wind empty-state. Race-tagged like tides.
  const defaultStation = ready?.manifest.wind?.station ?? null;
  const stationId = useMemo(
    () => stationForBuoy(campaign, defaultStation),
    [campaign, defaultStation, stationTick],
  );
  stationRef.current = stationId;
  const windData = wind && wind.campaign === campaign && wind.station === stationId ? wind.data : null;
  const windHistCols =
    windHistory && windHistory.campaign === campaign && windHistory.station === stationId ? windHistory.cols : null;

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
  const hourlyFiles = useMemo(
    () => Object.fromEntries((ready?.manifest.hourly_files ?? []).map((h) => [h.year, h.file])),
    [ready?.manifest],
  );
  const lastT = useMemo(
    () => (ready ? Math.floor(Date.parse(ready.manifest.span.end) / 1000) : 0),
    [ready?.manifest],
  );
  const windYearFiles = useMemo(
    () => Object.fromEntries((windData?.manifest.years ?? []).map((y) => [y.year, y.file])),
    [windData?.manifest],
  );
  const windHourlyFiles = useMemo(
    () => Object.fromEntries((windData?.manifest.hourly_files ?? []).map((h) => [h.year, h.file])),
    [windData?.manifest],
  );

  // Per-campaign history (daily means). Reloads when the buoy switches.
  useEffect(() => {
    let cancelled = false;
    setHistory(null);
    setHistoryError(null);
    loadParquetTier(campaign, 'daily.parquet', HISTORY_COLUMNS, (cols) => {
      // Cached copy → the charts are on screen before the network answers (spec 0019).
      if (!cancelled) setHistory({ campaign, cols });
    })
      .then((d) => {
        // null = byte-identical to the cached copy already plotted: keep it, a swap here
        // would rebuild every uPlot for nothing.
        if (d && !cancelled) setHistory({ campaign, cols: d });
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

  // Per-buoy tide extrema (marée). The buoy's manifest names its nearest port (tide block);
  // we fetch that port's shared tides.parquet (specs/0008 §8.2). Best-effort: no port in
  // range / unavailable tier leaves the tide UI in its empty-state. Keyed on the PORT so the
  // 5-min banner refresh (same port) never refetches or blinks; a buoy switch (new port, or
  // null while the new manifest loads) reloads it. Extrema cover ~a month ahead — the phase
  // interpolates client-side and ticks via useNow, so they aren't on the live refresh path.
  const tidePort = ready?.manifest.tide?.port ?? null;
  useEffect(() => {
    let cancelled = false;
    const mf = ready?.manifest;
    if (!mf?.tide) {
      setTides(null);
      return;
    }
    loadTidesForManifest(mf, (t) => {
      if (!cancelled) setTides({ campaign: mf.buoy.campaign_id, tides: t });
    })
      .then((t) => {
        // undefined = unchanged since the cached copy already shown; null = this buoy has no tides.
        if (cancelled || t === undefined) return;
        setTides(t ? { campaign: mf.buoy.campaign_id, tides: t } : null);
      })
      .catch(() => {
        if (!cancelled) setTides(null); // no tides for this buoy — empty-state handles it
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tidePort]);

  // Load the paired station's tiers (buoy-shaped: manifest + latest readings). Keyed on the
  // resolved station so a station override reloads it; tagged {campaign, station} for race safety.
  useEffect(() => {
    let cancelled = false;
    setWind(null);
    if (!stationId) return;
    const buoy = buoyInfo(campaign);
    const dist = stationsForBuoy(buoy.lat, buoy.lon).find((s) => s.id === stationId)?.distanceKm ?? 0;
    const apply = (wm: WindManifest, wl: Series) => {
      if (cancelled) return;
      setWind({
        campaign,
        station: stationId,
        data: { station: stationId, manifest: wm, latest: wl, distanceKm: dist, isOverride: hasStationOverride(campaign) },
      });
    };
    loadWindEager(stationId, (e) => apply(e.manifest, e.latest))
      .then((e) => {
        if (e) apply(e.manifest, e.latest); // null = unchanged since the cached paint
      })
      .catch((e) => {
        console.error('Failed to load wind station:', e);
        if (!cancelled) setWind((w) => (w && w.campaign === campaign && w.station === stationId ? w : null)); // keep a cached paint; else → empty-state
      });
    return () => {
      cancelled = true;
    };
  }, [campaign, stationId]);

  // Wind history (daily means) for the charts, keyed by station. Best-effort like the buoy history.
  useEffect(() => {
    let cancelled = false;
    setWindHistory(null);
    if (!stationId) return;
    loadWindParquetTier(stationId, 'daily.parquet', WIND_HISTORY_COLUMNS, (cols) => {
      if (!cancelled) setWindHistory({ campaign, station: stationId, cols });
    })
      .then((cols) => {
        if (cols && !cancelled) setWindHistory({ campaign, station: stationId, cols });
      })
      .catch((e) => {
        console.error('Failed to load wind history (daily.parquet):', e);
      });
    return () => {
      cancelled = true;
    };
  }, [campaign, stationId]);

  if (route !== 'home') {
    return (
      <div className={PAGE}>
        <Header />
        <LegalPage route={route} />
        <Footer />
        <ConsentBanner />
      </div>
    );
  }

  return (
    <div className={PAGE}>
      <DataStatus hasData={!!ready} refreshError={refreshError} />
      <Header />

      <main>
        <StationBar
          campaign={campaign}
          onSelect={setCampaign}
          selectedStation={stationId}
          defaultStation={defaultStation}
          onSelectStation={onSelectStation}
        />

        {error && (
          <div className="mt-8 text-base text-danger">
            {m.state_error()}
            <br />
            <code className="font-mono text-[0.82rem] text-faint">{error}</code>
          </div>
        )}
        {!error && !ready && (
          <>
            <p className="sr-only" role="status">{m.state_loading()}</p>
            <BannerSkeleton />
            <ChartsSkeleton />
            <StationLocationSkeleton />
          </>
        )}

        {ready && (
          <>
            <CurrentConditions latest={ready.latest} manifest={ready.manifest} tides={tideData} wind={windData} />

            {histCols ? (
              <TimeSeries
                key={campaign}
                campaign={campaign}
                data={histCols}
                tz={ready.manifest.timezone}
                lastT={lastT}
                yearFiles={yearFiles}
                hourlyFiles={hourlyFiles}
                tides={tideData}
                windStation={windData ? windData.station : null}
                windHistory={windHistCols}
                windYearFiles={windYearFiles}
                windHourlyFiles={windHourlyFiles}
              />
            ) : historyError ? (
              <div className="mt-8 text-base text-danger">{m.state_charts_error()}</div>
            ) : (
              <>
                <p className="sr-only" role="status">{m.state_loading()}</p>
                <ChartsSkeleton />
              </>
            )}

            <StationFacts manifest={ready.manifest} />
          </>
        )}
      </main>

      <Footer />
      <ConsentBanner />
    </div>
  );
}
