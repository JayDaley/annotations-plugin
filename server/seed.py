"""
Seed data for the IETF Annotation Test Server.

Called automatically by app.py on first run when the database is empty.
Can also be run directly to reset and re-seed:

    python seed.py
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

import bcrypt

# ---------------------------------------------------------------------------
# Seed constants
# ---------------------------------------------------------------------------

BASE_URL = "http://localhost:5000"

URL_FOO_BAR_02 = f"{BASE_URL}/archive/id/draft-ietf-foo-bar-02.txt"
URL_FOO_BAR_03 = f"{BASE_URL}/archive/id/draft-ietf-foo-bar-03.txt"
URL_TEST_00 = f"{BASE_URL}/archive/id/draft-ietf-test-protocol-00.txt"

_USERS = [
    {"username": "alice", "email": "alice@example.com", "password": "alice123"},
    {"username": "bob",   "email": "bob@example.com",   "password": "bob123"},
    {"username": "carol", "email": "carol@example.com", "password": "carol123"},
]

# Each entry:  (username, target_url, body_value, status, selector, section_ref)
# section_ref is an optional refinedBy FragmentSelector value.
_ANNOTATIONS = [
    # ---- draft-ietf-foo-bar-03.txt ----------------------------------------

    # alice + bob both annotate the same passage in section 4.2  (both "open")
    # This exercises the "two users, same passage" requirement.
    (
        "alice",
        URL_FOO_BAR_03,
        "Should this be SHOULD rather than MUST? Some implementations may need "
        "flexibility here — for example, when operating over a transport that "
        "automatically pads short values.",
        "open",
        {
            "type": "TextQuoteSelector",
            "exact": "Implementations MUST reject messages where the Nonce field is not exactly 16 octets in length.",
            "prefix": "it MUST be included in the Message Authentication Code calculation.  ",
            "suffix": "  A receiver that detects\n   a malformed Nonce MUST send an Error response.",
            "refinedBy": {"type": "FragmentSelector", "value": "section-4.2"},
        },
    ),
    (
        "bob",
        URL_FOO_BAR_03,
        "Agree with alice — MUST is too strict for implementations that receive "
        "a Nonce padded to a longer length by an intermediate layer.  At minimum "
        "the error behaviour should be SHOULD.",
        "open",
        {
            "type": "TextQuoteSelector",
            "exact": "Implementations MUST reject messages where the Nonce field is not exactly 16 octets in length.",
            "prefix": "it MUST be included in the Message Authentication Code calculation.  ",
            "suffix": "  A receiver that detects\n   a malformed Nonce MUST send an Error response.",
            "refinedBy": {"type": "FragmentSelector", "value": "section-4.2"},
        },
    ),
    (
        "carol",
        URL_FOO_BAR_03,
        "30 seconds is too aggressive for high-latency satellite links, which "
        "routinely see RTTs above 600 ms.  Recommend making this value "
        "configurable or specifying a longer mandatory minimum.",
        "resolved",
        {
            "type": "TextQuoteSelector",
            "exact": "A session MUST be terminated if no KEEPALIVE message is received within 30 seconds of the last successful exchange.",
            "prefix": "Keepalive processing is described in this section.  ",
            "suffix": "  Implementations MAY reduce this\n   timer in high-throughput environments.",
            "refinedBy": {"type": "FragmentSelector", "value": "section-5.3"},
        },
    ),

    # ---- draft-ietf-foo-bar-02.txt ----------------------------------------

    (
        "alice",
        URL_FOO_BAR_02,
        "This contradicts the multiplexing requirements that were discussed on "
        "the mailing list in January.  If we allow pipelining (see issue #47) "
        "this MUST NOT becomes a SHOULD NOT with a numeric limit.",
        "resolved",
        {
            "type": "TextQuoteSelector",
            "exact": "A sender MUST NOT transmit more than one outstanding request per session without receiving a response.",
            "prefix": "Flow control is fundamental to the FOO-BAR protocol design.  ",
            "suffix": "  This restriction ensures\n   that session state remains consistent at both endpoints.",
            "refinedBy": {"type": "FragmentSelector", "value": "section-3.3"},
        },
    ),
    (
        "bob",
        URL_FOO_BAR_02,
        "Version field hardcoded to 0x02 here, but Section 3.1 of the -01 "
        "draft implied the Version field would be negotiated.  Needs a note "
        "explaining that this field always carries the sending endpoint's "
        "implemented version, not the negotiated version.",
        "resolved",
        {
            "type": "TextQuoteSelector",
            "exact": "The Version field MUST be set to 0x02 for all messages conforming to this specification.",
            "prefix": "Version (1 octet), Type (1 octet), Length (2 octets).  ",
            "suffix": "  Messages\n   with unrecognized Version values MUST be silently discarded.",
            "refinedBy": {"type": "FragmentSelector", "value": "section-4.1"},
        },
    ),

    # ---- draft-ietf-test-protocol-00.txt -----------------------------------

    (
        "carol",
        URL_TEST_00,
        "The HELLO message also needs to carry a timestamp so the agent can "
        "detect clock skew between controller and agent, which affects timeout "
        "computations.  Suggest adding a Controller-Time field.",
        "open",
        {
            "type": "TextQuoteSelector",
            "exact": "The HELLO message serves as the initial handshake and MUST be the first message sent on a new connection.",
            "prefix": "Connection establishment proceeds as follows.  ",
            "suffix": "  The HELLO message contains the Protocol\n   Version, Capabilities, and Session Identifier fields.",
            "refinedBy": {"type": "FragmentSelector", "value": "section-4.1"},
        },
    ),
    (
        "alice",
        URL_TEST_00,
        "The range 0x0100-0xFEFF is very large for a first-come first-served "
        "policy.  Consider splitting into Expert Review (lower half) and "
        "Specification Required (upper half) to avoid registry pollution.",
        "resolved",
        {
            "type": "TextQuoteSelector",
            "exact": "Error codes in the range 0x0000-0x00FF are reserved for use by this specification.",
            "prefix": "Implementations MUST NOT use error codes outside the registered\n   range.  ",
            "suffix": "  Vendor-specific error codes MUST be allocated\n   from the range 0xFF00-0xFFFF.",
            "refinedBy": {"type": "FragmentSelector", "value": "section-6.1"},
        },
    ),
]

# Reply annotations — (username, body_value, status)
# These reference top-level annotations by their index in _ANNOTATIONS.
# The _create_annotations function stores annotation IDs for reply wiring.
_REPLIES = [
    # Reply from bob to alice's first annotation (index 0) on draft-ietf-foo-bar-03
    {
        "parent_index": 0,
        "username": "bob",
        "body_value": (
            "I checked the errata for RFC 4086 and there is precedent for "
            "accepting padded nonces.  A SHOULD with a note about why 16 octets "
            "is preferred would be the best path."
        ),
        "status": "open",
    },
    # Reply from carol to that reply (demonstrating two-level threading)
    {
        "parent_reply_index": 0,  # index into _REPLIES — bob's reply above
        "username": "carol",
        "body_value": (
            "Agreed.  I'll draft replacement text for the next revision.  "
            "We should also update the IANA considerations to match."
        ),
        "status": "open",
    },
    # Reply from alice to carol's keepalive annotation (index 2) on draft-ietf-foo-bar-03
    {
        "parent_index": 2,
        "username": "alice",
        "body_value": (
            "Good point about satellite links.  The working group discussed "
            "this at IETF 119 and agreed the timer should be configurable.  "
            "Marking this resolved since the -04 draft addresses it."
        ),
        "status": "resolved",
    },
]


# ---------------------------------------------------------------------------
# Public interface
# ---------------------------------------------------------------------------

def seed_all(app=None) -> None:
    """
    Create seed users and annotations.  May be called with an active
    Flask app context, or standalone (in which case it creates its own).
    """
    from models import User, Annotation, db

    users = _create_users(db)
    annotation_ids = _create_annotations(db, users)
    reply_count = _create_replies(db, users, annotation_ids)
    total = len(_ANNOTATIONS) + reply_count
    print(f"  Seeded {len(users)} users, {len(_ANNOTATIONS)} annotations, and {reply_count} replies.")


def _hash(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def _create_users(db) -> dict[str, object]:
    from models import User

    users: dict[str, object] = {}
    for u in _USERS:
        user = User(username=u["username"], email=u["email"], password=_hash(u["password"]))
        db.session.add(user)
        users[u["username"]] = user

    db.session.flush()  # assign IDs before creating annotations
    return users


def _create_annotations(db, users: dict) -> list[str]:
    """Create top-level annotations. Returns list of annotation IDs in order."""
    from models import Annotation

    now = datetime.now(timezone.utc)
    annotation_ids: list[str] = []

    for username, target_url, body_value, status, selector, *_ in _ANNOTATIONS:
        user = users[username]
        ann_id = str(uuid.uuid4())
        ann = Annotation(
            id=ann_id,
            target_url=target_url,
            creator_id=user.id,
            body_value=body_value,
            motivation="commenting",
            status=status,
            created=now,
            modified=now,
            selector=json.dumps(selector),
            reply_to=None,
            reply_count=0,
        )
        db.session.add(ann)
        annotation_ids.append(ann_id)

    db.session.flush()
    return annotation_ids


def _create_replies(db, users: dict, annotation_ids: list[str]) -> int:
    """Create reply annotations. Returns the count of replies created."""
    from models import Annotation

    now = datetime.now(timezone.utc)
    reply_ids: list[str] = []
    count = 0

    for reply_def in _REPLIES:
        user = users[reply_def["username"]]
        reply_id = str(uuid.uuid4())

        # Determine parent: either a top-level annotation or an earlier reply
        if "parent_index" in reply_def:
            parent_id = annotation_ids[reply_def["parent_index"]]
        else:
            parent_id = reply_ids[reply_def["parent_reply_index"]]

        # Get the parent to copy target info and increment reply_count
        parent = db.session.get(Annotation, parent_id)

        reply = Annotation(
            id=reply_id,
            target_url=parent.target_url,
            creator_id=user.id,
            body_value=reply_def["body_value"],
            motivation="replying",
            status=reply_def["status"],
            created=now,
            modified=now,
            selector=parent.selector,
            reply_to=parent_id,
            reply_count=0,
        )
        db.session.add(reply)
        parent.reply_count = (parent.reply_count or 0) + 1

        reply_ids.append(reply_id)
        count += 1

    db.session.commit()
    return count


# ---------------------------------------------------------------------------
# Standalone entry point — reset and re-seed
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import os
    import sys

    # Add server/ to path so imports work
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

    from app import create_app
    from models import db, User, Annotation

    application = create_app()
    with application.app_context():
        print("Dropping all tables...")
        db.drop_all()
        print("Creating tables...")
        db.create_all()
        print("Seeding...")
        seed_all(application)
        print("Done.")
