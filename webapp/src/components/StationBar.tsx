// The top "station bar" (spec 0005 §5.3): the banner that separates the Olatu app
// frame from the data. It introduces the app, lets you pick a buoy (segmented control
// + the map locator), and states plainly where the data comes from (CANDHIS live +
// the open Hugging Face dataset). Registry-driven, so it renders before any manifest
// loads and stays usable while a buoy's data is (re)loading.

import { lazy, Suspense } from 'react';
import { useI18n } from '../lib/i18n';
import { BUOYS } from '../lib/buoys';

const BuoyLocator = lazy(() => import('./BuoyLocator'));

const HF_DATASET = 'https://huggingface.co/datasets/hadim/olatu';
const CANDHIS = 'https://candhis.cerema.fr';

function BuoySwitcher({ selected, onSelect }: { selected: string; onSelect: (c: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="buoy-switch" role="group" aria-label={t('picker.choose')}>
      {BUOYS.map((b) => {
        const active = b.campaign_id === selected;
        return (
          <button
            key={b.campaign_id}
            type="button"
            className={`buoy-option ${active ? 'buoy-option--active' : ''}`}
            aria-pressed={active}
            onClick={() => onSelect(b.campaign_id)}
          >
            <span className="buoy-option-dot" aria-hidden="true" />
            <span className="buoy-option-text">
              <span className="buoy-option-name">{b.name}</span>
              <span className="buoy-option-id">CANDHIS {b.campaign_id}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function StationBar({
  campaign,
  onSelect,
}: {
  campaign: string;
  onSelect: (campaign: string) => void;
}) {
  const { t } = useI18n();
  return (
    <section className="station-bar" aria-label={t('picker.eyebrow')}>
      <div className="station-bar-intro">
        <span className="station-bar-eyebrow">{t('picker.eyebrow')}</span>
        <p className="station-bar-desc">{t('intro.description')}</p>
        <BuoySwitcher selected={campaign} onSelect={onSelect} />
        <p className="station-bar-source">
          {t('data.source')}:{' '}
          <a href={CANDHIS} target="_blank" rel="noopener noreferrer">
            {t('data.live')}
          </a>{' '}
          ·{' '}
          <a href={HF_DATASET} target="_blank" rel="noopener noreferrer">
            {t('data.dataset')}
          </a>
        </p>
      </div>
      <div className="station-bar-map">
        <Suspense fallback={<div className="locator locator--loading" aria-hidden="true" />}>
          <BuoyLocator selected={campaign} onSelect={onSelect} />
        </Suspense>
      </div>
    </section>
  );
}
