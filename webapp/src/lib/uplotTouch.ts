// Touch gestures for uPlot panels (spec 0006 §6 / 0001 Phase 7, gesture model revised by 0016).
//
// uPlot ships desktop drag-to-zoom but no touch gestures. This plugin adds:
//   • one finger, horizontal → **scrub**: move the cursor and read values along the series
//   • two fingers, drag      → pan the x-scale
//   • two fingers, pinch     → zoom the x-scale about the pinch midpoint
//   • one finger, vertical   → NOTHING: the page scrolls, handled by the browser
//
// The last line is the point. The previous model panned on a one-finger drag and called
// `preventDefault()` on every touchmove, which meant a finger anywhere on the chart stack could
// never scroll the page past it — on a phone the charts were a scroll trap (spec 0016 §1).
//
// Two mechanisms cooperate, deliberately:
//   1. `touch-action: pan-y` on the hit area tells the BROWSER it owns vertical panning. It then
//      scrolls natively (with its own momentum and rubber-banding, which JS can't match) and sends
//      us `touchcancel` once it takes over.
//   2. A JS axis-lock decides, on the first significant move, whether the gesture is ours
//      (horizontal) or the browser's (vertical). Belt and braces: not every engine cancels our
//      touches at the same moment, and without the lock a slightly-diagonal scroll would jitter
//      the cursor on the way past.
//
// Scale changes only go through `setScale('x', …)`, so the existing setScale sync hook propagates
// them to every synced panel; the cursor moves via `setCursor`, which `cursor.sync` propagates the
// same way. When a gesture ends, TimeSeries commits the visible window to `range` (on
// mouseup/touchend) so the matching finer tier loads — same as the desktop drag-zoom.

import type uPlot from 'uplot';

export interface TouchPluginOptions {
  /** Fired when a one-finger scrub begins — TimeSeries shows the pinned readout bar. */
  onScrubStart?: () => void;
}

/** Movement (px) before the gesture commits to an axis. Below this, nothing happens: a tap must
 *  stay a tap, and a finger that hasn't decided yet must not steal the scroll. */
const AXIS_LOCK_PX = 8;

export function touchZoomPlugin(opts: TouchPluginOptions = {}): uPlot.Plugin {
  return {
    hooks: {
      init: (u: uPlot) => {
        const over = u.over;
        // Vertical panning belongs to the browser; everything else reaches us (this also disables
        // double-tap page zoom over the plot, which used to fight the cursor).
        over.style.touchAction = 'pan-y';

        type Mode = 'none' | 'undecided' | 'scrub' | 'scroll' | 'pinch';
        let mode: Mode = 'none';
        let startMin = 0;
        let startMax = 0;
        let startX = 0;
        let startY = 0;
        let panStartX = 0;
        let pinchStartDist = 1;
        let pinchCenterVal = 0;

        const rectWidth = () => over.getBoundingClientRect().width || 1;
        const valAtClientX = (clientX: number) => u.posToVal(clientX - over.getBoundingClientRect().left, 'x');

        const moveCursor = (t: Touch) => {
          const rect = over.getBoundingClientRect();
          // Clamp into the plot box: dragging past an edge should pin the cursor to that edge, not
          // blank it (a negative left reads as "no cursor" downstream).
          const left = Math.max(0, Math.min(rect.width, t.clientX - rect.left));
          const top = Math.max(0, Math.min(rect.height, t.clientY - rect.top));
          u.setCursor({ left, top }, true);
        };

        const captureScale = () => {
          const xs = u.scales.x;
          if (xs.min == null || xs.max == null) return false;
          startMin = xs.min;
          startMax = xs.max;
          return true;
        };

        const onStart = (e: TouchEvent) => {
          if (!captureScale()) return;
          if (e.touches.length === 1) {
            mode = 'undecided';
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            panStartX = startX;
          } else if (e.touches.length >= 2) {
            mode = 'pinch';
            const [a, b] = [e.touches[0], e.touches[1]];
            pinchStartDist = Math.abs(a.clientX - b.clientX) || 1;
            pinchCenterVal = valAtClientX((a.clientX + b.clientX) / 2);
            panStartX = (a.clientX + b.clientX) / 2;
            e.preventDefault();
          }
        };

        const onMove = (e: TouchEvent) => {
          if (mode === 'scroll') return; // the browser owns this gesture — stay out of its way

          if (e.touches.length === 1 && (mode === 'undecided' || mode === 'scrub')) {
            const t = e.touches[0];
            if (mode === 'undecided') {
              const dx = Math.abs(t.clientX - startX);
              const dy = Math.abs(t.clientY - startY);
              if (dx < AXIS_LOCK_PX && dy < AXIS_LOCK_PX) return; // not yet committed
              if (dy > dx) {
                mode = 'scroll';
                return;
              }
              mode = 'scrub';
              opts.onScrubStart?.();
            }
            moveCursor(t);
            e.preventDefault();
            return;
          }

          if (mode === 'pinch' && e.touches.length >= 2) {
            const [a, b] = [e.touches[0], e.touches[1]];
            const dist = Math.abs(a.clientX - b.clientX) || 1;
            const factor = pinchStartDist / dist; // >1 zoom out, <1 zoom in
            let min = pinchCenterVal - (pinchCenterVal - startMin) * factor;
            let max = pinchCenterVal + (startMax - pinchCenterVal) * factor;
            // Two fingers also PAN: shift by however far the pinch midpoint travelled.
            const mid = (a.clientX + b.clientX) / 2;
            const shift = ((mid - panStartX) * (max - min)) / rectWidth();
            min -= shift;
            max -= shift;
            if (max - min > 1) u.setScale('x', { min, max });
            e.preventDefault();
          }
        };

        const onEnd = (e: TouchEvent) => {
          if (e.touches.length === 0) {
            // Deliberately DO NOT clear the cursor: on a phone the values you just scrubbed to are
            // only readable once your finger is off the screen (spec 0016 §2). It clears on the
            // next gesture, or when the readout bar is dismissed.
            mode = 'none';
          } else if (e.touches.length === 1) {
            // dropped from two fingers to one — re-arm the axis lock rather than jumping
            mode = 'undecided';
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            captureScale();
          }
        };

        over.addEventListener('touchstart', onStart, { passive: false });
        over.addEventListener('touchmove', onMove, { passive: false });
        over.addEventListener('touchend', onEnd);
        over.addEventListener('touchcancel', onEnd);
      },
    },
  };
}
