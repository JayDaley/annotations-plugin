import * as assert from "assert";
import * as vscode from "vscode";
import { findAnnotationRange, findAnnotationLine } from "../decorations";
import { TextQuoteSelector } from "../types";

/**
 * Create an in-memory text document with the given content.
 */
async function createDocument(content: string): Promise<vscode.TextDocument> {
  return vscode.workspace.openTextDocument({ content, language: "plaintext" });
}

suite("findAnnotationRange", () => {
  test("finds exact match with matching prefix and suffix", async () => {
    const content =
      "The quick brown fox jumps over the lazy dog. End of sentence.";
    const doc = await createDocument(content);
    const selector: TextQuoteSelector = {
      type: "TextQuoteSelector",
      exact: "brown fox jumps",
      prefix: "The quick ",
      suffix: " over the lazy",
    };

    const range = findAnnotationRange(doc, selector);
    assert.ok(range, "Should find a range");
    assert.strictEqual(doc.getText(range), "brown fox jumps");
  });

  test("finds exact match when prefix/suffix are empty", async () => {
    const content = "Hello World";
    const doc = await createDocument(content);
    const selector: TextQuoteSelector = {
      type: "TextQuoteSelector",
      exact: "World",
      prefix: "",
      suffix: "",
    };

    const range = findAnnotationRange(doc, selector);
    assert.ok(range, "Should find a range");
    assert.strictEqual(doc.getText(range), "World");
  });

  test("uses prefix/suffix to disambiguate duplicate exact strings", async () => {
    const content = "AAA foo BBB\nCCC foo DDD";
    const doc = await createDocument(content);

    const selectorFirst: TextQuoteSelector = {
      type: "TextQuoteSelector",
      exact: "foo",
      prefix: "AAA ",
      suffix: " BBB",
    };
    const rangeFirst = findAnnotationRange(doc, selectorFirst);
    assert.ok(rangeFirst, "Should find first occurrence");
    assert.strictEqual(rangeFirst.start.line, 0);

    const selectorSecond: TextQuoteSelector = {
      type: "TextQuoteSelector",
      exact: "foo",
      prefix: "CCC ",
      suffix: " DDD",
    };
    const rangeSecond = findAnnotationRange(doc, selectorSecond);
    assert.ok(rangeSecond, "Should find second occurrence");
    assert.strictEqual(rangeSecond.start.line, 1);
  });

  test("falls back to first occurrence when context does not match", async () => {
    const content = "foo bar foo baz";
    const doc = await createDocument(content);
    const selector: TextQuoteSelector = {
      type: "TextQuoteSelector",
      exact: "foo",
      prefix: "WRONG",
      suffix: "WRONG",
    };

    const range = findAnnotationRange(doc, selector);
    assert.ok(range, "Should fall back to first occurrence");
    assert.strictEqual(range.start.character, 0);
  });

  test("returns undefined when exact string is not found", async () => {
    const content = "Hello World";
    const doc = await createDocument(content);
    const selector: TextQuoteSelector = {
      type: "TextQuoteSelector",
      exact: "does not exist",
      prefix: "",
      suffix: "",
    };

    const range = findAnnotationRange(doc, selector);
    assert.strictEqual(range, undefined);
  });

  test("handles multiline exact text", async () => {
    const content = "line one\nline two\nline three";
    const doc = await createDocument(content);
    const selector: TextQuoteSelector = {
      type: "TextQuoteSelector",
      exact: "one\nline two",
      prefix: "line ",
      suffix: "\nline three",
    };

    const range = findAnnotationRange(doc, selector);
    assert.ok(range, "Should find multiline match");
    assert.strictEqual(range.start.line, 0);
    assert.strictEqual(range.end.line, 1);
  });

  test("handles prefix at the start of the document", async () => {
    const content = "Start of document with text.";
    const doc = await createDocument(content);
    const selector: TextQuoteSelector = {
      type: "TextQuoteSelector",
      exact: "Start",
      prefix: "",
      suffix: " of document",
    };

    const range = findAnnotationRange(doc, selector);
    assert.ok(range, "Should find match at document start");
    assert.strictEqual(range.start.character, 0);
  });
});

suite("findAnnotationLine", () => {
  test("returns the correct 0-based line number", async () => {
    const content = "line 0\nline 1\nline 2 target text\nline 3";
    const doc = await createDocument(content);
    const selector: TextQuoteSelector = {
      type: "TextQuoteSelector",
      exact: "target text",
      prefix: "line 2 ",
      suffix: "\nline 3",
    };

    const line = findAnnotationLine(doc, selector);
    assert.strictEqual(line, 2);
  });

  test("returns -1 when text is not found", async () => {
    const content = "Hello World";
    const doc = await createDocument(content);
    const selector: TextQuoteSelector = {
      type: "TextQuoteSelector",
      exact: "missing",
      prefix: "",
      suffix: "",
    };

    const line = findAnnotationLine(doc, selector);
    assert.strictEqual(line, -1);
  });
});
