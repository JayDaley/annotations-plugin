"""
OAuth 2.0 blueprint — /api/openid/*

Implements a minimal OAuth 2.0 Authorization Code flow with PKCE for the
test server.  The authorize endpoint renders a simple user-selection page
(no real login form) so that testers can quickly switch between seed users.

Endpoints:
  GET  /api/openid/authorize          Authorization (user-selection page)
  GET  /api/openid/authorize/approve  Approve & redirect with auth code
  POST /api/openid/token              Exchange auth code for access token
  GET  /api/openid/userinfo           Return authenticated user profile
"""
from __future__ import annotations

import hashlib
import base64
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from flask import Blueprint, jsonify, redirect, request

from models import User, db

oauth_bp = Blueprint("oauth", __name__, url_prefix="/api/openid")

# ---------------------------------------------------------------------------
# Configuration — hard-coded OAuth client for the VS Code extension
# ---------------------------------------------------------------------------

OAUTH_CLIENT_ID = "ietf-annotations-vscode"
AUTH_CODE_TTL = timedelta(minutes=5)
ACCESS_TOKEN_TTL = timedelta(hours=24)

# ---------------------------------------------------------------------------
# In-memory stores (adequate for a single-process test server)
# ---------------------------------------------------------------------------

_auth_codes: dict[str, dict] = {}
# key: auth code string
# value: { user_id, code_challenge, redirect_uri, expires, scope }

_access_tokens: dict[str, dict] = {}
# key: access token string
# value: { user_id, expires, scope }


# ---------------------------------------------------------------------------
# Public helper — used by auth.require_auth
# ---------------------------------------------------------------------------

def get_oauth_user(token_string: str) -> User | None:
    """Look up an OAuth access token and return the corresponding User, or
    None if the token is missing or expired."""
    entry = _access_tokens.get(token_string)
    if entry is None:
        return None
    if datetime.now(timezone.utc) > entry["expires"]:
        del _access_tokens[token_string]
        return None
    return db.session.get(User, entry["user_id"])


# ---------------------------------------------------------------------------
# PKCE helper
# ---------------------------------------------------------------------------

def _verify_pkce(code_verifier: str, code_challenge: str) -> bool:
    """Verify a PKCE S256 code challenge against the supplied verifier."""
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    expected = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return expected == code_challenge


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@oauth_bp.get("/authorize")
def authorize():
    """Render a minimal user-selection page.

    Validates the OAuth parameters, then shows a button for each seed user.
    Clicking a button approves the authorization as that user.
    """
    client_id = request.args.get("client_id", "")
    redirect_uri = request.args.get("redirect_uri", "")
    response_type = request.args.get("response_type", "")
    code_challenge = request.args.get("code_challenge", "")
    code_challenge_method = request.args.get("code_challenge_method", "")
    state = request.args.get("state", "")
    scope = request.args.get("scope", "openid profile")

    # ── Validate ──────────────────────────────────────────────────────────
    if client_id != OAUTH_CLIENT_ID:
        return jsonify({"error": "invalid_client", "message": "Unknown client_id"}), 400
    if response_type != "code":
        return jsonify({"error": "unsupported_response_type"}), 400
    if not redirect_uri:
        return jsonify({"error": "invalid_request", "message": "redirect_uri is required"}), 400
    if not code_challenge or code_challenge_method != "S256":
        return jsonify({"error": "invalid_request", "message": "PKCE S256 code_challenge is required"}), 400

    # ── Build user-selection page ─────────────────────────────────────────
    users = User.query.order_by(User.username).all()
    buttons = ""
    for u in users:
        qs = urlencode({
            "username": u.username,
            "redirect_uri": redirect_uri,
            "code_challenge": code_challenge,
            "state": state,
            "scope": scope,
        })
        approve_url = f"/api/openid/authorize/approve?{qs}"
        buttons += (
            f'<a href="{_esc(approve_url)}" '
            f'style="display:block;margin:12px 0;padding:10px 20px;'
            f'background:#0066cc;color:#fff;text-decoration:none;'
            f'border-radius:4px;text-align:center;font-size:16px;">'
            f"Sign in as <strong>{_esc(u.username)}</strong></a>\n"
        )

    html = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>IETF Test Sign In</title></head>
