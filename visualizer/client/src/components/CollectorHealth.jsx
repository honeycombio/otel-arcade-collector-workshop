import React from 'react';

function sumByName(metrics, name) {
  const arr = (metrics && metrics[name]) || [];
  return arr.reduce((s, m) => s + (m.value || 0), 0);
}

function sumByLabel(metrics, name, lk, lv) {
  return ((metrics && metrics[name]) || [])
    .filter((m) => m.labels && m.labels[lk] === lv)
    .reduce((s, m) => s + (m.value || 0), 0);
}

function pick(metrics, name) {
  const arr = (metrics && metrics[name]) || [];
  return arr[0] ? arr[0].value : 0;
}

function gauge(label, value, opts = {}) {
  let cls = 'gauge';
  if (opts.warnAt != null && value >= opts.warnAt) cls += ' warn';
  if (opts.badAt != null && value >= opts.badAt) cls += ' bad';
  return (
    <div className={cls} key={label}>
      <div className="label">{label}</div>
      <div className="value">{typeof value === 'number' ? value.toLocaleString() : value}</div>
    </div>
  );
}

export function CollectorHealth({ metrics, connected, label = 'Collector' }) {
  return (
    <details className="health" open>
      <summary>{label} self-metrics</summary>
      {!connected ? (
        <div className="empty">{label} self-metrics endpoint unreachable. Bring up the {label.toLowerCase()} and it will appear here.</div>
      ) : (
        <div className="health-grid">
          {gauge('Spans accepted', sumByName(metrics, 'otelcol_receiver_accepted_spans'))}
          {gauge('Spans refused', sumByName(metrics, 'otelcol_receiver_refused_spans'), { warnAt: 1, badAt: 100 })}
          {gauge('Spans sent', sumByName(metrics, 'otelcol_exporter_sent_spans'))}
          {gauge('Send failed (spans)', sumByName(metrics, 'otelcol_exporter_send_failed_spans'), { warnAt: 1, badAt: 100 })}
          {gauge('Queue size', pick(metrics, 'otelcol_exporter_queue_size'), { warnAt: 100 })}
          {gauge('Queue capacity', pick(metrics, 'otelcol_exporter_queue_capacity'))}
          {gauge('Logs accepted', sumByName(metrics, 'otelcol_receiver_accepted_log_records'))}
          {gauge('Metric points accepted', sumByName(metrics, 'otelcol_receiver_accepted_metric_points'))}
          {/* Tail sampling gauges — only visible when tail_sampling processor is active */}
          {sumByName(metrics, 'otelcol_processor_tail_sampling_count_traces_sampled') > 0 && (
            <>
              {gauge('Traces sampled', sumByName(metrics, 'otelcol_processor_tail_sampling_count_traces_sampled'))}
              {gauge('Traces dropped', sumByLabel(metrics, 'otelcol_processor_tail_sampling_global_count_traces_sampled', 'sampled', 'false'), { warnAt: 1 })}
            </>
          )}
        </div>
      )}
    </details>
  );
}
