"""Flask app factory for the leaderboard service.

Importing tracing first ensures the OTel SDK is configured before any
instrumented library (Flask, requests, sqlite3) is touched.
"""
import logging

import tracing  # noqa: E402  side-effect import: register OTel providers
tracing.setup()

from flask import Flask  # noqa: E402
from opentelemetry.instrumentation.flask import FlaskInstrumentor  # noqa: E402

from models import score as score_model  # noqa: E402
from routes import health as health_bp  # noqa: E402
from routes import leaderboard as leaderboard_bp  # noqa: E402
from routes import scores as scores_bp  # noqa: E402


def create_app() -> Flask:
    app = Flask(__name__)
    FlaskInstrumentor().instrument_app(app)
    score_model.init_schema()

    app.register_blueprint(health_bp.bp)
    app.register_blueprint(scores_bp.bp)
    app.register_blueprint(leaderboard_bp.bp)

    logging.getLogger(__name__).info("leaderboard ready")
    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(__import__("os").environ.get("PORT", "5000")))
