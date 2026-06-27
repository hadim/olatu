// Heat-ribbon timeline (spec 0001 §6.3): a "storm skyline" of the whole record —
// each day a bar, height ∝ wave height, coloured by the sea-state scale. The current
// view window is highlighted; click recenters it, drag selects a new range.

import { useEffect, useRef, useState } from 'react';
import { hsColor } from '../lib/format';

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
  const [drag, setDrag] = useState<{ a: number; b: number; moved: boolean } | null>(null);

  const T0 = t[0];
  const TN = t[t.length - 1];
  const span = Math.max(1, TN - T0);

  // draw the skyline
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const draw = () => {
      const w = wrap.clientWidth;
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

  const onDown = (e: React.PointerEvent) => {
    const a = pxToTime(e.clientX);
    setDrag({ a, b: a, moved: false });
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const b = pxToTime(e.clientX);
    setDrag((d) => (d ? { ...d, b, moved: d.moved || Math.abs(b - d.a) > span * 0.004 } : d));
  };
  const onUp = () => {
    if (!drag) return;
    if (drag.moved) {
      onChange(Math.min(drag.a, drag.b), Math.max(drag.a, drag.b));
    } else {
      // click: recenter the current window on the clicked instant
      const width = max - min;
      let nmin = drag.a - width / 2;
      let nmax = drag.a + width / 2;
      if (nmin < T0) [nmin, nmax] = [T0, T0 + width];
      if (nmax > TN) [nmin, nmax] = [TN - width, TN];
      onChange(Math.max(T0, nmin), Math.min(TN, nmax));
    }
    setDrag(null);
  };

  // selection (live during drag, else the active window)
  const selMin = drag && drag.moved ? Math.min(drag.a, drag.b) : min;
  const selMax = drag && drag.moved ? Math.max(drag.a, drag.b) : max;
  const leftPct = ((selMin - T0) / span) * 100;
  const rightPct = ((selMax - T0) / span) * 100;

  // year ticks
  const y0 = new Date(T0 * 1000).getUTCFullYear();
  const y1 = new Date(TN * 1000).getUTCFullYear();
  const ticks: { year: number; pct: number }[] = [];
  for (let y = y0 + 1; y <= y1; y++) {
    const s = Date.UTC(y, 0, 1) / 1000;
    ticks.push({ year: y, pct: ((s - T0) / span) * 100 });
  }

  return (
    <div className="ribbon-wrap">
      <div
        className="ribbon"
        ref={wrapRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        role="slider"
        aria-label="Timeline"
        aria-valuemin={T0}
        aria-valuemax={TN}
        aria-valuenow={Math.round((selMin + selMax) / 2)}
        tabIndex={0}
      >
        <canvas ref={canvasRef} className="ribbon-canvas" />
        <div className="ribbon-mask" style={{ left: 0, width: `${Math.max(0, leftPct)}%` }} />
        <div className="ribbon-mask" style={{ left: `${Math.min(100, rightPct)}%`, right: 0 }} />
        <div className="ribbon-window" style={{ left: `${leftPct}%`, width: `${Math.max(0.4, rightPct - leftPct)}%` }} />
      </div>
      <div className="ribbon-ticks">
        {ticks.map((tk) => (
          <span key={tk.year} className="ribbon-tick" style={{ left: `${tk.pct}%` }}>
            {tk.year}
          </span>
        ))}
      </div>
    </div>
  );
}
