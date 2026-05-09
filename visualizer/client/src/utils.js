// Shared metric helpers used by CollectorHealth, PipelineTopology, and friends.

export function sumByName(metrics, name) {
  const arr = (metrics && metrics[name]) || [];
  return arr.reduce((s, m) => s + (m.value || 0), 0);
}

export function sumByLabel(metrics, name, lk, lv) {
  return ((metrics && metrics[name]) || [])
    .filter((m) => m.labels && m.labels[lk] === lv)
    .reduce((s, m) => s + (m.value || 0), 0);
}

export function pick(metrics, name) {
  const arr = (metrics && metrics[name]) || [];
  return arr[0] ? arr[0].value : 0;
}
