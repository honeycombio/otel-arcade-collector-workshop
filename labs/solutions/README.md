# Lab Solutions

These are complete, working configs for each lab. **Try the lab yourself first** — then use these to check your work or get unstuck.

| File | Lab |
|------|-----|
| `lab-1-solution.yaml` | Lab 1 — complete OTLP → Honeycomb pipeline |
| `lab-2-solution.yaml` | Lab 2 — all five OTTL transforms applied |
| `lab-3-agent-solution.yaml` | Lab 3 — agent forwarding to gateway |
| `lab-4-agent-solution.yaml` | Lab 4 — self-telemetry wired to Honeycomb |
| `lab-5-gateway-solution.yaml` | Lab 5 — tail sampling + routing + service graph |

## How to apply a solution

**Browser editor:** Open ⚙ Deploy & Configure, paste the file contents in, and click Apply & Restart.

**IDE Watch Mode:** Copy the solution file over your active config and save:
```bash
cp labs/solutions/lab-2-solution.yaml collector-agent-config.yaml
```
The Collector restarts automatically if IDE Watch Mode is on, or run `make local-restart-collector`.
