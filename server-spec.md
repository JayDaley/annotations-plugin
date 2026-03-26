# IETF Annotation Test Server — Specification

## Overview

A standalone Python Flask server that acts as a stub IETF Datatracker for testing an annotation system. It serves Internet-Draft documents at stable versioned URLs and implements a REST annotation API using the W3C Web Annotation data model, extended with IETF-specific fields.

## Technology Stack

- Python 3.11+
- Flask 3.x
- SQLAlchemy 2.x with SQLite backend (single file: `annotations.db`)
- bcrypt for password hashing
- No external services or databases required

## Data Model

### User

```
id          integer, primary key
username    string, unique, not null
email       string, unique, not null
password    string (hashed, bcrypt), not null
created     datetime
```

### Annotation

Conforms to the W3C Web Annotation data model. Stored as a JSON blob in SQLite with indexed relational fields extracted for querying.

```
id          string (UUID), primary key
target_url  string, not null, indexed    -- canonical URL of the annotated I-D version
creator_id  integer, foreign key → User
body_value  string, not null             -- the annotation text
motivation  string, default "commenting"
status      string, enum("open","closed","resolved"), default "open"
created     datetime
modified    datetime
selector    JSON                         -- W3C selector object (see below)
```

### Selector Structure

The primary selector is TextQuoteSelector with an optional refinement. Stored as JSON in the selector column.

```json
{
  "type": "TextQuoteSelector",
  "exact": "the exact quoted text",
  "prefix": "text appearing before",
  "suffix": "text appearing after"
}
```

Optionally refined by a section reference:

```json
{
  "type": "TextQuoteSelector",
  "exact": "the exact quoted text",
  "prefix": "text appearing before",
  "suffix": "text appearing after",
  "refinedBy": {
    "type": "FragmentSelector",
    "value": "section-4.2"
  }
}
```

### Wire Format for Annotations

All annotation objects returned by the API must conform to this W3C Web Annotation JSON-LD structure:

```json
{
  "@context": "http://www.w3.org/ns/anno.jsonld",
  "id": "http://localhost:5000/api/annotations/uuid-here",
  "type": "Annotation",
  "motivation": "commenting",
  "status": "open",
  "creator": {
    "id": "http://localhost:5000/api/users/1",
    "type": "Person",
    "name": "alice"
  },
  "created": "2024-03-10T14:23:00Z",
  "modified": "2024-03-10T14:23:00Z",
  "body": {
    "type": "TextualBody",
    "value": "This definition seems inconsistent with Section 3.",
    "format": "text/plain"
  },
  "target": {
    "source": "http://localhost:5000/archive/id/draft-ietf-foo-bar-03.txt",
    "selector": {
      "type": "TextQuoteSelector",
      "exact": "the exact quoted text",
      "prefix": "text appearing before",
      "suffix": "text appearing after"
    }
  }
}
```

The `status` field is an extension beyond the W3C spec and must be included in every annotation object returned by the API.

## Authentication

Use HTTP Bearer token authentication. Tokens are generated at login and stored in the database.

### Token Table

```
token       string, primary key
user_id     integer, foreign key → User
created     datetime
expires     datetime (24 hours after creation)
```

All annotation write endpoints (POST, PUT, PATCH, DELETE) require a valid Bearer token in the `Authorization` header. GET endpoints are public (no auth required).

## API Endpoints

### Authentication

#### POST /api/auth/register

Create a new user account.

Request body:
```json
{ "username": "alice", "email": "alice@example.com", "password": "secret" }
```

Response 201:
```json
{ "id": 1, "username": "alice", "email": "alice@example.com" }
```

Response 400 if username or email already exists.

#### POST /api/auth/login

Authenticate and receive a Bearer token.

Request body:
```json
{ "username": "alice", "password": "secret" }
```

Response 200:
```json
{ "token": "abc123...", "expires": "2024-03-11T14:23:00Z" }
```

Response 401 if credentials are invalid.

#### POST /api/auth/logout

Invalidate the current token. Requires auth.

Response 204.

### Annotations

#### POST /api/annotations/

Create a new annotation. Requires auth. The `creator` field is taken from the authenticated user, not from the request body.

Request body: W3C annotation object without `id`, `creator`, `created`, or `modified` fields.

Response 201: Full annotation object.
Response 400 if required fields are missing or malformed.

#### GET /api/annotations/{id}

Retrieve a single annotation by ID.

Response 200: Full annotation object.
Response 404 if not found.

#### PUT /api/annotations/{id}

