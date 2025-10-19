import { useEffect, useState } from 'react';
import { asyncBufferFromUrl, parquetReadObjects } from 'hyparquet';
import { parseWaveData } from '../utils/dataParser.js';

const DATA_URL = `${import.meta.env.BASE_URL}data/wave_buoys_data.parquet`;
const REQUIRED_COLUMNS = [
  'campaign_id',
  'datetime',
  'height_1_3_m',
  'height_max_m',
  'period_1_3_s',
  'peak_direction_deg',
  'peak_spread_deg',
  'sea_temperature_c'
];

export default function DataLoader({ children }) {
  if (typeof children !== 'function') {
    throw new Error('DataLoader requires a render function as its child.');
  }

  const [state, setState] = useState({
    loading: true,
    error: null,
    rows: [],
    campaignIds: []
  });

  useEffect(() => {
    let isCancelled = false;

    async function load() {
      try {
        const file = await asyncBufferFromUrl({ url: DATA_URL });
        const rawRows = await parquetReadObjects({
          file,
          columns: REQUIRED_COLUMNS
        });

        if (isCancelled) {
          return;
        }

        const { rows, campaignIds } = parseWaveData(rawRows);
        setState({ loading: false, error: null, rows, campaignIds });
      } catch (error) {
        if (isCancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : 'Unable to load wave buoy data.';
        setState((prev) => ({ ...prev, loading: false, error: new Error(message) }));
      }
    }

    load();

    return () => {
      isCancelled = true;
    };
  }, []);

  if (state.loading) {
    return <div className="loading">Loading wave buoy measurements...</div>;
  }

  if (state.error) {
    return (
      <div className="error">
        Failed to load data. {state.error.message}
      </div>
    );
  }

  return children({ data: state.rows, campaignIds: state.campaignIds });
}
