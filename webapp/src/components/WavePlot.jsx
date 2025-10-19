import { useCallback, useMemo } from 'react';
import Plotly from 'plotly.js-dist-min';
import createPlotlyComponent from 'react-plotly.js/factory';
import { downsampleRows } from '../utils/downsample.js';

const Plot = createPlotlyComponent(Plotly);
const MAX_POINTS = 4000;
const NO_DOWNSAMPLE_DURATION_MS = 3 * 24 * 60 * 60 * 1000;
const SUBPLOT_TITLES = [
    { yref: 'y1 domain', text: '~~ Wave Heights (H1/3 & Hmax)' },
    { yref: 'y2 domain', text: '[T] Wave Period (T1/3)' },
    { yref: 'y3 domain', text: '[Dir] Direction & Spread' },
    { yref: 'y4 domain', text: '[Temp] Sea Surface Temperature' }
];

const MODE_BAR_CONFIG = {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['lasso2d', 'select2d']
};

export default function WavePlot({ data, focusRange, onFocusRangeChange }) {
    const focusDurationMs = useMemo(() => {
        if (!focusRange) {
            return null;
        }

        const [start, end] = focusRange;
        return Math.max(0, end.getTime() - start.getTime());
    }, [focusRange]);

    const visibleRows = useMemo(() => {
        if (!focusRange) {
            return data;
        }

        const [start, end] = focusRange;
        return data.filter((row) => row.datetime >= start && row.datetime <= end);
    }, [data, focusRange]);

    const displayRows = useMemo(() => {
        if (focusDurationMs !== null && focusDurationMs <= NO_DOWNSAMPLE_DURATION_MS) {
            return visibleRows;
        }

        return downsampleRows(visibleRows, MAX_POINTS);
    }, [focusDurationMs, visibleRows]);

    const timeAxis = useMemo(() => displayRows.map((row) => row.datetime), [displayRows]);
    const fullRange = useMemo(() => {
        if (!data.length) {
            return null;
        }

        const first = data[0].datetime;
        const last = data[data.length - 1].datetime;
        return [first, last];
    }, [data]);

    const focusRangeIso = useMemo(() => {
        if (!focusRange) {
            return undefined;
        }

        const [start, end] = focusRange;
        return [start.toISOString(), end.toISOString()];
    }, [focusRange]);

    const sliderRangeIso = useMemo(() => {
        if (!fullRange) {
            return undefined;
        }

        const [start, end] = fullRange;
        return [start.toISOString(), end.toISOString()];
    }, [fullRange]);

    const mainTraces = useMemo(() => {
        return [
            {
                type: 'scatter',
                mode: 'lines+markers',
                name: 'Significant wave height (H1/3)',
                x: timeAxis,
                y: displayRows.map((row) => row.height_1_3_m),
                yaxis: 'y1',
                line: { color: '#2563eb', width: 2 },
                marker: { size: 4 },
                hovertemplate: '%{x|%Y-%m-%d %H:%M:%S}<br>H1/3: %{y:.2f} m<extra></extra>',
                connectgaps: true
            },
            {
                type: 'scatter',
                mode: 'lines+markers',
                name: 'Maximum wave height',
                x: timeAxis,
                y: displayRows.map((row) => row.height_max_m),
                yaxis: 'y1',
                line: { color: '#1d4ed8', width: 2 },
                marker: { size: 4 },
                hovertemplate: '%{x|%Y-%m-%d %H:%M:%S}<br>Hmax: %{y:.2f} m<extra></extra>',
                connectgaps: true
            },
            {
                type: 'scatter',
                mode: 'lines+markers',
                name: 'Significant wave period',
                x: timeAxis,
                y: displayRows.map((row) => row.period_1_3_s),
                xaxis: 'x2',
                yaxis: 'y2',
                line: { color: '#16a34a', width: 2 },
                marker: { size: 4 },
                hovertemplate: '%{x|%Y-%m-%d %H:%M:%S}<br>Period: %{y:.2f} s<extra></extra>',
                connectgaps: true
            },
            {
                type: 'scatter',
                mode: 'lines+markers',
                name: 'Peak wave direction',
                x: timeAxis,
                y: displayRows.map((row) => row.peak_direction_deg),
                xaxis: 'x3',
                yaxis: 'y3',
                line: { color: '#f97316', width: 2 },
                marker: { size: 4 },
                hovertemplate: '%{x|%Y-%m-%d %H:%M:%S}<br>Direction: %{y:.1f} deg<extra></extra>',
                connectgaps: true
            },
            {
                type: 'scatter',
                mode: 'lines+markers',
                name: 'Directional spread',
                x: timeAxis,
                y: displayRows.map((row) => row.peak_spread_deg),
                xaxis: 'x3',
                yaxis: 'y3',
                line: { color: '#fb923c', width: 2, dash: 'dot' },
                marker: { size: 4 },
                hovertemplate: '%{x|%Y-%m-%d %H:%M:%S}<br>Spread: %{y:.1f} deg<extra></extra>',
                connectgaps: true
            },
            {
                type: 'scatter',
                mode: 'lines+markers',
                name: 'Sea temperature',
                x: timeAxis,
                y: displayRows.map((row) => row.sea_temperature_c),
                xaxis: 'x4',
                yaxis: 'y4',
                line: { color: '#ef4444', width: 2 },
                marker: { size: 4 },
                hovertemplate: '%{x|%Y-%m-%d %H:%M:%S}<br>Temperature: %{y:.2f} C<extra></extra>',
                connectgaps: true
            }
        ];
    }, [displayRows, timeAxis]);

    const overviewTrace = useMemo(() => {
        if (!data.length) {
            return null;
        }

        const overviewRows = downsampleRows(data, 800);
        return {
            type: 'scatter',
            mode: 'lines',
            x: overviewRows.map((row) => row.datetime),
            y: overviewRows.map(() => 1),
            xaxis: 'x5',
            yaxis: 'y5',
            line: { color: '#94a3b8', width: 1 },
            fill: 'tozeroy',
            fillcolor: 'rgba(148, 163, 184, 0.4)',
            hoverinfo: 'skip',
            showlegend: false,
            connectgaps: true
        };
    }, [data]);

    const plotData = useMemo(() => {
        if (overviewTrace) {
            return [...mainTraces, overviewTrace];
        }

        return mainTraces;
    }, [mainTraces, overviewTrace]);

    const layout = useMemo(() => {
        const zoomRange = focusRangeIso;

        return {
            height: 920,
            margin: { t: 50, r: 30, b: 60, l: 65 },
            showlegend: false,
            xaxis: {
                type: 'date',
                anchor: 'y1',
                domain: [0, 1],
                range: zoomRange,
                showticklabels: false,
                ticks: '',
                showgrid: false,
                zeroline: false
            },
            yaxis: {
                title: 'Wave height (m)',
                domain: [0.78, 1.0]
            },
            xaxis2: {
                type: 'date',
                anchor: 'y2',
                domain: [0, 1],
                matches: 'x',
                showticklabels: false,
                ticks: '',
                showgrid: false,
                zeroline: false
            },
            yaxis2: {
                title: 'Wave period (s)',
                domain: [0.54, 0.76]
            },
            xaxis3: {
                type: 'date',
                anchor: 'y3',
                domain: [0, 1],
                matches: 'x',
                showticklabels: false,
                ticks: '',
                showgrid: false,
                zeroline: false
            },
            yaxis3: {
                title: 'Direction / Spread (deg)',
                domain: [0.30, 0.52]
            },
            xaxis4: {
                type: 'date',
                anchor: 'y4',
                domain: [0, 1],
                matches: 'x',
                showticklabels: false,
                ticks: '',
                showgrid: false,
                zeroline: false
            },
            yaxis4: {
                title: 'Sea temperature (deg C)',
                domain: [0.12, 0.28]
            },
            xaxis5: {
                type: 'date',
                anchor: 'y5',
                domain: [0, 1],
                range: zoomRange,
                title: 'Timeline (local)',
                showgrid: false,
                ticks: '',
                tickformat: '%Y-%m-%d',
                ticklabelmode: 'period',
                rangeslider: {
                    visible: true,
                    range: sliderRangeIso,
                    thickness: 0.18,
                    bgcolor: '#e2e8f0',
                    bordercolor: '#94a3b8',
                    borderwidth: 1
                },
                fixedrange: false
            },
            yaxis5: {
                domain: [0.0, 0.08],
                visible: false,
                anchor: 'x5',
                range: [0, 1.05],
                fixedrange: true
            },
            hovermode: 'x unified',
            paper_bgcolor: '#f7f9fb',
            plot_bgcolor: '#ffffff',
            annotations: [
                ...SUBPLOT_TITLES.map((item) => ({
                    xref: 'paper',
                    yref: item.yref,
                    x: 0.0,
                    y: 1.04,
                    text: item.text,
                    showarrow: false,
                    xanchor: 'left',
                    yanchor: 'bottom',
                    font: { size: 14, color: '#0f172a' }
                })),
                {
                    xref: 'paper',
                    yref: 'paper',
                    x: 0.0,
                    y: 0.085,
                    text: 'Timeline range slider',
                    showarrow: false,
                    xanchor: 'left',
                    yanchor: 'bottom',
                    font: { size: 12, color: '#475569' }
                }
            ]
        };
    }, [focusRangeIso, sliderRangeIso]);

    const handleRelayout = useCallback(
        (relayoutData) => {
            if (!onFocusRangeChange) {
                return;
            }

            const startValue =
                relayoutData['xaxis.range[0]'] ?? relayoutData['xaxis5.range[0]'];
            const endValue = relayoutData['xaxis.range[1]'] ?? relayoutData['xaxis5.range[1]'];

            if (startValue && endValue) {
                const nextStart = new Date(startValue);
                const nextEnd = new Date(endValue);

                if (Number.isFinite(nextStart.valueOf()) && Number.isFinite(nextEnd.valueOf())) {
                    const nextIso = [nextStart.toISOString(), nextEnd.toISOString()];
                    if (
                        sliderRangeIso &&
                        nextIso[0] === sliderRangeIso[0] &&
                        nextIso[1] === sliderRangeIso[1]
                    ) {
                        onFocusRangeChange(null);
                    } else if (
                        !focusRangeIso ||
                        focusRangeIso[0] !== nextIso[0] ||
                        focusRangeIso[1] !== nextIso[1]
                    ) {
                        onFocusRangeChange([nextStart, nextEnd]);
                    }
                }
            } else if (relayoutData['xaxis.autorange'] || relayoutData['xaxis5.autorange']) {
                onFocusRangeChange(null);
            }
        },
        [focusRangeIso, onFocusRangeChange, sliderRangeIso]
    );

    return (
        <Plot
            data={plotData}
            layout={layout}
            config={MODE_BAR_CONFIG}
            style={{ width: '100%', height: '100%' }}
            useResizeHandler
            onRelayout={handleRelayout}
        />
    );
}
