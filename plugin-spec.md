# IETF Annotation VS Code Plugin — Specification

## Overview

A VS Code extension that allows users to create, view, and manage annotations on Internet-Draft documents. It communicates with the IETF annotation test server defined in `server-spec.md`. The extension is written in TypeScript and targets VS Code 1.85+.

## Technology Stack

- TypeScript 5.x
- VS Code Extension API
- Native `fetch` (Node 18+) for HTTP requests
- No bundler required for initial version

## Core Concepts

The extension activates when a file matching the pattern `draft-*.txt` is opened in the editor, or when the user explicitly invokes an annotation command. The server base URL and authentication token are stored in VS Code configuration and SecretStorage respectively.

The extension derives the canonical target URL for an open document from its filename: if the open file is named `draft-ietf-foo-bar-03.txt`, the target URL is `{serverUrl}/archive/id/draft-ietf-foo-bar-03.txt`. This means the workflow is: fetch a draft file from the server, open it locally, and annotate it — the URL round-trips correctly.

## Configuration

The following settings are contributed by the extension under the `ietfAnnotations` namespace:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `ietfAnnotations.serverUrl` | string | `http://localhost:5000` | Base URL of the annotation server |
| `ietfAnnotations.username` | string | `""` | Logged-in username (set automatically on login) |

The Bearer token is stored using VS Code's `SecretStorage` API (key: `ietfAnnotations.token`) and must never be written to plain settings.

## Authentication Flow

When the user invokes any write operation and no valid token is stored, the extension must:

1. Show an input box prompting for username
2. Show a password input box (password: true)
3. POST credentials to `POST /api/auth/login`
4. On success, store the token in `SecretStorage` and the username in settings
5. Proceed with the original operation that triggered the flow

A **Login** and **Logout** command must also be available explicitly in the command palette at all times.

On logout, the token is deleted from `SecretStorage`, the username setting is cleared, and all gutter decorations are refreshed (status-change actions will no longer be available without re-authenticating).

## TypeScript Interfaces

Define the following interfaces in `src/types.ts` and use them throughout the codebase.

```typescript
export type AnnotationStatus = "open" | "closed" | "resolved";

export interface TextQuoteSelector {
  type: "TextQuoteSelector";
  exact: string;
  prefix: string;
  suffix: string;
  refinedBy?: FragmentSelector;
}

export interface FragmentSelector {
  type: "FragmentSelector";
  value: string;
}

export interface W3CAnnotation {
  "@context": string;
  id: string;
  type: "Annotation";
  motivation: string;
  status: AnnotationStatus;
  creator: {
    id: string;
    type: "Person";
    name: string;
  };
  created: string;
  modified: string;
  body: {
    type: "TextualBody";
    value: string;
    format: string;
  };
  target: {
    source: string;
    selector: TextQuoteSelector;
  };
}

export interface AnnotationListResponse {
  total: number;
  page: number;
  per_page: number;
  annotations: W3CAnnotation[];
}

export interface CreateAnnotationRequest {
  motivation: string;
  body: {
    type: "TextualBody";
    value: string;
    format: string;
  };
  target: {
    source: string;
    selector: TextQuoteSelector;
  };
}
```

## API Client

Implement all server communication in `src/api.ts` as a class `AnnotationApiClient`. It must:

- Accept `serverUrl` and a token provider function in its constructor
- Include the Bearer token in the `Authorization` header on all write requests
- Set a 10 second timeout on all requests
- Throw typed errors distinguishing 401, 403, 404, and network failures
- Expose the following methods matching the server API:

```typescript
login(username: string, password: string): Promise<{ token: string; expires: string }>
logout(): Promise<void>
getAnnotations(params: { target?: string; draft?: string; status?: string; creator?: string }): Promise<AnnotationListResponse>
getAnnotation(id: string): Promise<W3CAnnotation>
createAnnotation(annotation: CreateAnnotationRequest): Promise<W3CAnnotation>
updateAnnotation(id: string, annotation: CreateAnnotationRequest): Promise<W3CAnnotation>
updateStatus(id: string, status: AnnotationStatus): Promise<W3CAnnotation>
deleteAnnotation(id: string): Promise<void>
listDrafts(): Promise<Array<{ filename: string; name: string; version: string; url: string }>>
```

