# OTel Arcade — workshop helper targets.
#
# Workshop priorities:
#   - `make local-up` is the one command attendees and the speaker run.
#   - `make collector-validate CONFIG=...` prevents CrashLoopBackOff, the #1
#     workshop time-sink. Always validate before applying.

SHELL            := /usr/bin/env bash
IMAGE_REGISTRY   ?= o11ycon-arcade
IMAGE_TAG        ?= latest
COLLECTOR_IMAGE  ?= otel/opentelemetry-collector-contrib:0.151.0
KUBE_NS_ARCADE   ?= arcade
KUBE_NS_TOOLS    ?= workshop-tools
KUBE_NS_OTEL     ?= otel-system

SERVICES         := score-api leaderboard arcade-ui visualizer loadgen

.DEFAULT_GOAL := help

## ── Help ────────────────────────────────────────────────────────────────
.PHONY: help
help:  ## Show this help.
	@awk 'BEGIN {FS = ":.*?## "; print "Usage: make <target>\n\nTargets:"} /^[a-zA-Z0-9_-]+:.*?## / { printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

## ── Build (local source) ────────────────────────────────────────────────
.PHONY: build
build:  ## Build all service binaries / bundles locally (no Docker).
	cd services/score-api && go build ./...
	cd services/arcade-ui && npm install --no-audit --no-fund
	cd visualizer && npm install --no-audit --no-fund && npx vite build
	@echo "leaderboard: pip install -r services/leaderboard/requirements.txt (use a venv)"

.PHONY: test
test:  ## Run unit tests (placeholder — workshop services have no test suite yet).
	cd services/score-api && go test ./... || true

## ── Docker ──────────────────────────────────────────────────────────────
.PHONY: docker-build
docker-build:  ## Build all Docker images (uses IMAGE_REGISTRY and IMAGE_TAG).
	@for s in $(SERVICES); do \
		case $$s in \
			score-api|leaderboard|arcade-ui) ctx=services/$$s ;; \
			visualizer)                      ctx=visualizer ;; \
			loadgen)                         ctx=loadgen ;; \
		esac; \
		echo "==> docker build $$s ($$ctx)"; \
		docker build -t $(IMAGE_REGISTRY)/$$s:$(IMAGE_TAG) $$ctx || exit 1; \
	done

.PHONY: docker-push
docker-push:  ## Push all images to IMAGE_REGISTRY.
	@for s in $(SERVICES); do \
		echo "==> docker push $$s"; \
		docker push $(IMAGE_REGISTRY)/$$s:$(IMAGE_TAG) || exit 1; \
	done

## ── Local dev (Docker Compose) ──────────────────────────────────────────
# Typical first-time flow: `make local-init` → `make local-up` → `make local-status`.
# Typical iteration loop:  edit collector-config.yaml → `make local-restart-collector`.

SVC ?= otel-collector-agent

.PHONY: local-init
local-init:  ## First-time setup: check Docker, create .env, pre-pull the Collector image.
	@docker info > /dev/null 2>&1 || { \
	  echo "Docker daemon is not running. Start Docker Desktop (or your daemon) and try again."; \
	  exit 1; \
	}
	@if [ ! -f .env ]; then \
	  cp .env.example .env; \
	  echo "✓ created .env  (edit to set HONEYCOMB_API_KEY for backend export — optional)"; \
	else \
	  echo "✓ .env already exists"; \
	fi
	@echo "pulling Collector image: $(COLLECTOR_IMAGE)"
	@docker pull $(COLLECTOR_IMAGE) > /dev/null || { echo "✗ failed to pull $(COLLECTOR_IMAGE)"; exit 1; }
	@echo "✓ Collector image cached"
	@echo
	@echo "Setup complete. Next: make local-up"

.PHONY: local-up
local-up:  ## Build and start the full stack. Also pre-builds the loadgen image for the browser Load Generator.
	docker compose build loadgen
	docker compose up -d --build
	@echo
	@echo "  Arcade UI:   http://localhost:3000"
	@echo "  Visualizer:  http://localhost:8090"
	@echo "  Score API:   http://localhost:8080"
	@echo "  Leaderboard: http://localhost:5000"
	@echo
	@echo "Run \`make local-status\` once everything settles (~15s) to confirm health."

