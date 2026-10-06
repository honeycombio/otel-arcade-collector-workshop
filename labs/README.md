# Workshop Labs

This directory contains student-facing lab instructions for the o11ycon 2026 OpenTelemetry Collector workshop.

> **Running this in an Instruqt sandbox?** These files aren't your instructions — follow the lab content in your Instruqt tab instead (sourced from `instruqt instructions/` in this repo, not from here). The stack is also already running for you, so the `make` commands and setup steps below don't apply. This directory is for the in-person / self-serve version of the workshop, run on your own machine.

## Labs

| Workshop | Lab | Time |
|---|---|---|
| Workshop 1 | [Your First Collector Pipeline](workshop-1-first-pipeline.md) | ~40 min |
| Workshop 1 | [Cleaning Up Telemetry with OTTL](workshop-1-ottl-cleanup.md) | ~50 min |
| Workshop 2 | [Collector Self-Telemetry](workshop-2-self-telemetry.md) | ~40 min |
| Workshop 2 | [Agent → Gateway Architecture](workshop-2-agent-gateway.md) | ~30 min |
| Workshop 2 | [Advanced Gateway Patterns *(stretch)*](workshop-2-advanced-gateway-patterns.md) | ~50 min |

## Before you start

1. Make sure Docker Desktop is running
2. If you haven't already: `make local-init` — checks Docker, creates `.env`, pre-pulls the Collector image
3. **Do this now, before the next step:** if you have a Honeycomb API key, open `.env` and add it:
   ```
   HONEYCOMB_API_KEY=your-key-here
   ```
   The pipeline and Visualizer work without it — only the Honeycomb backend export is affected. Adding the key *after* `make local-up` requires recreating the container (not just restarting it).
4. Start the stack: `make local-up`
5. Confirm everything is healthy: `make local-status`
6. Open the arcade UI at **http://localhost:3000**
7. Set your name and avatar: sidebar → **Profile** (changes save automatically — no button)

## Useful links

| | URL |
|---|---|
| Arcade UI | http://localhost:3000 |
| Profile | http://localhost:3000/profile.html |
| Visualizer | http://localhost:3000 (Visualizer sidebar) |
| TelemetryGen | http://localhost:3000/telemetrygen.html |
| Collector self-metrics | http://localhost:9888/metrics |
| Score API health | http://localhost:8080/health |
| Leaderboard health | http://localhost:5050/health |

## If something breaks

| Problem | Command |
|---|---|
| Collector won't start after editing config | `make local-reset-collector` |
| Gateway is broken / stuck | `make local-teardown-gateway` — then redeploy from the Gateway tab |
| Everything is broken, keep my data | `make local-reset` |
| Everything is broken, start fresh | `make local-down && make local-up` |
| `local-up` worked but Collector ports unreachable | `make local-down && make local-up` |
| Validate a config before applying | `make collector-validate CONFIG=collector-agent-config.yaml` |

**`make local-reset-collector`** — restores `collector-agent-config.yaml` to the completed **Your First Collector Pipeline** state (`collector-agent-config.baseline.yaml` — exporters wired, no OTTL or self-telemetry changes) and restarts the agent. Note this is the *solved* state for that first lab, not the debug-only config a fresh stack starts with.

- **Your First Collector Pipeline / Cleaning Up Telemetry with OTTL:** use this when your config is so broken the Collector won't start.
- **Collector Self-Telemetry / Agent → Gateway Architecture:** use **⚙ Deploy & Configure → Agent tab → Load template** instead (Self-telemetry or Agent forwarding) — `make local-reset-collector` resets all the way back to the first lab's completed state, wiping your OTTL transforms and self-telemetry config.

> **Note:** On a fresh `make local-up`, the Collector starts with debug-only pipelines — telemetry is received but nothing reaches the Visualizer or Honeycomb yet. That's the first lab's exercise: wire up the exporters. Only use `make local-reset-collector` if your config broke while you were editing it, not at the very start.

**`make local-reset`** — removes the gateway container, restores the baseline collector config, and restarts all services. Does **not** wipe game data (scores/sessions are preserved).

**`make local-down && make local-up`** — full teardown including SQLite data. Last resort.