<body style="font-family:sans-serif;max-width:400px;margin:60px auto;padding:0 16px;">
  <h2>IETF Annotations — Test Sign In</h2>
  <p>Select a user to authorize:</p>
  {buttons}
</body>
</html>"""
    return html, 200, {"Content-Type": "text/html"}


@oauth_bp.get("/authorize/approve")
def authorize_approve():
    """Auto-approve the authorization for a given test user and redirect
    back to the client with an authorization code."""
    username = request.args.get("username", "")
    redirect_uri = request.args.get("redirect_uri", "")
    code_challenge = request.args.get("code_challenge", "")
    state = request.args.get("state", "")
    scope = request.args.get("scope", "openid profile")

    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({"error": "invalid_request", "message": "Unknown user"}), 400

    # Generate a one-time authorization code
    code = secrets.token_urlsafe(32)
    _auth_codes[code] = {
        "user_id": user.id,
        "code_challenge": code_challenge,
        "redirect_uri": redirect_uri,
        "scope": scope,
        "expires": datetime.now(timezone.utc) + AUTH_CODE_TTL,
    }

    # Redirect back to the VS Code extension
    separator = "&" if "?" in redirect_uri else "?"
    target = f"{redirect_uri}{separator}code={code}&state={state}"
    return redirect(target, code=302)


@oauth_bp.post("/token")
def token():
    """Exchange an authorization code (+ PKCE verifier) for an access token."""
    # Accept both form-encoded and JSON bodies
    if request.is_json:
        data = request.get_json(force=True, silent=True) or {}
    else:
        data = request.form.to_dict()

    grant_type = data.get("grant_type", "")
    code = data.get("code", "")
    redirect_uri = data.get("redirect_uri", "")
    client_id = data.get("client_id", "")
    code_verifier = data.get("code_verifier", "")

    if grant_type != "authorization_code":
        return jsonify({"error": "unsupported_grant_type"}), 400
    if client_id != OAUTH_CLIENT_ID:
        return jsonify({"error": "invalid_client"}), 400

    entry = _auth_codes.pop(code, None)
    if entry is None:
        return jsonify({"error": "invalid_grant", "message": "Invalid or expired authorization code"}), 400
    if datetime.now(timezone.utc) > entry["expires"]:
        return jsonify({"error": "invalid_grant", "message": "Authorization code expired"}), 400
    if entry["redirect_uri"] != redirect_uri:
        return jsonify({"error": "invalid_grant", "message": "redirect_uri mismatch"}), 400

    # PKCE verification
    if not _verify_pkce(code_verifier, entry["code_challenge"]):
        return jsonify({"error": "invalid_grant", "message": "PKCE verification failed"}), 400

    # Issue access token
    access_token = secrets.token_urlsafe(32)
    _access_tokens[access_token] = {
        "user_id": entry["user_id"],
        "scope": entry["scope"],
        "expires": datetime.now(timezone.utc) + ACCESS_TOKEN_TTL,
    }

    return jsonify({
        "access_token": access_token,
        "token_type": "Bearer",
        "expires_in": int(ACCESS_TOKEN_TTL.total_seconds()),
        "scope": entry["scope"],
    }), 200


@oauth_bp.get("/userinfo")
def userinfo():
    """Return the authenticated user's profile."""
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return jsonify({"error": "invalid_token", "message": "Bearer token required"}), 401

    raw_token = header[len("Bearer "):]
    user = get_oauth_user(raw_token)
    if user is None:
        return jsonify({"error": "invalid_token", "message": "Invalid or expired token"}), 401

    return jsonify({
        "sub": str(user.id),
        "name": user.username,
        "email": user.email,
    }), 200


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _esc(value: str) -> str:
    """Minimal HTML-attribute escaping."""
    return (
        value.replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