## Features

### 1. Gutter Decorations

When an annotated I-D document is open, fetch all annotations for that document's target URL and display gutter icons on the lines where annotated text begins.

To determine which line an annotation appears on, search the document text for the `exact` string from the annotation's TextQuoteSelector, disambiguating using `prefix` and `suffix` if the exact string appears more than once. Use the line number of the first character of the match.

Decoration appearance by status:

| Status | Gutter icon | Overview ruler colour |
|--------|-------------|----------------------|
| open | Yellow circle (`icons/annotation-open.svg`) | `#f0c040` |
| resolved | Green circle (`icons/annotation-resolved.svg`) | `#40c040` |
| closed | Grey circle (`icons/annotation-closed.svg`) | `#808080` |

Decorations refresh:
- When a draft file is opened
- When the document is saved
- After any annotation create, update, status change, or delete operation
- When the user runs **Refresh Annotations**

### 2. Hover Cards

Hovering over a gutter decoration (or over decorated text) shows a hover card containing:

- The annotated text in a blockquote
- The annotation body text
- Creator username and creation timestamp
- Current status with colour coding matching the decoration colours
- A **Change Status** action link that invokes the Change Status command for that annotation
- A **Delete** action link (only shown if the logged-in user is the annotation's creator)

If multiple annotations exist on the same line, show all of them in the hover card separated by horizontal rules.

### 3. Creating an Annotation

**Command:** `IETF Annotations: Add Annotation`

Available when text is selected in a draft file. Accessible from:
- The command palette
- The editor right-click context menu (shown only when text is selected)

Flow:
1. Capture the selected text as `exact`
2. Capture up to 32 characters before the selection start as `prefix`
3. Capture up to 32 characters after the selection end as `suffix`
4. Prompt for annotation body text via `vscode.window.showInputBox` with placeholder "Enter your annotation..."
5. If the user cancels the input box, abort silently
6. POST to `/api/annotations/` — trigger auth flow if not logged in
7. On success, show a brief status bar message "Annotation created" and refresh decorations
8. On failure, show an error notification

### 4. Changing Annotation Status

**Command:** `IETF Annotations: Change Status`

Available when the cursor is on a line with an annotation. Accessible from:
- The command palette
- The hover card inline action link

Flow:
1. If multiple annotations are on the current line, present a QuickPick to select which annotation to update (show creator and body excerpt as labels)
2. Present a QuickPick with three options: `Open`, `Closed`, `Resolved`
3. PATCH `/api/annotations/{id}/status`
4. Refresh decorations on success

### 5. Deleting an Annotation

**Command:** `IETF Annotations: Delete Annotation`

Available when the cursor is on a line containing an annotation created by the currently logged-in user.

Flow:
1. If multiple annotations are on the current line, present a QuickPick to select which to delete
2. Show a confirmation dialog: "Delete this annotation? This cannot be undone." with Confirm / Cancel buttons
3. On confirmation, DELETE `/api/annotations/{id}`
4. Refresh decorations on success

### 6. Annotations Tree View Panel

A VS Code TreeView in the Explorer sidebar with the title **IETF Annotations**.

When a draft file is open, the panel shows all annotations for that document grouped by status:

```
IETF Annotations
├── Open (3)
│   ├── alice: "This definition seems inconsistent..." [line 42]
│   ├── bob: "Should this be a MUST or a SHOULD?" [line 67]
│   └── alice: "Missing reference to RFC 9110" [line 103]
├── Resolved (1)
│   └── carol: "Typo in section title" [line 12]
└── Closed (0)
```

Each leaf item shows: `{creator}: "{body truncated to 50 chars}" [line {n}]`

Clicking a leaf item navigates the editor to the annotated line and reveals the line in the centre of the viewport.

The panel includes a refresh button in its title bar.

When no draft file is open, the panel shows the message "Open a draft-*.txt file to see annotations."

### 7. Show Annotations Across All Versions

**Command:** `IETF Annotations: Show All Versions`

Available when a draft file is open.

Derives the draft name from the open filename by stripping the version suffix and extension (e.g. `draft-ietf-foo-bar-03.txt` → `draft-ietf-foo-bar`) and fetches annotations using the `?draft=` query parameter.

Displays results in the Tree View panel, adding a top-level grouping by document version above the status grouping:

```
IETF Annotations (all versions)
├── draft-ietf-foo-bar-03 (current)
│   ├── Open (2)
│   └── Resolved (1)
└── draft-ietf-foo-bar-02
    └── Closed (3)
```

## Commands Summary

| Command Palette Label | Command ID | When Available |
|---|---|---|
| IETF Annotations: Login | `ietfAnnotations.login` | Always |
| IETF Annotations: Logout | `ietfAnnotations.logout` | Always |
| IETF Annotations: Add Annotation | `ietfAnnotations.addAnnotation` | Text selected in a draft file |
| IETF Annotations: Change Status | `ietfAnnotations.changeStatus` | Cursor on annotated line in a draft file |
| IETF Annotations: Delete Annotation | `ietfAnnotations.deleteAnnotation` | Cursor on annotation by current user |
| IETF Annotations: Refresh Annotations | `ietfAnnotations.refresh` | Draft file is open |
| IETF Annotations: Show All Versions | `ietfAnnotations.showAllVersions` | Draft file is open |

## Error Handling

| Situation | Behaviour |
|---|---|
| 401 response | Trigger authentication flow, then retry the original request once |
| 403 response | Show error notification: "You do not have permission to perform this action" |
| 404 response | Show error notification: "Annotation not found" |
| Network error / timeout | Show error notification with a **Retry** action button |
| Server returns unexpected format | Log to the Output channel and show a generic error notification |

All errors should be logged to a dedicated Output channel named **IETF Annotations**.

## Project Structure

```
plugin/
  src/
    extension.ts        -- Extension activation, command registration, lifecycle
    auth.ts             -- Login/logout, token storage via SecretStorage
    api.ts              -- AnnotationApiClient class
    annotations.ts      -- Annotation operations (create, update, delete, fetch)
    decorations.ts      -- Gutter decoration management and text matching
    hoverProvider.ts    -- Hover card implementation
    treeView.ts         -- Sidebar TreeView data provider
    types.ts            -- TypeScript interfaces
  icons/
    annotation-open.svg
    annotation-resolved.svg
    annotation-closed.svg
  package.json          -- Extension manifest with contributes section
  tsconfig.json
  README.md
```

## package.json Requirements

The `contributes` section of `package.json` must register:

- All seven commands listed above
- The `ietfAnnotations.serverUrl` and `ietfAnnotations.username` configuration settings
- The TreeView container in the Explorer sidebar
- The context menu entry for **Add Annotation** on text selection in the editor
- Activation events for `onLanguage` matching `.txt` files and `onCommand` for all registered commands

## SVG Icons

Create three simple SVG circle icons (16x16) for the gutter decorations:

- `annotation-open.svg` — filled yellow circle (`#f0c040`)
- `annotation-resolved.svg` — filled green circle (`#40c040`)
- `annotation-closed.svg` — filled grey circle (`#808080`)

## README Requirements

The README must include:

- Prerequisites (Node.js version, VS Code version)
- How to install dependencies (`npm install`)
- How to compile TypeScript (`npm run compile`)
- How to launch the extension in VS Code's Extension Development Host (press `F5`)
- How to configure the server URL in VS Code settings
- How to log in using the command palette
- A step-by-step walkthrough: open a seed draft file, view existing annotations, create a new annotation, change its status, and view the tree panel
- A note that the test server (from `server-spec.md`) must be running on `http://localhost:5000`
