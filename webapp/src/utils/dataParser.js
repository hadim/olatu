const NUMERIC_COLUMNS = [
  'height_1_3_m',
  'height_max_m',
  'period_1_3_s',
  'peak_direction_deg',
  'peak_spread_deg',
  'sea_temperature_c'
];

function toNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function parseWaveData(rawRows) {
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    return { rows: [], campaignIds: [] };
  }

  const parsedRows = rawRows
    .map((row) => {
      const datetimeValue = row.datetime ?? row.Datetime ?? null;
      const datetime = datetimeValue ? new Date(datetimeValue) : null;

      if (!(datetime instanceof Date) || Number.isNaN(datetime.getTime())) {
        return null;
      }

      const normalized = { ...row, datetime };

      NUMERIC_COLUMNS.forEach((column) => {
        normalized[column] = toNumber(row[column]);
      });

      normalized.campaign_id = row.campaign_id ?? row.campaign ?? null;

      return normalized;
    })
    .filter(Boolean)
    .sort((a, b) => a.datetime - b.datetime);

  const campaignIds = Array.from(
    new Set(
      parsedRows
        .map((row) => row.campaign_id)
        .filter((value) => value !== null && value !== undefined && value !== '')
    )
  ).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  return { rows: parsedRows, campaignIds };
}
