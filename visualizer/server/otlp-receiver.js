// Minimal OTLP/HTTP receiver. Accepts POST /v1/traces, /v1/metrics, /v1/logs
// with body in OTLP JSON format.
//
// Two channels for traces:
//   - Normal POST /v1/traces                      → processed ring buffer (post-transform)
//   - POST /v1/traces + x-raw-channel: true       → rawBuffer (pre-transform) + rawMap for diff
//
// Per-collector source tagging:
//   - x-collector-source: agent|gateway           → tags each item with source
//   - Defaults to 'agent' when header is absent
const express = require('express');

const RING_CAP         = 200;
const RAW_TTL_MS       = 60000;
const RAW_MAP_CAP      = 500;
const SPAN_INDEX_TTL   = 60000;   // how long to keep a span in the lookup index
const SPAN_INDEX_CAP   = 2000;    // max entries before we evict oldest
const EDGE_TTL         = 5 * 60 * 1000; // remove edges not seen in 5 min

class RingBuffer {
  constructor(cap) { this.cap = cap; this.items = []; }
  push(item) {
    this.items.push(item);
    if (this.items.length > this.cap) this.items.shift();
  }
  list() { return this.items.slice(); }
}

// ── Attribute helpers ──────────────────────────────────────────────────────

function attrsToObject(attrs) {
  const out = {};
  if (!Array.isArray(attrs)) return out;
  for (const a of attrs) {
    if (!a || !a.key) continue;
    const v = a.value || {};
    out[a.key] = v.stringValue ?? v.intValue ?? v.boolValue ?? v.doubleValue ?? v.arrayValue ?? null;
  }
  return out;
}

// ── Normalizers ────────────────────────────────────────────────────────────

function normalizeSpans(payload, source) {
  const spans = [];
  for (const rs of payload.resourceSpans || []) {
    const resourceAttrs = attrsToObject(rs.resource && rs.resource.attributes);
    const serviceName = resourceAttrs['service.name'] || 'unknown';
    for (const ss of rs.scopeSpans || []) {
      for (const span of ss.spans || []) {
        const startNs = Number(span.startTimeUnixNano || 0);
        const endNs   = Number(span.endTimeUnixNano   || 0);
        spans.push({
          kind:         'span',
          source,
          traceId:      span.traceId,
          spanId:       span.spanId,
          parentSpanId: span.parentSpanId || null,
          name:         span.name,
          service:      serviceName,
          attrs:        attrsToObject(span.attributes),
          resourceAttrs,
          durationMs:   endNs > startNs ? (endNs - startNs) / 1e6 : 0,
          isError:      !!(span.status && span.status.code === 2),
          ts:           Date.now(),
        });
      }
    }
  }
  return spans;
}

function normalizeLogs(payload, source) {
  const logs = [];
  for (const rl of payload.resourceLogs || []) {
    const resourceAttrs = attrsToObject(rl.resource && rl.resource.attributes);
    const serviceName = resourceAttrs['service.name'] || 'unknown';
    for (const sl of rl.scopeLogs || []) {
      for (const log of sl.logRecords || []) {
        logs.push({
          kind:     'log',
          source,
          severity: log.severityText || 'INFO',
          body:     (log.body && (log.body.stringValue || JSON.stringify(log.body))) || '',
          service:  serviceName,
          attrs:    attrsToObject(log.attributes),
          resourceAttrs,
          ts: Date.now(),
        });
      }
    }
  }
  return logs;
}

