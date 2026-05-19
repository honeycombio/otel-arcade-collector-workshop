"""POST /scores — accept a score payload from the Score API."""
import logging
import time

from flask import Blueprint, jsonify, request
from opentelemetry import metrics, trace

from models import score as score_model

bp = Blueprint("scores", __name__)
log = logging.getLogger(__name__)
tracer = trace.get_tracer("leaderboard.scores")
meter = metrics.get_meter("leaderboard.scores")

scores_total = meter.create_counter(
    "leaderboard.scores.total",
    description="Total scores recorded by the leaderboard",
)
query_duration = meter.create_histogram(
    "leaderboard.scores.query.duration",
    unit="ms",
    description="Leaderboard query duration",
)


@bp.post("/scores")
def create_score():
    body = request.get_json(silent=True) or {}
    session_id = body.get("session_id")
    game = body.get("game")
    player_id = body.get("player_id")
    player_name = body.get("player_name", "")
    score = body.get("score")
    difficulty = body.get("difficulty", "medium")
    if not all([session_id, game, player_id, isinstance(score, int)]):
        return jsonify(error="session_id, game, player_id, score (int) required"), 400

    # DELIBERATE smell: span name is the full SQL with literal values inlined.
    display_sql = (
        f"INSERT INTO scores (session_id, game, player_id, score) "
        f"VALUES ('{session_id}', '{game}', '{player_id}', {score})"
    )
    start = time.monotonic()
    with tracer.start_as_current_span(display_sql) as span:
        # DELIBERATE smell: player.id propagated as PII attribute.
        span.set_attributes({
            "db.system": "sqlite",
            "db.statement": display_sql,
            "game.name": game,
            "player.id": player_id,
            "leaderboard.session.id": session_id,
        })
        new_id = score_model.insert_score(session_id, game, player_id, score, player_name, difficulty)

    with tracer.start_as_current_span("leaderboard.rank.compute") as span:
        rank = score_model.rank_for_score(game, score)
        span.set_attributes({
            "game.name": game,
            "player.id": player_id,
            "leaderboard.rank": rank,
            "leaderboard.score": score,
        })

    elapsed_ms = (time.monotonic() - start) * 1000.0
    query_duration.record(elapsed_ms, attributes={"op": "insert_score"})
    scores_total.add(1, attributes={"game.name": game})

    log.debug("score recorded", extra={"session_id": session_id, "game": game, "player.id": player_id, "score": score, "rank": rank})

    return jsonify(id=new_id, rank=rank), 201
