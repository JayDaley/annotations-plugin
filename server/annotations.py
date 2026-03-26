"""
Annotations blueprint — /api/annotations/*

Endpoints:
  POST   /api/annotations/
  GET    /api/annotations/         (public, paginated)
  GET    /api/annotations/<id>     (public)
  GET    /api/annotations/<id>/replies  (public, paginated)
  PUT    /api/annotations/<id>     (auth, creator only)
  PATCH  /api/annotations/<id>/status  (auth, any user)
  DELETE /api/annotations/<id>     (auth, creator only)
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from flask import Blueprint, current_app, g, jsonify, request
from sqlalchemy import func

from auth import require_auth
from models import Annotation, User, db, VALID_STATUSES

annotations_bp = Blueprint("annotations", __name__, url_prefix="/api/annotations")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _base_url() -> str:
    return current_app.config["BASE_URL"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_body(data: dict) -> tuple[str, str, str, str | None]:
    """
    Extract and validate fields from a W3C annotation request body.
    Returns (target_url, body_value, motivation, selector_json) or raises ValueError.
    """
    target = data.get("target")
    if not target or not isinstance(target, dict) or not target.get("source"):
        raise ValueError("target.source is required")
    target_url: str = target["source"]

    body = data.get("body")
    if not body or not isinstance(body, dict) or not body.get("value"):
        raise ValueError("body.value is required")
    body_value: str = body["value"]

    motivation: str = data.get("motivation", "commenting")

    selector = target.get("selector")
    selector_json = json.dumps(selector) if selector else None

    return target_url, body_value, motivation, selector_json


def _extract_uuid(value: str) -> str:
    """
    Extract the bare UUID from a value that may be a full annotation URI
    or already a bare UUID.
    """
    # Strip trailing slash
    value = value.rstrip("/")
    # If it looks like a URI, take the last path segment
    if "/" in value:
        return value.rsplit("/", 1)[-1]
    return value


def _delete_recursive(ann: Annotation) -> int:
    """
    Recursively delete an annotation and all its replies.
    Returns the number of annotations deleted (excluding the root).
    """
    deleted = 0
    for reply in list(ann.replies):
        deleted += _delete_recursive(reply)
        deleted += 1
    # Decrement parent's reply_count if this annotation has a parent
    if ann.reply_to:
        parent = db.session.get(Annotation, ann.reply_to)
        if parent:
            parent.reply_count = max(0, (parent.reply_count or 0) - 1)
    db.session.delete(ann)
    return deleted


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@annotations_bp.post("/")
@require_auth
def create_annotation():
    data = request.get_json(force=True, silent=True) or {}
    try:
        target_url, body_value, motivation, selector_json = _parse_body(data)
    except ValueError as exc:
        return jsonify({"error": "Bad Request", "message": str(exc)}), 400

    status = data.get("status", "open")
    if status not in VALID_STATUSES:
        return jsonify({"error": "Bad Request", "message": f"status must be one of {VALID_STATUSES}"}), 400

    # Handle replyTo
    reply_to_id = None
    raw_reply_to = data.get("replyTo")
    if raw_reply_to:
        reply_to_id = _extract_uuid(raw_reply_to)
        parent = db.session.get(Annotation, reply_to_id)
        if not parent:
            return jsonify({"error": "Not Found", "message": "Parent annotation not found"}), 404
        # Force motivation to "replying" for replies
        motivation = "replying"
    else:
        # Reject "replying" motivation without replyTo
        if motivation == "replying":
            return jsonify({
                "error": "Bad Request",
                "message": "motivation 'replying' requires a replyTo field",
            }), 400

    ann = Annotation(
        id=str(uuid.uuid4()),
        target_url=target_url,
        creator_id=g.current_user.id,
        body_value=body_value,
        motivation=motivation,
        status=status,
        selector=selector_json,
        reply_to=reply_to_id,
        reply_count=0,
    )
    db.session.add(ann)

    # Atomically increment parent's reply_count
    if reply_to_id:
        parent = db.session.get(Annotation, reply_to_id)
        parent.reply_count = (parent.reply_count or 0) + 1

    db.session.commit()
    return jsonify(ann.to_jsonld(_base_url())), 201


@annotations_bp.get("/")
def list_annotations():
    target = request.args.get("target")
    draft = request.args.get("draft")
    status = request.args.get("status")
    creator_name = request.args.get("creator")
    reply_to_param = request.args.get("replyTo")
    include_replies = request.args.get("includeReplies", "false").lower() in ("true", "1", "yes")

    try:
        page = max(1, int(request.args.get("page", 1)))
        per_page = min(100, max(1, int(request.args.get("per_page", 20))))
    except ValueError:
        return jsonify({"error": "Bad Request", "message": "page and per_page must be integers"}), 400

    # replyTo filter — returns direct replies to a specific annotation
    if reply_to_param:
        parent_id = _extract_uuid(reply_to_param)
        q = Annotation.query.filter(Annotation.reply_to == parent_id)
    elif not target and not draft:
        return jsonify({"error": "Bad Request", "message": "Provide 'target', 'draft', or 'replyTo' query parameter"}), 400
    else:
        q = Annotation.query

        if target:
            q = q.filter(Annotation.target_url == target)
        elif draft:
            # Match any version: draft-ietf-foo-bar matches -00, -01, etc.
            q = q.filter(Annotation.target_url.like(f"%/{draft}-%"))

        # By default, exclude replies unless includeReplies is set
        if not include_replies:
            q = q.filter(Annotation.reply_to.is_(None))

    if status:
        if status not in VALID_STATUSES:
            return jsonify({"error": "Bad Request", "message": f"status must be one of {VALID_STATUSES}"}), 400
        q = q.filter(Annotation.status == status)

    if creator_name:
        q = q.join(User).filter(User.username == creator_name)

    total = q.count()
    annotations = q.offset((page - 1) * per_page).limit(per_page).all()

    return jsonify({
        "total": total,
        "page": page,
        "per_page": per_page,
        "annotations": [a.to_jsonld(_base_url()) for a in annotations],
    }), 200


@annotations_bp.get("/<ann_id>")
def get_annotation(ann_id: str):
    ann = db.session.get(Annotation, ann_id)
    if not ann:
        return jsonify({"error": "Not Found", "message": "Annotation not found"}), 404
    return jsonify(ann.to_jsonld(_base_url())), 200


@annotations_bp.get("/<ann_id>/replies")
def get_replies(ann_id: str):
    ann = db.session.get(Annotation, ann_id)
    if not ann:
        return jsonify({"error": "Not Found", "message": "Annotation not found"}), 404

    try:
        page = max(1, int(request.args.get("page", 1)))
        per_page = min(100, max(1, int(request.args.get("per_page", 20))))
    except ValueError:
        return jsonify({"error": "Bad Request", "message": "page and per_page must be integers"}), 400

    q = Annotation.query.filter(Annotation.reply_to == ann_id)
    total = q.count()
    replies = q.offset((page - 1) * per_page).limit(per_page).all()

    return jsonify({
        "total": total,
        "page": page,
        "per_page": per_page,
        "annotations": [r.to_jsonld(_base_url()) for r in replies],
    }), 200


@annotations_bp.put("/<ann_id>")
@require_auth
def update_annotation(ann_id: str):
    ann = db.session.get(Annotation, ann_id)
    if not ann:
        return jsonify({"error": "Not Found", "message": "Annotation not found"}), 404
    if ann.creator_id != g.current_user.id:
        return jsonify({"error": "Forbidden", "message": "Only the creator may update this annotation"}), 403

    data = request.get_json(force=True, silent=True) or {}
    try:
        target_url, body_value, motivation, selector_json = _parse_body(data)
    except ValueError as exc:
        return jsonify({"error": "Bad Request", "message": str(exc)}), 400

    status = data.get("status", ann.status)
    if status not in VALID_STATUSES:
        return jsonify({"error": "Bad Request", "message": f"status must be one of {VALID_STATUSES}"}), 400

    ann.target_url = target_url
    ann.body_value = body_value
    ann.motivation = motivation
    ann.selector = selector_json
    ann.status = status
    ann.modified = _now()
    db.session.commit()
    return jsonify(ann.to_jsonld(_base_url())), 200


@annotations_bp.patch("/<ann_id>/status")
@require_auth
def patch_status(ann_id: str):
    ann = db.session.get(Annotation, ann_id)
    if not ann:
        return jsonify({"error": "Not Found", "message": "Annotation not found"}), 404

    data = request.get_json(force=True, silent=True) or {}
    new_status = data.get("status")
    if new_status not in VALID_STATUSES:
        return jsonify({"error": "Bad Request", "message": f"status must be one of {VALID_STATUSES}"}), 400

    ann.status = new_status
    ann.modified = _now()
    db.session.commit()
    return jsonify(ann.to_jsonld(_base_url())), 200


@annotations_bp.delete("/<ann_id>")
@require_auth
def delete_annotation(ann_id: str):
    ann = db.session.get(Annotation, ann_id)
    if not ann:
        return jsonify({"error": "Not Found", "message": "Annotation not found"}), 404
    if ann.creator_id != g.current_user.id:
        return jsonify({"error": "Forbidden", "message": "Only the creator may delete this annotation"}), 403

    _delete_recursive(ann)
    db.session.commit()
    return "", 204
