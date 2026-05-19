# Lab 4: Collector Self-Telemetry

## What you'll do

Configure the Collector to ship its own metrics and logs to Honeycomb. Then put it under load and use that data to investigate pipeline health — queue depth, throughput, dropped spans — with historical queries rather than just the live Visualizer panel.

## Prerequisites

- Lab 3 complete: agent → gateway architecture is running
- Both Collector containers are healthy
- `HONEYCOMB_API_KEY` is set in your `.env` — Lab 4 exercises push Collector self-telemetry directly to Honeycomb and won't show results without it

---

## Concepts

The Collector instruments itself with OpenTelemetry. By default, it exposes those self-metrics via a Prometheus endpoint at `:8888/metrics` — that's what the Visualizer's **Collector Health** panel scrapes. It's live, but ephemeral: once the window closes, the data is gone.

To make self-telemetry queryable and alertable, you need to push it to Honeycomb. This is done in a separate part of the config called `service.telemetry` — **not** in the pipeline exporters.

**The difference:**

| Path | Where it's configured | What it carries |
|---|---|---|
| Pipeline exporters (`exporters:`) | Your `traces`, `metrics`, `logs` pipelines | App telemetry from your services |
| `service.telemetry` | The `service:` block, separate from pipelines | Collector's own health metrics and logs |

Three exercises in Step 2 below wire up `service.telemetry` so self-metrics and logs land in Honeycomb alongside your app data.

Key metrics to know:

| Metric | What it tells you |
|---|---|
| `otelcol_processor_batch_batch_size_trigger_send` | How often the batch processor flushes |
| `otelcol_exporter_queue_size` | Spans waiting to be exported (rising = backpressure) |
| `otelcol_exporter_send_failed_spans` | Spans dropped because the exporter couldn't keep up |
| `otelcol_receiver_accepted_spans` | Spans received successfully |
| `otelcol_processor_dropped_spans` | Spans dropped by a processor (e.g., memory_limiter) |
| `otelcol_process_memory_rss` | Collector process memory (watch against your memory_limiter settings) |

---

## Steps

### 1. Observe the Visualizer health panel

Open the Visualizer's **Collector Health** panel at the bottom of the page. Play a game or fire a TelemetryGen preset — you should see spans accepted, queue depth, and throughput update in real time.

This all comes from Prometheus pull. Honeycomb can't see any of it yet. Step 2 changes that.

---

### 2. Configure self-telemetry

Open `collector-agent-config.yaml` and work through the three exercises below — restart the agent after each one.

#### Exercise 1 — Tag the Collector

Open `collector-agent-config.yaml` and find the `service.telemetry` block. Add a `resource` section:

```yaml
service:
  telemetry:
    resource:
      attributes:
        - name: service.name
          value: otel-collector-agent
```

**Why this comes first:** without `service.name`, every metric and log the Collector ships to Honeycomb arrives with no identity — you can't filter for Collector health data separately from your app data.

Apply & Restart the agent.

---

#### Exercise 2 — Push Collector metrics to Honeycomb

Add a `periodic` reader under `service.telemetry.metrics.readers`:

```yaml
    metrics:
      level: detailed
      readers:
        - pull:              # Visualizer keeps scraping this — leave it
            exporter:
              prometheus:
                host: "0.0.0.0"
                port: 8888
        - periodic:         # NEW: push to Honeycomb
            exporter:
              otlp:
                protocol: http/protobuf
                endpoint: https://api.honeycomb.io/v1/metrics
                headers:
                  - name: x-honeycomb-team
                    value: ${env:HONEYCOMB_API_KEY}
                  - name: x-honeycomb-dataset
                    value: otel-collector
```

Apply & Restart. After ~15 seconds, open Honeycomb and query the `otel-collector` metrics dataset — you should see `otelcol_receiver_accepted_spans`, `otelcol_exporter_queue_size`, and the other metrics from the table above.

