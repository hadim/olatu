// Touch pinch-zoom + drag-pan for uPlot panels (spec 0006 §6 / 0001 Phase 7).
// uPlot ships desktop drag-to-zoom but no touch gestures. This plugin adds:
//   • two-finger pinch  → zoom the x-scale about the pinch midpoint
//   • one-finger drag    → pan the x-scale
// It manipulates only the x-scale via setScale, so the existing setScale sync hook
// propagates the gesture to every synced panel. Zoom is transient (within the loaded
// window), matching the desktop drag-zoom behaviour; the preset chips / Reset restore it.

import type uPlot from 'uplot';

export function touchZoomPlugin(): uPlot.Plugin {
  return {
    hooks: {
      init: (u: uPlot) => {
        const over = u.over;
        let mode: 'none' | 'pan' | 'pinch' = 'none';
        let startMin = 0;
        let startMax = 0;
        let panStartX = 0;
        let pinchStartDist = 1;
        let pinchCenterVal = 0;

        const rectWidth = () => over.getBoundingClientRect().width || 1;
        const valAtClientX = (clientX: number) => {
          const rect = over.getBoundingClientRect();
          return u.posToVal(clientX - rect.left, 'x');
        };

        const onStart = (e: TouchEvent) => {
          const xs = u.scales.x;
          if (xs.min == null || xs.max == null) return;
          startMin = xs.min;
          startMax = xs.max;
          if (e.touches.length === 1) {
            mode = 'pan';
            panStartX = e.touches[0].clientX;
          } else if (e.touches.length >= 2) {
            mode = 'pinch';
            const [a, b] = [e.touches[0], e.touches[1]];
            pinchStartDist = Math.abs(a.clientX - b.clientX) || 1;
            pinchCenterVal = valAtClientX((a.clientX + b.clientX) / 2);
            e.preventDefault();
          }
        };

        const onMove = (e: TouchEvent) => {
          if (mode === 'pan' && e.touches.length === 1) {
            const dxPx = e.touches[0].clientX - panStartX;
            const valPerPx = (startMax - startMin) / rectWidth();
            const shift = dxPx * valPerPx;
            u.setScale('x', { min: startMin - shift, max: startMax - shift });
            e.preventDefault();
          } else if (mode === 'pinch' && e.touches.length >= 2) {
            const [a, b] = [e.touches[0], e.touches[1]];
            const dist = Math.abs(a.clientX - b.clientX) || 1;
            const factor = pinchStartDist / dist; // >1 zoom out, <1 zoom in
            const min = pinchCenterVal - (pinchCenterVal - startMin) * factor;
            const max = pinchCenterVal + (startMax - pinchCenterVal) * factor;
            if (max - min > 1) u.setScale('x', { min, max });
            e.preventDefault();
          }
        };

        const onEnd = (e: TouchEvent) => {
          if (e.touches.length === 0) mode = 'none';
          else if (e.touches.length === 1) {
            // dropped from pinch to a single finger — restart a clean pan
            mode = 'pan';
            panStartX = e.touches[0].clientX;
            const xs = u.scales.x;
            if (xs.min != null && xs.max != null) {
              startMin = xs.min;
              startMax = xs.max;
            }
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