.PHONY: local-down
local-down:  ## Stop the stack and remove volumes (wipes SQLite data).
	docker compose down -v

.PHONY: local-status
local-status:  ## Show container status and probe each public health endpoint.
	@echo "─── containers ───"
	@docker compose ps
	@echo
	@echo "─── health endpoints ───"
	@for entry in \
	  "arcade-ui   http://localhost:3000/health" \
	  "score-api   http://localhost:8080/health" \
	  "leaderboard http://localhost:5000/health" \
	  "visualizer  http://localhost:8090/health"; do \
	    name=$$(echo $$entry | awk '{print $$1}'); \
	    url=$$(echo $$entry | awk '{print $$2}'); \
	    if curl -sS --max-time 2 "$$url" > /dev/null 2>&1; then \
	      printf "  ✓ %-12s %s\n" "$$name" "$$url"; \
	    else \
	      printf "  ✗ %-12s %s  (not reachable yet)\n" "$$name" "$$url"; \
	    fi; \
	  done

.PHONY: local-logs
local-logs:  ## Follow logs for one service. Default SVC=otel-collector-agent. Override: SVC=arcade-ui
	docker compose logs -f $(SVC)

.PHONY: local-restart-collector
local-restart-collector:  ## Validate collector-config.yaml, then restart the Collector to pick up changes.
	$(MAKE) collector-validate
	docker compose restart otel-collector-agent
	@echo
	@echo "Collector restarted. Recent logs:"
	@sleep 2
	@docker compose logs --tail=15 otel-collector-agent || true

.PHONY: local-reset-collector
local-reset-collector:  ## Reset collector-config.yaml to the Lab 1 baseline and restart the agent.
	cp collector-config.baseline.yaml collector-config.yaml
	docker compose restart otel-collector-agent
	@echo
	@echo "Collector config reset to baseline. Recent logs:"
	@sleep 2
	@docker compose logs --tail=15 otel-collector-agent || true

.PHONY: local-teardown-gateway
local-teardown-gateway:  ## Force-remove the gateway container (safe to run even if it's not deployed).
	@if docker inspect otel-arcade-otel-collector-gateway-1 > /dev/null 2>&1; then \
	  docker rm -f otel-arcade-otel-collector-gateway-1 > /dev/null; \
	  echo "Gateway container removed."; \
	else \
	  echo "Gateway was not running."; \
	fi

.PHONY: local-reset
local-reset:  ## Soft reset: remove gateway, restore baseline collector config, restart all services (keeps data).
	$(MAKE) local-teardown-gateway
	cp collector-config.baseline.yaml collector-config.yaml
	docker compose restart
	@echo
	@echo "Stack restarted with baseline collector config. Gateway removed."
	@echo "Run 'make local-status' to confirm health."

.PHONY: local-rebuild
local-rebuild:  ## Rebuild & restart one service in place. Required: SVC=<arcade-ui|score-api|leaderboard|visualizer>
	@case "$(SVC)" in \
	  arcade-ui|score-api|leaderboard|visualizer) ;; \
	  *) echo "usage: make local-rebuild SVC=<arcade-ui|score-api|leaderboard|visualizer>"; exit 1 ;; \
	esac
	docker compose up -d --build --no-deps $(SVC)

.PHONY: local-smoke
local-smoke:  ## End-to-end smoke test: drives one session through arcade-ui → score-api → leaderboard.
	@set -e; \
	  echo "1. POST /api/games/memory/start (via arcade-ui :3000)"; \
	  resp=$$(curl -sS -X POST http://localhost:3000/api/games/memory/start \
	    -H 'Content-Type: application/json' -H 'X-Player-Id: u_smoke01' -d '{}'); \
	  id=$$(printf '%s' "$$resp" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4); \
	  test -n "$$id" || { echo "FAIL: no session id in response: $$resp"; exit 1; }; \
	  echo "   session $$id"; \
	  echo "2. POST /api/games/memory/events"; \
	  curl -sS -X POST "http://localhost:3000/api/games/memory/events" \
	    -H 'Content-Type: application/json' -H 'X-Player-Id: u_smoke01' \
	    -d "{\"session_id\":\"$$id\",\"type\":\"flip\",\"data\":{\"index\":1}}" > /dev/null; \
	  echo "3. POST /api/games/memory/complete"; \
	  curl -sS -X POST "http://localhost:3000/api/games/memory/complete" \
	    -H 'Content-Type: application/json' -H 'X-Player-Id: u_smoke01' \
	    -d "{\"session_id\":\"$$id\"}" > /dev/null; \
	  echo "4. GET /leaderboard?game=memory (via leaderboard :5000)"; \
	  sleep 1; \
	  curl -sS 'http://localhost:5000/leaderboard?game=memory&limit=3' | head -c 400; \
	  echo; \
	  echo; \
	  echo "✓ end-to-end chain works. Open http://localhost:8090 to see the trace in the Visualizer."

