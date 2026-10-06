# Solutions

These are complete, working configs. **Try it out yourself first** — then use these to check your work or get unstuck.

| File | Title |
|------|-----|
| `workshop-1-first-pipeline-solution.yaml` | Your First Collector Pipeline — complete OTLP → Honeycomb pipeline |
| `workshop-1-ottl-cleanup-solution.yaml` | Cleaning Up Telemetry with OTTL — all five OTTL transforms applied |
| `workshop-2-self-telemetry-agent-solution.yaml` | Collector Self-Telemetry — self-telemetry wired to Honeycomb |
| `workshop-2-agent-gateway-agent-solution.yaml` | Agent → Gateway Architecture — agent forwarding to gateway (with self-telemetry retained) |
| `workshop-2-advanced-gateway-patterns-gateway-solution.yaml` | Advanced Gateway Patterns — tail sampling + routing + service graph |

## How to apply a solution

**Browser editor:** Open ⚙ Deploy & Configure, paste the file contents in, and click Apply & Restart.

**IDE Watch Mode:** Copy the solution file over your active config and save:
```bash
cp labs/solutions/workshop-1-ottl-cleanup-solution.yaml collector-agent-config.yaml
```
The Collector restarts automatically if IDE Watch Mode is on, or run `make local-restart-collector`.
