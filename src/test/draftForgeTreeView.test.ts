import * as assert from "assert";
import * as vscode from "vscode";
import { DraftForgeAnnotationTreeProvider } from "../draftForgeTreeView";
import { makeAnnotation } from "./helpers";

suite("DraftForgeAnnotationTreeProvider", () => {
  let provider: DraftForgeAnnotationTreeProvider;

  setup(() => {
    provider = new DraftForgeAnnotationTreeProvider();
  });

  test("shows placeholder when no annotations", () => {
    const children = provider.getChildren();
    assert.strictEqual(children.length, 1);
    assert.strictEqual(children[0].label, "No annotations");
  });

  test("lists annotations by quoted text", () => {
    const annotations = [
      makeAnnotation({ id: "a1", exact: "some quoted text" }),
      makeAnnotation({ id: "a2", exact: "other quoted text" }),
    ];
    const lineMap = new Map([
      ["a1", 5],
      ["a2", 10],
    ]);

    provider.setAnnotations(annotations, lineMap);
    const children = provider.getChildren();

    assert.strictEqual(children.length, 2);
    assert.ok(
      (children[0].label as string).includes("some quoted text"),
    );
    assert.ok(
      (children[1].label as string).includes("other quoted text"),
    );
  });

  test("wraps quoted text in double quotes", () => {
    const annotations = [
      makeAnnotation({ id: "a1", exact: "hello world" }),
    ];
    const lineMap = new Map([["a1", 0]]);

    provider.setAnnotations(annotations, lineMap);
    const children = provider.getChildren();
    const label = children[0].label as string;

    assert.ok(label.startsWith('"'), "Label should start with quote");
    assert.ok(label.endsWith('"'), "Label should end with quote");
  });

  test("truncates long quoted text at 60 characters", () => {
    const longText = "A".repeat(100);
    const annotations = [
      makeAnnotation({ id: "a1", exact: longText }),
    ];
    const lineMap = new Map([["a1", 0]]);

    provider.setAnnotations(annotations, lineMap);
    const children = provider.getChildren();
    const label = children[0].label as string;

    // Label includes quotes and ellipsis: `"AAA...…"`
    assert.ok(label.includes("…"), "Should have ellipsis for truncated text");
    assert.ok(
      label.length < longText.length,
      "Label should be shorter than original",
    );
  });

  test("shows creator name as description", () => {
    const annotations = [
      makeAnnotation({ id: "a1", creatorName: "carol" }),
    ];
    const lineMap = new Map([["a1", 0]]);

    provider.setAnnotations(annotations, lineMap);
    const children = provider.getChildren();

    assert.strictEqual(children[0].description, "carol");
  });

  test("shows reply count in description when replies exist", () => {
    const annotations = [
      makeAnnotation({ id: "a1", creatorName: "carol", replyCount: 5 }),
    ];
    const lineMap = new Map([["a1", 0]]);

    provider.setAnnotations(annotations, lineMap);
    const children = provider.getChildren();

    assert.strictEqual(children[0].description, "carol · 5 replies");
  });

  test("shows singular reply in description for count of 1", () => {
    const annotations = [
      makeAnnotation({ id: "a1", creatorName: "alice", replyCount: 1 }),
    ];
    const lineMap = new Map([["a1", 0]]);

    provider.setAnnotations(annotations, lineMap);
    const children = provider.getChildren();

    assert.strictEqual(children[0].description, "alice · 1 reply");
  });

  test("shows only creator name when no replies", () => {
    const annotations = [
      makeAnnotation({ id: "a1", creatorName: "bob", replyCount: 0 }),
    ];
    const lineMap = new Map([["a1", 0]]);

    provider.setAnnotations(annotations, lineMap);
    const children = provider.getChildren();

    assert.strictEqual(children[0].description, "bob");
  });

  test("shows annotation body as tooltip", () => {
    const annotations = [
      makeAnnotation({ id: "a1", bodyValue: "My detailed comment" }),
    ];
    const lineMap = new Map([["a1", 0]]);

    provider.setAnnotations(annotations, lineMap);
    const children = provider.getChildren();

    assert.strictEqual(children[0].tooltip, "My detailed comment");
  });

  test("items have revealLine command when line is mapped", () => {
    const annotations = [
      makeAnnotation({ id: "a1" }),
    ];
    const lineMap = new Map([["a1", 7]]);

    provider.setAnnotations(annotations, lineMap);
    const children = provider.getChildren();

    assert.ok(children[0].command, "Item should have a command");
    assert.strictEqual(
      children[0].command!.command,
      "ietfAnnotations.revealLine",
    );
    assert.deepStrictEqual(children[0].command!.arguments, [7]);
  });

  test("items have no command when line is not mapped", () => {
    const annotations = [
      makeAnnotation({ id: "a1" }),
    ];
    const lineMap = new Map<string, number>(); // empty — no line mapping

    provider.setAnnotations(annotations, lineMap);
    const children = provider.getChildren();

    assert.strictEqual(children[0].command, undefined);
  });

  test("items have comment icon", () => {
    const annotations = [
      makeAnnotation({ id: "a1" }),
    ];
    const lineMap = new Map([["a1", 0]]);

    provider.setAnnotations(annotations, lineMap);
    const children = provider.getChildren();

    const icon = children[0].iconPath as vscode.ThemeIcon;
    assert.strictEqual(icon.id, "comment");
  });

  test("replaces newlines in quoted text with spaces", () => {
    const annotations = [
      makeAnnotation({ id: "a1", exact: "line one\nline two" }),
    ];
    const lineMap = new Map([["a1", 0]]);

    provider.setAnnotations(annotations, lineMap);
    const children = provider.getChildren();
    const label = children[0].label as string;

    assert.ok(
      !label.includes("\n"),
      "Label should not contain newlines",
    );
    assert.ok(label.includes("line one line two"));
  });

  test("clear resets to placeholder", () => {
    const annotations = [makeAnnotation({ id: "a1" })];
    provider.setAnnotations(annotations, new Map([["a1", 0]]));

    assert.strictEqual(provider.getChildren().length, 1);
    assert.ok(
      (provider.getChildren()[0].label as string).startsWith('"'),
      "Should show annotation",
    );

    provider.clear();
    const children = provider.getChildren();
    assert.strictEqual(children.length, 1);
    assert.strictEqual(children[0].label, "No annotations");
  });

  test("fires onDidChangeTreeData when annotations change", () => {
    let fireCount = 0;
    provider.onDidChangeTreeData(() => {
      fireCount++;
    });

    provider.setAnnotations([], new Map());
    assert.strictEqual(fireCount, 1);

    provider.clear();
    assert.strictEqual(fireCount, 2);
  });

  test("all items are non-collapsible", () => {
    const annotations = [
      makeAnnotation({ id: "a1" }),
      makeAnnotation({ id: "a2" }),
    ];
    const lineMap = new Map([
      ["a1", 0],
      ["a2", 1],
    ]);

    provider.setAnnotations(annotations, lineMap);
    const children = provider.getChildren();

    for (const child of children) {
      assert.strictEqual(
        child.collapsibleState,
        vscode.TreeItemCollapsibleState.None,
      );
    }
  });
});
