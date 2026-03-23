import * as vscode from 'vscode';
import { Annotation } from './annotationClient';

export class AnnotationsPanel {
    private static currentPanel: AnnotationsPanel | undefined;
    private readonly panel: vscode.WebviewPanel;

    private constructor(
        panel: vscode.WebviewPanel,
        annotations: Annotation[],
        onDelete: (id: string) => Promise<void>,
    ) {
        this.panel = panel;
        this.panel.webview.html = this.buildHtml(annotations);
        this.panel.webview.onDidReceiveMessage(async (msg) => {
            if (msg.command === 'delete') {
                await onDelete(msg.id);
                this.panel.dispose();
            }
        });
        this.panel.onDidDispose(() => {
            AnnotationsPanel.currentPanel = undefined;
        });
    }

    static show(
        context: vscode.ExtensionContext,
        annotations: Annotation[],
        onDelete: (id: string) => Promise<void>,
    ) {
        if (AnnotationsPanel.currentPanel) {
            AnnotationsPanel.currentPanel.panel.reveal();
            AnnotationsPanel.currentPanel.panel.webview.html =
                AnnotationsPanel.currentPanel.buildHtml(annotations);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'annotations',
            'Annotations',
            vscode.ViewColumn.Beside,
            { enableScripts: true },
        );

        AnnotationsPanel.currentPanel = new AnnotationsPanel(panel, annotations, onDelete);
    }

    private buildHtml(annotations: Annotation[]): string {
        const rows = annotations.length
            ? annotations
                .map(
                    (a) => `
          <tr>
            <td>${a.line}${a.end_line !== a.line ? `–${a.end_line}` : ''}</td>
            <td><code>${escapeHtml(a.selected_text)}</code></td>
            <td>${escapeHtml(a.text)}</td>
            <td>${escapeHtml(a.username)}</td>
            <td>${new Date(a.created_at).toLocaleString()}</td>
            <td><button onclick="del('${a.id}')">Delete</button></td>
          </tr>`,
                )
                .join('')
            : '<tr><td colspan="6" style="text-align:center;color:gray">No annotations for this file.</td></tr>';

        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 1em; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: top; }
    th { background: var(--vscode-editor-lineHighlightBackground); }
    code { background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 3px 8px; cursor: pointer; border-radius: 3px; }
    button:hover { background: var(--vscode-button-hoverBackground); }
  </style>
</head>
<body>
  <h2>Annotations</h2>
  <table>
    <thead><tr><th>Line(s)</th><th>Selected Text</th><th>Annotation</th><th>Author</th><th>Date</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <script>
    const vscode = acquireVsCodeApi();
    function del(id) {
      if (confirm('Delete this annotation?')) {
        vscode.postMessage({ command: 'delete', id });
      }
    }
  </script>
</body>
</html>`;
    }
}

function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
