import { useEffect, useState } from 'react';
import Header from './components/Header';
import CurrentConditions from './components/CurrentConditions';
import Sparkline from './components/Sparkline';
import Footer from './components/Footer';
import { useI18n } from './lib/i18n';
import { loadManifest, loadLatest, loadRecent, type Manifest, type Series } from './lib/data';

interface Loaded {
  manifest: Manifest;
  latest: Series;
  recent: Series;
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

  return (
    <div className="app">
      <Header buoy={data?.manifest.buoy ?? null} />

      <main>
        {error && <div className="state state--error">{t('state.error')}<br /><code>{error}</code></div>}
        {!error && !data && <div className="state">{t('state.loading')}</div>}

        {data && (
          <>
            <CurrentConditions latest={data.latest} manifest={data.manifest} />

            <section className="panel">
              <h2 className="panel-title">{t('cc.last30days')}</h2>
              <Sparkline t={data.recent.t} values={data.recent.significant_wave_height_m} />
            </section>

            <StationFacts manifest={data.manifest} />
          </>
        )}
      </main>

      <Footer />
    </div>
  );
}
