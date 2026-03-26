# Specification: Reply Support for IETF Annotation System

## Overview

This specification extends both the Flask test server and the VS Code plugin to support threaded annotation replies, using a pragmatic `replyTo` extension field alongside the W3C Web Annotation data model. It should be read alongside `server-spec.md` and `plugin-spec.md`, which define the base system. Only additions and changes are described here.

---

## Data Model Changes

### Annotation (server)

Add one new column to the annotation table:

```
reply_to    string (UUID), nullable, foreign key → Annotation.id, indexed
```

A null value means the annotation is a top-level annotation. A non-null value means it is a reply to the referenced annotation. Replies can themselves be replied to — there is no enforced depth limit, but the client should display no more than three levels of nesting in the UI.

### Wire Format Extension

All annotation objects gain two new fields:

```json
{
  "@context": "http://www.w3.org/ns/anno.jsonld",
  "id": "http://localhost:5000/api/annotations/uuid-here",
  "type": "Annotation",
  "motivation": "replying",
  "replyTo": "http://localhost:5000/api/annotations/parent-uuid",
  "replyCount": 2,
  "..."
}
```

**`replyTo`** — the full URI of the annotation being replied to. Present on reply annotations, omitted (not null, omitted entirely) on top-level annotations. The value is the full `id` URI of the parent annotation, not just the UUID, consistent with W3C Linked Data conventions.

**`replyCount`** — integer count of direct replies to this annotation. Present on all annotations, value 0 for annotations with no replies. This is a denormalised convenience field so clients can show reply counts without a separate query.

**`motivation`** — for reply annotations, this must be set to `"replying"` in accordance with the W3C Web Annotation Vocabulary. For top-level annotations it remains `"commenting"` (or any other valid motivation). The server must enforce this: if `replyTo` is present, `motivation` must be `"replying"`; if `replyTo` is absent, `motivation` must not be `"replying"`.

---

## Server Changes

### New Endpoint

#### GET /api/annotations/{id}/replies

Fetch all direct replies to an annotation. Public endpoint.

Query parameters:

| Parameter  | Type    | Description |
|------------|---------|-------------|
| `page`     | integer | Page number, default 1 |
| `per_page` | integer | Results per page, default 20, max 100 |

Response 200:
```json
{
  "total": 3,
  "page": 1,
  "per_page": 20,
  "annotations": []
}
```

Response 404 if the parent annotation does not exist.

This endpoint returns only direct replies (one level), not the full reply tree. Clients that want deeper threads call this endpoint recursively.

### Changes to Existing Endpoints

#### POST /api/annotations/

The request body may now include a `replyTo` field containing the full URI or bare UUID of the parent annotation.

If `replyTo` is present:
- Validate that the referenced annotation exists; return 404 with message `"Parent annotation not found"` if not
- Set `motivation` to `"replying"` automatically, ignoring any `motivation` value in the request body
- Increment the `replyCount` of the parent annotation atomically

If `replyTo` is absent:
- Reject any request body that includes `"motivation": "replying"` with a 400 response and the message `"motivation 'replying' requires a replyTo field"`

#### DELETE /api/annotations/{id}

When a top-level annotation is deleted:
- All replies to that annotation must also be deleted (cascade)
- All replies to those replies must also be deleted (recursive cascade)

When a reply annotation is deleted:
- Decrement the `replyCount` of the parent annotation atomically
- Any replies to the deleted reply are also deleted (cascade), and their parent's `replyCount` is decremented accordingly

#### GET /api/annotations/

Add two new query parameters:

| Parameter        | Type    | Description |
|-----------------|---------|-------------|
| `replyTo`        | string  | Filter by parent annotation UUID or full URI. Returns only direct replies to that annotation. |
| `includeReplies` | boolean | If `true`, include reply annotations in results alongside top-level annotations when querying by `target` or `draft`. Default `false`. |

When querying by `target` or `draft`, top-level annotations are returned by default (i.e. `includeReplies` defaults to `false`). This is intentional — callers fetching annotations for a document generally want top-level annotations and load replies on demand.

### Seed Data Changes

Add at least three reply annotations to the existing seed data, distributed as follows:
- At least one reply to an existing seed annotation, from a different user than the original annotation's creator
- At least one reply to that reply (demonstrating two-level threading)
- At least one top-level annotation that therefore has a non-zero `replyCount` after seeding

---

## Plugin Changes

### Types (types.ts)

Extend `W3CAnnotation` with two new fields:

```typescript
export interface W3CAnnotation {
  // ... all existing fields unchanged ...
  replyTo?: string;    // Full URI of parent annotation. Present only on replies, omitted on top-level annotations.
  replyCount: number;  // Count of direct replies. Always present, 0 if no replies.
}
```

Extend `CreateAnnotationRequest` with one new field:

```typescript
export interface CreateAnnotationRequest {
  // ... all existing fields unchanged ...
  replyTo?: string;    // Full URI of parent annotation if this is a reply. Omit for top-level annotations.
}
```

### API Client (api.ts)

Add one new method to `AnnotationApiClient`:

```typescript
getReplies(
  annotationId: string,
  params?: { page?: number; per_page?: number }
): Promise<AnnotationListResponse>
```

The `annotationId` parameter accepts either a bare UUID or a full URI — the method should normalise to the UUID before constructing the URL by stripping the server base URL prefix if present.

### Gutter Decorations

No change to the decoration icons or colours. However, the hover card action line for any annotation with `replyCount > 0` must include the reply count. For example, an open annotation by alice with 2 replies would render as:

