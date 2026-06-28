// Heat-ribbon timeline (spec 0001 §6.3): a "storm skyline" of the whole record —
// each day a bar, height ∝ wave height, coloured by the sea-state scale. The current
// view window is highlighted; drag an edge handle to resize it, drag inside it to pan,
// drag empty track to select a fresh window, click to recentre. Charts commit on release.

import { useEffect, useRef, useState } from 'react';
import { hsColor } from '../lib/format';

const DAY = 86_400;

type Mode = 'select' | 'resize-l' | 'resize-r' | 'pan';
interface Drag {
  mode: Mode;
  startMin: number;
  startMax: number;
  grab: number; // time grabbed at pointer-down
  cur: number; // current pointer time
  moved: boolean;
}

interface Props {
  t: number[]; // epoch seconds, ascending
  hs: (number | null)[];
  min: number;
  max: number;
  onChange: (min: number, max: number) => void;
}

export default function HeatRibbon({ t, hs, min, max, onChange }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [width, setWidth] = useState(0);

  const T0 = t[0];
  const TN = t[t.length - 1];
  const span = Math.max(1, TN - T0);
  const MINW = Math.min(DAY, span); // smallest window a handle drag can shrink to

  // draw the skyline
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const draw = () => {
      const w = wrap.clientWidth;
      setWidth(w);
      const h = 48;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const bw = Math.max(1, w / t.length);
      for (let i = 0; i < t.length; i++) {
        const v = hs[i];
        if (v == null) continue;
        const x = ((t[i] - T0) / span) * w;
        const bh = Math.min(1, Math.max(0.05, v / 6)) * h;
        ctx.fillStyle = hsColor(v);
        ctx.fillRect(x, h - bh, bw, bh);
      }
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [t, hs, T0, span]);

  const pxToTime = (clientX: number) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return T0 + frac * span;
  };

  // The window the drag would produce, given its mode (live preview; committed on up).
  const previewOf = (d: Drag): [number, number] => {
    if (d.mode === 'resize-l') return [Math.min(d.cur, d.startMax - MINW), d.startMax];
    if (d.mode === 'resize-r') return [d.startMin, Math.max(d.cur, d.startMin + MINW)];
    if (d.mode === 'pan') {
      const w = d.startMax - d.startMin;
      const mn = Math.min(Math.max(d.startMin + (d.cur - d.grab), T0), TN - w);
      return [mn, mn + w];
    }
    return [Math.min(d.grab, d.cur), Math.max(d.grab, d.cur)];
  };

  const onDown = (e: React.PointerEvent) => {
    const time = pxToTime(e.clientX);
    const handle = (e.target as HTMLElement).dataset.handle;
    const mode: Mode = handle === 'l' ? 'resize-l' : handle === 'r' ? 'resize-r' : time >= min && time <= max ? 'pan' : 'select';
    setDrag({ mode, startMin: min, startMax: max, grab: time, cur: time, moved: false });
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const cur = pxToTime(e.clientX);
    setDrag((d) => (d ? { ...d, cur, moved: d.moved || d.mode !== 'select' || Math.abs(cur - d.grab) > span * 0.004 } : d));
  };
  const onUp = () => {
    if (!drag) return;
    if (drag.moved) {
      const [a, b] = previewOf(drag);
      onChange(Math.max(T0, a), Math.min(TN, b));
    } else if (drag.mode === 'select' || drag.mode === 'pan') {
      // a click (no drag): recentre the current window on the clicked instant
      const w = max - min;
      let nmin = drag.grab - w / 2;
      let nmax = drag.grab + w / 2;
      if (nmin < T0) [nmin, nmax] = [T0, T0 + w];
      if (nmax > TN) [nmin, nmax] = [TN - w, TN];
      onChange(Math.max(T0, nmin), Math.min(TN, nmax));
    }
    setDrag(null);
  };

  // Keyboard control for the slider (spec 0006 §6): ←/→ pan the window, Home/End jump to
  // the record ends. Window width is preserved; commits immediately (like a click).
  const onKey = (e: React.KeyboardEvent) => {
    const w = max - min;
    const step = Math.max(DAY, span * 0.05);
    let nmin = min;
    if (e.key === 'ArrowLeft') nmin = min - step;
    else if (e.key === 'ArrowRight') nmin = min + step;
    else if (e.key === 'Home') nmin = T0;
    else if (e.key === 'End') nmin = TN - w;
    else return;
    e.preventDefault();
    nmin = Math.max(T0, Math.min(nmin, TN - w));
    onChange(nmin, nmin + w);
  };

  // selection (live during a drag, else the active window)
  const [selMin, selMax] = drag && drag.moved ? previewOf(drag) : [min, max];
  const leftPct = ((selMin - T0) / span) * 100;
  const rightPct = ((selMax - T0) / span) * 100;

  // year ticks, thinned so labels never overlap on narrow screens
  const y0 = new Date(T0 * 1000).getUTCFullYear();
  const y1 = new Date(TN * 1000).getUTCFullYear();
  const allYears: number[] = [];
  for (let y = y0 + 1; y <= y1; y++) allYears.push(y);
  const maxLabels = Math.max(2, Math.floor((width || 1000) / 46));
  const step = Math.max(1, Math.ceil(allYears.length / maxLabels));
  const ticks = allYears
    .filter((_, i) => i % step === 0)
    .map((year) => ({ year, pct: ((Date.UTC(year, 0, 1) / 1000 - T0) / span) * 100 }));

  return (
    <div className="mb-[0.9rem]">
      <div
        className="relative h-12 cursor-crosshair touch-none overflow-hidden rounded-[0.5rem] border border-line bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        ref={wrapRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onKeyDown={onKey}
        role="slider"
        aria-label="Timeline"
        aria-valuemin={T0}
        aria-valuemax={TN}
        aria-valuenow={Math.round((selMin + selMax) / 2)}
        tabIndex={0}
      >
        <canvas ref={canvasRef} className="absolute inset-0 block" />
        <div className="pointer-events-none absolute bottom-0 top-0 bg-[color-mix(in_oklab,var(--bg)_60%,transparent)]" style={{ left: 0, width: `${Math.max(0, leftPct)}%` }} />
        <div className="pointer-events-none absolute bottom-0 top-0 bg-[color-mix(in_oklab,var(--bg)_60%,transparent)]" style={{ left: `${Math.min(100, rightPct)}%`, right: 0 }} />
        <div className="pointer-events-none absolute bottom-0 top-0 border-x-2 border-accent bg-[color-mix(in_oklab,var(--accent)_8%,transparent)]" style={{ left: `${leftPct}%`, width: `${Math.max(0.4, rightPct - leftPct)}%` }} />
        <div className="group absolute bottom-0 top-0 z-[2] w-[14px] -translate-x-1/2 cursor-ew-resize touch-none" data-handle="l" style={{ left: `${leftPct}%` }} aria-hidden="true">
          <span className="pointer-events-none absolute left-1/2 top-1/2 h-[22px] w-[4px] -translate-x-1/2 -translate-y-1/2 rounded-[2px] bg-accent shadow-[0_0_0_2px_var(--surface-2)] group-hover:bg-accent-deep" />
        </div>
        <div className="group absolute bottom-0 top-0 z-[2] w-[14px] -translate-x-1/2 cursor-ew-resize touch-none" data-handle="r" style={{ left: `${rightPct}%` }} aria-hidden="true">
          <span className="pointer-events-none absolute left-1/2 top-1/2 h-[22px] w-[4px] -translate-x-1/2 -translate-y-1/2 rounded-[2px] bg-accent shadow-[0_0_0_2px_var(--surface-2)] group-hover:bg-accent-deep" />
        </div>
      </div>
      <div className="relative mt-0.5 h-4">
        {ticks.map((tk) => (
          <span key={tk.year} className="absolute -translate-x-1/2 font-mono text-[0.64rem] text-faint" style={{ left: `${tk.pct}%` }}>
            {tk.year}
          </span>
        ))}
      </div>
    </div>
  );
}