function normalizeMetrics(payload, source) {
  const items = [];
  for (const rm of payload.resourceMetrics || []) {
    const resourceAttrs = attrsToObject(rm.resource && rm.resource.attributes);
    const serviceName = resourceAttrs['service.name'] || 'unknown';
    for (const sm of rm.scopeMetrics || []) {
      for (const metric of sm.metrics || []) {
        let metricType = 'unknown';
        let value = null;
        if (metric.gauge) {
          metricType = 'gauge';
          const dp = metric.gauge.dataPoints && metric.gauge.dataPoints[0];
          if (dp) value = dp.asDouble ?? dp.asInt ?? null;
        } else if (metric.sum) {
          metricType = 'sum';
          const dp = metric.sum.dataPoints && metric.sum.dataPoints[0];
          if (dp) value = dp.asDouble ?? dp.asInt ?? null;
        } else if (metric.histogram) {
          metricType = 'histogram';
          const dp = metric.histogram.dataPoints && metric.histogram.dataPoints[0];
          if (dp) value = dp.count ?? null;
        }
        items.push({
          kind: 'metric',
          source,
          name: metric.name,
          metricType,
          value,
          service:  serviceName,
          resourceAttrs,
          ts: Date.now(),
        });
      }
    }
  }
  return items;
}

// ── Diff helpers (for before/after toggle) ─────────────────────────────────

function diffSpan(raw, processed) {
  const changes = [];
  if (raw.name !== processed.name) {
    changes.push({ field: 'name', before: raw.name, after: processed.name });
  }
  const allKeys = new Set([
    ...Object.keys(raw.attrs     || {}),
    ...Object.keys(processed.attrs || {}),
  ]);
  for (const k of allKeys) {
    const bv = (raw.attrs      || {})[k];
    const av = (processed.attrs || {})[k];
    if (bv !== av) changes.push({ field: k, before: bv ?? null, after: av ?? null });
  }
  return changes;
}

function pruneRawMap(rawMap) {
  const now = Date.now();
  for (const [key, entry] of rawMap) {
    if (entry.expiresAt < now) rawMap.delete(key);
  }
  if (rawMap.size > RAW_MAP_CAP) {
    const excess = rawMap.size - RAW_MAP_CAP;
    let n = 0;
    for (const key of rawMap.keys()) {
      if (n++ >= excess) break;
      rawMap.delete(key);
    }
  }
}

// ── Service graph helpers ──────────────────────────────────────────────────

function makeServiceGraph() {
  // spanId → { service, ts } — lets us look up a span's service from its ID
  const spanIndex = new Map();
  // "client→server" → { client, server, calls, errors, lastSeen }
  const edgeMap   = new Map();

  function indexSpan(spanId, service) {
    spanIndex.set(spanId, { service, ts: Date.now() });
    // Evict oldest entries when over cap
    if (spanIndex.size > SPAN_INDEX_CAP) {
      let oldest = null, oldestTs = Infinity;
      for (const [id, e] of spanIndex) {
        if (e.ts < oldestTs) { oldest = id; oldestTs = e.ts; }
      }
      if (oldest) spanIndex.delete(oldest);
    }
  }

  function pruneIndex() {
    const cutoff = Date.now() - SPAN_INDEX_TTL;
    for (const [id, e] of spanIndex) {
      if (e.ts < cutoff) spanIndex.delete(id);
    }
  }

  function recordEdge(parentSpanId, childService, isError) {
    const parent = spanIndex.get(parentSpanId);
    if (!parent || parent.service === childService) return;
    const key  = `${parent.service}→${childService}`;
    const edge = edgeMap.get(key) || { client: parent.service, server: childService, calls: 0, errors: 0, lastSeen: 0 };
    edge.calls++;
    if (isError) edge.errors++;
    edge.lastSeen = Date.now();
    edgeMap.set(key, edge);
  }

  function getGraph() {
    const cutoff = Date.now() - EDGE_TTL;
    for (const [k, e] of edgeMap) {
      if (e.lastSeen < cutoff) edgeMap.delete(k);
    }
    return [...edgeMap.values()];
  }

  return { indexSpan, pruneIndex, recordEdge, getGraph };
}

// ── Receiver factory ───────────────────────────────────────────────────────

