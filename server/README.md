# IETF Annotation Test Server

A standalone Flask server acting as a stub IETF Datatracker for testing the Annotations Plugin.
It serves Internet-Draft documents and implements a REST API conforming to the
[W3C Web Annotation](https://www.w3.org/TR/annotation-model/) data model.

## Prerequisites

- Python 3.11 or later

## Installation

```bash
cd server
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## Running

```bash
python app.py
```

The server starts on `http://localhost:5000`.  On first run it automatically creates
the SQLite database (`annotations.db`) and populates it with seed users, draft documents,
and sample annotations.

Optional flags:

```bash
python app.py --host 0.0.0.0 --port 8080 --debug
```

## Resetting the Database

To wipe all data and re-seed from scratch:

```bash
python seed.py
```

## Seed Credentials

| Username | Password  |
|----------|-----------|
| alice    | alice123  |
| bob      | bob123    |
| carol    | carol123  |

## API Quick Reference

### Authentication

```bash
# Register a new user
curl -s -X POST http://localhost:5000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"dave","email":"dave@example.com","password":"dave123"}' | jq

# Log in and save the token
TOKEN=$(curl -s -X POST http://localhost:5000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"alice123"}' | jq -r .token)
echo "Token: $TOKEN"

# Log out
curl -s -X POST http://localhost:5000/api/auth/logout \
  -H "Authorization: Bearer $TOKEN"
```

### Annotations

```bash
# List all available drafts
curl -s http://localhost:5000/api/drafts/ | jq

# Fetch seed annotations for a specific document
curl -s "http://localhost:5000/api/annotations/?target=http://localhost:5000/archive/id/draft-ietf-foo-bar-03.txt" | jq

# Filter by draft name (matches all versions)
curl -s "http://localhost:5000/api/annotations/?draft=draft-ietf-foo-bar" | jq

# Create an annotation (requires auth)
curl -s -X POST http://localhost:5000/api/annotations/ \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "motivation": "commenting",
    "body": {
      "type": "TextualBody",
      "value": "This section needs a worked example.",
      "format": "text/plain"
    },
    "target": {
      "source": "http://localhost:5000/archive/id/draft-ietf-foo-bar-03.txt",
      "selector": {
        "type": "TextQuoteSelector",
        "exact": "FOO-BAR operates as a symmetric protocol",
        "prefix": "",
        "suffix": ": once a session is"
      }
    }
  }' | jq

# Change annotation status (any authenticated user)
ANNOTATION_ID="<paste-id-here>"
curl -s -X PATCH "http://localhost:5000/api/annotations/$ANNOTATION_ID/status" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"status":"resolved"}' | jq
```

### Draft Documents

```bash
# Serve a draft file
curl -s http://localhost:5000/archive/id/draft-ietf-foo-bar-03.txt
```

## Project Layout

```
server/
  app.py          Flask application factory and entry point
  models.py       SQLAlchemy models (User, Token, Annotation)
  auth.py         Authentication blueprint (/api/auth/*)
  annotations.py  Annotations blueprint (/api/annotations/*)
  documents.py    Document serving blueprint (/archive/*, /api/drafts/)
  seed.py         Seed data — run directly to reset the database
  drafts/         Plain-text Internet-Draft files
  annotations.db  SQLite database (auto-created; do not commit)
  requirements.txt
```
