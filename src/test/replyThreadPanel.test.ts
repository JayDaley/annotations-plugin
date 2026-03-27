import * as assert from "assert";
import { AnnotationThreadPanel, ThreadPanelMessage } from "../replyThreadPanel";

suite("AnnotationThreadPanel", () => {
  test("isOpen returns false before show is called", () => {
    const panel = new AnnotationThreadPanel();
    assert.strictEqual(panel.isOpen, false);
  });

  test("dispose does not throw when panel is not open", () => {
    const panel = new AnnotationThreadPanel();
    assert.doesNotThrow(() => panel.dispose());
  });

  test("update does not throw when panel is not open", () => {
    const panel = new AnnotationThreadPanel();
    const { makeAnnotation } = require("./helpers");
    const parent = makeAnnotation({ id: "p1" });
    assert.doesNotThrow(() => panel.update(parent, [], "alice"));
  });
});

suite("ThreadPanelMessage", () => {
  test("reply message has correct shape", () => {
    const msg: ThreadPanelMessage = {
      type: "reply",
      annotationId: "parent-1",
      value: "My reply text",
    };
    assert.strictEqual(msg.type, "reply");
    assert.strictEqual(msg.annotationId, "parent-1");
    assert.strictEqual(msg.value, "My reply text");
  });

  test("edit message has correct shape", () => {
    const msg: ThreadPanelMessage = {
      type: "edit",
      annotationId: "ann-1",
      value: "Updated body",
    };
    assert.strictEqual(msg.type, "edit");
    assert.strictEqual(msg.annotationId, "ann-1");
    assert.strictEqual(msg.value, "Updated body");
  });

  test("delete message has correct shape", () => {
    const msg: ThreadPanelMessage = {
      type: "delete",
      annotationId: "ann-1",
    };
    assert.strictEqual(msg.type, "delete");
    assert.strictEqual(msg.annotationId, "ann-1");
    assert.strictEqual(msg.value, undefined);
  });
});
