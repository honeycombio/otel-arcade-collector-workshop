# OTel Arcade

Welcome to the OTel Collector workshop. This repo contains the application you'll be working with today — a small arcade of mini-games that generates real OpenTelemetry telemetry as you play.

Your job isn't to understand the app. Your job is to build and tune the **OpenTelemetry Collector pipeline** that processes the telemetry coming out of it. The app is just the traffic source.

---

## Getting started

```bash
make local-init   # check Docker, create .env, pre-pull the Collector image
```

**(Optional — do this before the next step)** Open `.env` and add your Honeycomb API key:
```
HONEYCOMB_API_KEY=your-key-here
```
If you don't have one yet, skip it. The Visualizer and Collector pipeline work without it; only the Honeycomb backend export is affected. Adding the key *after* `make local-up` requires recreating the container — see Lab 1 for details.

```bash
make local-up     # build and start everything
make local-status # confirm all services are healthy
```

Once everything is up, open **http://localhost:3000** in your browser.

**Start here: [Lab 1 →](labs/lab-1.md)** — write your first Collector pipeline and watch telemetry flow through it.

---

## What you're looking at

The sidebar is split into two sections:

**Arcade** — the app itself:

| Page | What it's for |
|---|---|
| **Profile** | Set your display name and avatar — appears on the leaderboard. Changes save automatically. |
| **Games** | Play a game to generate telemetry |
| **Leaderboard** | See scores across all games |

**Collector** — your workshop tools:

| Page | What it's for |
|---|---|
| **Visualizer** | Watch your telemetry flow through the Collector in real time |
| **Deploy & Configure** | Edit and apply Collector configs — in the browser or your IDE |
| **TelemetryGen** | Generate specific spans on demand — no game required |

Start by playing a game, then open the Visualizer and watch what shows up. You'll notice some things pretty quickly.

---

## The games

There are 20 games plus a **Random** card (always top-left in the lobby) that picks one at random. Play any of them to generate telemetry. Each produces a slightly different trace shape.

| Game | Trace shape |
|---|---|
| Memory Match | Sequential flip events |
| Typing Speed | Throttled progress stream |
| Whack-a-Mole | Rapid hit/miss events |
| Reaction Timer | Browser-side spans with precise timing |
| Target Shooter | Browser-side click spans |
| Word Scramble | Sequential guess events *(deliberate smell: reveals answer)* |
| Math Sprint | Sequential answer events |
| Simon Says | Growing sequence events *(deliberate smell: exposes full sequence)* |
| Speed Tap | High-frequency burst events |
| **Wave Defender** | **Fan-out spans** — each enemy resolved as a parallel child span |
| **Bid Wars** | **Retry spans** — bid attempts with error status on contention |
| **Hot Cache** | **Cache hit/miss spans** — cold answers produce a `cache.lookup` child span |
| **Pixel Sort** | **Scatter-gather spans** — parallel partitions followed by an explicit merge span |
| **Chain Reaction** | **Saga spans** — sequential steps; wrong click triggers compensating rollback spans |
| **Deadline Dash** | **Timeout spans** — fulfillment steps that miss the order deadline get `DEADLINE_EXCEEDED` status |
| **Power Surge** | **Circuit-breaker spans** — `circuit.handle` alone (CLOSED = ok, OPEN = ERROR); HALF-OPEN adds a `circuit.probe` child |
| **Vault Sync** | **Two-phase commit spans** — parallel prepare → commit + confirm (success) or abort + rollback (failure) |
| **Laser Grid** | **Rate-limit spans** — permitted: `shot.fire → shot.process`; throttled: adds `rate.backoff`; rejected: `shot.fire` ERROR alone |
| **Canary Deploy** | **Traffic-split spans** — `deploy.route` → `service.v1.handle` (stable) or `service.v2.handle` (canary, 30% ERROR) |
| **Pulse** | **Pub-sub spans** — `event.publish` fans out to four named subscriber spans, each with distinct latency and failure rate |

The last eleven games are specifically designed to show distributed systems patterns that are harder to see in the first nine. To see these trace shapes in the Visualizer, play those games — the TelemetryGen session generator uses the original nine.

---

## The Visualizer

The **◈ Visualizer** page is your primary feedback loop for the labs. It shows:

- **Pipeline topology** — a live diagram of your actual Collector config, updated automatically whenever you apply a change. Shows the real receiver, processor, and exporter names for each pipeline.
- **Telemetry feed** — live spans, logs, and metrics as they flow through the Collector. Use the **All / Traces / Logs / Metrics** tabs to focus on one signal type at a time.
- **Split view** — once you're working on Lab 2 transforms, click **Split** in the feed header to see pre-transform and post-transform spans side by side. Rows with changes get an amber border in the After column. You'll need the Lab 2 template applied for it to populate.
- **Collector health** — queue depth, throughput, and other self-metrics (useful in the later labs). The health panel reflects whichever collector is selected — switch to the **Gateway** tab in the topology panel to see the gateway's own metrics.

The feed highlights certain spans in orange. Pay attention to what's highlighted and why — understanding that is part of Lab 2.

---

## The Deploy & Configure page

The **⚙ Deploy & Configure** page is the single place for all Collector config work. It has three tabs:

| Tab | What it's for |
|---|---|
| **Collector** (Labs 1–2) | Configures `otel-collector-agent` — your single Collector for Labs 1 and 2 |
| **Agent** (Lab 3) | Same container, now framed as the agent in the agent→gateway pattern |
| **Gateway** (Lab 3) | Deploys `otel-collector-gateway` on the Docker network and configures it |

### Editing in the browser