```
**alice** · Open · Resolve · 2 replies · Reply · Edit · Delete
```

The "N replies" text is a clickable link that opens a **Reply Thread** panel (see Hover Card Changes below).

### Hover Card Changes

The current hover card layout is: annotation body text, a horizontal rule, then an action line showing `**author** · Status · StatusToggle · Edit · Delete`. This specification adds reply-related elements to that layout.

#### Reply count in the action line

For annotations with `replyCount > 0`, add a **"N replies"** link in the action line after the status toggle. Clicking this link opens a **Reply Thread** webview panel beside the active editor (using `ViewColumn.Beside`, the same approach as the annotation input panel) showing:

1. The parent annotation body and author at the top
2. Each reply below, visually indented, showing: creator username, status badge, body text
3. Each rendered reply also shows its own reply count (if non-zero) and a **Reply** action link
4. A text input at the bottom for adding a new reply

Reply annotations rendered inside the hover card are not decorated with gutter icons themselves — they are only surfaced through the thread panel.

Note: VS Code hover tooltips are static markdown and do not support dynamic re-rendering on click. The "N replies" link therefore opens a separate panel rather than expanding inline within the hover.

#### Reply action in the action line

Show a **Reply** action link in the action line for all annotations (top-level and replies visible in the thread panel). Clicking **Reply**:

1. Opens the multiline annotation input panel (`showMultilineInput`) beside the active editor with the title "Reply" and placeholder "Enter your reply…"
2. If the user cancels or closes the panel, abort silently
3. POSTs a new annotation with `replyTo` set to the URI of the annotation being replied to
4. On success:
   - Show a brief status bar message: "Reply added"
5. Refresh gutter decorations so updated reply counts are visible

### Tree View Changes

Reply annotations are **not** shown as top-level items in the Tree View. The Tree View remains focused on top-level review comments only, keeping it uncluttered for the primary review workflow.

Top-level annotation leaf items gain a reply count suffix where applicable:

```
IETF Annotations
├── Open (3)
│   ├── alice: "This definition seems inconsistent..." [line 42] (2 replies)
│   ├── bob: "Should this be a MUST or a SHOULD?" [line 67]
│   └── alice: "Missing reference to RFC 9110" [line 103] (1 reply)
└── Resolved (1)
    └── carol: "Typo in section title" [line 12]
```

The reply count suffix is only shown when `replyCount > 0`.

### DraftForge Sidebar Changes

The "Annotations" section in the DraftForge sidebar lists annotations by their quoted text. Reply annotations are **not** shown in this list — it only displays top-level annotations, consistent with the Explorer tree view.

Top-level annotation items with `replyCount > 0` gain a reply count in their description (alongside the creator name), e.g. `carol · 2 replies`.

### New Command

| Command Palette Label | Command ID | When Available |
|---|---|---|
| IETF Annotations: Reply to Annotation | `ietfAnnotations.replyToAnnotation` | Cursor is on an annotated line and user is logged in |

This command behaves identically to clicking the **Reply** link in the hover card: it opens the multiline annotation input panel beside the active editor. If multiple top-level annotations exist on the current line, a QuickPick is shown first to select which annotation to reply to (showing creator username and a truncated body excerpt as labels).

This command must be registered in `package.json` `contributes.commands` in the same manner as the existing commands.

### Error Handling Additions

| Situation | Behaviour |
|---|---|
| `replyTo` target annotation not found (404 on POST) | Show error notification: "The annotation you are replying to no longer exists" |
| Attempting to reply when not logged in | Trigger the standard authentication flow before proceeding |
| Reply depth exceeds 3 levels in the UI | Do not show the **Reply** action link on annotations at depth 3 or deeper. No server-side depth limit is enforced in this version. |

---

## Consistency Rules

The following invariants must be maintained by the server at all times:

- `replyCount` on a parent annotation must equal the number of annotation records with `reply_to` set to that annotation's ID. It is authoritative — clients must not compute or cache their own counts.
- The `status` field applies to reply annotations independently of their parent. A reply can be `resolved` while its parent annotation remains `open`.
- `PATCH /api/annotations/{id}/status` works identically for replies as for top-level annotations — any authenticated user may change the status of any annotation.
- Only the creator of a reply may delete it (same rule as top-level annotations).
- Deleting a reply that itself has replies must recursively cascade the deletion and correctly decrement `replyCount` at each affected level.

---

## Suggested Build Order for Claude Code

1. Add `reply_to` column to the SQLAlchemy model and verify the migration runs cleanly
2. Update the annotation serialiser to include `replyTo` and `replyCount` in all wire format responses
3. Update `POST /api/annotations/` to accept and validate `replyTo`, enforce the `motivation` rule, and atomically increment `replyCount`
4. Add `GET /api/annotations/{id}/replies` endpoint
5. Update `DELETE /api/annotations/{id}` to cascade correctly and decrement `replyCount`
6. Update `GET /api/annotations/` to support `replyTo` and `includeReplies` query parameters
7. Add reply seed data and verify seed counts are consistent
8. Update `types.ts` with the new fields
9. Update `api.ts` with the `getReplies` method
10. Update the hover card action line to show reply counts and the Reply action link
11. Create the Reply Thread webview panel (opened from the "N replies" hover link)
12. Update the Explorer Tree View to show reply count suffixes on leaf items
13. Update the DraftForge sidebar to exclude replies and show reply counts in descriptions
14. Add and register the `replyToAnnotation` command
15. Verify the full flow end-to-end: create annotation → reply → reply to reply → delete middle reply → check counts
