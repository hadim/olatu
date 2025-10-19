export function downsampleRows(rows, maxPoints = 5000) {
  if (!Array.isArray(rows) || rows.length <= maxPoints) {
    return rows;
  }

  const step = Math.max(1, Math.ceil(rows.length / maxPoints));
  const sampled = [];

  for (let index = 0; index < rows.length; index += step) {
    sampled.push(rows[index]);
  }

  const last = rows[rows.length - 1];
  if (sampled[sampled.length - 1] !== last) {
    sampled.push(last);
  }

  return sampled;
}
