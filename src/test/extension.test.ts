import * as assert from "assert";
import * as vscode from "vscode";

suite("Extension Activation", () => {
  test("extension is present in the registry", () => {
    const ext = vscode.extensions.getExtension("undefined_publisher.ietf-annotations");
    // The extension may be listed even without a publisher during development
    // so also try looking it up by contribution
    const allExtensions = vscode.extensions.all;
    const found = allExtensions.some(
      (e) =>
        e.id.includes("ietf-annotations") ||
        e.packageJSON?.name === "ietf-annotations",
    );
    assert.ok(found || ext !== undefined, "Extension should be registered");
  });

  test("extension activates on a draft file", async () => {
    const doc = await vscode.workspace.openTextDocument({
      content: "Hello World\n",
      language: "plaintext",
    });
    await vscode.window.showTextDocument(doc);

    // Allow activation events to fire
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  test("all commands are registered", async () => {
    const allCommands = await vscode.commands.getCommands(true);

    const expected = [
      "ietfAnnotations.login",
      "ietfAnnotations.logout",
      "ietfAnnotations.addAnnotation",
      "ietfAnnotations.changeStatus",
      "ietfAnnotations.editAnnotation",
      "ietfAnnotations.deleteAnnotation",
      "ietfAnnotations.refresh",
      "ietfAnnotations.showAllVersions",
      "ietfAnnotations.revealLine",
      "ietfAnnotations.replyToAnnotation",
      "ietfAnnotations.showReplyThread",
    ];

    for (const cmd of expected) {
      assert.ok(
        allCommands.includes(cmd),
        `Command "${cmd}" should be registered`,
      );
    }
  });
});
