"""
Unit tests for the Annotations Plugin test server.
Run with: python -m pytest server/test_server.py -v
"""

import json
import pytest
from app import app as flask_app


@pytest.fixture()
def client():
    flask_app.config["TESTING"] = True
    # Clear in-memory store before each test
    import app as server_module
    server_module._annotations.clear()
    with flask_app.test_client() as c:
        yield c


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

SAMPLE = {
    "file": "/path/to/file.py",
    "line": 10,
    "end_line": 12,
    "selected_text": "def foo():",
    "text": "This function does something important",
    "username": "alice",
}


def create(client, **overrides):
    payload = {**SAMPLE, **overrides}
    resp = client.post("/annotations", json=payload)
    assert resp.status_code == 201
    return resp.get_json()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestHealth:
    def test_health(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "ok"


class TestCreate:
    def test_create_returns_201(self, client):
        resp = client.post("/annotations", json=SAMPLE)
        assert resp.status_code == 201

    def test_create_returns_annotation(self, client):
        ann = create(client)
        assert ann["id"]
        assert ann["file"] == SAMPLE["file"]
        assert ann["text"] == SAMPLE["text"]
        assert ann["username"] == SAMPLE["username"]
        assert "created_at" in ann

    def test_create_missing_field(self, client):
        payload = {**SAMPLE}
        del payload["text"]
        resp = client.post("/annotations", json=payload)
        assert resp.status_code == 400


class TestList:
    def test_list_all(self, client):
        create(client)
        create(client, file="/other/file.py")
        resp = client.get("/annotations")
        assert resp.status_code == 200
        assert len(resp.get_json()) == 2

    def test_list_filter_by_file(self, client):
        create(client)
        create(client, file="/other/file.py")
        resp = client.get(f"/annotations?file={SAMPLE['file']}")
        data = resp.get_json()
        assert len(data) == 1
        assert data[0]["file"] == SAMPLE["file"]

    def test_list_sorted_by_line(self, client):
        create(client, line=20, end_line=20)
        create(client, line=5, end_line=5)
        resp = client.get(f"/annotations?file={SAMPLE['file']}")
        lines = [a["line"] for a in resp.get_json()]
        assert lines == sorted(lines)


class TestGet:
    def test_get_existing(self, client):
        ann = create(client)
        resp = client.get(f"/annotations/{ann['id']}")
        assert resp.status_code == 200
        assert resp.get_json()["id"] == ann["id"]

    def test_get_not_found(self, client):
        resp = client.get("/annotations/nonexistent-id")
        assert resp.status_code == 404


class TestUpdate:
    def test_update_text(self, client):
        ann = create(client)
        resp = client.put(f"/annotations/{ann['id']}", json={"text": "Updated text"})
        assert resp.status_code == 200
        assert resp.get_json()["text"] == "Updated text"

    def test_update_not_found(self, client):
        resp = client.put("/annotations/bad-id", json={"text": "x"})
        assert resp.status_code == 404

    def test_update_missing_text(self, client):
        ann = create(client)
        resp = client.put(f"/annotations/{ann['id']}", json={})
        assert resp.status_code == 400


class TestDelete:
    def test_delete_existing(self, client):
        ann = create(client)
        resp = client.delete(f"/annotations/{ann['id']}")
        assert resp.status_code == 200
        assert resp.get_json()["deleted"] == ann["id"]

    def test_delete_removes_from_list(self, client):
        ann = create(client)
        client.delete(f"/annotations/{ann['id']}")
        resp = client.get("/annotations")
        assert len(resp.get_json()) == 0

    def test_delete_not_found(self, client):
        resp = client.delete("/annotations/bad-id")
        assert resp.status_code == 404
