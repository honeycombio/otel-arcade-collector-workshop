## Tab reference
| Challenge | Tab 0 (OTel Arcade) | Tab 1 (Terminal) | Tab 2 (Honeycomb) |
|---|---|---|---|
| 1 — Observe Agent Self-Metrics | ✓ | ✓ setup | — |
| 2 — Configure Self-Telemetry | ✓ | — | ✓ verify |
| 3 — Query Self-Metrics Under Load | ✓ | — | ✓ query |
| 4 — Deploy the Gateway | ✓ | — | — |
| 5 — Reconfigure the Agent | ✓ | ✓ `docker compose logs` | — |
| 6 — Verify the Two-Tier Architecture | ✓ | — | ✓ verify |
| 7 — Tail Sampling | ✓ | — | ✓ verify |
| 8 — Routing Connector | ✓ | — | — |
| 9 — Service Graph Connector | ✓ | — | ✓ verify |
Keep both tabs visible across all challenges.
# Challenge 1: Observe Agent Self-Metrics
## Set up your starting state
This sandbox starts fresh. Before observing anything, restore the Workshop 1 end state and reconnect to Honeycomb.
1. Select the [button label="OpenTelemetry Arcade"](tab-0) tab and select **⚙ Deploy & Configure** in the app's left navigation.
2. In the **Collector** tab, select **Load template → OTTL transforms**. This restores the Workshop 1 end state — all five OTTL fixes and the correct pipeline wiring — without pre-completing any of the Challenge 2 exercises.
3. Select **Apply & Restart**.
4. Select the [button label="Terminal"](tab-1) tab. Run the following command, replacing `your-key-here` with your Honeycomb API key:
```bash
sed -i 's/HONEYCOMB_API_KEY=.*/HONEYCOMB_API_KEY=your-key-here/' /root/otel-arcade-collector-workshop/.env
```
5. Recreate the Collector container to inject the key:
```bash
cd /root/otel-arcade-collector-workshop && docker compose up --force-recreate otel-collector-agent -d
```
## Observe Agent self-metrics
Before changing anything else, take a look at what the Collector is already telling you.
1. Select the [button label="OpenTelemetry Arcade"](tab-0) tab.
2. Play a game or fire a preset in **⚡ TelemetryGen** to generate traffic through the Collector.
3. Select **◈ Visualizer** in the app's left navigation.
4. Scroll to the bottom of the Visualizer to find the **Agent self-metrics** panel. After traffic has flowed through, you should see counters for spans accepted, spans sent, and queue size alongside the static queue capacity value.
This panel is powered by a Prometheus pull from the Collector's `:8888/metrics` endpoint. It's live, but ephemeral — when you close the page, the history is gone. Honeycomb can't see any of it yet. The next challenge changes that.
## Success criteria
- The Agent self-metrics panel is visible and showing live counters after generating traffic
# Challenge 2: Configure Self-Telemetry
The Collector instruments itself with OpenTelemetry. By default, it exposes those self-metrics via a Prometheus endpoint — that's what the health panel scrapes. To make self-telemetry queryable, you need to push it to Honeycomb. This is done in a separate part of the config called `service.telemetry` — **not** in the pipeline exporters.
Work through the three exercises below. Select **Apply & Restart** after each one.
## Exercise 1 — Tag the Collector
Without `service.name`, every metric and log the Collector ships to Honeycomb arrives with no identity — you can't filter for Collector health data separately from your app data.
1. Select the [button label="OpenTelemetry Arcade"](tab-0) tab and select **⚙ Deploy & Configure** in the app's left navigation.
2. Scroll to the bottom of the config and find the `service:` block. Inside it you'll see a `telemetry:` key — this is where the Collector's self-instrumentation is configured.
3. Without a `service.name`, self-telemetry arrives in Honeycomb with no identity label — you can't isolate Collector health data from your app telemetry. Paste the block below inside `telemetry:`, directly above the existing `metrics:` key:
```yaml
    resource:
      attributes:
        - name: service.name
          value: otel-collector-agent
```
4. Select **Apply & Restart**.
## Exercise 2 — Push Collector Metrics to Honeycomb
1. Select the [button label="OpenTelemetry Arcade"](tab-0) tab and select **⚙ Deploy & Configure** in the app's left navigation.
2. The health panel works because the Collector already exposes a Prometheus pull endpoint — but that data is ephemeral and only visible inside the sandbox. Adding a `periodic` OTLP reader pushes those same metrics to Honeycomb on a schedule so they're queryable and durable. Paste the block below into the `readers` list under `telemetry:` → `metrics:`, after the existing `- pull:` block:
```yaml
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
3. Select **Apply & Restart**.
4. After ~15 seconds, open the [button label="Honeycomb"](tab-2) tab and query the `otel-collector` metrics dataset. Confirm you see metrics like `otelcol_receiver_accepted_spans` and `otelcol_exporter_queue_size`.
> [!NOTE]
> The `pull` and `periodic` readers co-exist — the Visualizer health panel still works after this change. If no metrics appear in Honeycomb, confirm `HONEYCOMB_API_KEY` is set in your `.env` and the agent was fully restarted.
## Exercise 3 — Push Collector Logs to Honeycomb
1. Select the [button label="OpenTelemetry Arcade"](tab-0) tab and select **⚙ Deploy & Configure** in the app's left navigation.
2. By default the Collector's own log output only goes to stdout — readable with `docker compose logs --tail=50 otel-collector-agent` but gone when the container restarts. Adding a `logs` block under `telemetry:` pushes those logs to Honeycomb so they're searchable and durable. Paste the block below inside `telemetry:`, after the `metrics:` block:
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
3. Select **Apply & Restart**.
4. Open the [button label="Honeycomb"](tab-2) tab and query the `otel-collector` logs dataset. Confirm you see the Collector's startup messages, pipeline summaries, and any warning or error logs.
> [!NOTE]
> The **Self-telemetry** template in the editor's **Template** dropdown shows the completed config for all three exercises — load it to check your work or get unstuck.
## Verify
1. In Honeycomb, confirm metrics with the `otelcol_` prefix are visible in the `otel-collector` metrics dataset.
2. Confirm log records from the Collector are visible in the `otel-collector` logs dataset.
3. Select the [button label="OpenTelemetry Arcade"](tab-0) tab and confirm the Visualizer's Agent self-metrics panel still shows live metrics (both pull and push now coexist).
> [!IMPORTANT]
> If no data appears in Honeycomb, check the Collector logs in the [button label="Terminal"](tab-1) tab:
> ```bash
> docker compose logs --tail=50 otel-collector-agent
> ```
> An invalid or missing API key will show as a 401 error.
## Success criteria
- `otelcol_*` metrics are visible in Honeycomb in the `otel-collector` dataset
- Collector log records are visible in Honeycomb
- Visualizer Agent self-metrics panel is still showing live metrics
# Challenge 3: Query Self-Metrics Under Load
Now put the pipeline under load and use Honeycomb to investigate pipeline health — queue depth, throughput, and dropped spans.
## Generate load
1. Select the [button label="OpenTelemetry Arcade"](tab-0) tab and select **⚡ TelemetryGen** in the app's left navigation.
2. Choose one of the following:
   **Burst:** Scroll to the **Game Session Presets** section and select **50 × Mixed (load volume)** to fire a spike of traffic.
   **Sustained:** Scroll to the **Load Generator** section at the bottom of TelemetryGen. Set a desired RPS and select **Start** to run continuous background load. Select **Stop** when done.
## Query self-metrics in Honeycomb
Open the [button label="Honeycomb"](tab-2) tab and query the `otel-collector` metrics dataset. Use the `otelcol_` prefix to find Collector metrics.
Work through the following questions — the answers are in the data:
**Throughput and batching**
- What is the average batch size being sent? Is the batch processor flushing on size limit or on timeout?
**Queue health**
- Is `otelcol_exporter_queue_size` staying near zero, or is it growing? What would cause it to grow?
- Has `otelcol_exporter_send_failed_spans` ever been non-zero? What would that indicate?
**Memory**
- What is the Collector's memory usage under load? How much headroom before `memory_limiter` would start dropping spans?
**Processor efficiency**
- After the OTTL transforms you applied in Workshop 1, are spans being dropped anywhere? Where would you look to confirm?
## Design an alert
Based on what you've seen: if you were on-call for this pipeline, what would you alert on?
Consider:
- Leading indicators (queue depth) vs. lagging indicators (failed spans)
- What threshold for `otelcol_exporter_queue_size` would you use before paging someone?
- Is throughput alone a useful alert, or do you need a ratio (failed / accepted)?
## Success criteria
- `otelcol_*` metrics are visible in Honeycomb with values that changed during your load test
- You can answer the throughput and queue questions above with Honeycomb data
# Challenge 4: Deploy the Gateway
So far, a single Collector has handled everything — receiving from your services, transforming data, and exporting to Honeycomb. In production, that single-tier approach doesn't scale. This challenge restructures the pipeline into two tiers:
- **Agent** — one per node, close to the services. Lightweight. Handles collection, initial filtering, and normalization. Forwards upstream.
- **Gateway** — a small number of central replicas. Handles batching, fan-out to multiple backends, and anything you want applied cluster-wide.
In this sandbox, Docker Compose gives you the same network semantics as Kubernetes: each container is reachable by its service name as a hostname. The agent will reach the gateway at `otel-collector-gateway:4317` exactly as it would resolve a Kubernetes Service DNS name.
## Deploy the gateway container
1. Select the [button label="OpenTelemetry Arcade"](tab-0) tab and select **⚙ Deploy & Configure** in the app's left navigation.
2. Select the **Gateway** tab.
3. The tab shows "Gateway not running" with a **Deploy Gateway** button. Select it.
4. Wait for the Gateway tab to confirm the gateway is running.
## Read the gateway config
Once the gateway is deployed, read through the config now visible in the editor.
- What is the gateway receiving?
- What is it exporting to?
- What processors does it run?
The gateway ships with a baseline config. You'll leave it as-is for this challenge and modify it in Challenges 7–9.
## Success criteria
- The Gateway tab shows the gateway as running
- You can identify what the gateway is receiving, processing, and exporting
# Challenge 5: Reconfigure the Agent
With the gateway running, reconfigure the agent to forward telemetry to the gateway instead of exporting directly to Honeycomb.
## Load the agent forwarding template
1. Select the [button label="OpenTelemetry Arcade"](tab-0) tab and select **⚙ Deploy & Configure** in the app's left navigation.
2. In the **Collector** tab, select **Load template → Agent forwarding**.
3. Read through what changed compared to the Self-telemetry config:
   - What exporters are present now? What's missing?
   - Where is the agent now sending traces, metrics, and logs?
   - Which processors are still running on the agent?
   - What is the endpoint for the `otlp_grpc/gateway` exporter? Does that hostname match the gateway container name?
> [!NOTE]
> The Agent forwarding template keeps the `telemetry:` block under `service:` from the Self-telemetry config — your Collector metrics and logs keep flowing to Honeycomb. Only the pipeline destination changes.
## Apply the agent config
Select **Apply & Restart** in the Collector tab.
Watch the Collector logs for errors in the [button label="Terminal"](tab-1) tab:
```bash
docker compose logs --tail=50 otel-collector-agent
```
> [!IMPORTANT]
> If the agent logs show connection errors to `otel-collector-gateway:4317`, confirm the gateway container is running:
> ```bash
> docker ps | grep otel-arcade
> ```
> You should see both the agent and gateway containers listed.
## Success criteria
- The agent config exports only to `otel-collector-gateway:4317` (no direct Honeycomb export)
- The agent restarted successfully with no errors in the logs
# Challenge 6: Verify the Two-Tier Architecture
With both tiers running, verify that telemetry is flowing end to end and the Visualizer reflects the new topology.
## Verify in the Visualizer
1. Select the [button label="OpenTelemetry Arcade"](tab-0) tab and select **◈ Visualizer** in the app's left navigation.
2. At the top of the topology diagram, there are **Agent** and **Gateway** selector buttons. Select each to see that collector's live pipeline topology.
3. Play a game to generate traffic.
4. Select the **Gateway** button. Spans should appear in the feed — this confirms telemetry is flowing through the full two-hop path (services → agent → gateway → Visualizer).
> [!NOTE]
> If the Gateway tab shows "not deployed yet", wait a moment and refresh. The Visualizer re-reads configs on a short interval.
## Verify in Honeycomb
Open the [button label="Honeycomb"](tab-2) tab and confirm traces are still arriving from all three services: `arcade-ui`, `score-api`, and `leaderboard`.
## Think about the architecture
With this two-tier setup in place, consider:
- If you want to add a second observability backend exporter, which config do you change — the agent or the gateway? Why?
- If you want to apply a sampling policy, which tier should own it?
- The gateway also has processors. What would you move from the agent to the gateway, and what would you keep on the agent?
## Success criteria
- Both `otel-collector-agent` and `otel-collector-gateway` containers are running
- Pipeline diagrams are visible for both Agent and Gateway — use the selector buttons to switch between them
- Spans appear in the Visualizer feed when the **Gateway** selector is active
- Honeycomb is still receiving traces from all three services
# Challenge 7: Tail Sampling
Most sampling strategies decide the moment a span arrives — **head sampling**. If you head-sample at 10%, you drop 10% of error traces before you even know they're errors.
**Tail sampling** buffers the complete trace and decides *after* all spans arrive. You can keep all errors, keep all slow traces, and sample everything else. The Collector's `tail_sampling` processor does this at the gateway tier.
## Load the Sampling & Connectors template
1. Select the [button label="OpenTelemetry Arcade"](tab-0) tab and select **⚙ Deploy & Configure** in the app's left navigation.
2. Select the **Gateway** tab.
3. Select **Load template → Sampling & Connectors**.
4. Read through the file. The `tail_sampling` block is commented out. Find it.
## Enable tail sampling
1. The `tail_sampling` processor is defined in the Gateway config but commented out. Find the commented `tail_sampling` block in the `processors:` section and uncomment it.
2. In the `traces` pipeline under `service.pipelines`, replace `batch` with `tail_sampling` in the `processors` list.
3. Select **Apply & Restart** in the Gateway tab to deploy the updated config.
## Verify
1. Select the [button label="OpenTelemetry Arcade"](tab-0) tab and select **◈ Visualizer**.
2. Select the **Gateway** selector button at the top of the Pipeline panel to switch to the gateway view, then scroll down to the **Gateway self-metrics** panel — you should now see two new gauges: **Traces sampled** and **Traces dropped**.
3. Start the load generator: select **⚡ TelemetryGen**, scroll to **Load Generator**, and set 10 RPS. Select **Start**.
4. Watch the gauges update as traffic flows.
To verify the `keep_errors` policy works:
1. Select **⚡ TelemetryGen** in the app navigation.
2. Select the **Error span (status code 2)** preset.
3. Check **Set error status (code=2)**.
4. Select **Generate span**.
5. Open the [button label="Honeycomb"](tab-2) tab and confirm the error trace arrived despite the 10% base sample rate.
> [!NOTE]
> The `decision_wait` setting (default: 5s) is how long the processor waits for all spans in a trace before deciding. Traces that arrive incomplete before `decision_wait` expires may be sampled differently than expected.
## Success criteria
- **Traces sampled** and **Traces dropped** gauges are visible in the Gateway self-metrics panel
- An error span from TelemetryGen reaches Honeycomb even at 10% base sample rate
# Challenge 8: Routing Connector
Processors transform data *inside* a pipeline. **Connectors** sit *between* pipelines — they are simultaneously an exporter from one pipeline and a receiver in one or more others. This enables conditional routing without duplicating receivers or exporters.
In this challenge, you'll route error traces to a dedicated pipeline using the `routing` connector.
## Enable the routing connector
1. Select the [button label="OpenTelemetry Arcade"](tab-0) tab and select **⚙ Deploy & Configure → Gateway** tab.
2. The `routing` connector acts as both an exporter from the main `traces` pipeline and a receiver in sub-pipelines — each trace is evaluated against routing rules and forwarded to the matching pipeline. Find the commented `routing` block in the `connectors:` section and uncomment it.
3. Add `routing` to the end of the `exporters` list in the `traces` pipeline under `service.pipelines`.
4. Find the two commented pipeline definitions near the bottom of the config (`traces/standard` and `traces/errors`) and uncomment both blocks.
5. Select **Apply & Restart** in the Gateway tab.
## Verify
1. Select the [button label="OpenTelemetry Arcade"](tab-0) tab and select **◈ Visualizer**.
2. Select the **Gateway** selector button in the Pipeline panel.
3. Confirm the topology shows three trace pipelines: `traces`, `traces/standard`, and `traces/errors`.
4. Notice that `routing` appears as both an **exporter** in the `traces` pipeline and a **receiver** in `traces/standard` and `traces/errors`. That is what makes it a connector.
## Explore
Look at the `default_pipelines` field in the `routing` connector definition, then consider:
- What happens when no routing rule matches a trace?
- What attribute would you use to route `score-api` traces to a different pipeline than `leaderboard`?
- Try giving `traces/errors` a shorter batch `timeout` (e.g. `timeout: 1s`). What does that mean for latency to Honeycomb?
## Success criteria
- Three trace pipelines are visible in the Visualizer Gateway topology
- The `routing` connector appears as both exporter and receiver in the topology diagram
# Challenge 9: Service Graph Connector
The `service_graph` connector reads traces and automatically emits request-count and latency metrics for every client→server pair it observes. These metrics land in Honeycomb as a queryable dataset — the same information the Visualizer's Service Graph panel shows, but now durable and alertable.
## Enable the service graph connector
1. Select the [button label="OpenTelemetry Arcade"](tab-0) tab and select **⚙ Deploy & Configure → Gateway** tab.
2. The `service_graph` connector derives request-count and latency metrics for every client→server pair it observes directly from your traces — no extra instrumentation needed. Find the commented `service_graph` block in the `connectors:` section and uncomment it.
3. Add `service_graph` to the end of the `exporters` list in the `traces` pipeline under `service.pipelines`.
4. Find the commented `metrics/service_graph` pipeline definition and uncomment it.
5. Select **Apply & Restart** in the Gateway tab.
## Verify
1. Open the [button label="Honeycomb"](tab-2) tab.
2. Look for metrics with the `traces_service_graph_` prefix:
   - `traces_service_graph_request_total` with `client` and `server` labels
   - `traces_service_graph_request_failed_total`
   - `traces_service_graph_request_server_seconds_bucket`
3. Play a few games to generate traffic between services, then refresh your query.
## Explore
- What is the error rate between `score-api` and `leaderboard`? How would you build a Honeycomb trigger (alert) on it?
- If a service stops sending spans but is still being called as a server, does it disappear from the service graph?
- How do the latency histograms in Honeycomb compare to the p99 values you see in individual traces?
## Success criteria
- `traces_service_graph_request_total` metrics are visible in Honeycomb with `client` and `server` labels
- At least three client→server pairs are represented
