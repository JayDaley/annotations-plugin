import * as vscode from "vscode";

/** The currently-open input panel, if any. Only one may exist at a time. */
let _activePanel: vscode.WebviewPanel | undefined;

/**
 * Open a floating webview panel with a multiline textarea for composing or
 * editing an annotation body.
 *
 * If a panel is already open it is closed first, so there is never more than
 * one annotation input window at a time.
 *
 * Resolves with the trimmed text the user submitted, or `undefined` if they
 * cancelled or closed the panel without submitting.
 *
 * @param title       - Panel title shown in the editor tab bar.
 * @param placeholder - Placeholder text shown inside the empty textarea.
 * @param initial     - Pre-filled content, e.g. when editing an existing annotation.
 */
export function showMultilineInput(
  title: string,
  placeholder = "Enter your annotation…",
  initial = "",
): Promise<string | undefined> {
  // Dismiss any existing input panel before opening a new one.
  if (_activePanel) {
    _activePanel.dispose();
    _activePanel = undefined;
  }

  return new Promise((resolve) => {
    const panel = vscode.window.createWebviewPanel(
      "ietfAnnotationInput",
      title,
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: false },
    );

    _activePanel = panel;
    panel.webview.html = buildHtml(placeholder, initial);

    let settled = false;

    panel.webview.onDidReceiveMessage(
      (msg: { type: string; value?: string }) => {
        if (settled) {
          return;
        }
        if (msg.type === "submit") {
          settled = true;
          panel.dispose();
          resolve(msg.value ?? "");
        } else if (msg.type === "cancel") {
          settled = true;
          panel.dispose();
          resolve(undefined);
        }
      },
    );

    panel.onDidDispose(() => {
      if (_activePanel === panel) {
        _activePanel = undefined;
      }
      if (!settled) {
        resolve(undefined);
      }
    });
  });
}

/**
 * Build the webview HTML for the annotation input panel.
 * All colours use VS Code CSS variables so the panel respects the active theme.
 *
 * @param placeholder - Textarea placeholder attribute value.
 * @param initial     - Pre-filled textarea content.
 */
function buildHtml(placeholder: string, initial: string): string {
  const escapedInitial = initial
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const escapedPlaceholder = placeholder.replace(/"/g, "&quot;");

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Annotation</title>
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
    p.hint {
      margin: 0 0 8px;
      font-size: 0.9em;
      color: var(--vscode-descriptionForeground);
    }
    textarea {
      width: 100%;
      min-height: 140px;
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
  </style>
</head>
<body>
  <p class="hint">
    <kbd>Ctrl+Enter</kbd> / <kbd>⌘+Enter</kbd> to submit &nbsp;·&nbsp;
    <kbd>Escape</kbd> to cancel
  </p>
  <textarea id="input" placeholder="${escapedPlaceholder}" autofocus>${escapedInitial}</textarea>
  <div class="actions">
    <button class="secondary" id="cancel">Cancel</button>
    <button class="primary" id="submit">Save Annotation</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi()
    const input = document.getElementById('input')
    const submitBtn = document.getElementById('submit')
    const cancelBtn = document.getElementById('cancel')

    // Ensure cursor starts at end of any pre-filled content
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)

    function submit() {
      const value = input.value.trim()
      if (!value) { return }
      vscode.postMessage({ type: 'submit', value })
    }

    submitBtn.addEventListener('click', submit)

    cancelBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'cancel' })
    })

    input.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        submit()
      }
      if (e.key === 'Escape') {
        vscode.postMessage({ type: 'cancel' })
      }
    })
  </script>
</body>
</html>`;
}
