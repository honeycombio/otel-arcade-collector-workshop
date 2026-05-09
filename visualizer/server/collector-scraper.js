// Periodically fetch Collector :8888/metrics (Prometheus text format) and
// extract otelcol_* metrics. Failures are silent except a single "waiting"
// state pushed to clients so the UI can show "waiting for Collector".

const KEYS = [
  'otelcol_receiver_accepted_spans',
  'otelcol_receiver_refused_spans',
  'otelcol_receiver_accepted_metric_points',
  'otelcol_receiver_refused_metric_points',
  'otelcol_receiver_accepted_log_records',
  'otelcol_receiver_refused_log_records',
  'otelcol_exporter_sent_spans',
  'otelcol_exporter_send_failed_spans',
  'otelcol_exporter_sent_metric_points',
  'otelcol_exporter_sent_log_records',
  'otelcol_exporter_queue_size',
  'otelcol_exporter_queue_capacity',
  'otelcol_processor_batch_batch_send_size_count',
  'otelcol_processor_tail_sampling_count_traces_sampled',
  'otelcol_processor_tail_sampling_global_count_traces_sampled',
];

function parsePromText(text) {
  const out = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    // metric{label="x",label2="y"} value [timestamp]
    const m = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{([^}]*)\})?\s+([\-+0-9.eE]+)/);
    if (!m) continue;
    const name = m[1];
    if (!KEYS.includes(name)) continue;
    const labels = {};
    if (m[3]) {
      for (const part of m[3].split(',')) {
        const lm = part.match(/^([^=]+)="([^"]*)"$/);
        if (lm) labels[lm[1].trim()] = lm[2];
      }
    }
    const value = parseFloat(m[4]);
    if (!out[name]) out[name] = [];
    out[name].push({ labels, value });
  }
  return out;
}

function startScraper({ url, intervalMs, broadcast, type = 'metrics' }) {
  let consecutiveFailures = 0;
  let stopped = false;

  async function tick() {
    if (stopped) return;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const text = await res.text();
      const parsed = parsePromText(text);
      consecutiveFailures = 0;
      broadcast({ type, payload: { connected: true, metrics: parsed, ts: Date.now() } });
    } catch (err) {
      consecutiveFailures += 1;
      broadcast({ type, payload: { connected: false, error: String(err.message || err), consecutiveFailures, ts: Date.now() } });
    }
  }

  const handle = setInterval(tick, intervalMs);
  // Kick off immediately so the UI isn't blank for `intervalMs`.
  setTimeout(tick, 100);

  return () => { stopped = true; clearInterval(handle); };
}

module.exports = { startScraper };
