import React, { useState, useEffect } from 'react';

function sumByName(metrics, name) {
  const arr = (metrics && metrics[name]) || [];
  return arr.reduce((s, m) => s + (m.value || 0), 0);
}

function chip(name) {
  return <span key={name} className="pipe-chip">{name}</span>;
}

function PipelineRow({ name, pipeline, metrics }) {
  const accepted = sumByName(metrics, 'otelcol_receiver_accepted_spans');
  const sent     = sumByName(metrics, 'otelcol_exporter_sent_spans');
  const failed   = sumByName(metrics, 'otelcol_exporter_send_failed_spans');
  const isTrace  = name.startsWith('traces');

  return (
    <div className="pipeline-row">
      <div className="pipeline-name">{name}</div>

      <div className="pipeline-stage">
        <span className="stage-label">receivers</span>
        <div className="chip-group">{pipeline.receivers.map(chip)}</div>
      </div>

      {pipeline.processors.length > 0 && (
        <>
          <div className="pipeline-arrow">▼</div>
          <div className="pipeline-stage">
            <span className="stage-label">processors</span>
            <div className="chip-group">{pipeline.processors.map(chip)}</div>
          </div>
        </>
      )}

      <div className="pipeline-arrow">▼</div>
      <div className="pipeline-stage">
        <span className="stage-label">exporters</span>
        <div className="chip-group">{pipeline.exporters.map(chip)}</div>
      </div>

      {isTrace && (accepted > 0 || sent > 0) && (
        <div className="pipeline-stats">
          <span style={{ color: 'var(--accent)' }}>{accepted.toFixed(0)} accepted</span>
          <span style={{ color: 'var(--muted)' }}>·</span>
          <span style={{ color: 'var(--ok)' }}>{sent.toFixed(0)} sent</span>
          {failed > 0 && (
            <>
              <span style={{ color: 'var(--muted)' }}>·</span>
              <span style={{ color: 'var(--bad)' }}>{failed.toFixed(0)} failed</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function PipelineTopology({ collectors, selected, onSelect, pipelineConfig, metrics }) {
  const pipelines     = pipelineConfig?.pipelines;
  const pipelineNames = pipelines ? Object.keys(pipelines) : [];

  const [activePipeline, setActivePipeline] = useState(null);
  // Reset pipeline tab when selected collector changes
  useEffect(() => setActivePipeline(null), [selected]);

  const currentPipeline = activePipeline || pipelineNames[0] || null;

  return (
    <div className="topology">
      {/* ── Collector selector ─────────────────────────────── */}
      <div className="collector-selector">
        {(collectors || []).map((c) => (
          <button
            key={c.id}
            className={`collector-btn ${selected === c.id ? 'active' : ''} ${!c.active ? 'inactive' : ''}`}
            onClick={() => onSelect(c.id)}
            title={c.active ? `View ${c.label} pipeline and telemetry` : `No telemetry received from ${c.label} yet`}
          >
            <span className={`collector-dot ${c.active ? 'ok' : ''}`} />
            {c.label}
          </button>
        ))}
      </div>

      {/* ── Pipeline for selected collector ────────────────── */}
      {(!pipelines || pipelineNames.length === 0) ? (
        <div className="empty">
          {selected === 'gateway'
            ? 'Gateway not deployed yet. Use the Gateway tab in ⚙ Deploy & Configure to deploy it, then the pipeline will appear here.'
            : 'No config loaded. Apply a config in ⚙ Deploy & Configure to see the live pipeline here.'}
        </div>
      ) : (
        <>
          {pipelineNames.length > 1 && (
            <div className="pipe-tabs">
              {pipelineNames.map((name) => (
                <button
                  key={name}
                  className={`pipe-tab ${currentPipeline === name ? 'active' : ''}`}
                  onClick={() => setActivePipeline(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          )}

          {currentPipeline && pipelines[currentPipeline] && (
            <PipelineRow
              name={currentPipeline}
              pipeline={pipelines[currentPipeline]}
              metrics={metrics}
            />
          )}
        </>
      )}
    </div>
  );
}
