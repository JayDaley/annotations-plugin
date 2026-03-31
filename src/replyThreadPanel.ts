import * as vscode from "vscode";
import { W3CAnnotation } from "./types";

/**
 * Messages the webview can post back to the extension host.
 */
export interface ThreadPanelMessage {
  type: "reply" | "edit" | "delete";
  annotationId: string;
  value?: string;
}

/**
 * Callback invoked each time the user performs an action in the thread panel.
 * The callback should carry out the action (API call, confirmation dialog, etc.)
 * and return `true` if the panel content should be refreshed afterward.
 */
export type ThreadActionHandler = (
  msg: ThreadPanelMessage,
) => Promise<boolean>;

/**
 * Manages a single webview panel that displays an annotation thread:
 * the parent annotation at the top, replies below, and a reply-input
 * section at the bottom.
 *
 * Each annotation owned by the current user has Edit and Delete buttons.
 * Editing is done inline — the body text is replaced with a textarea.
 */
export class AnnotationThreadPanel {
  private panel: vscode.WebviewPanel | undefined;
  private disposables: vscode.Disposable[] = [];

  /**
   * Open (or re-reveal) the thread panel for the given parent annotation.
   *
   * @param parent      - The top-level annotation.
   * @param replies     - Direct replies to display beneath the parent.
   * @param currentUser - The logged-in username (empty string if anonymous).
   * @param onAction    - Callback for handling reply / edit / delete actions.
   *                      Should return `true` when the caller will call
   *                      `update()` afterward to refresh content.
   */
  show(
    parent: W3CAnnotation,
    replies: W3CAnnotation[],
    currentUser: string,
    onAction: ThreadActionHandler,
  ): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
    } else {
      this.panel = vscode.window.createWebviewPanel(
        "ietfAnnotationThread",
        `Thread: ${parent.creator.name}`,
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true },
      );

      this.panel.onDidDispose(
        () => {
          this.panel = undefined;
          for (const d of this.disposables) {
            d.dispose();
          }
          this.disposables = [];
        },
        null,
        this.disposables,
      );

      this.panel.webview.onDidReceiveMessage(
        async (msg: ThreadPanelMessage) => {
          if (msg.type === "reply" || msg.type === "edit" || msg.type === "delete") {
            await onAction(msg);
          }
        },
        null,
        this.disposables,
      );
    }

    this.panel.title = `Thread: ${parent.creator.name}`;
    this.panel.webview.html = buildHtml(parent, replies, currentUser);
  }

  /**
   * Refresh the panel content without creating a new panel.
   * Call this after an action handler modifies server state.
   */
  update(
    parent: W3CAnnotation,
    replies: W3CAnnotation[],
    currentUser: string,
  ): void {
    if (!this.panel) {
      return;
    }
    this.panel.webview.html = buildHtml(parent, replies, currentUser);
  }

  /** Close the panel if it is open. */
  dispose(): void {
    this.panel?.dispose();
  }

  /** Whether the panel is currently visible. */
  get isOpen(): boolean {
    return this.panel !== undefined;
  }
}

/* ── HTML helpers ───────────────────────────────────────────────────────── */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function annotationCard(
  ann: W3CAnnotation,
  currentUser: string,
  isReply: boolean,
): string {
  const isOwner = currentUser !== "" && ann.creator.name === currentUser;
  const cssClass = isReply ? "annotation reply" : "annotation parent";

  const ownerButtons = isOwner
    ? `<span class="card-actions">
        <button class="link-btn edit-btn" data-id="${escapeHtml(ann.id)}">Edit</button>
        <button class="link-btn delete-btn" data-id="${escapeHtml(ann.id)}">Delete</button>
       </span>`
    : "";

  return `
    <div class="${cssClass}" data-annotation-id="${escapeHtml(ann.id)}">
      <div class="meta">
        <strong>${escapeHtml(ann.creator.name)}</strong>
        ${ownerButtons}
      </div>
      <div class="body" data-id="${escapeHtml(ann.id)}">${escapeHtml(ann.body.value).replace(/\n/g, "<br>")}</div>
    </div>`;
}

