from flask import Blueprint, jsonify

bp = Blueprint("health", __name__)


@bp.get("/health")
def health():
    return jsonify(status="ok")


@bp.get("/ready")
def ready():
    return jsonify(status="ready")
