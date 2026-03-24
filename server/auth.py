"""
Authentication blueprint — /api/auth/*

Endpoints:
  POST /api/auth/register
  POST /api/auth/login
  POST /api/auth/logout  (requires auth)
"""

import secrets
from datetime import datetime, timedelta, timezone
from functools import wraps

import bcrypt
from flask import Blueprint, current_app, g, jsonify, request

from models import Token, User, db

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


# ---------------------------------------------------------------------------
# Auth helper — used by other blueprints via `from auth import require_auth`
# ---------------------------------------------------------------------------

def require_auth(f):
    """Decorator that validates a Bearer token and sets g.current_user."""
    @wraps(f)
    def decorated(*args, **kwargs):
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return jsonify({"error": "Unauthorized", "message": "Bearer token required"}), 401
        raw_token = header[len("Bearer "):]
        token_row = db.session.get(Token, raw_token)
        if token_row is None or token_row.is_expired():
            return jsonify({"error": "Unauthorized", "message": "Invalid or expired token"}), 401
        g.current_user = token_row.user
        return f(*args, **kwargs)
    return decorated


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@auth_bp.post("/register")
def register():
    data = request.get_json(force=True, silent=True) or {}
    missing = [f for f in ("username", "email", "password") if not data.get(f)]
    if missing:
        return jsonify({"error": "Bad Request", "message": f"Missing fields: {', '.join(missing)}"}), 400

    if User.query.filter_by(username=data["username"]).first():
        return jsonify({"error": "Bad Request", "message": "Username already exists"}), 400
    if User.query.filter_by(email=data["email"]).first():
        return jsonify({"error": "Bad Request", "message": "Email already exists"}), 400

    hashed = bcrypt.hashpw(data["password"].encode(), bcrypt.gensalt()).decode()
    user = User(username=data["username"], email=data["email"], password=hashed)
    db.session.add(user)
    db.session.commit()
    return jsonify(user.to_dict()), 201


@auth_bp.post("/login")
def login():
    data = request.get_json(force=True, silent=True) or {}
    user = User.query.filter_by(username=data.get("username", "")).first()
    if not user or not bcrypt.checkpw(data.get("password", "").encode(), user.password.encode()):
        return jsonify({"error": "Unauthorized", "message": "Invalid credentials"}), 401

    raw_token = secrets.token_hex(32)
    expires = datetime.now(timezone.utc) + timedelta(hours=24)
    token = Token(token=raw_token, user_id=user.id, expires=expires)
    db.session.add(token)
    db.session.commit()

    return jsonify({"token": raw_token, "expires": _fmt(expires)}), 200


@auth_bp.post("/logout")
@require_auth
def logout():
    header = request.headers.get("Authorization", "")
    raw_token = header[len("Bearer "):]
    token_row = db.session.get(Token, raw_token)
    if token_row:
        db.session.delete(token_row)
        db.session.commit()
    return "", 204


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fmt(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
