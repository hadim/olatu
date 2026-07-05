// Brand marks — one coherent icon family so the app logo and every data-source link
// read as one system (spec 0007). The Olatu logo is a single wave-barrel "O" (the
// swell curls over into a tube, forming the O of Olatu); the SAME mark is the favicon
// (public/favicon.svg is a hand-kept copy — change both together). The source marks
// (GitHub / Hugging Face / CANDHIS buoy) are line icons that inherit `currentColor`.

import type { SVGProps } from 'react';

/** The Olatu logo: a wave-barrel monogram on a dark rounded tile (app-icon style, so it
 *  matches the favicon exactly at any size). Decorative — pair it with a visible label. */
export function Logo({ size = 32, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false" {...props}>
      <defs>
        <linearGradient id="olatu-logo-g" x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#9CEFE2" />
          <stop offset="0.55" stopColor="#38E1C6" />
          <stop offset="1" stopColor="#12A28E" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7.5" fill="#0A1622" />
      <g fill="none" stroke="url(#olatu-logo-g)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3.3">
        <path d="M22.5 8.6 A10 10 0 1 0 24.2 20.5" />
        <path d="M24.2 20.5 A6 6 0 1 0 16 10.2" />
      </g>
    </svg>
  );
}

type MarkProps = SVGProps<SVGSVGElement> & { size?: number };

/** GitHub Octocat mark (solid, inherits currentColor). */
export function GitHubMark({ size = 16, ...props }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/** Hugging Face — a monochrome smiling face (line style, inherits currentColor). */
export function HuggingFaceMark({ size = 16, ...props }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="8.7" cy="10.6" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.3" cy="10.6" r="1" fill="currentColor" stroke="none" />
      <path d="M8.2 13.6c1 1.6 2.4 2.4 3.8 2.4s2.8-.8 3.8-2.4" />
    </svg>
  );
}

/** CANDHIS — a measurement buoy on the waterline (line style, inherits currentColor). */
export function BuoyMark({ size = 16, ...props }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
      <circle cx="12" cy="12.5" r="3.1" />
      <path d="M12 9.4V5.5" />
      <circle cx="12" cy="4" r="1" fill="currentColor" stroke="none" />
      <path d="M3.5 18.5q2.1-2 4.25 0t4.25 0 4.25 0 4.25 0" />
    </svg>
  );
}
