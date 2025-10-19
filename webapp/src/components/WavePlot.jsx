import { useMemo } from 'react';
import Plotly from 'plotly.js-dist-min';
import createPlotlyComponent from 'react-plotly.js/factory';

const Plot = createPlotlyComponent(Plotly);

const MODE_BAR_CONFIG = {
  responsive: true,
  displaylogo: false,
  modeBarButtonsToRemove: ['lasso2d', 'select2d']
};

export default function WavePlot({ data }) {
  const timeAxis = useMemo(() => data.map((row) => row.datetime.toISOString()), [data]);

  const chartData = useMemo(() => {
    return [
      {
        type: 'scatter',
        mode: 'lines+markers',
        name: 'Significant wave height (H1/3)',
        x: timeAxis,
        y: data.map((row) => row.height_1_3_m),
        yaxis: 'y1',
        line: { color: '#2563eb', width: 2 },
        marker: { size: 4 },
        hovertemplate: '%{x}<br>H1/3: %{y:.2f} m<extra></extra>'
      },
      {
        type: 'scatter',
        mode: 'lines+markers',
        name: 'Maximum wave height',
        x: timeAxis,
        y: data.map((row) => row.height_max_m),
        yaxis: 'y1',
        line: { color: '#1d4ed8', width: 2, dash: 'dash' },
        marker: { size: 4 },
        hovertemplate: '%{x}<br>Hmax: %{y:.2f} m<extra></extra>'
      },
      {
        type: 'scatter',
        mode: 'lines+markers',
        name: 'Significant wave period',
        x: timeAxis,
        y: data.map((row) => row.period_1_3_s),
        xaxis: 'x2',
        yaxis: 'y2',
        line: { color: '#16a34a', width: 2 },
        marker: { size: 4 },
        hovertemplate: '%{x}<br>Period: %{y:.2f} s<extra></extra>'
      },
      {
        type: 'scatter',
        mode: 'lines+markers',
        name: 'Peak wave direction',
        x: timeAxis,
        y: data.map((row) => row.peak_direction_deg),
        xaxis: 'x3',
        yaxis: 'y3',
        line: { color: '#f97316', width: 2 },
        marker: { size: 4 },
        hovertemplate: '%{x}<br>Direction: %{y:.1f} deg<extra></extra>'
      },
      {
        type: 'scatter',
        mode: 'lines+markers',
        name: 'Directional spread',
        x: timeAxis,
        y: data.map((row) => row.peak_spread_deg),
        xaxis: 'x3',
        yaxis: 'y3',
        line: { color: '#fb923c', width: 2, dash: 'dot' },
        marker: { size: 4 },
        hovertemplate: '%{x}<br>Spread: %{y:.1f} deg<extra></extra>'
      },
      {
        type: 'scatter',
        mode: 'lines+markers',
        name: 'Sea temperature',
        x: timeAxis,
        y: data.map((row) => row.sea_temperature_c),
        xaxis: 'x4',
        yaxis: 'y4',
        line: { color: '#ef4444', width: 2 },
        marker: { size: 4 },
        hovertemplate: '%{x}<br>Temperature: %{y:.2f} C<extra></extra>'
      }
    ];
  }, [data, timeAxis]);

  const layout = useMemo(
    () => ({
      height: 900,
      margin: { t: 50, r: 30, b: 80, l: 65 },
      legend: {
        orientation: 'h',
        yanchor: 'bottom',
        y: 1.05,
        xanchor: 'right',
        x: 1
      },
      grid: { rows: 4, columns: 1, pattern: 'independent', roworder: 'top to bottom' },
      xaxis: {
        title: 'Datetime',
        type: 'date',
        rangeslider: { visible: true },
        rangeselector: {
          buttons: [
            { count: 6, label: '6h', step: 'hour', stepmode: 'backward' },
            { count: 1, label: '1d', step: 'day', stepmode: 'backward' },
            { count: 7, label: '7d', step: 'day', stepmode: 'backward' },
            { count: 1, label: '1m', step: 'month', stepmode: 'backward' },
            { step: 'all', label: 'All' }
          ]
        }
      },
      xaxis2: { matches: 'x', anchor: 'y2', type: 'date' },
      xaxis3: { matches: 'x', anchor: 'y3', type: 'date' },
      xaxis4: { matches: 'x', anchor: 'y4', type: 'date' },
    yaxis: { title: 'Wave height (m)' },
    yaxis2: { title: 'Wave period (s)' },
    yaxis3: { title: 'Direction / Spread (deg)' },
    yaxis4: { title: 'Sea temperature (deg C)' },
      hovermode: 'x unified',
      paper_bgcolor: '#f7f9fb',
      plot_bgcolor: '#ffffff'
    }),
    []
  );

  return (
    <Plot
      data={chartData}
      layout={layout}
      config={MODE_BAR_CONFIG}
      style={{ width: '100%', height: '100%' }}
      useResizeHandler
    />
  );
}
