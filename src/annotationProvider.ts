import * as vscode from 'vscode';
import { AnnotationClient, Annotation } from './annotationClient';

const ANNOTATION_DECORATION = vscode.window.createTextEditorDecorationType({
    after: {
        color: new vscode.ThemeColor('editorCodeLens.foreground'),
        fontStyle: 'italic',
        margin: '0 0 0 2em',
    },
    isWholeLine: false,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});

const ANNOTATION_GUTTER = vscode.window.createTextEditorDecorationType({
    gutterIconPath: new vscode.ThemeIcon('comment').id as unknown as vscode.Uri,
    overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.commentForeground'),
    overviewRulerLane: vscode.OverviewRulerLane.Right,
});

export class AnnotationProvider {
    private disposables: vscode.Disposable[] = [];
    private decorationMap = new Map<string, vscode.TextEditorDecorationType>();

    constructor(
        private client: AnnotationClient,
        private context: vscode.ExtensionContext,
    ) {}

    async refresh() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const filePath = editor.document.uri.fsPath;
        let annotations: Annotation[] = [];

        try {
            annotations = await this.client.getAnnotations(filePath);
        } catch {
            // Server may not be running — silently skip decorations
            editor.setDecorations(ANNOTATION_DECORATION, []);
            return;
        }

        const decorations: vscode.DecorationOptions[] = annotations.map((ann) => {
            const line = Math.max(0, ann.line - 1);
            const endLine = Math.max(line, ann.end_line - 1);
            const range = new vscode.Range(line, 0, endLine, Number.MAX_SAFE_INTEGER);
            return {
                range,
                renderOptions: {
                    after: {
                        contentText: `  💬 ${ann.username}: ${ann.text}`,
                    },
                },
                hoverMessage: new vscode.MarkdownString(
                    `**${ann.username}** — *${new Date(ann.created_at).toLocaleString()}*\n\n${ann.text}`
                ),
            };
        });

        editor.setDecorations(ANNOTATION_DECORATION, decorations);
    }

    dispose() {
        ANNOTATION_DECORATION.dispose();
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}
