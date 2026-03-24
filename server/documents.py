"""
Document serving blueprint — /archive/* and /api/drafts/

Endpoints:
  GET /archive/id/<filename>   Serve an I-D text file from ./drafts/
  GET /api/drafts/             List all available I-D files with metadata
"""
from __future__ import annotations

import os
import re

from flask import Blueprint, current_app, jsonify, send_from_directory

documents_bp = Blueprint("documents", __name__)

# Matches filenames like draft-ietf-foo-bar-03.txt
_DRAFT_RE = re.compile(r"^(draft-.+?)-(\d{2})\.txt$")


def _drafts_dir() -> str:
    return current_app.config["DRAFTS_DIR"]


def _base_url() -> str:
    return current_app.config["BASE_URL"]


def _parse_filename(filename: str) -> dict | None:
    m = _DRAFT_RE.match(filename)
    if not m:
        return None
    return {
        "filename": filename,
        "name": m.group(1),
        "version": m.group(2),
        "url": f"{_base_url()}/archive/id/{filename}",
    }


@documents_bp.get("/archive/id/<path:filename>")
def serve_draft(filename: str):
    drafts_dir = _drafts_dir()
    file_path = os.path.join(drafts_dir, filename)
    if not os.path.isfile(file_path):
        return jsonify({"error": "Not Found", "message": f"Draft not found: {filename}"}), 404
    return send_from_directory(drafts_dir, filename, mimetype="text/plain")


@documents_bp.get("/api/drafts/")
def list_drafts():
    drafts_dir = _drafts_dir()
    if not os.path.isdir(drafts_dir):
        return jsonify([]), 200

    results = []
    for filename in sorted(os.listdir(drafts_dir)):
        if filename.endswith(".txt"):
            info = _parse_filename(filename)
            if info:
                results.append(info)

    return jsonify(results), 200
