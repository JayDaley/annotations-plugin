import * as assert from "assert";
import { makeAnnotation } from "./helpers";
import { AnnotationStatus, W3CAnnotation } from "../types";

suite("W3CAnnotation type contracts", () => {
  test("makeAnnotation produces valid W3CAnnotation shape", () => {
    const ann = makeAnnotation();

    assert.strictEqual(ann["@context"], "http://www.w3.org/ns/anno.jsonld");
    assert.strictEqual(ann.type, "Annotation");
    assert.strictEqual(ann.motivation, "commenting");
    assert.ok(ann.id);
    assert.ok(ann.creator.name);
    assert.ok(ann.body.value);
    assert.strictEqual(ann.body.type, "TextualBody");
    assert.strictEqual(ann.body.format, "text/plain");
    assert.ok(ann.target.source);
    assert.strictEqual(ann.target.selector.type, "TextQuoteSelector");
    assert.ok(ann.target.selector.exact);
  });

  test("AnnotationStatus only allows open and resolved", () => {
    const valid: AnnotationStatus[] = ["open", "resolved"];
    for (const s of valid) {
      const ann = makeAnnotation({ status: s });
      assert.strictEqual(ann.status, s);
    }
  });

  test("annotations have distinct IDs by default", () => {
    const a = makeAnnotation();
    const b = makeAnnotation();
    assert.notStrictEqual(a.id, b.id, "Generated annotations should have unique IDs");
  });

  test("override fields are applied correctly", () => {
    const ann = makeAnnotation({
      id: "custom-id",
      status: "resolved",
      creatorName: "bob",
      bodyValue: "Custom body",
      exact: "custom exact",
      prefix: "custom prefix",
      suffix: "custom suffix",
      targetSource: "http://example.com/test.txt",
      created: "2025-06-01T00:00:00Z",
    });

    assert.strictEqual(ann.id, "custom-id");
    assert.strictEqual(ann.status, "resolved");
    assert.strictEqual(ann.creator.name, "bob");
    assert.strictEqual(ann.body.value, "Custom body");
    assert.strictEqual(ann.target.selector.exact, "custom exact");
    assert.strictEqual(ann.target.selector.prefix, "custom prefix");
    assert.strictEqual(ann.target.selector.suffix, "custom suffix");
    assert.strictEqual(ann.target.source, "http://example.com/test.txt");
    assert.strictEqual(ann.created, "2025-06-01T00:00:00Z");
  });
});
