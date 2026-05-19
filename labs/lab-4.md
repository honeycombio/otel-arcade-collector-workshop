# Lab 4: Collector Self-Telemetry (Stretch)

## What you'll do

Put the Collector under load and use Honeycomb to investigate its own health — queue depth, throughput, memory usage, and dropped spans. The Collector is a telemetry pipeline, and like any system it needs to be observed.

## Prerequisites

- Lab 3 complete: agent → gateway architecture is running
- Both Collector containers are healthy
- Honeycomb is receiving data

---

## Concepts

The Collector instruments itself with OpenTelemetry. It exports metrics about its own pipeline state — how many spans are being received, how many are queued, how many are being dropped, how much memory it's using.

These self-metrics flow through the same Prometheus endpoint the Collector exposes at `:9888/metrics`, and if you've wired the `otlp_grpc/backend` exporter into your service pipelines, some of them also land in Honeycomb as metric data points.

The Visualizer's **Collector Health** panel shows a live view of queue depth and throughput. Honeycomb lets you query this data historically and set alerts.

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

### 1. Start load generation

Go to **TelemetryGen** in the sidebar. You have two options:

**Burst:** Use the **Simulate game sessions** presets to fire a spike of traffic — try 50× Mixed to create a meaningful load event.

**Sustained:** Scroll to the **Load Generator** section at the bottom of TelemetryGen. Set your desired RPS and click **Start** to run a continuous background load. Click **Stop** when you're done. Alternatively, from the terminal:

```
make local-loadgen        # start
make local-loadgen-stop   # stop
```

### 2. Watch the Visualizer health panel

In the Visualizer, the **Collector health** panel is open at the bottom of the page. Select **Agent** or **Gateway** in the topology tabs to switch which collector's metrics you're watching. You should see:
- Throughput rising as load increases
- Queue depth fluctuating as the batch processor fills and flushes

What happens to queue depth when you fire a large burst? Does it recover? How do the agent's metrics compare to the gateway's?

### 3. Query self-metrics in Honeycomb

Open Honeycomb and find the metrics dataset (or query in your traces dataset if metrics are flowing to the same place). Look for metrics with the `otelcol_` prefix.

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

### 4. Design an alert

Based on what you've seen: if you were on-call for this pipeline, what would you alert on?

Think about:
- Leading indicators (queue depth) vs. lagging indicators (failed spans)
- What threshold would you set for `otelcol_exporter_queue_size` before paging someone?
- Is throughput alone a useful alert, or do you need a ratio (e.g., failed / accepted)?

---

## What success looks like

This lab is open-ended — there's no counter to reach zero. Success is being able to answer the questions above with data from Honeycomb, and having an opinion about what you'd alert on and why.

---

## Going further

- Stop the gateway while load is running. Watch `otelcol_exporter_queue_size` on the agent. How long before spans start being dropped? Does the Collector recover when the gateway comes back?
- Reduce `batch.send_batch_size` in your agent config to a very small number. What changes in throughput metrics?
- Try setting `memory_limiter.limit_mib` very low. What happens? Which metric tells you spans are being dropped?
- Look at the `otelcol_processor_batch_metadata_cardinality` metric. What does high cardinality here mean for pipeline performance?
