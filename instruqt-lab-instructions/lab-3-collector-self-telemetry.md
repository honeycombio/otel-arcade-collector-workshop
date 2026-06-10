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
