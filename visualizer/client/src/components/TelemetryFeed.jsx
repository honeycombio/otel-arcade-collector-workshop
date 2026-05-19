import React, { useState, useMemo, memo } from 'react';

const SQL_RE   = /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE)\b/i;
const PROBE_RE  = /^(GET|POST) \/(health|ready)$/;

function detectSmells(item) {
  const tags = [];
  const a = item.attrs || {};

  // PII: present and not already redacted to "***"
  if (a['player.id'] != null && a['player.id'] !== '***')
    tags.push({ kind: 'warn', label: 'PII player.id' });

  // Long attribute value: user-agent over 128 chars (truncate_all fixes this)
  if (a['browser.user_agent'] && String(a['browser.user_agent']).length > 128)
    tags.push({ kind: 'warn', label: 'full UA' });

  if (item.kind === 'span' && SQL_RE.test(item.name || ''))
    tags.push({ kind: 'warn', label: 'raw SQL name' });

  // Matches the filter pattern: ^(GET|POST) /(health|ready)$
  if (item.kind === 'span' && PROBE_RE.test(item.name || ''))
    tags.push({ kind: 'warn', label: 'probe noise' });

  const r = item.resourceAttrs || {};
  if (r['app.name'] && r['service.name'] && r['app.name'] === r['service.name'])
    tags.push({ kind: 'warn', label: 'redundant app.name' });

  return tags;
}

function pickAttrSummary(item) {
  const a = item.attrs || {};
  const keys = ['game.name', 'game.session.id', 'player.id', 'http.method', 'http.target'];
  const hits = keys.filter((k) => a[k] != null).slice(0, 3);
  return hits.map((k) => `${k}=${String(a[k]).slice(0, 40)}`).join(' · ');
}

export function countSmells(items) {
  return items.filter((item) => detectSmells(item).length > 0).length;
}

// ── Diff row ───────────────────────────────────────────────────────────────

