## Tab reference

| Challenge | Tab 0 (OTel Arcade) | Tab 1 (Terminal) |
|---|---|---|
| 1 — Observe Collector Health | ✓ | — |
| 2 — Configure Self-Telemetry | ✓ | ✓ `make local-restart-collector` (x3) |
| 3 — Query Self-Metrics Under Load | ✓ | — |
| 4 — Deploy the Gateway | ✓ | — |
| 5 — Reconfigure the Agent | ✓ | ✓ `make local-restart-collector`, `make local-logs` |
| 6 — Verify the Two-Tier Architecture | ✓ | — |
| 7 — Tail Sampling | ✓ | — |
| 8 — Routing Connector | ✓ | — |
| 9 — Service Graph Connector | ✓ | — |

Keep both tabs visible across all challenges.

---

# Challenge 1: Observe Collector Health

Your pipeline from the previous workshop is running. Before you change
anything, take a look at what the Collector is already telling you.

1. Select [button label="OTel Arcade" variant="success"](tab-0) to
open the app.
2. Select **◈ Visualizer** in the app's left navigation.
3. Scroll to the bottom of the Visualizer to find the **Collector
Health** panel.
4. Play a game or fire a preset in **⚡ TelemetryGen** to generate
traffic, then watch the metrics update in real time:
   - Spans accepted
   - Queue depth
   - Export throughput

This panel is powered by a Prometheus pull from the Collector's
`:8888/metrics` endpoint. It's live, but ephemeral — when you close
the page, the history is gone. Honeycomb can't see any of it yet.
The next challenge changes that.

---

## Success criteria

- The Collector Health panel is visible and showing live metrics

---

# Challenge 2: Configure Self-Telemetry

The Collector instruments itself with OpenTelemetry. By default, it
exposes those self-metrics via a Prometheus endpoint — that's what
the health panel scrapes. To make self-telemetry queryable, you need
to push it to Honeycomb. This is done in a separate part of the
config called `service.telemetry` — **not** in the pipeline
exporters.

Work through the three exercises below. Apply and restart the agent
after each one.

---

## Exercise 1 — Tag the Collector

Without `service.name`, every metric and log the Collector ships to
Honeycomb arrives with no identity — you can't filter for Collector
health data separately from your app data.

1. Select [button label="OTel Arcade" variant="success"](tab-0) and
select **⚙ Deploy & Configure** in the app's left navigation.
2. Find the `service.telemetry` block in the **Collector** tab
editor.
3. Add a `resource` section:
```yaml
service:
  telemetry:
    resource:
      attributes:
        - name: service.name
          value: otel-collector-agent
```
4. Save the file. Then run the following in
[button label="Terminal" variant="success"](tab-1):
```bash
make local-restart-collector
```

---

## Exercise 2 — Push Collector Metrics to Honeycomb

Add a `periodic` reader alongside the existing `pull` reader under
`service.telemetry.metrics.readers`:

```yaml
    metrics:
      level: detailed
      readers:
        - pull:
            exporter:
              prometheus:
                host: "0.0.0.0"
                port: 8888
        - periodic:
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

Save the file and run:
```bash
make local-restart-collector
```

After ~15 seconds, open Honeycomb and query the `otel-collector`
metrics dataset. You should see metrics like
`otelcol_receiver_accepted_spans` and `otelcol_exporter_queue_size`.

> [!NOTE]
> The `pull` and `periodic` readers co-exist — the Visualizer health
> panel still works after this change.
> If no metrics appear in Honeycomb, confirm `HONEYCOMB_API_KEY` is
> set in your `.env` and the agent was fully restarted.

---

## Exercise 3 — Push Collector Logs to Honeycomb

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

Save the file and run:
```bash
make local-restart-collector
```

Open Honeycomb and query the `otel-collector` logs dataset — you'll
see the Collector's own startup messages, pipeline summaries, and any
warning or error logs.

> [!NOTE]
> The **Lab 3 — Self-telemetry** template in the editor's
> **Template** dropdown shows the completed config for all three
> exercises — load it to check your work or get unstuck.

---

## Verify

1. In Honeycomb, confirm metrics with the `otelcol_` prefix are
visible in the `otel-collector` metrics dataset.
2. Confirm log records from the Collector are visible in the
`otel-collector` logs dataset.
3. Select [button label="OTel Arcade" variant="success"](tab-0) and
confirm the Visualizer's Collector Health panel still shows live
metrics (both pull and push now coexist).

> [!IMPORTANT]
> If no data appears in Honeycomb, check the Collector logs:
> ```bash
> make local-logs SVC=otel-collector-agent
> ```
> An invalid or missing API key will show as a 401 error.

---

## Success criteria

- `otelcol_*` metrics are visible in Honeycomb in the
`otel-collector` dataset
- Collector log records are visible in Honeycomb
- Visualizer Collector Health panel is still showing live metrics

---

# Challenge 3: Query Self-Metrics Under Load

Now put the pipeline under load and use Honeycomb to investigate
pipeline health — queue depth, throughput, and dropped spans.

---

## Generate load

1. Select [button label="OTel Arcade" variant="success"](tab-0) and
select **⚡ TelemetryGen** in the app's left navigation.
2. Choose one of the following:

   **Burst:** Use the **Simulate game sessions** presets to fire a
   spike of traffic — try **50× Mixed** to create a meaningful load
   event.

   **Sustained:** Scroll to the **Load Generator** section at the
   bottom of TelemetryGen. Set a desired RPS and select **Start**
   to run continuous background load. Select **Stop** when done.

---

## Query self-metrics in Honeycomb

Open Honeycomb and query the `otel-collector` metrics dataset. Use
the `otelcol_` prefix to find Collector metrics.

Work through the following questions — the answers are in the data:

**Throughput and batching**
- What is the average batch size being sent? Is the batch processor
  flushing on size limit or on timeout?

**Queue health**
- Is `otelcol_exporter_queue_size` staying near zero, or is it
  growing? What would cause it to grow?
- Has `otelcol_exporter_send_failed_spans` ever been non-zero?
  What would that indicate?

**Memory**
- What is the Collector's memory usage under load? How much headroom
  before `memory_limiter` would start dropping spans?

**Processor efficiency**
- After your Lab 2 transforms, are spans being dropped anywhere?
  Where would you look to confirm?

---

## Design an alert

Based on what you've seen: if you were on-call for this pipeline,
what would you alert on?

Consider:
- Leading indicators (queue depth) vs. lagging indicators (failed
  spans)
- What threshold for `otelcol_exporter_queue_size` would you use
  before paging someone?
- Is throughput alone a useful alert, or do you need a ratio
  (failed / accepted)?

---

## Success criteria

- `otelcol_*` metrics are visible in Honeycomb with values that
changed during your load test
- You can answer the throughput and queue questions above with
Honeycomb data

---

# Challenge 4: Deploy the Gateway

So far, a single Collector has handled everything — receiving from
your services, transforming data, and exporting to Honeycomb. In
production, that single-tier approach doesn't scale. This challenge
restructures the pipeline into two tiers:

- **Agent** — one per node, close to the services. Lightweight.
  Handles collection, initial filtering, and normalization.
  Forwards upstream.
- **Gateway** — a small number of central replicas. Handles batching,
  fan-out to multiple backends, and anything you want applied
  cluster-wide.

In this sandbox, Docker Compose gives you the same network semantics
as Kubernetes: each container is reachable by its service name as a
hostname. The agent will reach the gateway at
`otel-collector-gateway:4317` exactly as it would resolve a
Kubernetes Service DNS name.

---

## Deploy the gateway container

1. Select [button label="OTel Arcade" variant="success"](tab-0) and
select **⚙ Deploy & Configure** in the app's left navigation.
2. Select the **Gateway** tab.
3. The tab shows "Gateway not running" with a **Deploy Gateway**
button. Select it.
4. Wait for the Gateway tab to confirm the gateway is running.

---

## Read the gateway config

Once the gateway is deployed, read through the config now visible in
the editor.

- What is the gateway receiving?
- What is it exporting to?
- What processors does it run?

The gateway ships with a baseline config. You'll leave it as-is for
this challenge and modify it in Challenges 7–9.

---

## Success criteria

- The Gateway tab shows the gateway as running
- You can identify what the gateway is receiving, processing, and
exporting

---

# Challenge 5: Reconfigure the Agent

With the gateway running, reconfigure the agent to forward telemetry
to the gateway instead of exporting directly to Honeycomb.

---

## Load the Lab 4 agent template

1. Select [button label="OTel Arcade" variant="success"](tab-0) and
select **⚙ Deploy & Configure** in the app's left navigation.
2. In the **Collector** tab, select **Load template → Lab 4 — Agent
forwarding**.
3. Read through what changed compared to the Lab 3 config:
   - What exporters are present now? What's missing?
   - Where is the agent now sending traces, metrics, and logs?
   - Which processors are still running on the agent?
   - What is the endpoint for the `otlp_grpc/gateway` exporter?
     Does that hostname match the gateway container name?

> [!NOTE]
> The Lab 4 template keeps the `service.telemetry` block from Lab 3
> — your Collector metrics and logs keep flowing to Honeycomb. Only
> the pipeline destination changes.

---

## Apply the agent config

Save the file. Then run the following in
[button label="Terminal" variant="success"](tab-1):
```bash
make local-restart-collector
```

Watch the Collector logs for errors:
```bash
make local-logs SVC=otel-collector-agent
```

> [!IMPORTANT]
> If the agent logs show connection errors to
> `otel-collector-gateway:4317`, confirm the gateway container is
> running:
> ```bash
> docker ps | grep otel-arcade
> ```
> You should see both the agent and gateway containers listed.

---

## Success criteria

- The agent config exports only to `otel-collector-gateway:4317`
  (no direct Honeycomb export)
- The agent restarted successfully with no errors in the logs

---

# Challenge 6: Verify the Two-Tier Architecture

With both tiers running, verify that telemetry is flowing end to end
and the Visualizer reflects the new topology.

---

## Verify in the Visualizer

1. Select [button label="OTel Arcade" variant="success"](tab-0) and
select **◈ Visualizer** in the app's left navigation.
2. The Pipeline panel now has **Agent** and **Gateway** tabs at the
top. Select each to see that collector's live pipeline topology.
3. Play a game to generate traffic.
4. Confirm spans in the feed are tagged with source **gateway** —
this means telemetry is flowing through the full two-hop path
(services → agent → gateway → Visualizer).

> [!NOTE]
> If the Gateway tab shows "not deployed yet", wait a moment and
> refresh. The Visualizer re-reads configs on a short interval.

---

## Verify in Honeycomb

Open Honeycomb and confirm traces are still arriving from all three
services: `arcade-ui`, `score-api`, and `leaderboard`.

---

## Think about the architecture

With this two-tier setup in place, consider:

- If you want to add a second observability backend exporter, which
  config do you change — the agent or the gateway? Why?
- If you want to apply a sampling policy, which tier should own it?
- The gateway also has processors. What would you move from the
  agent to the gateway, and what would you keep on the agent?

---

## Success criteria

- Both `otel-collector-agent` and `otel-collector-gateway` containers
are running
- The Visualizer Pipeline panel shows two topology diagrams
- Spans in the Visualizer feed are tagged with source `gateway`
- Honeycomb is still receiving traces from all three services

---

# Challenge 7: Tail Sampling

Most sampling strategies decide the moment a span arrives —
**head sampling**. If you head-sample at 10%, you drop 10% of error
traces before you even know they're errors.

**Tail sampling** buffers the complete trace and decides *after* all
spans arrive. You can keep all errors, keep all slow traces, and
sample everything else. The Collector's `tail_sampling` processor
does this at the gateway tier.

---

## Load the Lab 5 template

1. Select [button label="OTel Arcade" variant="success"](tab-0) and
select **⚙ Deploy & Configure** in the app's left navigation.
2. Select the **Gateway** tab.
3. Select **Load template → Lab 5 — Sampling & Connectors**.
4. Read through the file. The `tail_sampling` block is commented out.
Find it.

---

## Enable tail sampling

1. Uncomment the `tail_sampling` processor block.
2. In the `traces` pipeline, replace `[batch]` with
`[tail_sampling]`:
```yaml
    traces:
      receivers: [otlp]
      processors: [memory_limiter, tail_sampling]
      exporters: [debug, otlp_grpc/backend, otlp_http/visualizer]
