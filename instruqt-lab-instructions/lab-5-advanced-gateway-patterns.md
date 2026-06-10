# Challenge 1: Tail Sampling

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
3. Save the file. Then run:
```bash
make local-restart-gateway
```

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

# Challenge 2: Routing Connector

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
4. Save the file and run:
```bash
make local-restart-gateway
```

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

# Challenge 3: Service Graph Connector

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
4. Save the file and run:
```bash
make local-restart-gateway
```

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