function buildHtml(
  parent: W3CAnnotation,
  replies: W3CAnnotation[],
  currentUser: string,
): string {
  const parentHtml = annotationCard(parent, currentUser, false);

  const repliesHtml = replies
    .map((r) => annotationCard(r, currentUser, true))
    .join("\n");

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Annotation Thread</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    .annotation {
      margin-bottom: 12px;
      padding: 10px;
      border-radius: 4px;
      background: var(--vscode-input-background);
    }
    .annotation.reply {
      margin-left: 24px;
      border-left: 3px solid var(--vscode-focusBorder);
    }
    .meta {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
      font-size: 0.9em;
    }
    .status-badge {
      font-weight: bold;
      font-size: 0.85em;
    }
    .card-actions {
      margin-left: auto;
    }
    .link-btn {
      background: none;
      border: none;
      color: var(--vscode-textLink-foreground);
      cursor: pointer;
      font-family: inherit;
      font-size: 0.85em;
      padding: 0 4px;
      text-decoration: underline;
    }
    .link-btn:hover {
      color: var(--vscode-textLink-activeForeground);
    }
    .body {
      line-height: 1.5;
    }
    .edit-area {
      margin-top: 6px;
    }
    .edit-area textarea {
      width: 100%;
      min-height: 60px;
      resize: vertical;
      padding: 6px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-focusBorder);
      border-radius: 2px;
      font-family: inherit;
      font-size: inherit;
      line-height: 1.5;
      outline: none;
    }
    .edit-area .edit-actions {
      display: flex;
      gap: 6px;
      justify-content: flex-end;
      margin-top: 6px;
    }
    .separator {
      border: none;
      border-top: 1px solid var(--vscode-input-border, transparent);
      margin: 16px 0;
    }
    .reply-input-section {
      margin-top: 16px;
    }
    .reply-input-section p.hint {
      margin: 0 0 8px;
      font-size: 0.9em;
      color: var(--vscode-descriptionForeground);
    }
    textarea#reply-input {
      width: 100%;
      min-height: 80px;
      resize: vertical;
      padding: 8px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px;
      font-family: inherit;
      font-size: inherit;
      line-height: 1.5;
      outline: none;
    }
    textarea#reply-input:focus {
      border-color: var(--vscode-focusBorder);
    }
    .actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      margin-top: 10px;
    }
    button {
      padding: 5px 14px;
      border: none;
      border-radius: 2px;
      cursor: pointer;
      font-family: inherit;
      font-size: inherit;
    }
    button.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button.primary:hover {
      background: var(--vscode-button-hoverBackground);
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    button.danger {
      background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
      color: var(--vscode-editor-foreground);
    }
    button.danger:hover {
      opacity: 0.85;
    }
    .empty {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
      margin: 12px 0 12px 24px;
    }
  </style>
</head>
<body>
  ${parentHtml}
  <hr class="separator">
  ${replies.length > 0 ? repliesHtml : '<p class="empty">No replies yet.</p>'}
  <div class="reply-input-section">
    <p class="hint">
      <kbd>Ctrl+Enter</kbd> / <kbd>\u2318+Enter</kbd> to submit
    </p>
    <textarea id="reply-input" placeholder="Enter your reply\u2026" autofocus></textarea>
    <div class="actions">
      <button class="primary" id="submit-reply">Reply</button>
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi()

    /* ── Reply ─────────────────────────────────────────────────────────── */
    const replyInput = document.getElementById('reply-input')
    const submitBtn  = document.getElementById('submit-reply')

    function submitReply() {
      const value = replyInput.value.trim()
      if (!value) { return }
      vscode.postMessage({
        type: 'reply',
        value,
        annotationId: '${escapeHtml(parent.id)}'
      })
      replyInput.value = ''
    }

    submitBtn.addEventListener('click', submitReply)

    replyInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        submitReply()
      }
    })

    /* ── Inline Edit ───────────────────────────────────────────────────── */
    document.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const annId = btn.dataset.id
        const card = document.querySelector('[data-annotation-id="' + annId + '"]')
        if (!card) return

        const bodyEl = card.querySelector('.body[data-id="' + annId + '"]')
        if (!bodyEl || bodyEl.classList.contains('editing')) return
        bodyEl.classList.add('editing')

        // Grab the raw text (reverse the <br> → newline)
        const currentText = bodyEl.innerHTML.replace(/<br>/g, '\\n')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&#39;/g, "'")

        const originalHtml = bodyEl.innerHTML

        bodyEl.innerHTML = ''
        const editArea = document.createElement('div')
        editArea.className = 'edit-area'

        const ta = document.createElement('textarea')
        ta.value = currentText
        editArea.appendChild(ta)

        const actionsDiv = document.createElement('div')
        actionsDiv.className = 'edit-actions'

        const cancelBtn = document.createElement('button')
        cancelBtn.className = 'secondary'
        cancelBtn.textContent = 'Cancel'
        cancelBtn.addEventListener('click', () => {
          bodyEl.innerHTML = originalHtml
          bodyEl.classList.remove('editing')
        })

        const saveBtn = document.createElement('button')
        saveBtn.className = 'primary'
        saveBtn.textContent = 'Save'
        saveBtn.addEventListener('click', () => {
          const newValue = ta.value.trim()
          if (!newValue) return
          vscode.postMessage({ type: 'edit', annotationId: annId, value: newValue })
        })

        actionsDiv.appendChild(cancelBtn)
        actionsDiv.appendChild(saveBtn)
        editArea.appendChild(actionsDiv)
        bodyEl.appendChild(editArea)

        ta.focus()
        ta.setSelectionRange(ta.value.length, ta.value.length)

        ta.addEventListener('keydown', (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault()
            saveBtn.click()
          }
          if (e.key === 'Escape') {
            cancelBtn.click()
          }
        })
      })
    })

    /* ── Delete ─────────────────────────────────────────────────────────── */
    document.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const annId = btn.dataset.id
        vscode.postMessage({ type: 'delete', annotationId: annId })
      })
    })
  </script>
</body>
</html>`;
}
