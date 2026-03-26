# IETF Annotation System

Two-component system for annotating Internet-Draft documents using the W3C Web Annotation data model.

## Components

- **`./server/`** — Flask test server acting as a stub IETF Datatracker. See `server-spec.md`.
- **`./src/`** — VS Code extension for creating and viewing annotations. See `plugin-spec.md`.

## Key Facts

- Server runs on `http://localhost:5000`
- Plugin connects to the server at that URL by default
- W3C Web Annotation data model used throughout (`http://www.w3.org/ns/anno.jsonld`)
- SQLite for storage (`server/annotations.db`) — no external database required
- Annotations are anchored using TextQuoteSelector (exact text + prefix/suffix context)
- Annotations have a `status` field extending the W3C spec: `open` or `resolved`
- Authentication uses Bearer tokens; GET endpoints are public

## Seed Credentials (test server)

| Username | Password  |
|----------|-----------|
| alice    | alice123  |
| bob      | bob123    |
| carol    | carol123  |

## Specifications

- `server-spec.md` — full specification for the Flask server
- `plugin-spec.md` — full specification for the VS Code plugin
