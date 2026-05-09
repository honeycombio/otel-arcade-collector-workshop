#!/usr/bin/env bash
# OTel Arcade load generator.
# Usage: ./loadgen.sh [RPS] [SCORE_API_URL]
# Default: 5 RPS against http://localhost:8080 (or SCORE_API_URL env var).

set -u

RPS=${1:-${LOADGEN_RPS:-5}}
URL=${2:-${SCORE_API_URL:-http://localhost:8080}}

if ! command -v bc >/dev/null 2>&1; then
  echo "loadgen: 'bc' not found; install bc or run inside the loadgen container" >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "loadgen: 'curl' not found" >&2
  exit 1
fi
if [ "$RPS" -le 0 ] 2>/dev/null; then
  echo "loadgen: RPS must be a positive integer, got: $RPS" >&2
  exit 1
fi

INTERVAL=$(echo "scale=4; 1/$RPS" | bc)

GAMES=("memory" "typing" "whackamole")
PLAYER_IDS=("u_load01" "u_load02" "u_load03" "u_load04" "u_load05")

echo "loadgen: $RPS req/s against $URL (interval=${INTERVAL}s, Ctrl+C to stop)"

trap 'echo; echo "loadgen: stopping"; exit 0' INT TERM

while true; do
  GAME=${GAMES[$((RANDOM % ${#GAMES[@]}))]}
  PLAYER=${PLAYER_IDS[$((RANDOM % ${#PLAYER_IDS[@]}))]}

  RESP=$(curl -s -m 3 -X POST "$URL/sessions" \
    -H 'Content-Type: application/json' \
    -d "{\"game\":\"$GAME\",\"player_id\":\"$PLAYER\"}")
  SESSION=$(printf '%s' "$RESP" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  if [ -n "$SESSION" ]; then
    EVENTS=$(( (RANDOM % 4) + 2 ))
    for _ in $(seq 1 $EVENTS); do
      curl -s -m 3 -o /dev/null -X POST "$URL/sessions/$SESSION/events" \
        -H 'Content-Type: application/json' \
        -d "{\"type\":\"action\",\"data\":{\"value\":$((RANDOM % 100))}}"
    done
    curl -s -m 3 -o /dev/null -X POST "$URL/sessions/$SESSION/complete"
  fi

  # Throttle to approximately RPS sessions per second.
  sleep "$INTERVAL"
done