> **Note:** The `pull` and `periodic` readers co-exist — the Visualizer health panel still works.
> If no metrics appear, confirm `HONEYCOMB_API_KEY` is set in `.env` and the agent was fully restarted (not just reloaded).

---

#### Exercise 3 — Push Collector logs to Honeycomb

Add a `logs` block under `service.telemetry`:

```yaml
    logs:
      level: info
      processors:
        - batch:
            exporter:
              otlp:
                protocol: http/protobuf
                endpoint: https://api.honeycomb.io/v1/logs
                headers:
                  - name: x-honeycomb-team
                    value: ${env:HONEYCOMB_API_KEY}
                  - name: x-honeycomb-dataset
                    value: otel-collector
```

Apply & Restart. In Honeycomb, query the `otel-collector` logs dataset — you'll see the Collector's own startup messages, pipeline summaries, and any warning or error logs.

> **Tip:** The **Lab 4 — Self-telemetry** template in the editor dropdown shows the completed config for all three exercises — load it to check your work or get unstuck.

---

### 3. Put it under load

All three exercises should be applied and the agent restarted before generating load — this ensures queue depth and throughput metrics are flowing to Honeycomb when you start the queries.

Go to **TelemetryGen** in the sidebar. You have two options:

**Burst:** Use the **Simulate game sessions** presets to fire a spike of traffic — try 50× Mixed to create a meaningful load event.

**Sustained:** Scroll to the **Load Generator** section at the bottom of TelemetryGen. Set your desired RPS and click **Start** to run a continuous background load. Click **Stop** when you're done. Alternatively, from the terminal:

```
make local-loadgen        # start
make local-loadgen-stop   # stop
```

### 4. Query self-metrics in Honeycomb

Open Honeycomb and query the `otel-collector` metrics dataset. Look for metrics with the `otelcol_` prefix.

Some questions to explore:

**Throughput and batching:**
- What's the average batch size being sent? Is the batch processor flushing on size or on timeout?
- How does throughput on the agent compare to throughput on the gateway?

**Queue health:**
- Is `otelcol_exporter_queue_size` staying near zero, or is it growing? What would cause it to grow?
- Has `otelcol_exporter_send_failed_spans` ever been non-zero? What would that indicate?

**Memory:**
- What is the Collector's memory usage under load? How much headroom do you have before `memory_limiter` would start dropping spans?
- What is the difference between `memory_limiter`'s `limit_mib` and `spike_limit_mib`, and when would the spike limit matter?

**Processor efficiency:**
- After your Lab 2 transforms, are spans being dropped anywhere? Where would you look to confirm?

### 5. Design an alert

Based on what you've seen: if you were on-call for this pipeline, what would you alert on?

Think about:
- Leading indicators (queue depth) vs. lagging indicators (failed spans)
- What threshold would you set for `otelcol_exporter_queue_size` before paging someone?
- Is throughput alone a useful alert, or do you need a ratio (e.g., failed / accepted)?

---

## What success looks like

- `otelcol_*` metrics are visible in Honeycomb
- Collector log records are visible in Honeycomb
- Visualizer health panel still works (both pull and push coexist)
- You can answer the throughput and queue questions above with Honeycomb data

---

## Going further

- Do the same for the gateway: the `service.telemetry` block in `collector-gateway-config.yaml` has the same structure. Add the `resource`, `logs`, and `periodic` blocks there too — set `service.name` to `otel-collector-gateway`.
- Stop the gateway while load is running. Watch `otelcol_exporter_queue_size` on the agent in Honeycomb. How long before spans start being dropped? Does the Collector recover when the gateway comes back?
- Reduce `batch.send_batch_size` in your agent config to a very small number. What changes in throughput metrics?
- Try setting `memory_limiter.limit_mib` very low. What happens? Which metric tells you spans are being dropped?
- Look at the `otelcol_processor_batch_metadata_cardinality` metric. What does high cardinality here mean for pipeline performance?