.PHONY: local-loadgen
local-loadgen:  ## Start the loadgen container (sustained traffic for Labs 3–4).
	docker compose --profile load up -d loadgen

.PHONY: local-loadgen-stop
local-loadgen-stop:  ## Stop the loadgen container.
	docker compose stop loadgen

## ── Kubernetes ──────────────────────────────────────────────────────────
.PHONY: k8s-deploy
k8s-deploy:  ## Apply all manifests under k8s/ (recursive).
	kubectl apply -f k8s/namespaces.yaml
	kubectl apply -R -f k8s/arcade/
	kubectl apply -R -f k8s/otel-system/collector-rbac.yaml
	kubectl apply -R -f k8s/otel-system/collector-configmap.yaml
	kubectl apply -R -f k8s/otel-system/collector-agent.yaml
	kubectl apply -R -f k8s/workshop-tools/

.PHONY: k8s-teardown
k8s-teardown:  ## Delete all manifests under k8s/.
	-kubectl delete -R -f k8s/workshop-tools/
	-kubectl delete -R -f k8s/otel-system/
	-kubectl delete -R -f k8s/arcade/
	-kubectl delete -f k8s/namespaces.yaml

.PHONY: k8s-port-forward
k8s-port-forward:  ## Port-forward arcade-ui (3000) and visualizer (8090).
	@echo "Open: http://localhost:3000 (arcade-ui), http://localhost:8090 (visualizer)"
	@echo "Ctrl+C to stop both forwards."
	kubectl -n $(KUBE_NS_ARCADE) port-forward svc/arcade-ui 3000:3000 & \
	kubectl -n $(KUBE_NS_TOOLS)  port-forward svc/visualizer 8090:8090 & \
	wait

## ── Workshop helpers ────────────────────────────────────────────────────
CONFIG ?= collector-config.yaml

.PHONY: collector-validate
collector-validate:  ## Validate a Collector config YAML before applying. CONFIG=path/to/config.yaml
	@test -f "$(CONFIG)" || { echo "no such file: $(CONFIG)"; exit 1; }
	@echo "validating $(CONFIG) against $(COLLECTOR_IMAGE)"
	docker run --rm \
	  -e HONEYCOMB_API_KEY=dummy \
	  -e OTEL_EXPORTER_ENDPOINT=api.honeycomb.io:443 \
	  -v "$(PWD):/conf:ro" $(COLLECTOR_IMAGE) validate --config=/conf/$(CONFIG)
	@echo "OK"

.PHONY: collector-apply
collector-apply:  ## Validate, patch the agent ConfigMap, and rollout restart. CONFIG=path/to/config.yaml
	$(MAKE) collector-validate CONFIG=$(CONFIG)
	kubectl create configmap otel-collector-agent-config \
	  --from-file=config.yaml=$(CONFIG) \
	  --dry-run=client -o yaml \
	  -n $(KUBE_NS_OTEL) | kubectl apply -f -
	kubectl -n $(KUBE_NS_OTEL) rollout restart daemonset/otel-collector-agent

.PHONY: loadgen-start
loadgen-start:  ## Scale loadgen to 1 replica in Kubernetes.
	kubectl -n $(KUBE_NS_TOOLS) scale deployment/loadgen --replicas=1

.PHONY: loadgen-stop
loadgen-stop:  ## Scale loadgen to 0 replicas in Kubernetes.
	kubectl -n $(KUBE_NS_TOOLS) scale deployment/loadgen --replicas=0