```
3. Select **Apply & Restart** in the Gateway tab to deploy the
updated config.

---

## Verify

1. Select [button label="OTel Arcade" variant="success"](tab-0) and
select **◈ Visualizer**.
2. Scroll to the **Collector Health** panel. Switch to the
**Gateway** tab — you should now see two new gauges: **Traces
sampled** and **Traces dropped**.
3. Start the load generator: select **⚡ TelemetryGen**, scroll to
**Load Generator**, and set 10 RPS. Select **Start**.
4. Watch the gauges update as traffic flows.

To verify the `keep_errors` policy works:

1. Select **⚡ TelemetryGen** in the app navigation.
2. Select the **Error span** preset.
3. Check **Set error status (code=2)**.
4. Select **Generate span**.
5. Open Honeycomb and confirm the error trace arrived despite the
10% base sample rate.

> [!NOTE]
> The `decision_wait` setting (default: 5s) is how long the
> processor waits for all spans in a trace before deciding. Traces
> that arrive incomplete before `decision_wait` expires may be
> sampled differently than expected.

---

## Success criteria

- **Traces sampled** and **Traces dropped** gauges are visible in
the Collector Health panel for the Gateway
- An error span from TelemetryGen reaches Honeycomb even at 10%
base sample rate

---

# Challenge 8: Routing Connector

Processors transform data *inside* a pipeline. **Connectors** sit
*between* pipelines — they are simultaneously an exporter from one
pipeline and a receiver in one or more others. This enables
conditional routing without duplicating receivers or exporters.

In this challenge, you'll route error traces to a dedicated pipeline
using the `routing` connector.

---

## Enable the routing connector

1. Select [button label="OTel Arcade" variant="success"](tab-0) and
select **⚙ Deploy & Configure → Gateway** tab.
2. Find the commented `routing` connector block. Uncomment it.
3. Add `routing` to the `traces` pipeline `exporters` list, and
uncomment the two named pipelines at the bottom of the config:
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
4. Select **Apply & Restart** in the Gateway tab.

---

## Verify

1. Select [button label="OTel Arcade" variant="success"](tab-0) and
select **◈ Visualizer**.
2. Select the **Gateway** tab in the Pipeline panel.
3. Confirm the topology shows three trace pipelines: `traces`,
`traces/standard`, and `traces/errors`.
4. Notice that `routing` appears as both an **exporter** in the
`traces` pipeline and a **receiver** in `traces/standard` and
`traces/errors`. That is what makes it a connector.

---

## Explore

Look at the `default_pipelines` field in the `routing` connector
definition, then consider:

- What happens when no routing rule matches a trace?
- What attribute would you use to route `score-api` traces to a
different pipeline than `leaderboard`?
- Try giving `traces/errors` a shorter batch `timeout` (e.g.
`timeout: 1s`). What does that mean for latency to Honeycomb?

---

## Success criteria

- Three trace pipelines are visible in the Visualizer Gateway
topology
- The `routing` connector appears as both exporter and receiver in
the topology diagram

---

# Challenge 9: Service Graph Connector

The `service_graph` connector reads traces and automatically emits
request-count and latency metrics for every client→server pair it
observes. These metrics land in Honeycomb as a queryable dataset —
the same information the Visualizer's Service Graph panel shows, but
now durable and alertable.

---

## Enable the service graph connector

1. Select [button label="OTel Arcade" variant="success"](tab-0) and
select **⚙ Deploy & Configure → Gateway** tab.
2. Find the commented `service_graph` connector block. Uncomment it.
3. Add `service_graph` to the `traces` pipeline `exporters` list,
and uncomment the `metrics/service_graph` pipeline:
```yaml
    traces:
      receivers: [otlp]
      processors: [memory_limiter, tail_sampling]
      exporters: [debug, otlp_grpc/backend, otlp_http/visualizer, routing, service_graph]

    metrics/service_graph:
      receivers: [service_graph]
      exporters: [otlp_grpc/backend]
```
4. Select **Apply & Restart** in the Gateway tab.

---

## Verify

1. Open Honeycomb.
2. Look for metrics with the `traces_service_graph_` prefix:
   - `traces_service_graph_request_total` with `client` and `server`
   labels
   - `traces_service_graph_request_failed_total`
   - `traces_service_graph_request_server_seconds_bucket`
3. Play a few games to generate traffic between services, then
refresh your query.

---

## Explore

- What is the error rate between `score-api` and `leaderboard`? How
would you build a Honeycomb trigger (alert) on it?
- If a service stops sending spans but is still being called as a
server, does it disappear from the service graph?
- How do the latency histograms in Honeycomb compare to the p99
values you see in individual traces?

---

## Success criteria

- `traces_service_graph_request_total` metrics are visible in
Honeycomb with `client` and `server` labels
- At least three client→server pairs are represented
