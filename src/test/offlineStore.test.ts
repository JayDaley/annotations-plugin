import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { OfflineStore, annotationsFilePath } from "../offlineStore";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a temporary directory that is cleaned up after the suite. */
function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ietf-annotations-test-"));
}

/** Build a file:// URI for a path (cross-platform). */
function fileUri(fsPath: string): string {
  // vscode.Uri is not available in pure Node tests, so construct manually.
  return "file://" + fsPath.replace(/\\/g, "/");
}

// ── annotationsFilePath ────────────────────────────────────────────────────────

suite("annotationsFilePath", () => {
  test("strips version number and extension from file URI", () => {
    const result = annotationsFilePath(
      "file:///home/user/draft-ietf-foo-bar-03.txt",
    );
    assert.ok(result.endsWith("draft-ietf-foo-bar.annotations.json"));
  });

  test("handles two-digit version 00", () => {
    const result = annotationsFilePath(
      "file:///home/user/draft-ietf-foo-bar-00.txt",
    );
    assert.ok(result.endsWith("draft-ietf-foo-bar.annotations.json"));
  });

  test("preserves directory", () => {
    const result = annotationsFilePath(
      "file:///docs/wg/draft-ietf-quic-tls-42.txt",
    );
    assert.ok(result.startsWith("/docs/wg/"));
  });

  test("works with raw filesystem path (no file://)", () => {
    const result = annotationsFilePath(
      "/home/user/draft-ietf-foo-bar-03.txt",
    );
    assert.ok(result.endsWith("draft-ietf-foo-bar.annotations.json"));
  });
});

// ── OfflineStore ─────────────────────────────────────────────────────────────

