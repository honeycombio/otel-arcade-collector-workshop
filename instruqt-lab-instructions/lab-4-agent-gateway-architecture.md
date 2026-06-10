# Challenge 1: Deploy the Gateway

So far, a single Collector has handled everything — receiving from
your services, transforming data, and exporting to Honeycomb. In
production, that single-tier approach doesn't scale. This lab
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
this challenge and modify it in Lab 5.

---

## Success criteria

- The Gateway tab shows the gateway as running
- You can identify what the gateway is receiving, processing, and
exporting

---

# Challenge 2: Reconfigure the Agent

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

# Challenge 3: Verify the Two-Tier Architecture

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