Press **Ctrl+S** (or **⌘S** on Mac) to apply the active tab's config, or click **Apply & Restart**.

Each tab also has:
- **Format** — fixes tabs-to-spaces and trims trailing whitespace
- **Restart** — restarts the container without re-applying config
- **Revert** — discards unsaved editor changes
- **Logs** — live log stream from that container

Each tab has a **Load template** dropdown with starter configs for that lab.

On the Collector tab, your edits are automatically saved as a draft in your browser. If you navigate away and come back, you'll be offered the chance to restore.

### Editing in your IDE (IDE Watch Mode)

Each tab has an **Edit mode** toggle: **Built-in Editor** or **IDE Watch Mode**.

In **IDE Watch Mode**:
- The in-browser editor steps aside and shows a watch status indicator
- Edit `collector-agent-config.yaml` (or `collector-gateway-config.yaml`) directly in VS Code or any editor — it's at the **repo root**
- Every time you save the file, the Collector restarts automatically
- The topology in the Visualizer updates within a second

Switch back to **Built-in Editor** at any time — the editor will show the current file state.

The editor validates YAML as you type and shows the error location in a banner above the editor. In IDE Watch Mode, the Collector will not restart if you save invalid YAML — the running Collector stays up.

---

## Labs overview

**Lab 1** — Deploy a working Collector
Write a Collector config that receives OTLP from the arcade services and exports somewhere useful. When it works, the Visualizer topology will populate and telemetry will start flowing.

**Lab 2** — OTTL processors
Look at what's in the feed. Some of it probably shouldn't be there, or shouldn't look the way it does. Your task is to write `transform` processor statements to clean it up. The Visualizer header gives you a real-time count of how much work is left. The **Before → After** toggle (available once the Lab 2 template is applied) shows you exactly what each transform changed.

**Lab 3** — Gateway architecture
Introduce the agent→gateway pattern. Open **⚙ Deploy & Configure**, switch to the **Gateway** tab and click **Deploy Gateway**, then switch to the **Agent** tab and update the config to forward to `otel-collector-gateway:4317` instead of exporting directly.

**Lab 4 (stretch)** — Collector self-telemetry
Put the Collector under load using TelemetryGen's Load Generator or `make local-loadgen`, then explore what it reports about itself. The Visualizer health panel shows queue depth and throughput in real time.

**Lab 5 (stretch)** — Advanced gateway patterns
Three exercises on the gateway: tail sampling, routing connector, and service graph connector. The Visualizer's Service Graph panel shows the topology from Lab 1 onward.

---

## Generating traffic

Play any game to generate a few spans manually.

The **⚡ TelemetryGen** sidebar page is your main traffic tool — no game required:

- **Custom span** — set any service name, span name, and attributes. Good for testing a specific OTTL expression.
- **Presets** — one-click spans that demonstrate each Lab 2 smell (SQL, PII, health probe, clean, error status).
- **Game Session presets** — simulate full multi-service game sessions at volume (5×, 10×, 50×), complete with all deliberate telemetry problems.
- **Load Generator** — scroll to the bottom of TelemetryGen to start and stop a sustained background load at a configurable RPS.

For sustained volume from the terminal instead:

```bash
make local-loadgen       # start the load generator
make local-loadgen-stop  # stop it
```

---

## Useful commands

```bash
make local-restart-collector              # validate config and restart the Collector
make local-reset-collector               # reset to Lab 1 baseline and restart
make local-logs SVC=otel-collector-agent  # follow the Collector's logs in the terminal
make local-logs SVC=score-api            # follow any other service's logs
make collector-validate CONFIG=my-config.yaml  # validate a config file before applying
make local-smoke                          # quick end-to-end health check
make local-down                           # stop everything and wipe state
```

> **Important:** `make local-up` rebuilds application services but does **not** restart the Collector. If you've changed `collector-agent-config.yaml` directly, use `make local-restart-collector` or the Apply & Restart button in the browser. IDE Watch Mode handles this automatically.

---

## Troubleshooting

**The Visualizer topology is empty.** Your Collector config probably doesn't have the `otlp_http/visualizer` exporter in its pipelines, or the Collector isn't running. Check `make local-logs SVC=otel-collector-agent`.

**The Collector crashes after I apply my config.** Open the Logs panel on the active tab of the ⚙ Collector page — it streams live output and will show the parse or validation error.

**I'm getting auth errors to the backend.** If you haven't set `HONEYCOMB_API_KEY` in your `.env`, remove `otlp_grpc/backend` from your pipeline exporters for now. Everything else keeps working.

**I don't know where to start on Lab 2.** Open the Visualizer feed and look at what's highlighted orange. Click on a span and read its attributes. The template in the Load dropdown for Lab 2 has scaffolding with hints.

**My config was valid YAML but the Collector still crashed.** YAML syntax and OTel config semantics are different things. `make collector-validate` checks both — run it before applying.

**I changed `collector-agent-config.yaml` in my editor but the Collector didn't restart.** Enable **IDE Watch Mode** on the Deploy & Configure page, or run `make local-restart-collector`.

**`make local-up` succeeded but the Collector isn't reachable on ports 4317, 4318, or 8888.** This happens when a previous `make local-up` failed mid-way (e.g., a port conflict) and left containers in a half-created state. Run `make local-down` then `make local-up` to get a clean start.

---

## Direct service URLs

| URL | Service |
|---|---|
| http://localhost:3000 | Arcade UI |
| http://localhost:8090 | Pipeline Visualizer (standalone) |
| http://localhost:8080 | Score API |
| http://localhost:5000 | Leaderboard |
| http://localhost:8888/metrics | Collector self-metrics (Prometheus text) |
