import { useEffect, useState } from 'react';
import { parquetReadObjects } from 'hyparquet';
import { parseWaveData } from '../utils/dataParser.js';

const DATA_FILE_NAME = import.meta.env.MODE === 'production'
  ? 'wave_buoys_data_prod.parquet'
  : 'wave_buoys_data.parquet';
const DATA_URL = `${import.meta.env.BASE_URL}data/${DATA_FILE_NAME}`;
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
    const controller = new AbortController();

  // Fetch the entire file to avoid range issues when the host compresses responses.
  async function fetchParquetFile(url, signal) {
      const response = await fetch(url, { cache: 'no-store', signal });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      const byteLength = buffer.byteLength;

      return {
        byteLength,
        slice(start, end) {
          const nextEnd = end ?? byteLength;
          return buffer.slice(start, nextEnd);
        }
      };
    }

    async function load() {
      try {
        const file = await fetchParquetFile(DATA_URL, controller.signal);
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
        if (isCancelled || controller.signal.aborted) {
          return;
        }

        const message = error instanceof Error ? error.message : 'Unable to load wave buoy data.';
        setState((prev) => ({ ...prev, loading: false, error: new Error(message) }));
      }
    }

    load();

    return () => {
      isCancelled = true;
      controller.abort();
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
