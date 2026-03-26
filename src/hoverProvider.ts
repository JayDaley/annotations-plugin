import * as vscode from "vscode";
import { DecorationManager } from "./decorations";
import { PROVIDER_ID } from "./auth";

/**
 * Provides hover tooltips for annotated lines in draft-*.txt files.
 *
 * Each annotation is shown as a Markdown card with the body text in a
 * blockquote, followed by a single action line showing the author, a
 * status toggle (Resolve / Re-open), and Delete (own annotations only).
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

      // ── Action line: author · status label · status toggle · delete ──────
      const isOpen = ann.status === "open";

      const statusLabel = isOpen
        ? `<span style="color:#f0c040;">**Open**</span>`
        : `<span style="color:#40c040;">**Resolved**</span>`;

      const toggleStatus = isOpen ? "resolved" : "open";
      const toggleLabel = isOpen ? "Resolve" : "Re-open";
      const toggleArgs = encodeURIComponent(
        JSON.stringify([ann.id, toggleStatus]),
      );
      const toggleLink = `[${toggleLabel}](command:ietfAnnotations.changeStatus?${toggleArgs})`;

      const actionParts = [
        `**${ann.creator.name}**`,
        `${statusLabel} · ${toggleLink}`,
      ];

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
