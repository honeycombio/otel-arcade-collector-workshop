# Lab 5: Advanced Gateway Patterns (Stretch)

## What you'll do

Apply three advanced Collector patterns to the gateway from Lab 4. By the end you'll have a gateway that samples intelligently, routes by condition, and generates service dependency metrics automatically.

## Prerequisites

- Lab 4 complete: agent → gateway is running, spans tagged with source `gateway` are flowing
- Load generator available on the TelemetryGen page

---

## Concepts

### Tail sampling vs. head sampling

Most sampling strategies decide the moment a span arrives — **head sampling**. If you head-sample at 10%, you drop 10% of error traces before you know they're errors.

**Tail sampling** buffers the complete trace and decides *after* all spans arrive. The Collector keeps all errors, keeps all slow traces, and samples the rest. You get the traces that matter and control costs.

### Connectors

Processors transform data *inside* a pipeline. **Connectors** sit *between* pipelines — they're simultaneously an exporter from one pipeline and a receiver in one or more others. This enables fan-out, conditional routing, and signal conversion.

---

## Steps

### Exercise 1 — Tail Sampling

In the sidebar, go to **⚙ Deploy & Configure → Gateway** tab. Load the **Lab 5 — Sampling & Connectors** template.

Find the commented `tail_sampling` block. Uncomment it, then replace `[batch]` with `[tail_sampling]` in the traces pipeline processors:

```yaml
    traces:
      receivers: [otlp]
      processors: [memory_limiter, tail_sampling]
      exporters: [debug, otlp_grpc/backend, otlp_http/visualizer]
```

Apply the config. Start the load generator (TelemetryGen → Load Generator → Start at 10 RPS).

Watch the **health panel** in the Visualizer — two new gauges appear:
- **Traces sampled** — kept by any policy
- **Traces dropped** — discarded after `decision_wait`

To verify the `keep_errors` policy: go to **⚡ TelemetryGen**, select the **Error span** preset, check **Set error status (code=2)**, and click **Generate span**. The span should reach Honeycomb even at 10% base sample rate.

Questions to explore:
- What fraction of normal traces makes it through at `sampling_percentage: 10`?
- What is `decision_wait` for, and what would happen if you set it too short?
- Can you increase the latency threshold to 1000ms and observe the change in "Traces sampled"?

---

### Exercise 2 — Routing Connector

Find the commented `routing` connector block. Uncomment it, add `routing` to the `traces` pipeline exporters, and uncomment the two named pipelines at the bottom:

```yaml
    traces:
      receivers: [otlp]
      processors: [memory_limiter, tail_sampling]
      exporters: [debug, otlp_grpc/backend, otlp_http/visualizer, routing]

    traces/standard:
      receivers: [routing]
      processors: [batch]
      exporters: [debug, otlp_grpc/backend, otlp_http/visualizer]

    traces/errors:
      receivers: [routing]
      processors: [batch]
      exporters: [debug, otlp_grpc/backend, otlp_http/visualizer]
```

Apply the config. The Visualizer topology should now show three trace pipelines: `traces`, `traces/standard`, and `traces/errors`.

The `routing` connector is what makes a connector different from a processor: it appears as an **exporter** in `traces` and as a **receiver** in both output pipelines. It bridges them.

Look for the `default_pipelines` field in the `routing` connector definition — it controls where unmatched traces go, and is the subject of the first question below.

Questions to explore:
- What is `default_pipelines` for? What happens when no routing rule matches?
- What attribute would you use to route `score-api` traces to a different pipeline than `leaderboard`?
- Try giving `traces/errors` a shorter batch `timeout` (e.g. `timeout: 1s`). What does that mean for latency to Honeycomb?

---

### Exercise 3 — Service Graph Connector

Find the commented `service_graph` connector block. Uncomment it, add `service_graph` to the `traces` pipeline exporters, and uncomment the `metrics/service_graph` pipeline:

```yaml
    traces:
      receivers: [otlp]
      processors: [memory_limiter, tail_sampling]
      exporters: [debug, otlp_grpc/backend, otlp_http/visualizer, routing, service_graph]

    metrics/service_graph:
      receivers: [service_graph]
      exporters: [otlp_grpc/backend]
```

Apply the config. Open Honeycomb and look for metrics with the `traces_service_graph_` prefix:
- `traces_service_graph_request_total{client="arcade-ui", server="score-api"}`
- `traces_service_graph_request_failed_total{...}`
- `traces_service_graph_request_server_seconds_bucket{...}`

The Visualizer's **Service Graph** panel (bottom of the page) has been showing this same topology all day — it's computed from spans the Visualizer already holds. The connector produces the same information as durable, queryable backend metrics.

Questions to explore:
- What's the error rate between `score-api` and `leaderboard`? How would you build an alert on it?
- If a service stops sending spans but is still being called, does it disappear from the service graph?
- How do the latency histograms in Honeycomb compare to the p99 you see in individual traces?

---

## What success looks like

- **Tail sampling:** "Traces sampled" and "Traces dropped" gauges visible in health panel. An error span from TelemetryGen reaches Honeycomb despite the 10% sample rate.
- **Routing:** Three trace pipelines visible in the Visualizer topology. `routing` connector appears as both exporter and receiver.
- **Service graph:** `traces_service_graph_request_total` metrics in Honeycomb with `client` and `server` labels.

---

## Going further

- Combine tail sampling and routing: keep all errors unsampled via `traces/errors`, and sample the rest via `traces/standard`.
- Add a short `timeout: 1s` batch to `traces/errors` so errors flush immediately without waiting for a full batch.
- Try the `spanmetrics` connector — similar to `service_graph` but emits per-span-name histograms and call counts.
