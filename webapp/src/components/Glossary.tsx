// "Definitions" slide-over (spec 0001 §6.5 tier 3 / 0003 C2): plain-language meaning
// of every value on screen, the wave-vs-swell distinction, and the sea-state colour
// scale that doubles as the chart legend. Self-contained trigger + panel.

import { useEffect, useState } from 'react';
import { useI18n, type MessageKey } from '../lib/i18n';
import { compass, dirColor } from '../lib/format';

// Each term carries its CANDHIS source field (the original code, language-neutral) and a
// typical-range hint, so the slide-over is the full tier-3 reference (spec 0001 §6.5).
const TERMS: { labelKey: MessageKey; defKey: MessageKey; src: string; rangeKey: MessageKey }[] = [
  { labelKey: 'cc.waveHeight', defKey: 'def.waveHeight', src: 'H1/3 · H13D', rangeKey: 'gloss.range.waveHeight' },
  { labelKey: 'cc.maxWave', defKey: 'def.maxWave', src: 'Hmax · HMAXD', rangeKey: 'gloss.range.maxWave' },
  { labelKey: 'cc.period', defKey: 'def.period', src: 'Th1/3 · TH13D', rangeKey: 'gloss.range.period' },
  { labelKey: 'cc.direction', defKey: 'def.direction', src: 'DirPic · THETAP', rangeKey: 'gloss.range.direction' },
  { labelKey: 'cc.spread', defKey: 'def.spread', src: 'EtalPic · SIGMAP', rangeKey: 'gloss.range.spread' },
  { labelKey: 'cc.seaTemp', defKey: 'def.seaTemp', src: 'TempMer', rangeKey: 'gloss.range.seaTemp' },
];

// Cardinal anchors of the cyclical direction hue (mirrors format.ts DIR_ANCHORS).
const DIR_LEGEND = [0, 90, 180, 270];

// Sea-state reference scale — mirrors specs/0002 §6 and the chart wave-height colours.
const SEA_STATE: { key: MessageKey; range: string; color: string }[] = [
  { key: 'sea.glassy', range: '0–0.5 m', color: '#BFE9E0' },
  { key: 'sea.smooth', range: '0.5–1 m', color: '#6FD3C4' },
  { key: 'sea.moderate', range: '1–1.5 m', color: '#38B8C9' },
  { key: 'sea.clean', range: '1.5–2.5 m', color: '#2E8FC4' },
  { key: 'sea.building', range: '2.5–4 m', color: '#3D5FBE' },
  { key: 'sea.big', range: '4–6 m', color: '#7A4FC0' },
  { key: 'sea.storm', range: '6 m+', color: '#B83D8E' },
];

function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM19 17H6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Glossary() {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button type="button" className="glossary-trigger" onClick={() => setOpen(true)}>
        <BookIcon />
        <span>{t('glossary.open')}</span>
      </button>

      {open && (
        <div className="glossary-backdrop" onClick={() => setOpen(false)}>
          <aside
            className="glossary-panel"
            role="dialog"
            aria-modal="true"
            aria-label={t('glossary.title')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="glossary-head">
              <h2>{t('glossary.title')}</h2>
              <button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label={t('a11y.close')}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <p className="glossary-intro">{t('glossary.intro')}</p>

            <section className="glossary-section">
              <h3>{t('glossary.waveVsSwell')}</h3>
              <p className="glossary-def">{t('def.waveVsSwell')}</p>
            </section>

            <section className="glossary-section">
              <h3>{t('glossary.measurements')}</h3>
              <dl className="glossary-terms">
                {TERMS.map((term) => (
                  <div key={term.labelKey}>
                    <dt>{t(term.labelKey)}</dt>
                    <dd>{t(term.defKey)}</dd>
                    <div className="glossary-meta">
                      <span className="glossary-src">{term.src}</span>
                      <span className="glossary-typical">{t('glossary.typical')}: {t(term.rangeKey)}</span>
                    </div>
                  </div>
                ))}
              </dl>
            </section>

            <section className="glossary-section">
              <h3>{t('glossary.directionScale')}</h3>
              <p className="glossary-note">{t('glossary.directionScaleNote')}</p>
              <ul className="dir-scale">
                {DIR_LEGEND.map((deg) => (
                  <li key={deg}>
                    <span className="dir-swatch" style={{ background: dirColor(deg) }} aria-hidden="true" />
                    <span className="sea-label">{compass(deg, locale)}</span>
                    <span className="sea-range">{deg}°</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="glossary-section">
              <h3>{t('glossary.seaState')}</h3>
              <p className="glossary-note">{t('glossary.seaStateNote')}</p>
              <ul className="sea-scale">
                {SEA_STATE.map((s) => (
                  <li key={s.key}>
                    <span className="sea-swatch" style={{ background: s.color }} aria-hidden="true" />
                    <span className="sea-label">{t(s.key)}</span>
                    <span className="sea-range">{s.range}</span>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
      )}
    </>
  );
}
