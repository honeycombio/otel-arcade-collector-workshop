# Lab 3: Agent → Gateway Architecture

## What you'll do

Restructure the pipeline from a single Collector into a two-tier architecture: a lightweight **agent** that runs close to your services and a central **gateway** that handles routing to backends. This mirrors how most production Kubernetes deployments are structured.

## Prerequisites

- Lab 2 complete: your agent config has working OTTL transforms
- The Visualizer is showing clean spans (smells counter at 0)

---

## Concepts

### Why two tiers?

A single Collector works fine for one service on one host. At scale you need:

- **Agents** — one per node (DaemonSet in Kubernetes). Lightweight. Close to the services. Handles signal collection, initial filtering, and normalization. Forwards upstream.
- **Gateway** — a small number of replicas behind a load balancer. Handles batching, fan-out to multiple backends, sampling decisions, and anything you want to apply cluster-wide.

This separation lets teams own their local Collector config (the agent) while platform teams control what reaches the backend (the gateway).

### How we're simulating this with Docker Compose

In Kubernetes, service names resolve to Pod IPs automatically. Docker Compose gives you the same thing on a single machine: every service name is resolvable as a hostname within the shared network.

| Kubernetes concept | Docker Compose equivalent |
|---|---|
| DaemonSet (one per node) | `otel-collector-agent` container |
| Central Deployment | `otel-collector-gateway` container |
| Service DNS (`otel-collector-gateway.otel-system`) | Container hostname `otel-collector-gateway` |
| ConfigMap rollout restart | Ctrl+S in the Agent/Gateway tab |

The agent and gateway containers are on the same Docker network (`arcade`), so the agent can reach `otel-collector-gateway:4317` the same way it would resolve a Kubernetes Service.

---

## Steps

### 1. Deploy the gateway

In the sidebar, go to **⚙ Deploy & Configure → Gateway** tab.

The tab shows "Gateway not deployed" with a **Deploy** button. Click it. The arcade-ui will start a new Collector container (`otel-collector-gateway`) using `gateway-config.yaml` as its config.

Wait for the Gateway tab to show the gateway as running, then look at `gateway-config.yaml` in the editor. This is what the gateway is currently doing:
- What is it receiving?
- What is it exporting to?
- What processors does it run?

The gateway ships with a baseline config. You'll leave it mostly as-is for this lab.

### 2. Reconfigure the agent

Now switch to the **Agent** tab. You'll see the same editor interface for `collector-config.yaml`.

Click **Load template → Lab 3 — Agent forwarding** in the Agent tab's toolbar. This replaces your Lab 2 config with an agent config designed to forward to a gateway rather than export directly to Honeycomb.

Read through what changed:
- What exporters are present? What's missing compared to Lab 2?
- Where is the agent now sending traces, metrics, and logs?
- Which processors are still running on the agent?
- What is the endpoint for the `otlp_grpc/gateway` exporter? Does that hostname match the container name you just deployed?

Apply the config (Ctrl+S). Watch the Logs panel for errors.

### 3. Verify the topology

Go to the Visualizer. The Pipeline panel has **Agent** and **Gateway** tabs at the top — click each to see that collector's live pipeline topology.

If the Gateway tab shows "not deployed yet", the Visualizer may need a moment to re-read the configs. Check that both containers are running:

```
docker ps | grep otel-arcade
```

You should see both `otel-arcade-otel-collector-agent-1` and `otel-arcade-otel-collector-gateway-1`.

The **Collector health** panel at the bottom of the Visualizer also switches when you change tabs — use it to compare the agent's and gateway's self-metrics side by side.

### 4. Verify end-to-end flow

Check the Visualizer feed — spans should still be arriving. The source tag on each span should now say **gateway** (not **agent**) because they're coming from the gateway's exporter, not the agent's.

Check Honeycomb — traces should still be landing, now tagged with the gateway as the source.

### 5. Think about what the gateway adds

With this architecture in place, consider:

- If you want to add a new backend exporter (e.g., a second observability tool), where do you add it — the agent or gateway config? Why?
- If you want to apply a sampling policy, which tier should own it?
- The gateway config has processors too. What would you move from the agent to the gateway, and what would you keep on the agent?

---

## What success looks like

- Both `otel-collector-agent` and `otel-collector-gateway` containers are running
- The Visualizer Pipeline panel shows two topology diagrams
- Spans in the Visualizer feed are tagged with source `gateway`
- Honeycomb is still receiving traces
- The agent config exports only to `otel-collector-gateway:4317` (not directly to Honeycomb)

---

## Going further

- Modify the **gateway** config to add a second exporter. What changes in the Visualizer topology?
- Try stopping the gateway container (`docker stop otel-arcade-otel-collector-gateway-1`). What happens to the Visualizer feed? What happens to the agent's queue? Watch the **Agent** health panel in the Visualizer — does `otelcol_exporter_queue_size` climb?
- In a real Kubernetes deployment, how many agent replicas would there be? How many gateway replicas? What drives those numbers?
