"""
Annotations Plugin - Test Server
A simple Flask REST API for storing and retrieving code annotations.
"""

import uuid
from datetime import datetime, timezone
from flask import Flask, jsonify, request, abort

app = Flask(__name__)

# In-memory store: { id -> annotation_dict }
_annotations: dict[str, dict] = {}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return jsonify({"status": "ok", "count": len(_annotations)})


@app.get("/annotations")
def list_annotations():
    """Return all annotations, optionally filtered by ?file=<path>."""
    file_filter = request.args.get("file")
    results = list(_annotations.values())
    if file_filter:
        results = [a for a in results if a["file"] == file_filter]
    results.sort(key=lambda a: (a["file"], a["line"]))
    return jsonify(results)


@app.post("/annotations")
def create_annotation():
    """Create a new annotation."""
    data = request.get_json(force=True, silent=True) or {}

    required = ("file", "line", "end_line", "selected_text", "text", "username")
    missing = [f for f in required if f not in data]
    if missing:
        abort(400, description=f"Missing fields: {', '.join(missing)}")

    annotation = {
        "id": str(uuid.uuid4()),
        "file": data["file"],
        "line": int(data["line"]),
        "end_line": int(data["end_line"]),
        "selected_text": data["selected_text"],
        "text": data["text"],
        "username": data["username"],
        "created_at": _now(),
        "updated_at": _now(),
    }
    _annotations[annotation["id"]] = annotation
    return jsonify(annotation), 201


@app.get("/annotations/<ann_id>")
def get_annotation(ann_id: str):
    ann = _annotations.get(ann_id)
    if not ann:
        abort(404, description="Annotation not found")
    return jsonify(ann)


@app.put("/annotations/<ann_id>")
def update_annotation(ann_id: str):
    """Update the text of an existing annotation."""
    ann = _annotations.get(ann_id)
    if not ann:
        abort(404, description="Annotation not found")

    data = request.get_json(force=True, silent=True) or {}
    if "text" not in data:
        abort(400, description="Missing field: text")

    ann["text"] = data["text"]
    ann["updated_at"] = _now()
    return jsonify(ann)


@app.delete("/annotations/<ann_id>")
def delete_annotation(ann_id: str):
    ann = _annotations.pop(ann_id, None)
    if not ann:
        abort(404, description="Annotation not found")
    return jsonify({"deleted": ann_id})


# ---------------------------------------------------------------------------
# Error handlers
# ---------------------------------------------------------------------------

@app.errorhandler(400)
@app.errorhandler(404)
def http_error(e):
    return jsonify({"error": e.name, "message": e.description}), e.code


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Annotations Plugin Test Server")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=5000, help="Port to listen on (default: 5000)")
    parser.add_argument("--debug", action="store_true", help="Enable Flask debug mode")
    args = parser.parse_args()

    print(f"Starting Annotations server on http://{args.host}:{args.port}")
    app.run(host=args.host, port=args.port, debug=args.debug)
