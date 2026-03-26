import * as assert from "assert";
import * as vscode from "vscode";
import { AnnotationTreeProvider, AnnotationTreeItem } from "../treeView";
import { makeAnnotation } from "./helpers";

suite("AnnotationTreeProvider", () => {
  let provider: AnnotationTreeProvider;

  setup(() => {
    provider = new AnnotationTreeProvider();
  });

  test("shows placeholder message when no document is open", () => {
    provider.setNoDocument();
    const children = provider.getChildren();
    assert.strictEqual(children.length, 1);
    assert.ok(
      (children[0].label as string).includes("Open a draft"),
      "Should show placeholder message",
    );
  });

  test("groups annotations by status in single mode", () => {
    const annotations = [
      makeAnnotation({ id: "a1", status: "open" }),
      makeAnnotation({ id: "a2", status: "open" }),
      makeAnnotation({ id: "a3", status: "resolved" }),
    ];
    const lineMap = new Map([
      ["a1", 0],
      ["a2", 5],
      ["a3", 10],
    ]);

    provider.setAnnotations(annotations, lineMap, "single");
    const roots = provider.getChildren();

    // Should have exactly two status groups: open and resolved
    assert.strictEqual(roots.length, 2);

    const openGroup = roots[0] as AnnotationTreeItem;
    const resolvedGroup = roots[1] as AnnotationTreeItem;

    assert.ok((openGroup.label as string).includes("Open"));
    assert.ok((openGroup.label as string).includes("2"));
    assert.ok((resolvedGroup.label as string).includes("Resolved"));
    assert.ok((resolvedGroup.label as string).includes("1"));
  });

  test("open group is expanded, empty groups are collapsed", () => {
    const annotations = [
      makeAnnotation({ id: "a1", status: "open" }),
    ];
    const lineMap = new Map([["a1", 0]]);

    provider.setAnnotations(annotations, lineMap, "single");
    const roots = provider.getChildren();

    const openGroup = roots[0] as AnnotationTreeItem;
    const resolvedGroup = roots[1] as AnnotationTreeItem;

    assert.strictEqual(
      openGroup.collapsibleState,
      vscode.TreeItemCollapsibleState.Expanded,
    );
    assert.strictEqual(
      resolvedGroup.collapsibleState,
      vscode.TreeItemCollapsibleState.Collapsed,
    );
  });

  test("annotation items show author and body excerpt", () => {
    const annotations = [
      makeAnnotation({
        id: "a1",
        status: "open",
        creatorName: "bob",
        bodyValue: "This is a test comment about the protocol",
      }),
    ];
    const lineMap = new Map([["a1", 7]]);

    provider.setAnnotations(annotations, lineMap, "single");
    const roots = provider.getChildren();
    const openGroup = roots[0] as AnnotationTreeItem;
    const items = provider.getChildren(openGroup);

    assert.strictEqual(items.length, 1);
    const item = items[0] as AnnotationTreeItem;
    assert.ok((item.label as string).includes("bob"));
    assert.ok(
      (item.label as string).includes("This is a test comment"),
    );
    assert.strictEqual(item.description, "line 8"); // 0-based line 7 → display line 8
  });

  test("annotation item has revealLine command", () => {
    const annotations = [
      makeAnnotation({ id: "a1", status: "open" }),
    ];
    const lineMap = new Map([["a1", 3]]);

    provider.setAnnotations(annotations, lineMap, "single");
    const roots = provider.getChildren();
    const openGroup = roots[0] as AnnotationTreeItem;
    const items = provider.getChildren(openGroup);
    const item = items[0] as AnnotationTreeItem;

    assert.ok(item.command, "Item should have a command");
    assert.strictEqual(item.command!.command, "ietfAnnotations.revealLine");
    assert.deepStrictEqual(item.command!.arguments, [3]);
  });

  test("truncates long body text with ellipsis", () => {
    const longBody = "A".repeat(100);
    const annotations = [
      makeAnnotation({ id: "a1", status: "open", bodyValue: longBody }),
    ];
    const lineMap = new Map([["a1", 0]]);

    provider.setAnnotations(annotations, lineMap, "single");
    const roots = provider.getChildren();
    const openGroup = roots[0] as AnnotationTreeItem;
    const items = provider.getChildren(openGroup);
    const item = items[0] as AnnotationTreeItem;

    const label = item.label as string;
    assert.ok(label.includes("…"), "Should truncate with ellipsis");
    assert.ok(label.length < longBody.length, "Label should be shorter than full body");
  });

  test("groups by version in allVersions mode", () => {
    const annotations = [
      makeAnnotation({
        id: "a1",
        status: "open",
        targetSource:
          "http://localhost:5000/archive/id/draft-ietf-foo-bar-02.txt",
      }),
      makeAnnotation({
        id: "a2",
        status: "open",
        targetSource:
          "http://localhost:5000/archive/id/draft-ietf-foo-bar-03.txt",
      }),
    ];
    const lineMap = new Map([
      ["a1", 0],
      ["a2", 0],
    ]);

    provider.setAnnotations(annotations, lineMap, "allVersions");
    const roots = provider.getChildren();

    assert.strictEqual(roots.length, 2, "Should have two version groups");
    assert.ok((roots[0].label as string).includes("02"));
    assert.ok((roots[1].label as string).includes("03"));
  });

  test("fires onDidChangeTreeData when annotations are set", () => {
    let fired = false;
    provider.onDidChangeTreeData(() => {
      fired = true;
    });

    provider.setAnnotations([], new Map(), "single");
    assert.ok(fired, "Should fire change event");
  });

  test("fires onDidChangeTreeData on setNoDocument", () => {
    let fired = false;
    provider.onDidChangeTreeData(() => {
      fired = true;
    });

    provider.setNoDocument();
    assert.ok(fired, "Should fire change event");
  });

  test("annotation items show reply count suffix", () => {
    const annotations = [
      makeAnnotation({ id: "a1", status: "open", replyCount: 3, creatorName: "alice", bodyValue: "Comment" }),
    ];
    const lineMap = new Map([["a1", 0]]);

    provider.setAnnotations(annotations, lineMap, "single");
    const roots = provider.getChildren();
    const openGroup = roots[0] as AnnotationTreeItem;
    const items = provider.getChildren(openGroup);

    const label = items[0].label as string;
    assert.ok(label.includes("3 replies"), "Should show reply count in label");
  });

  test("annotation items show singular reply for count of 1", () => {
    const annotations = [
      makeAnnotation({ id: "a1", status: "open", replyCount: 1 }),
    ];
    const lineMap = new Map([["a1", 0]]);

    provider.setAnnotations(annotations, lineMap, "single");
    const roots = provider.getChildren();
    const openGroup = roots[0] as AnnotationTreeItem;
    const items = provider.getChildren(openGroup);

    const label = items[0].label as string;
    assert.ok(label.includes("1 reply"), "Should show singular 'reply'");
    assert.ok(!label.includes("1 replies"), "Should not show plural for 1");
  });

  test("annotation items omit reply count when zero", () => {
    const annotations = [
      makeAnnotation({ id: "a1", status: "open", replyCount: 0 }),
    ];
    const lineMap = new Map([["a1", 0]]);

    provider.setAnnotations(annotations, lineMap, "single");
    const roots = provider.getChildren();
    const openGroup = roots[0] as AnnotationTreeItem;
    const items = provider.getChildren(openGroup);

    const label = items[0].label as string;
    assert.ok(!label.includes("repl"), "Should not show reply count when zero");
  });

  test("handles zero annotations gracefully", () => {
    provider.setAnnotations([], new Map(), "single");
    const roots = provider.getChildren();

    // Still shows status groups, just empty
    assert.strictEqual(roots.length, 2);
    for (const root of roots) {
      const children = provider.getChildren(root as AnnotationTreeItem);
      assert.strictEqual(children.length, 0);
    }
  });
});
