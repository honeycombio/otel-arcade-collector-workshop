# Lab 1: Your First Collector Pipeline

## What you'll do

Write a working OpenTelemetry Collector configuration that receives telemetry from the OTel Arcade and exports it to Honeycomb. By the end, the Visualizer will show live spans flowing through your pipeline.

## Prerequisites

- The app services are running (`make local-up`, then `make local-status` to confirm the four ✓ health checks)
- The Collector is **not** running yet — the config starts with empty pipelines. That's the exercise: Lab 1 is done when the Collector starts.
- A Honeycomb API key is helpful but not required. If you have one, it should already be in your `.env` — the [setup instructions](../labs/README.md) say to add it *before* `make local-up`. The Visualizer and pipeline work without it; only the `otlp_grpc/backend` exporter will log auth errors.
- Open the arcade UI at **http://localhost:3000**

---

## Concepts

The OpenTelemetry Collector is a vendor-agnostic proxy for telemetry. It runs as a separate process and receives signals from your instrumented services, optionally transforms them, then exports to one or more backends.

A Collector config has three sections:
- **receivers** — how telemetry comes in (the OTel Arcade sends OTLP over gRPC and HTTP)
- **processors** — optional transforms and filters in between
- **exporters** — where telemetry goes out (Honeycomb accepts OTLP)

Those pieces are wired together in a **service > pipelines** block. A pipeline is a named receiver → processor chain → exporter route for one signal type (traces, metrics, or logs).

---

## Steps

### 1. Open the Collector editor

In the arcade sidebar, click **⚙ Deploy & Configure**. You'll see the config editor on the **Collector** tab.

The editor shows the current `collector-agent-config.yaml`. This is the config the Collector will use — your job is to complete it.

> **Prefer editing in VS Code?** Click the **IDE Watch Mode** toggle at the top of the tab. The editor steps aside and watches for file saves. Open `collector-agent-config.yaml` at the repo root in your IDE — saving it automatically restarts the Collector. Switch back to **Built-in Editor** at any time.

### 2. Read the starter config

The editor already shows the Lab 1 starter. Read through it: receivers, processors, and exporters are defined — but `service.pipelines` is intentionally empty. The components are *defined* but not yet *connected*.

As you read, try to answer:
- What signal types does the arcade send? (check how many exporters there are and where they go)
- What are the three exporters for?
- What does the `${env:HONEYCOMB_API_KEY}` syntax do?

If you accidentally modify the editor and need to reset, use **Load template → ↺ Lab 1 — baseline**.

> **IDE Watch Mode:** Open `collector-agent-config.yaml` at the repo root in your IDE — it's already the Lab 1 starter. Fill in the pipelines there; each save auto-restarts the Collector.

### 3. Wire the pipelines

Fill in the `service.pipelines` section to connect the components. Each pipeline needs three keys: `receivers`, `processors`, and `exporters` — each a list of component names from the sections above.

The commented example in the template shows the shape. Component names to use: `otlp`, `memory_limiter`, `batch`, `debug`, `otlp_grpc/backend`, `otlp_http/visualizer`.

Wire all three signal types: `traces`, `metrics`, and `logs`.

### 4. Apply and read the errors

Press **Ctrl+S** (or **⌘S** on Mac) to apply. If any list is empty, the Collector will refuse to start — the Logs panel will name exactly which pipeline is misconfigured. Fix and re-apply.

> **If you need to change the Honeycomb API key:** Edit `.env`, then recreate the container — Apply & Restart alone is not enough because env vars are injected only at container creation:
> ```
> docker compose up --force-recreate otel-collector-agent
> ```

### 5. Verify in the Visualizer

Click **Visualizer** in the sidebar. You should see:
- The **Pipeline** panel showing a diagram of your pipeline topology
- The **Feed** panel filling with incoming spans within a few seconds

If the feed is empty, check:
- Is the Collector running? (Logs panel on the Collector tab)
- Is the app generating traffic? (Play a game or click around — the app instruments everything)

### 6. Verify in Honeycomb

Open Honeycomb and look for your dataset. Traces from `arcade-ui`, `score-api`, and `leaderboard` should be arriving.

---

## What success looks like

- You wrote the `service.pipelines` wiring yourself — not just loaded a complete config
- The Visualizer feed shows live spans
- The Pipeline panel shows your receiver → processor → exporter topology
- Honeycomb is receiving traces from all three services *(if you have an API key set)*

---

## Going further

- Add a `debug` exporter with `verbosity: detailed` and wire it into your pipelines. Look at the Logs panel to see the full span content.
- Try applying a config with a syntax error — what happens? How do you recover?
- Look at the Collector self-metrics on port **8888** (`http://localhost:8888/metrics`) — what can you learn about pipeline health from those numbers?
