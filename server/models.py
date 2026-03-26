"""
SQLAlchemy models for the IETF Annotation Test Server.
"""

import json
from datetime import datetime, timezone

from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

VALID_STATUSES = ("open", "resolved")


class User(db.Model):
    __tablename__ = "user"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password = db.Column(db.String(200), nullable=False)  # bcrypt hash
    created = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    tokens = db.relationship("Token", backref="user", lazy=True, cascade="all, delete-orphan")
    annotations = db.relationship("Annotation", backref="creator", lazy=True)

    def to_dict(self):
        return {"id": self.id, "username": self.username, "email": self.email}


class Token(db.Model):
    __tablename__ = "token"

    token = db.Column(db.String(64), primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    created = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    expires = db.Column(db.DateTime, nullable=False)

    def is_expired(self) -> bool:
        return datetime.now(timezone.utc) > self.expires.replace(tzinfo=timezone.utc)


class Annotation(db.Model):
    __tablename__ = "annotation"

    id = db.Column(db.String(36), primary_key=True)       # UUID
    target_url = db.Column(db.String(500), nullable=False, index=True)
    creator_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    body_value = db.Column(db.Text, nullable=False)
    motivation = db.Column(db.String(50), default="commenting")
    status = db.Column(db.String(20), default="open")
    created = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    modified = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    selector = db.Column(db.Text)  # JSON string
    reply_to = db.Column(db.String(36), db.ForeignKey("annotation.id"), nullable=True, index=True)
    reply_count = db.Column(db.Integer, default=0)

    replies = db.relationship(
        "Annotation",
        backref=db.backref("parent", remote_side="Annotation.id"),
        lazy=True,
        cascade="all, delete-orphan",
    )

    def selector_dict(self):
        return json.loads(self.selector) if self.selector else None

    def to_jsonld(self, base_url: str) -> dict:
        """Serialise to W3C Web Annotation JSON-LD format."""
        result = {
            "@context": "http://www.w3.org/ns/anno.jsonld",
            "id": f"{base_url}/api/annotations/{self.id}",
            "type": "Annotation",
            "motivation": self.motivation,
            "status": self.status,
            "replyCount": self.reply_count or 0,
            "creator": {
                "id": f"{base_url}/api/users/{self.creator.id}",
                "type": "Person",
                "name": self.creator.username,
            },
            "created": _fmt(self.created),
            "modified": _fmt(self.modified),
            "body": {
                "type": "TextualBody",
                "value": self.body_value,
                "format": "text/plain",
            },
            "target": {
                "source": self.target_url,
                "selector": self.selector_dict(),
            },
        }
        if self.reply_to:
            result["replyTo"] = f"{base_url}/api/annotations/{self.reply_to}"
        return result


def _fmt(dt: datetime) -> str:
    """Format a datetime as an ISO 8601 UTC string."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
