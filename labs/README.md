# Workshop Labs

This directory contains student-facing lab instructions for the o11ycon 2026 OpenTelemetry Collector workshop.

## Labs

| Lab | Title | Time |
|---|---|---|
| [Lab 1](lab-1.md) | Your First Collector Pipeline | ~20 min |
| [Lab 2](lab-2.md) | Cleaning Up Telemetry with OTTL | ~40 min |
| [Lab 3](lab-3.md) | Agent → Gateway Architecture | ~30 min |
| [Lab 4](lab-4.md) | Collector Self-Telemetry *(stretch)* | open-ended |
| [Lab 5](lab-5.md) | Advanced Gateway Patterns *(stretch)* | ~50 min |

## Before you start

1. Make sure Docker Desktop is running
2. Start the stack: `make local-up`
3. Confirm everything is healthy: `make local-status`
4. Open the arcade UI at **http://localhost:3000**
5. Set your name and avatar: sidebar → **Profile** (changes save automatically — no button)
6. Get your Honeycomb API key from the facilitator and add it to `.env`

## Useful links

| | URL |
|---|---|
| Arcade UI | http://localhost:3000 |
| Profile | http://localhost:3000/profile.html |
| Visualizer | http://localhost:3000 (Visualizer sidebar) |
| TelemetryGen | http://localhost:3000/telemetrygen.html |
| Collector self-metrics | http://localhost:8888/metrics |
| Score API health | http://localhost:8080/health |
| Leaderboard health | http://localhost:5000/health |

## If something breaks

| Problem | Command |
|---|---|
| Collector won't start (bad config) | `make local-reset-collector` |
| Gateway is broken / stuck | `make local-teardown-gateway` — then redeploy from the Gateway tab |
| Everything is broken, keep my data | `make local-reset` |
| Everything is broken, start fresh | `make local-down && make local-up` |
| Validate a config before applying | `make collector-validate CONFIG=collector-config.yaml` |

**`make local-reset-collector`** — restores `collector-config.yaml` to the Lab 1 baseline and restarts the agent. Use this when your config is so broken the Collector won't start.

**`make local-reset`** — removes the gateway container, restores the baseline collector config, and restarts all services. Does **not** wipe game data (scores/sessions are preserved).

**`make local-down && make local-up`** — full teardown including SQLite data. Last resort.
