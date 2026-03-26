import * as assert from "assert";
import * as vscode from "vscode";
import { DecorationManager } from "../decorations";
import { AnnotationHoverProvider } from "../hoverProvider";
import { makeAnnotation } from "./helpers";
import { W3CAnnotation } from "../types";

/**
 * Create a DecorationManager and inject annotations at a given line without
 * needing to call the full `apply()` pipeline (which requires a real editor
 * with matching document text).
 */
function managerWithAnnotations(
  line: number,
  annotations: W3CAnnotation[],
): DecorationManager {
  // We only need the lineAnnotations map for hover tests, so we construct a
  // minimal manager with a dummy extensionUri and populate the map directly.
  const dummyUri = vscode.Uri.file("/tmp");
  const manager = new DecorationManager(dummyUri);
  manager.lineAnnotations.set(line, annotations);
  return manager;
}

suite("AnnotationHoverProvider", () => {
  test("returns undefined for lines with no annotations", async () => {
    const manager = new DecorationManager(vscode.Uri.file("/tmp"));
    const provider = new AnnotationHoverProvider(manager);

    const doc = await vscode.workspace.openTextDocument({
      content: "line 0\nline 1\n",
      language: "plaintext",
    });
    const position = new vscode.Position(0, 0);
    const hover = await provider.provideHover(doc, position);

    assert.strictEqual(hover, undefined);
  });

  test("returns a Hover for a line with annotations", async () => {
    const ann = makeAnnotation({
      id: "a1",
      status: "open",
      creatorName: "alice",
      bodyValue: "Needs review",
    });
    const manager = managerWithAnnotations(0, [ann]);
    const provider = new AnnotationHoverProvider(manager);

    const doc = await vscode.workspace.openTextDocument({
      content: "annotated text\n",
      language: "plaintext",
    });
    const position = new vscode.Position(0, 0);
    const hover = await provider.provideHover(doc, position);

    assert.ok(hover, "Should return a Hover");
    assert.ok(hover.contents.length > 0, "Should have content");
  });

  test("hover contains annotation body text", async () => {
    const ann = makeAnnotation({
      id: "a1",
      bodyValue: "This is important feedback",
    });
    const manager = managerWithAnnotations(0, [ann]);
    const provider = new AnnotationHoverProvider(manager);

    const doc = await vscode.workspace.openTextDocument({
      content: "text\n",
      language: "plaintext",
    });
    const hover = await provider.provideHover(doc, new vscode.Position(0, 0));

    assert.ok(hover);
    const md = hover.contents[0] as vscode.MarkdownString;
    assert.ok(
      md.value.includes("This is important feedback"),
      "Hover should contain body text",
    );
  });

  test("hover contains author name", async () => {
    const ann = makeAnnotation({ id: "a1", creatorName: "bob" });
    const manager = managerWithAnnotations(0, [ann]);
    const provider = new AnnotationHoverProvider(manager);

    const doc = await vscode.workspace.openTextDocument({
      content: "text\n",
      language: "plaintext",
    });
    const hover = await provider.provideHover(doc, new vscode.Position(0, 0));

    assert.ok(hover);
    const md = hover.contents[0] as vscode.MarkdownString;
    assert.ok(md.value.includes("bob"), "Hover should contain author name");
  });

  test("hover shows Resolve action for open annotations", async () => {
    const ann = makeAnnotation({ id: "a1", status: "open" });
    const manager = managerWithAnnotations(0, [ann]);
    const provider = new AnnotationHoverProvider(manager);

    const doc = await vscode.workspace.openTextDocument({
      content: "text\n",
      language: "plaintext",
    });
    const hover = await provider.provideHover(doc, new vscode.Position(0, 0));

    assert.ok(hover);
    const md = hover.contents[0] as vscode.MarkdownString;
    assert.ok(md.value.includes("Resolve"), "Should show Resolve action");
    assert.ok(md.value.includes("Open"), "Should show Open status label");
  });

  test("hover shows Re-open action for resolved annotations", async () => {
    const ann = makeAnnotation({ id: "a1", status: "resolved" });
    const manager = managerWithAnnotations(0, [ann]);
    const provider = new AnnotationHoverProvider(manager);

    const doc = await vscode.workspace.openTextDocument({
      content: "text\n",
      language: "plaintext",
    });
    const hover = await provider.provideHover(doc, new vscode.Position(0, 0));

    assert.ok(hover);
    const md = hover.contents[0] as vscode.MarkdownString;
    assert.ok(md.value.includes("Re-open"), "Should show Re-open action");
    assert.ok(
      md.value.includes("Resolved"),
      "Should show Resolved status label",
    );
  });

  test("hover contains changeStatus command link", async () => {
    const ann = makeAnnotation({ id: "test-ann-123", status: "open" });
    const manager = managerWithAnnotations(0, [ann]);
    const provider = new AnnotationHoverProvider(manager);

    const doc = await vscode.workspace.openTextDocument({
      content: "text\n",
      language: "plaintext",
    });
    const hover = await provider.provideHover(doc, new vscode.Position(0, 0));

    assert.ok(hover);
    const md = hover.contents[0] as vscode.MarkdownString;
    assert.ok(
      md.value.includes("command:ietfAnnotations.changeStatus"),
      "Should contain changeStatus command URI",
    );
  });

  test("hover separates multiple annotations with horizontal rule", async () => {
    const ann1 = makeAnnotation({ id: "a1", bodyValue: "First" });
    const ann2 = makeAnnotation({ id: "a2", bodyValue: "Second" });
    const manager = managerWithAnnotations(0, [ann1, ann2]);
    const provider = new AnnotationHoverProvider(manager);

    const doc = await vscode.workspace.openTextDocument({
      content: "text\n",
      language: "plaintext",
    });
    const hover = await provider.provideHover(doc, new vscode.Position(0, 0));

    assert.ok(hover);
    const md = hover.contents[0] as vscode.MarkdownString;
    assert.ok(md.value.includes("First"), "Should contain first annotation");
    assert.ok(md.value.includes("Second"), "Should contain second annotation");
    // There should be a horizontal rule between annotations and also between
    // body/action, so at least two
    const hrCount = (md.value.match(/---/g) ?? []).length;
    assert.ok(hrCount >= 2, `Should have separator rules, found ${hrCount}`);
  });

  test("hover does not contain date/time", async () => {
    const ann = makeAnnotation({
      id: "a1",
      created: "2026-01-15T10:00:00Z",
    });
    const manager = managerWithAnnotations(0, [ann]);
    const provider = new AnnotationHoverProvider(manager);

    const doc = await vscode.workspace.openTextDocument({
      content: "text\n",
      language: "plaintext",
    });
    const hover = await provider.provideHover(doc, new vscode.Position(0, 0));

    assert.ok(hover);
    const md = hover.contents[0] as vscode.MarkdownString;
    assert.ok(
      !md.value.includes("2026"),
      "Hover should not contain timestamp",
    );
  });

  test("hover shows reply count with thread link", async () => {
    const ann = makeAnnotation({ id: "a1", replyCount: 3 });
    const manager = managerWithAnnotations(0, [ann]);
    const provider = new AnnotationHoverProvider(manager);

    const doc = await vscode.workspace.openTextDocument({
      content: "text\n",
      language: "plaintext",
    });
    const hover = await provider.provideHover(doc, new vscode.Position(0, 0));

    assert.ok(hover);
    const md = hover.contents[0] as vscode.MarkdownString;
    assert.ok(
      md.value.includes("3 replies"),
      "Should show reply count",
    );
    assert.ok(
      md.value.includes("command:ietfAnnotations.showReplyThread"),
      "Reply count should link to showReplyThread command",
    );
  });

  test("hover shows singular reply for count of 1", async () => {
    const ann = makeAnnotation({ id: "a1", replyCount: 1 });
    const manager = managerWithAnnotations(0, [ann]);
    const provider = new AnnotationHoverProvider(manager);

    const doc = await vscode.workspace.openTextDocument({
      content: "text\n",
      language: "plaintext",
    });
    const hover = await provider.provideHover(doc, new vscode.Position(0, 0));

    assert.ok(hover);
    const md = hover.contents[0] as vscode.MarkdownString;
    assert.ok(
      md.value.includes("1 reply"),
      "Should show singular 'reply'",
    );
    assert.ok(
      !md.value.includes("1 replies"),
      "Should not show plural for count of 1",
    );
  });

  test("hover does not show reply count when zero", async () => {
    const ann = makeAnnotation({ id: "a1", replyCount: 0 });
    const manager = managerWithAnnotations(0, [ann]);
    const provider = new AnnotationHoverProvider(manager);

    const doc = await vscode.workspace.openTextDocument({
      content: "text\n",
      language: "plaintext",
    });
    const hover = await provider.provideHover(doc, new vscode.Position(0, 0));

    assert.ok(hover);
    const md = hover.contents[0] as vscode.MarkdownString;
    assert.ok(
      !md.value.includes("0 repl"),
      "Should not show reply count when zero",
    );
    assert.ok(
      !md.value.includes("showReplyThread"),
      "Should not show thread link when no replies",
    );
  });

  test("hover contains Reply action link", async () => {
    const ann = makeAnnotation({ id: "a1" });
    const manager = managerWithAnnotations(0, [ann]);
    const provider = new AnnotationHoverProvider(manager);

    const doc = await vscode.workspace.openTextDocument({
      content: "text\n",
      language: "plaintext",
    });
    const hover = await provider.provideHover(doc, new vscode.Position(0, 0));

    assert.ok(hover);
    const md = hover.contents[0] as vscode.MarkdownString;
    assert.ok(
      md.value.includes("Reply"),
      "Should show Reply action",
    );
    assert.ok(
      md.value.includes("command:ietfAnnotations.replyToAnnotation"),
      "Should contain replyToAnnotation command URI",
    );
  });

  test("hover does not contain quoted target text", async () => {
    const ann = makeAnnotation({
      id: "a1",
      exact: "some exact quoted passage",
    });
    const manager = managerWithAnnotations(0, [ann]);
    const provider = new AnnotationHoverProvider(manager);

    const doc = await vscode.workspace.openTextDocument({
      content: "text\n",
      language: "plaintext",
    });
    const hover = await provider.provideHover(doc, new vscode.Position(0, 0));

    assert.ok(hover);
    const md = hover.contents[0] as vscode.MarkdownString;
    assert.ok(
      !md.value.includes("some exact quoted passage"),
      "Hover should not show the selector exact text",
    );
  });
});
