"""
Authentication helpers and legacy auth blueprint — /api/auth/*

The primary authentication mechanism is now OAuth 2.0 via the
``/api/openid/*`` endpoints (see ``oauth.py``).  The legacy username /
password endpoints are retained as stubs that return 410 Gone.

The ``require_auth`` decorator validates OAuth access tokens issued by
the ``/api/openid/token`` endpoint.
"""
from __future__ import annotations

from functools import wraps

from flask import Blueprint, g, jsonify, request

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


# ---------------------------------------------------------------------------
# Auth decorator — validates OAuth bearer tokens
# ---------------------------------------------------------------------------

def require_auth(f):
    """Decorator that validates a Bearer token and sets ``g.current_user``."""
    @wraps(f)
    def decorated(*args, **kwargs):
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return jsonify({"error": "Unauthorized", "message": "Bearer token required"}), 401

        raw_token = header[len("Bearer "):]

        # Validate as an OAuth access token
        from oauth import get_oauth_user
        user = get_oauth_user(raw_token)
        if user is None:
            return jsonify({"error": "Unauthorized", "message": "Invalid or expired token"}), 401

        g.current_user = user
        return f(*args, **kwargs)
    return decorated


# ---------------------------------------------------------------------------
# Legacy endpoints — return 410 Gone
# ---------------------------------------------------------------------------

_GONE_MSG = "This endpoint has been removed. Use the OAuth 2.0 flow at /api/openid/authorize instead."


@auth_bp.post("/register")
def register():
    return jsonify({"error": "Gone", "message": _GONE_MSG}), 410


@auth_bp.post("/login")
def login():
    return jsonify({"error": "Gone", "message": _GONE_MSG}), 410


@auth_bp.post("/logout")
def logout():
    return jsonify({"error": "Gone", "message": _GONE_MSG}), 410
