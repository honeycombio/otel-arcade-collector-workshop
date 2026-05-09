# Lab 1: Your First Collector Pipeline

## What you'll do

Write a working OpenTelemetry Collector configuration that receives telemetry from the OTel Arcade and exports it to Honeycomb. By the end, the Visualizer will show live spans flowing through your pipeline.

## Prerequisites

- The app is running (`make local-up`, then `make local-status` to confirm)
- You have a Honeycomb API key (your facilitator will provide one)
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

In the arcade sidebar, click **⚙ Collector**. You'll see the config editor on the **Collector** tab.

The editor shows the current `collector-config.yaml`. This is what the running Collector is using — any changes you apply here restart the Collector with the new config.

> **Prefer editing in VS Code?** Click the **IDE Watch Mode** toggle at the top of the tab. The editor steps aside and watches for file saves. Open `collector-config.yaml` at the repo root in your IDE — saving it automatically restarts the Collector. Switch back to **Built-in Editor** at any time.

### 2. Load the Lab 1 template

Click **Load template → ↺ Lab 1 — baseline** to load a working baseline config. Read through it before applying anything.

In IDE Watch Mode the file is already the Lab 1 baseline — open it in your editor and read it there.

As you read, try to answer:
- Which receiver protocol does the arcade use to send telemetry?
- Where does telemetry go when it leaves the Collector?
- What do the processors do, and why are they ordered the way they are?
- What is the `otlphttp/visualizer` exporter for?

### 3. Add your Honeycomb API key

Find the `otlp/backend` exporter. It has a header `x-honeycomb-team` that reads from an environment variable. That variable is already set in your `.env` file — open it in a text editor and paste your API key as the value of `HONEYCOMB_API_KEY`.

You don't need to touch the exporter config itself. The variable substitution handles it.

### 4. Apply the config

Press **Ctrl+S** (or **⌘S** on Mac) to apply the config. The Logs panel at the bottom of the page will show the Collector restarting and loading your config.

Watch for any error lines in red. If the Collector fails to start, the Logs panel is your first debugging tool.

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

- The Visualizer feed shows live spans
- The Pipeline panel shows your receiver → processor → exporter topology
- Honeycomb is receiving traces from all three services

---

## Going further

- Add a `debug` exporter with `verbosity: detailed` and wire it into your pipelines. Look at the Logs panel to see the full span content.
- Try applying a config with a syntax error — what happens? How do you recover?
- Look at the Collector self-metrics on port **8888** (`http://localhost:8888/metrics`) — what can you learn about pipeline health from those numbers?
