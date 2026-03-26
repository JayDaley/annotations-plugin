import * as vscode from "vscode";
import { W3CAnnotation } from "./types";

/**
 * Open a webview panel beside the active editor showing a reply thread
 * for the given parent annotation.
 *
 * The panel shows the parent annotation at the top, then each reply
 * indented below, with a text input at the bottom to add a new reply.
 *
 * @param parent  - The parent annotation.
 * @param replies - Direct replies to display.
 * @param currentUser - The logged-in username (empty if not logged in).
 * @returns A promise that resolves with a message from the panel, or
 *          `undefined` if the panel is closed without action.
 */
export function showReplyThread(
  parent: W3CAnnotation,
  replies: W3CAnnotation[],
  currentUser: string,
): Promise<{ type: string; value?: string; annotationId?: string } | undefined> {
  return new Promise((resolve) => {
    const panel = vscode.window.createWebviewPanel(
      "ietfReplyThread",
      `Replies: ${parent.creator.name}`,
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: false },
    );

    panel.webview.html = buildHtml(parent, replies, currentUser);

    let settled = false;

    panel.webview.onDidReceiveMessage(
      (msg: { type: string; value?: string; annotationId?: string }) => {
        if (settled) {
          return;
        }
        if (msg.type === "reply") {
          settled = true;
          panel.dispose();
          resolve(msg);
        } else if (msg.type === "close") {
          settled = true;
          panel.dispose();
          resolve(undefined);
        }
      },
    );

    panel.onDidDispose(() => {
      if (!settled) {
        resolve(undefined);
      }
    });
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function statusBadge(status: string): string {
  const color = status === "open" ? "#f0c040" : "#40c040";
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return `<span class="status-badge" style="color:${color};">${label}</span>`;
}

function buildHtml(
  parent: W3CAnnotation,
  replies: W3CAnnotation[],
  _currentUser: string,
): string {
  const parentHtml = `
    <div class="annotation parent">
      <div class="meta">
        <strong>${escapeHtml(parent.creator.name)}</strong>
        ${statusBadge(parent.status)}
      </div>
      <div class="body">${escapeHtml(parent.body.value).replace(/\n/g, "<br>")}</div>
    </div>`;

  const repliesHtml = replies
    .map(
      (r) => `
    <div class="annotation reply">
      <div class="meta">
        <strong>${escapeHtml(r.creator.name)}</strong>
        ${statusBadge(r.status)}
        ${r.replyCount > 0 ? `<span class="reply-count">${r.replyCount} ${r.replyCount === 1 ? "reply" : "replies"}</span>` : ""}
      </div>
      <div class="body">${escapeHtml(r.body.value).replace(/\n/g, "<br>")}</div>
    </div>`,
    )
    .join("\n");

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reply Thread</title>
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
      margin-bottom: 6px;
      font-size: 0.9em;
    }
    .meta strong {
      margin-right: 8px;
    }
    .status-badge {
      font-weight: bold;
      font-size: 0.85em;
    }
    .reply-count {
      margin-left: 8px;
      color: var(--vscode-descriptionForeground);
      font-size: 0.85em;
    }
    .body {
      line-height: 1.5;
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
    textarea {
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
    textarea:focus {
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
      <kbd>Ctrl+Enter</kbd> / <kbd>⌘+Enter</kbd> to submit
    </p>
    <textarea id="input" placeholder="Enter your reply…" autofocus></textarea>
    <div class="actions">
      <button class="secondary" id="close">Close</button>
      <button class="primary" id="submit">Reply</button>
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi()
    const input = document.getElementById('input')
    const submitBtn = document.getElementById('submit')
    const closeBtn = document.getElementById('close')

    function submit() {
      const value = input.value.trim()
      if (!value) { return }
      vscode.postMessage({ type: 'reply', value, annotationId: '${escapeHtml(parent.id)}' })
    }

    submitBtn.addEventListener('click', submit)

    closeBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'close' })
    })

    input.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        submit()
      }
    })
  </script>
</body>
</html>`;
}