suite("OfflineStore", () => {
  let tmpDir: string;
  let store: OfflineStore;
  let source: string;          // file:// URI of a versioned draft
  let altSource: string;       // same draft, different version

  setup(() => {
    tmpDir = makeTmpDir();
    store = new OfflineStore();
    source = fileUri(path.join(tmpDir, "draft-ietf-foo-bar-00.txt"));
    altSource = fileUri(path.join(tmpDir, "draft-ietf-foo-bar-01.txt"));
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("getAnnotations returns empty array when no file exists", () => {
    const result = store.getAnnotations(source);
    assert.deepStrictEqual(result, []);
  });

  test("createAnnotation persists and returns the new annotation", () => {
    const ann = store.createAnnotation(
      {
        motivation: "commenting",
        body: { type: "TextualBody", value: "hello", format: "text/plain" },
        target: {
          source,
          selector: { type: "TextQuoteSelector", exact: "some text", prefix: "", suffix: "" },
        },
      },
      "alice",
    );

    assert.strictEqual(ann.creator.name, "alice");
    assert.strictEqual(ann.body.value, "hello");
    assert.strictEqual(ann.status, "open");
    assert.ok(typeof ann.id === "string" && ann.id.length > 0);
  });

  test("getAnnotations only returns top-level annotations (not replies)", () => {
    const parent = store.createAnnotation(
      {
        motivation: "commenting",
        body: { type: "TextualBody", value: "parent", format: "text/plain" },
        target: {
          source,
          selector: { type: "TextQuoteSelector", exact: "text", prefix: "", suffix: "" },
        },
      },
      "alice",
    );

    store.createAnnotation(
      {
        motivation: "replying",
        body: { type: "TextualBody", value: "reply", format: "text/plain" },
        target: {
          source,
          selector: { type: "TextQuoteSelector", exact: "text", prefix: "", suffix: "" },
        },
        replyTo: parent.id,
      },
      "bob",
    );

    const top = store.getAnnotations(source);
    assert.strictEqual(top.length, 1);
    assert.strictEqual(top[0].id, parent.id);
  });

  test("createAnnotation reply increments parent replyCount", () => {
    const parent = store.createAnnotation(
      {
        motivation: "commenting",
        body: { type: "TextualBody", value: "parent", format: "text/plain" },
        target: {
          source,
          selector: { type: "TextQuoteSelector", exact: "text", prefix: "", suffix: "" },
        },
      },
      "alice",
    );

    store.createAnnotation(
      {
        motivation: "replying",
        body: { type: "TextualBody", value: "reply", format: "text/plain" },
        target: {
          source,
          selector: { type: "TextQuoteSelector", exact: "text", prefix: "", suffix: "" },
        },
        replyTo: parent.id,
      },
      "bob",
    );

    const updated = store.getAnnotation(parent.id, source);
    assert.strictEqual(updated?.replyCount, 1);
  });

  test("getAnnotation returns the correct annotation", () => {
    const ann = store.createAnnotation(
      {
        motivation: "commenting",
        body: { type: "TextualBody", value: "body", format: "text/plain" },
        target: {
          source,
          selector: { type: "TextQuoteSelector", exact: "x", prefix: "", suffix: "" },
        },
      },
      "alice",
    );

    const found = store.getAnnotation(ann.id, source);
    assert.strictEqual(found?.id, ann.id);
  });

  test("getAnnotation returns undefined for unknown ID", () => {
    assert.strictEqual(store.getAnnotation("no-such-id", source), undefined);
  });

  test("getReplies returns only replies for the given parent", () => {
    const parent = store.createAnnotation(
      {
        motivation: "commenting",
        body: { type: "TextualBody", value: "p", format: "text/plain" },
        target: { source, selector: { type: "TextQuoteSelector", exact: "x", prefix: "", suffix: "" } },
      },
      "alice",
    );
    const other = store.createAnnotation(
      {
        motivation: "commenting",
        body: { type: "TextualBody", value: "o", format: "text/plain" },
        target: { source, selector: { type: "TextQuoteSelector", exact: "y", prefix: "", suffix: "" } },
      },
      "bob",
    );

    store.createAnnotation(
      {
        motivation: "replying",
        body: { type: "TextualBody", value: "r1", format: "text/plain" },
        target: { source, selector: { type: "TextQuoteSelector", exact: "x", prefix: "", suffix: "" } },
        replyTo: parent.id,
      },
      "carol",
    );
    store.createAnnotation(
      {
        motivation: "replying",
        body: { type: "TextualBody", value: "r2", format: "text/plain" },
        target: { source, selector: { type: "TextQuoteSelector", exact: "y", prefix: "", suffix: "" } },
        replyTo: other.id,
      },
      "carol",
    );

    const replies = store.getReplies(parent.id, source);
    assert.strictEqual(replies.annotations.length, 1);
    assert.strictEqual(replies.annotations[0].body.value, "r1");
  });

  test("updateAnnotation changes the body text", () => {
    const ann = store.createAnnotation(
      {
        motivation: "commenting",
        body: { type: "TextualBody", value: "original", format: "text/plain" },
        target: { source, selector: { type: "TextQuoteSelector", exact: "x", prefix: "", suffix: "" } },
      },
      "alice",
    );

    const updated = store.updateAnnotation(ann.id, "revised", source);
    assert.strictEqual(updated?.body.value, "revised");

    const persisted = store.getAnnotation(ann.id, source);
    assert.strictEqual(persisted?.body.value, "revised");
  });

  test("updateAnnotation returns undefined for unknown ID", () => {
    assert.strictEqual(store.updateAnnotation("bad-id", "text", source), undefined);
  });

  test("updateStatus changes the annotation status", () => {
    const ann = store.createAnnotation(
      {
        motivation: "commenting",
        body: { type: "TextualBody", value: "body", format: "text/plain" },
        target: { source, selector: { type: "TextQuoteSelector", exact: "x", prefix: "", suffix: "" } },
      },
      "alice",
    );

    const updated = store.updateStatus(ann.id, "resolved", source);
    assert.strictEqual(updated?.status, "resolved");

    const persisted = store.getAnnotation(ann.id, source);
    assert.strictEqual(persisted?.status, "resolved");
  });

  test("deleteAnnotation removes the annotation and returns true", () => {
    const ann = store.createAnnotation(
      {
        motivation: "commenting",
        body: { type: "TextualBody", value: "body", format: "text/plain" },
        target: { source, selector: { type: "TextQuoteSelector", exact: "x", prefix: "", suffix: "" } },
      },
      "alice",
    );

    const deleted = store.deleteAnnotation(ann.id, source);
    assert.ok(deleted);
    assert.strictEqual(store.getAnnotation(ann.id, source), undefined);
  });

  test("deleteAnnotation returns false for unknown ID", () => {
    assert.strictEqual(store.deleteAnnotation("no-such-id", source), false);
  });

  test("deleting a reply decrements parent replyCount", () => {
    const parent = store.createAnnotation(
      {
        motivation: "commenting",
        body: { type: "TextualBody", value: "p", format: "text/plain" },
        target: { source, selector: { type: "TextQuoteSelector", exact: "x", prefix: "", suffix: "" } },
      },
      "alice",
    );
    const reply = store.createAnnotation(
      {
        motivation: "replying",
        body: { type: "TextualBody", value: "r", format: "text/plain" },
        target: { source, selector: { type: "TextQuoteSelector", exact: "x", prefix: "", suffix: "" } },
        replyTo: parent.id,
      },
      "bob",
    );

    store.deleteAnnotation(reply.id, source);

    const updatedParent = store.getAnnotation(parent.id, source);
    assert.strictEqual(updatedParent?.replyCount, 0);
  });

  test("deleting a parent also removes all its replies", () => {
    const parent = store.createAnnotation(
      {
        motivation: "commenting",
        body: { type: "TextualBody", value: "p", format: "text/plain" },
        target: { source, selector: { type: "TextQuoteSelector", exact: "x", prefix: "", suffix: "" } },
      },
      "alice",
    );
    const reply = store.createAnnotation(
      {
        motivation: "replying",
        body: { type: "TextualBody", value: "r", format: "text/plain" },
        target: { source, selector: { type: "TextQuoteSelector", exact: "x", prefix: "", suffix: "" } },
        replyTo: parent.id,
      },
      "bob",
    );

    store.deleteAnnotation(parent.id, source);

    assert.strictEqual(store.getAnnotation(parent.id, source), undefined);
    assert.strictEqual(store.getAnnotation(reply.id, source), undefined);
  });

  test("annotations from different draft versions share the same file", () => {
    // Create annotation via version -00 URI
    store.createAnnotation(
      {
        motivation: "commenting",
        body: { type: "TextualBody", value: "from v00", format: "text/plain" },
        target: { source, selector: { type: "TextQuoteSelector", exact: "x", prefix: "", suffix: "" } },
      },
      "alice",
    );

    // Read via version -01 URI — should see the same annotation
    const anns = store.getAnnotations(altSource);
    assert.strictEqual(anns.length, 1);
    assert.strictEqual(anns[0].body.value, "from v00");
  });
});
