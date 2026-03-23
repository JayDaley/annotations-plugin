import * as vscode from 'vscode';
import { AnnotationClient, Annotation } from './annotationClient';
import { AnnotationProvider } from './annotationProvider';
import { AnnotationsPanel } from './annotationsPanel';

let provider: AnnotationProvider;

export function activate(context: vscode.ExtensionContext) {
    const client = new AnnotationClient(context);
    provider = new AnnotationProvider(client, context);

    context.subscriptions.push(
        vscode.commands.registerCommand('annotations.addAnnotation', () => addAnnotation(client, context)),
        vscode.commands.registerCommand('annotations.showAnnotations', () => showAnnotations(client, context)),
        vscode.commands.registerCommand('annotations.deleteAnnotation', (annotation: Annotation) => deleteAnnotation(annotation, client)),
        vscode.commands.registerCommand('annotations.configureServer', () => configureServer()),

        vscode.window.onDidChangeActiveTextEditor(() => provider.refresh()),
        vscode.workspace.onDidSaveTextDocument(() => provider.refresh()),
    );

    provider.refresh();
}

async function addAnnotation(client: AnnotationClient, context: vscode.ExtensionContext) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor.');
        return;
    }

    const selection = editor.selection;
    if (selection.isEmpty) {
        vscode.window.showWarningMessage('Select text to annotate first.');
        return;
    }

    const text = await vscode.window.showInputBox({
        prompt: 'Enter annotation text',
        placeHolder: 'Your annotation...',
    });

    if (!text) {
        return;
    }

    const config = vscode.workspace.getConfiguration('annotationsPlugin');
    const username: string = config.get('username') || 'anonymous';
    const filePath = editor.document.uri.fsPath;

    try {
        await client.addAnnotation({
            file: filePath,
            line: selection.start.line + 1,
            end_line: selection.end.line + 1,
            selected_text: editor.document.getText(selection),
            text,
            username,
        });
        vscode.window.showInformationMessage('Annotation added.');
        provider.refresh();
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to add annotation: ${err}`);
    }
}

async function showAnnotations(client: AnnotationClient, context: vscode.ExtensionContext) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor.');
        return;
    }

    const filePath = editor.document.uri.fsPath;
    try {
        const annotations = await client.getAnnotations(filePath);
        AnnotationsPanel.show(context, annotations, async (id: string) => {
            await client.deleteAnnotation(id);
            provider.refresh();
        });
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to fetch annotations: ${err}`);
    }
}

async function deleteAnnotation(annotation: Annotation, client: AnnotationClient) {
    const confirm = await vscode.window.showWarningMessage(
        `Delete annotation by ${annotation.username}?`,
        { modal: true },
        'Delete'
    );
    if (confirm === 'Delete') {
        await client.deleteAnnotation(annotation.id);
        provider.refresh();
    }
}

async function configureServer() {
    const config = vscode.workspace.getConfiguration('annotationsPlugin');
    const current: string = config.get('serverUrl') || 'http://localhost:5000';
    const url = await vscode.window.showInputBox({
        prompt: 'Annotation server URL',
        value: current,
    });
    if (url !== undefined) {
        await config.update('serverUrl', url, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Server URL set to ${url}`);
    }
}

export function deactivate() {
    provider?.dispose();
}
