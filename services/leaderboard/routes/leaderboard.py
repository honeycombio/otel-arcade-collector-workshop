"""GET /leaderboard, GET /leaderboard/stats."""
import logging
import time

from flask import Blueprint, jsonify, request
from opentelemetry import metrics, trace

from models import score as score_model

bp = Blueprint("leaderboard", __name__)
log = logging.getLogger(__name__)
tracer = trace.get_tracer("leaderboard.queries")
meter = metrics.get_meter("leaderboard.queries")

query_duration = meter.create_histogram(
    "leaderboard.query.duration",
    unit="ms",
    description="Leaderboard query duration",
)


@bp.get("/leaderboard")
def get_leaderboard():
    game = request.args.get("game")
    try:
        limit = max(1, min(int(request.args.get("limit", 10)), 100))
    except ValueError:
        limit = 10

    # DELIBERATE smell: full SQL with bound values as the span name.
    if game:
        display_sql = (
            f"SELECT * FROM scores WHERE game = '{game}' "
            f"ORDER BY score DESC LIMIT {limit}"
        )
    else:
        display_sql = f"SELECT * FROM scores ORDER BY score DESC LIMIT {limit}"

    start = time.monotonic()
    with tracer.start_as_current_span(display_sql) as span:
        span.set_attributes({
            "db.system": "sqlite",
            "db.statement": display_sql,
            "leaderboard.game": game or "all",
            "leaderboard.limit": limit,
        })
        rows = score_model.top_scores(game, limit)

    elapsed_ms = (time.monotonic() - start) * 1000.0
    query_duration.record(elapsed_ms, attributes={"op": "top_scores"})

    log.debug("served leaderboard", extra={"game": game, "limit": limit, "count": len(rows)})

    return jsonify([
        {
            "id": r["id"],
            "session_id": r["session_id"],
            "game": r["game"],
            # DELIBERATE smell: player.id leaks into response body too.
            "player_id": r["player_id"],
            "player_name": r["player_name"],
            "score": r["score"],
            "difficulty": r["difficulty"],
            "created_at": r["created_at"],
        }
        for r in rows
    ])


@bp.get("/leaderboard/stats")
def stats():
    start = time.monotonic()
    with tracer.start_as_current_span("leaderboard.stats.aggregate") as span:
        rows = score_model.stats()
        span.set_attribute("leaderboard.games_seen", len(rows))

    elapsed_ms = (time.monotonic() - start) * 1000.0
    query_duration.record(elapsed_ms, attributes={"op": "stats"})

    return jsonify([
        {
            "game": r["game"],
            "total": r["total"],
            "avg_score": r["avg_score"],
            "max_score": r["max_score"],
        }
        for r in rows
    ])