Replace an annotation. Requires auth. Only the creator of the annotation may update it.

Request body: W3C annotation object without `id`, `creator`, `created`, or `modified`.

Response 200: Updated annotation object.
Response 403 if the authenticated user is not the creator.
Response 404 if not found.

#### PATCH /api/annotations/{id}/status

Update only the status of an annotation. Requires auth. Any authenticated user may update status (not just the creator), to support collaborative review workflows.

Request body:
```json
{ "status": "resolved" }
```

Response 200: Updated full annotation object.
Response 400 if status value is not one of `open`, `closed`, or `resolved`.
Response 404 if not found.

#### DELETE /api/annotations/{id}

Delete an annotation. Requires auth. Only the creator may delete.

Response 204.
Response 403 if the authenticated user is not the creator.
Response 404 if not found.

#### GET /api/annotations/

Query annotations. Public endpoint.

Query parameters:

| Parameter  | Type    | Description |
|------------|---------|-------------|
| `target`   | string  | Filter by exact target URL. Required unless `draft` is provided. |
| `draft`    | string  | Filter by draft name across all versions, e.g. `draft-ietf-foo-bar` matches -00, -01, -02 etc. |
| `status`   | string  | Filter by status: `open`, `closed`, or `resolved`. |
| `creator`  | string  | Filter by username. |
| `page`     | integer | Page number, default 1. |
| `per_page` | integer | Results per page, default 20, max 100. |

Response 200:
```json
{
  "total": 42,
  "page": 1,
  "per_page": 20,
  "annotations": [ ]
}
```

### Document Serving

#### GET /archive/id/{filename}

Serve an I-D document file. Public. Files are served from the local `./drafts/` directory.

Example: `GET /archive/id/draft-ietf-foo-bar-03.txt`

Response 200 with `Content-Type: text/plain`.
Response 404 if the file is not found.

#### GET /api/drafts/

List all available draft documents. Public. Returns filename, draft name, version number, and canonical URL for each.

Response 200:
```json
[
  {
    "filename": "draft-ietf-foo-bar-03.txt",
    "name": "draft-ietf-foo-bar",
    "version": "03",
    "url": "http://localhost:5000/archive/id/draft-ietf-foo-bar-03.txt"
  }
]
```

## Seed Data

On first run (empty database), the server must create the following seed data automatically.

### Users

| Username | Email                  | Password  |
|----------|------------------------|-----------|
| alice    | alice@example.com      | alice123  |
| bob      | bob@example.com        | bob123    |
| carol    | carol@example.com      | carol123  |

### Draft Documents

Place three synthetic I-D text files in `./drafts/`:

- `draft-ietf-foo-bar-02.txt`
- `draft-ietf-foo-bar-03.txt`
- `draft-ietf-test-protocol-00.txt`

Each file must be a plausible-looking plain text Internet-Draft of at least 200 lines, with the standard I-D header format (title, docname, date, abstract, status of this memo, copyright notice) and at least five numbered sections containing substantive prose. The content should be detailed enough to make annotation examples meaningful — use realistic-sounding protocol design language.

### Sample Annotations

Create at least six annotations distributed across the seed documents, across all three users, and across all three status values. Include at least one case where two different users have annotated the same passage in the same document. Annotations should use realistic TextQuoteSelector values referencing actual text in the seed draft files.

## Project Structure

```
server/
  app.py              -- Flask application factory and entry point
  models.py           -- SQLAlchemy models (User, Token, Annotation)
  auth.py             -- Authentication blueprint (/api/auth/*)
  annotations.py      -- Annotations blueprint (/api/annotations/*)
  documents.py        -- Document serving blueprint (/archive/*, /api/drafts/)
  seed.py             -- Seed data creation, called on first run
  drafts/
    draft-ietf-foo-bar-02.txt
    draft-ietf-foo-bar-03.txt
    draft-ietf-test-protocol-00.txt
  annotations.db      -- SQLite database (created on first run, do not commit)
  requirements.txt
  README.md
```

## Running the Server

```bash
pip install -r requirements.txt
python app.py
```

The server runs on `http://localhost:5000`. On first run, seed data is created automatically if the database is empty. The server should print a startup message confirming the URL and whether seed data was created.

## README Requirements

The README must include:

- Prerequisites (Python version)
- Installation steps
- How to run the server
- How to reset the database and re-seed
- A table of the seed user credentials
- Example curl commands demonstrating login, creating an annotation, querying by target URL, and changing annotation status
