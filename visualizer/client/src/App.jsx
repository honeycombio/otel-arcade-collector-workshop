import React, { useState } from 'react';
import { useCollectorStream } from './hooks/useCollectorMetrics.js';
import { PipelineTopology } from './components/PipelineTopology.jsx';
import { TelemetryFeed, countSmells } from './components/TelemetryFeed.jsx';
import { CollectorHealth } from './components/CollectorHealth.jsx';
import { ServiceGraphPanel } from './components/ServiceGraphPanel.jsx';

export default function App() {
  const { feed, rawFeed, metrics, gatewayMetrics, serviceGraph, configs, wsConnected } = useCollectorStream();
  const [selectedCollector, setSelectedCollector] = useState('agent');

  const activeMetrics = selectedCollector === 'gateway' ? gatewayMetrics : metrics;
  const collectorOk   = !!(activeMetrics && activeMetrics.connected);
  const headerCls     = `status ${wsConnected ? 'connected' : ''}`;

  // Gateway is "active" when it has sent at least one item
  const gatewayHasData = feed.some((i) => i.source === 'gateway');

  const collectors = [
    { id: 'agent',   label: 'Agent',   config: configs?.agent,   active: true },
    { id: 'gateway', label: 'Gateway', config: configs?.gateway, active: gatewayHasData },
  ];

  // Filter feed to selected collector. If no items carry a source tag yet
  // (configs without the x-collector-source header), fall back to showing all.
  const hasSourceTags = feed.some((i) => i.source);
  const collectorFeed = hasSourceTags
    ? feed.filter((i) => i.source === selectedCollector)
    : feed;

  // Raw feed also filtered to selected collector (for split/diff view)
  const collectorRawFeed = hasSourceTags
    ? rawFeed.filter((i) => i.source === selectedCollector)
    : rawFeed;

  const smellCount = countSmells(collectorFeed);
  const smellCls   = smellCount === 0 ? 'smells-badge clean' : 'smells-badge dirty';

  return (
    <div className="app">
      <header className="header">
        <h1>OTel Pipeline Visualizer</h1>
        <div className={headerCls}>
          <span className="dot" />
          {wsConnected ? 'live' : 'reconnecting'} · collector {collectorOk ? 'ok' : 'waiting'}
        </div>
        {collectorFeed.length > 0 && (
          <span className={smellCls} title="Smelly spans in the last 200. Goes to 0 when Lab 2 transforms are working.">
            {smellCount === 0 ? '✓ clean' : `⚠ ${smellCount} smell${smellCount === 1 ? '' : 's'}`}
          </span>
        )}
      </header>

      <PipelineTopology
        collectors={collectors}
        selected={selectedCollector}
        onSelect={setSelectedCollector}
        pipelineConfig={configs?.[selectedCollector] || null}
        metrics={activeMetrics.metrics}
      />

      <TelemetryFeed
        key={selectedCollector}
        items={collectorFeed}
        rawFeed={collectorRawFeed}
      />

      <CollectorHealth
        metrics={activeMetrics.metrics}
        connected={collectorOk}
        label={selectedCollector === 'gateway' ? 'Gateway' : 'Agent'}
      />

      <ServiceGraphPanel edges={serviceGraph} />
    </div>
  );
}