function DiffRows({ diff }) {
  if (!diff || !diff.length) return null;
  return (
    <div className="diff-list">
      {diff.map((change, i) => (
        <div key={change.field} className="diff-row">
          <span className="diff-field">{change.field}</span>
          <span className="diff-before">{change.before == null ? '(none)' : String(change.before).slice(0, 60)}</span>
          <span className="diff-arrow">→</span>
          <span className="diff-after">{change.after == null ? '(removed)' : String(change.after).slice(0, 60)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Key-value attribute table ──────────────────────────────────────────────

function KVTable({ label, obj }) {
  const entries = Object.entries(obj || {});
  if (!entries.length) return null;
  return (
    <div className="detail-kv-block">
      <span className="detail-section-label">{label}</span>
      <div className="detail-kv">
        {entries.map(([k, v]) => (
          <React.Fragment key={k}>
            <span className="detail-label">{k}</span>
            <span className="detail-val">{String(v)}</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// ── Single feed row ────────────────────────────────────────────────────────

const FeedRow = memo(function FeedRow({ item, showDiff }) {
  const [expanded, setExpanded] = useState(false);
  const tags   = detectSmells(item);
  const hasDiff = item.diff && item.diff.length > 0;
  const cls    = `row ${item.kind} ${tags.length ? 'smelly' : ''} ${hasDiff ? 'has-diff' : ''} expandable ${expanded ? 'expanded' : ''}`;

  if (item.kind === 'metric') {
    return (
      <div className={cls} onClick={() => setExpanded((v) => !v)}>
        <span className="svc">{item.service}</span>
        <span className="name">
          {item.name}
          <span className="metric-type-badge">{item.metricType}</span>
        </span>
        <span className="dur" style={{ color: 'var(--accent2)' }}>
          {item.value != null ? item.value : '—'}
        </span>
        {expanded && (
          <div className="row-detail">
            <div className="detail-kv-block">
              <div className="detail-kv">
                <span className="detail-label">type</span>
                <span className="detail-val">{item.metricType}</span>
                <span className="detail-label">value</span>
                <span className="detail-val">{String(item.value)}</span>
                <span className="detail-label">service</span>
                <span className="detail-val">{item.service}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cls} onClick={() => setExpanded((v) => !v)}>
      <span className="svc">{item.service}</span>
      <span className="name">
        {item.kind === 'log' ? <span style={{ color: 'var(--muted)' }}>[{item.severity}] </span> : null}
        {item.name || (!expanded && item.body)}
        <br />
        <span style={{ color: 'var(--muted)', fontSize: 11 }}>{pickAttrSummary(item)}</span>
        {tags.map((t) => <span key={t.label} className={`tag ${t.kind}`}>{t.label}</span>)}
      </span>
      <span className="dur">{item.kind === 'span' ? `${item.durationMs.toFixed(1)} ms` : ''}</span>

      {expanded && (
        <div className="row-detail">
          {item.kind === 'span' && (
            <div className="detail-ids">
              <span className="detail-label">trace</span>
              <span className="detail-id">{item.traceId}</span>
              <span className="detail-label">span</span>
              <span className="detail-id">{item.spanId}</span>
            </div>
          )}
          {item.kind === 'log' && item.body && (
            <div className="detail-body">{item.body}</div>
          )}
          <KVTable label="attrs"    obj={item.attrs} />
          <KVTable label="resource" obj={item.resourceAttrs} />
          {showDiff && <DiffRows diff={item.diff} />}
        </div>
      )}
    </div>
  );
});

// ── Main component ─────────────────────────────────────────────────────────

export function TelemetryFeed({ items, rawFeed = [] }) {
  const [signalTab,     setSignalTab]     = useState('all');
  const [splitMode,     setSplitMode]     = useState(false);
  const [serviceFilter, setServiceFilter] = useState('');
  const [searchText,    setSearchText]    = useState('');

  const hasDiffData = rawFeed.length > 0;

  // Unique services in the current items list
  const services = useMemo(
    () => [...new Set(items.map((i) => i.service).filter(Boolean))].sort(),
    [items]
  );

  // Apply all filters: signal type → service → text search
  const filtered = useMemo(() => {
    const q = searchText.toLowerCase();
    return items
      .filter((i) => signalTab === 'all' || i.kind === signalTab)
      .filter((i) => !serviceFilter || i.service === serviceFilter)
      .filter((i) => {
        if (!q) return true;
        return (i.name    && i.name.toLowerCase().includes(q))
            || (i.body    && i.body.toLowerCase().includes(q))
            || (i.service && i.service.toLowerCase().includes(q));
      });
  }, [items, signalTab, serviceFilter, searchText]);

  const rawFiltered = useMemo(() => {
    return rawFeed
      .filter((i) => signalTab === 'all' || i.kind === signalTab)
      .filter((i) => !serviceFilter || i.service === serviceFilter);
  }, [rawFeed, signalTab, serviceFilter]);

  const ordered    = filtered.slice().reverse();
  const rawOrdered = rawFiltered.slice().reverse();

  const tabs = [
    { id: 'all',    label: 'All',     count: items.length },
    { id: 'span',   label: 'Traces',  count: items.filter((i) => i.kind === 'span').length },
    { id: 'log',    label: 'Logs',    count: items.filter((i) => i.kind === 'log').length },
    { id: 'metric', label: 'Metrics', count: items.filter((i) => i.kind === 'metric').length },
  ];

  const emptyMsg = items.length === 0
    ? 'No telemetry yet — make sure the Collector is running with an otlphttp/visualizer exporter pointed at http://visualizer:4318. Play a game or use TelemetryGen to generate traffic.'
    : filtered.length === 0
      ? 'No items match the current filters.'
      : `No ${signalTab === 'span' ? 'traces' : signalTab === 'log' ? 'logs' : signalTab === 'metric' ? 'metrics' : 'items'} in the current buffer.`;

  return (
    <div className="feed">
      {/* ── Feed header ────────────────────────────────────── */}
      <div className="feed-header">
        <div className="feed-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`feed-tab ${signalTab === tab.id ? 'active' : ''}`}
              onClick={() => setSignalTab(tab.id)}
            >
              {tab.label}
              <span className="feed-tab-count">{tab.count}</span>
            </button>
          ))}
        </div>

        {/* Service filter — only shown when more than one service is present */}
        {services.length > 1 && (
          <select
            className="feed-filter-select"
            value={serviceFilter}
            onChange={(e) => setServiceFilter(e.target.value)}
            title="Filter by service"
          >
            <option value="">All services</option>
            {services.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}

        {/* Text search */}
        <input
          className="feed-search"
          type="search"
          placeholder="filter…"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          title="Filter by span name, log body, or service"
        />

        <button
          className={`split-btn ${splitMode ? 'active' : ''} ${!hasDiffData ? 'disabled' : ''}`}
          onClick={() => hasDiffData && setSplitMode((v) => !v)}
          title={hasDiffData ? 'Toggle side-by-side before/after view' : 'Load the Lab 2 template to enable before/after comparison'}
        >
          Split
        </button>
      </div>

      {/* ── Split view ─────────────────────────────────────── */}
      {splitMode ? (
        <div className="feed-split">
          <div className="feed-pane before">
            <div className="feed-pane-label">Before</div>
            {rawOrdered.length === 0
              ? <div className="empty">No pre-transform data.</div>
              : rawOrdered.map((item, idx) => (
                  <FeedRow key={`${item.spanId || item.ts}-${idx}`} item={item} showDiff={false} />
                ))
            }
          </div>
          <div className="feed-pane after">
            <div className="feed-pane-label">After</div>
            {ordered.length === 0
              ? <div className="empty">{emptyMsg}</div>
              : ordered.map((item, idx) => (
                  <FeedRow key={`${item.spanId || item.ts}-${idx}`} item={item} showDiff={true} />
                ))
            }
          </div>
        </div>
      ) : (
        /* ── Single view ───────────────────────────────────── */
        <div className="feed-body">
          {ordered.length === 0
            ? <div className="empty">{emptyMsg}</div>
            : ordered.map((item, idx) => (
                <FeedRow key={`${item.spanId || item.ts}-${idx}`} item={item} showDiff={false} />
              ))
          }
        </div>
      )}
    </div>
  );
}
