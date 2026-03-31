# IETF Annotations Plugin

A VS Code extension for creating, viewing, and managing annotations on IETF Internet-Draft documents. Includes a Flask test server that acts as a stub IETF Datatracker.

Annotations follow the [W3C Web Annotation](https://www.w3.org/TR/annotation-model/) data model, anchored to draft text using TextQuoteSelector (exact text + prefix/suffix context).

## Components

| Component | Location | Technology |
|-----------|----------|------------|
| VS Code extension | `src/` | TypeScript, VS Code Extension API |
| Test server | `server/` | Python 3.14, Flask, SQLAlchemy, SQLite |

## Features

**Extension**
- Annotate selected text in `draft-*.txt` files with multiline input
- Light-green background highlighting on all annotated text spans
- Gutter icons indicating annotation status (open/resolved)
- Hover popup with annotation body, status toggle, reply, edit, and delete actions
- Unified thread panel — reply to any annotation while viewing the full conversation (parent + all replies) in a single side panel
- Inline edit and delete of your own annotations and replies directly within the thread panel
- Reply counts shown in hover tooltips, Explorer tree, and DraftForge sidebar
- **Offline mode** — store annotations in a local `.annotations.json` file with no server required (see [Offline Mode](#offline-mode))
- OAuth 2.0 authentication with PKCE via the VS Code Accounts icon — uses provider ID `"ietf"` (compatible with DraftForge)
- Tree view in Explorer grouped by status
- Annotations panel in the [DraftForge](https://github.com/ietf-tools/draftforge) sidebar listing annotations by quoted text
- View annotations across all versions of a draft

**Test server**
- Serves sample Internet-Draft `.txt` files at stable versioned URLs
- OAuth 2.0 Authorization Code flow with PKCE (auto-approve user-selection page for testing)
- REST API for annotation CRUD with OAuth bearer token authentication
- Threaded reply support with cascade deletes and denormalised reply counts
- Seeded with three test users, seven top-level annotations, and three replies across three drafts

## Getting Started

### Prerequisites

- [VS Code](https://code.visualstudio.com/) 1.85+
- [Node.js](https://nodejs.org/) 18+
- Python 3.11+

### Server setup

```bash
cd server
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

The server starts on `http://localhost:5001` and automatically creates the database with seed data on first run.

### Extension setup

```bash
npm install
npm run compile
```

Open the project folder in VS Code and press `F5` (or `Fn+F5`) to launch the Extension Development Host.

### Usage

1. Start the Flask server
2. Launch the Extension Development Host (`F5`)
3. Open one of the sample drafts from `server/drafts/` (e.g. `draft-ietf-foo-bar-03.txt`)
4. Sign in via the Accounts icon in the bottom-left of the VS Code sidebar — this opens a browser page where you select a test user (alice, bob, or carol)
5. Select text and right-click to **Add Annotation**, or use the Command Palette

## Offline Mode

When `ietfAnnotations.offlineMode` is enabled the extension works entirely without a server:

- Annotations are stored in a `.annotations.json` file in the same directory as the draft.
- The file is named after the draft with the version number stripped, so all versions of the same draft share one file. For example, both `draft-ietf-foo-bar-02.txt` and `draft-ietf-foo-bar-03.txt` store their annotations in `draft-ietf-foo-bar.annotations.json`.
- The author name is taken from the OS username (overridable via `ietfAnnotations.offlineUsername`).
- No sign-in is required. All annotation operations — create, edit, delete, reply, and status changes — work locally.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `ietfAnnotations.serverUrl` | `http://localhost:5001` | Base URL of the annotation server (online mode only) |
| `ietfAnnotations.offlineMode` | `false` | Store annotations locally; no server or sign-in required |
| `ietfAnnotations.offlineUsername` | *(OS username)* | Author name used in offline mode |

## Project Structure

```
src/
  extension.ts          Extension entry point and command registration
  types.ts              W3C Annotation TypeScript interfaces
  api.ts                HTTP client for the annotation server
  auth.ts               OAuth 2.0 + PKCE Authentication Provider (provider ID "ietf")
  annotations.ts        Annotation CRUD coordinator (create, edit, delete, reply)
  offlineStore.ts       Local JSON file storage for offline mode
  annotationInput.ts    Multiline input webview panel
  replyThreadPanel.ts   Unified annotation thread panel with inline edit/delete
  decorations.ts        Gutter icons and text highlighting
  hoverProvider.ts      Hover tooltip with actions
  treeView.ts           Explorer tree view (grouped by status)
  draftForgeTreeView.ts DraftForge sidebar annotations list

server/
  app.py                Flask application factory
  oauth.py              OAuth 2.0 endpoints (authorize, token, userinfo)
  auth.py               require_auth decorator and legacy endpoint stubs
  models.py             SQLAlchemy models (User, Annotation)
  seed.py               Seed data (users and sample annotations)
  annotations.py        Annotation CRUD API
  documents.py          Draft document serving
  drafts/               Sample Internet-Draft text files
  requirements.txt      Python dependencies
```

## Specifications

- [`plugin-spec.md`](plugin-spec.md) — full specification for the VS Code extension
- [`server-spec.md`](server-spec.md) — full specification for the Flask server
- [`reply-spec.md`](reply-spec.md) — specification for threaded reply support (extends both specs above)

## License

BSD 3-Clause License. See [LICENSE](LICENSE).
