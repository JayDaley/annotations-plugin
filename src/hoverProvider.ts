import * as vscode from "vscode";
import { DecorationManager } from "./decorations";
import { PROVIDER_ID } from "./auth";

/**
 * Provides hover tooltips for annotated lines in draft-*.txt files.
 *
 * Each annotation is shown as a Markdown card with the body text,
 * followed by a single action line showing the author, status toggle,
 * reply count, Reply, Edit, and Delete links.
 */
export class AnnotationHoverProvider implements vscode.HoverProvider {
  constructor(private readonly decorations: DecorationManager) {}

  /**
   * Build a hover for all annotations on the hovered line.
   *
   * @param _document - The active text document (unused; data comes from DecorationManager).
   * @param position  - The editor position being hovered.
   */
  async provideHover(
    _document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | undefined> {
    const annotations = this.decorations.lineAnnotations.get(position.line);
    if (!annotations || annotations.length === 0) {
      return undefined;
    }

    // Resolve the current user silently — no prompt if not logged in.
    const session = await vscode.authentication.getSession(PROVIDER_ID, [], {
      silent: true,
    });
    const currentUser = session?.account.label ?? "";

    const combined = new vscode.MarkdownString("", true);
    combined.isTrusted = true;

    for (let i = 0; i < annotations.length; i++) {
      const ann = annotations[i];

      if (i > 0) {
        combined.appendMarkdown("\n\n---\n\n");
      }

      // ── Body text in normal font ──────────────────────────────────────────
      combined.appendMarkdown(`${ann.body.value}\n\n---\n\n`);

      // ── Action line ────────────────────────────────────────────────────────
      const isOpen = ann.status === "open";

      const toggleStatus = isOpen ? "resolved" : "open";
      const toggleLabel = isOpen ? "Resolve" : "Re-open";
      const toggleArgs = encodeURIComponent(
        JSON.stringify([ann.id, toggleStatus]),
      );
      const toggleLink = `[${toggleLabel}](command:ietfAnnotations.changeStatus?${toggleArgs})`;

      const actionParts = [
        `**${ann.creator.name}**`,
        toggleLink,
      ];

      // Reply count — clickable to open the thread panel
      if (ann.replyCount > 0) {
        const threadArgs = encodeURIComponent(JSON.stringify([ann.id]));
        const noun = ann.replyCount === 1 ? "reply" : "replies";
        actionParts.push(
          `[${ann.replyCount} ${noun}](command:ietfAnnotations.showReplyThread?${threadArgs})`,
        );
      }

      // Reply action
      const replyArgs = encodeURIComponent(JSON.stringify([ann.id]));
      actionParts.push(
        `[Reply](command:ietfAnnotations.replyToAnnotation?${replyArgs})`,
      );

      if (currentUser && ann.creator.name === currentUser) {
        const editArgs = encodeURIComponent(JSON.stringify([ann.id]));
        actionParts.push(
          `[Edit](command:ietfAnnotations.editAnnotation?${editArgs})`,
        );
        const deleteArgs = encodeURIComponent(JSON.stringify([ann.id]));
        actionParts.push(
          `[Delete](command:ietfAnnotations.deleteAnnotation?${deleteArgs})`,
        );
      }

      combined.appendMarkdown(actionParts.join(" &nbsp;·&nbsp; ") + "\n");
    }

    return new vscode.Hover(combined);
  }
}
