// Minimal gap-aware sparkline (SVG). Breaks the line across null gaps.

interface Props {
  t: number[];
  values: (number | null)[];
  width?: number;
  height?: number;
}

export default function Sparkline({ t, values, width = 640, height = 96 }: Props) {
  const pts = t
    .map((time, i) => ({ time, v: values[i] }))
    .filter((p) => p.v != null) as { time: number; v: number }[];

  if (pts.length < 2) return null;

  const minT = pts[0].time;
  const maxT = pts[pts.length - 1].time;
  const maxV = Math.max(...pts.map((p) => p.v));
  const pad = 6;
  const x = (time: number) => pad + ((time - minT) / (maxT - minT || 1)) * (width - 2 * pad);
  const y = (v: number) => height - pad - (v / (maxV || 1)) * (height - 2 * pad);

  // Break the path wherever there is a gap larger than 3x the median spacing.
  const spacings = pts.slice(1).map((p, i) => p.time - pts[i].time);
  const median = [...spacings].sort((a, b) => a - b)[Math.floor(spacings.length / 2)] || 1;
  const gapLimit = median * 3;

  let d = '';
  pts.forEach((p, i) => {
    const cmd = i === 0 || p.time - pts[i - 1].time > gapLimit ? 'M' : 'L';
    d += `${cmd}${x(p.time).toFixed(1)},${y(p.v).toFixed(1)} `;
  });

  return (
    <svg className="block h-24 w-full" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img">
      <path d={d.trim()} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