function makeReceiver({ broadcast }) {
  const buffer    = new RingBuffer(RING_CAP);
  const rawBuffer = new RingBuffer(RING_CAP);
  const rawMap    = new Map();
  const counters  = { spans: 0, logs: 0, metrics: 0 };
  let lastReceivedAt = 0;

  const serviceGraph = makeServiceGraph();

  // Per-source buffers — keyed by x-collector-source header value
  const sourceBuffers = new Map();
  function getSourceBuf(source) {
    if (!sourceBuffers.has(source)) sourceBuffers.set(source, new RingBuffer(RING_CAP));
    return sourceBuffers.get(source);
  }

  const app = express();
  app.use(express.json({ limit: '8mb' }));
  app.use(express.raw({ type: 'application/x-protobuf', limit: '8mb' }));

  app.post('/v1/traces', (req, res) => {
    if (req.is('application/x-protobuf')) {
      counters.spans += 1;
      lastReceivedAt = Date.now();
      return res.status(200).end();
    }

    const source  = req.headers['x-collector-source'] || 'agent';
    const isRaw   = req.headers['x-raw-channel'] === 'true';
    const spans   = normalizeSpans(req.body || {}, source);
    lastReceivedAt = Date.now();

    if (isRaw) {
      pruneRawMap(rawMap);
      for (const s of spans) {
        rawBuffer.push(s);
        getSourceBuf(source).push(s);
        if (s.spanId) rawMap.set(s.spanId, { span: s, expiresAt: Date.now() + RAW_TTL_MS });
        broadcast({ type: 'raw-span', payload: s });
      }
      counters.spans += spans.length;
      return res.status(200).end();
    }

    for (const s of spans) {
      // Service graph: index this span and record the calling edge
      if (s.spanId) {
        if (s.parentSpanId) serviceGraph.recordEdge(s.parentSpanId, s.service, s.isError);
        serviceGraph.indexSpan(s.spanId, s.service);
      }

      const rawEntry = s.spanId ? rawMap.get(s.spanId) : null;
      if (rawEntry) {
        const diff = diffSpan(rawEntry.span, s);
        if (diff.length > 0) s.diff = diff;
        rawMap.delete(s.spanId);
      }
      buffer.push(s);
      getSourceBuf(source).push(s);
      broadcast({ type: 'span', payload: s });
    }
    counters.spans += spans.length;
    // Periodically prune the span index
    if (counters.spans % 200 === 0) serviceGraph.pruneIndex();
    res.status(200).end();
  });

  app.post('/v1/logs', (req, res) => {
    if (req.is('application/x-protobuf')) {
      counters.logs += 1;
      lastReceivedAt = Date.now();
      return res.status(200).end();
    }
    const source = req.headers['x-collector-source'] || 'agent';
    const logs   = normalizeLogs(req.body || {}, source);
    for (const l of logs) {
      buffer.push(l);
      getSourceBuf(source).push(l);
      broadcast({ type: 'log', payload: l });
    }
    counters.logs += logs.length;
    lastReceivedAt = Date.now();
    res.status(200).end();
  });

  app.post('/v1/metrics', (req, res) => {
    if (req.is('application/x-protobuf')) {
      counters.metrics += 1;
      lastReceivedAt = Date.now();
      return res.status(200).end();
    }
    const source = req.headers['x-collector-source'] || 'agent';
    const items  = normalizeMetrics(req.body || {}, source);
    for (const item of items) {
      buffer.push(item);
      getSourceBuf(source).push(item);
      broadcast({ type: 'metric', payload: item });
    }
    counters.metrics += items.length;
    lastReceivedAt = Date.now();
    res.status(200).end();
  });

  app.get('/health', (_req, res) => res.json({ status: 'ok', counters, lastReceivedAt }));

  return { app, buffer, rawBuffer, sourceBuffers, counters, getLastReceivedAt: () => lastReceivedAt, getServiceGraph: serviceGraph.getGraph };
}

module.exports = { makeReceiver };
