import * as vscode from "vscode";
import * as path from "path";
import { AnnotationApiClient } from "./api";
import { IetfAuthenticationProvider, PROVIDER_ID } from "./auth";
import { AnnotationManager } from "./annotations";
import { DecorationManager, findAnnotationLine } from "./decorations";
import { AnnotationHoverProvider } from "./hoverProvider";
import { AnnotationTreeProvider, TreeViewMode } from "./treeView";
import { DraftForgeAnnotationTreeProvider } from "./draftForgeTreeView";
import { showMultilineInput } from "./annotationInput";
import { AnnotationThreadPanel, ThreadPanelMessage } from "./replyThreadPanel";
import { AnnotationStatus, W3CAnnotation } from "./types";
import { OfflineStore } from "./offlineStore";

const DRAFT_PATTERN = /^draft-.+\.txt$/;

/**
 * Return `true` if the document is an IETF Internet-Draft plain-text file.
 *
 * @param document - The document to check.
 */
function isDraftFile(document: vscode.TextDocument): boolean {
  return DRAFT_PATTERN.test(path.basename(document.uri.fsPath));
}

/** Return `true` when offline mode is enabled in settings. */
function isOfflineMode(): boolean {
  return (
    vscode.workspace
      .getConfiguration("ietfAnnotations")
      .get<boolean>("offlineMode") ?? false
  );
}

/**
 * Build the target source identifier for a draft document.
 *
 * - Online mode: the canonical server URL for the specific version.
 * - Offline mode: the local `file://` URI (version-specific, but all versions
 *   share the same `.annotations.json` file via the store's path logic).
 *
 * @param document - The open draft document.
 */
function getTargetUrl(document: vscode.TextDocument): string {
  if (isOfflineMode()) {
    return document.uri.toString();
  }
  const serverUrl =
    vscode.workspace
      .getConfiguration("ietfAnnotations")
      .get<string>("serverUrl") ?? "http://localhost:5001";
  return `${serverUrl}/archive/id/${path.basename(document.uri.fsPath)}`;
}

/**
 * Extract the base draft name from a versioned filename.
 * e.g. `draft-ietf-foo-bar-03.txt` → `draft-ietf-foo-bar`
 *
 * @param document - The open draft document.
 */
function getDraftName(document: vscode.TextDocument): string {
  return path.basename(document.uri.fsPath, ".txt").replace(/-\d+$/, "");
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("IETF Annotations");
  context.subscriptions.push(output);

  // ── Helper — read server URL from settings ──────────────────────────────
  function getServerUrl(): string {
    return (
      vscode.workspace
        .getConfiguration("ietfAnnotations")
        .get<string>("serverUrl") ?? "http://localhost:5001"
    );
  }

  // ── Authentication provider (OAuth 2.0 + PKCE) ────────────────────────
  const authProvider = new IetfAuthenticationProvider(
    context.secrets,
    getServerUrl,
    output,
  );

  // Register the URI handler FIRST — it must be ready before the browser
  // redirects back with the authorization code.
  context.subscriptions.push(vscode.window.registerUriHandler(authProvider));

  // Load any persisted session before registering, so VS Code sees the
  // existing account immediately on activation.
  void authProvider.initialize().then(() => {
    context.subscriptions.push(
      vscode.authentication.registerAuthenticationProvider(
        PROVIDER_ID,
        "IETF Account",
        authProvider,
        { supportsMultipleAccounts: false },
      ),
    );
  });

  context.subscriptions.push(authProvider);

  // ── API client ────────────────────────────────────────────────────────────
  const client = new AnnotationApiClient(
    getServerUrl,
    async () => {
      const session = await vscode.authentication.getSession(PROVIDER_ID, [], {
        silent: true,
      });
      return session?.accessToken;
    },
  );

  // ── Auth helpers passed to AnnotationManager ──────────────────────────────

  /** Ensure a session exists, prompting for credentials if there isn't one. */
  async function ensureAuth(): Promise<boolean> {
    const session = await vscode.authentication.getSession(PROVIDER_ID, [], {
      createIfNone: true,
    });
    return session !== undefined;
  }

  /** Force a fresh credential prompt, e.g. after receiving a 401 response. */
  async function forceReauth(): Promise<boolean> {
    const session = await vscode.authentication.getSession(PROVIDER_ID, [], {
      forceNewSession: true,
    });
    return session !== undefined;
  }

  // ── Feature managers ──────────────────────────────────────────────────────
  const offlineStore = new OfflineStore();

  const annotationManager = new AnnotationManager(
    client,
    ensureAuth,
    forceReauth,
    output,
    offlineStore,
    isOfflineMode,
  );
  const decorationManager = new DecorationManager(context.extensionUri);
  const hoverProvider = new AnnotationHoverProvider(decorationManager);
  const treeProvider = new AnnotationTreeProvider();

  const threadPanel = new AnnotationThreadPanel();

  context.subscriptions.push(decorationManager);

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { pattern: "**/draft-*.txt" },
      hoverProvider,
    ),
  );

  const treeView = vscode.window.createTreeView("ietfAnnotationsView", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  const draftForgeTreeProvider = new DraftForgeAnnotationTreeProvider();
  const draftForgeTreeView = vscode.window.createTreeView(
    "ietfAnnotationsDraftForgeView",
    { treeDataProvider: draftForgeTreeProvider },
  );
  context.subscriptions.push(draftForgeTreeView);

  // ── Core refresh ──────────────────────────────────────────────────────────

  /**
   * Re-fetch annotations for the active editor and update all UI surfaces.
   *
   * @param mode - `"single"` for the current version only; `"allVersions"` for
   *               all versions of the same base draft name.
   */
  async function refresh(mode: TreeViewMode = "single"): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isDraftFile(editor.document)) {
      if (editor) {
        decorationManager.clear(editor);
      }
      treeProvider.setNoDocument();
      draftForgeTreeProvider.clear();
      return;
    }

    const targetUrl = getTargetUrl(editor.document);

    let annotations: W3CAnnotation[];
    if (mode === "allVersions") {
      annotations = await annotationManager.fetchAnnotationsForDraft(
        getDraftName(editor.document),
        targetUrl,
      );
    } else {
      annotations = await annotationManager.fetchAnnotations(targetUrl);
    }

    decorationManager.apply(editor, annotations);

    const lineMap = new Map<string, number>();
    for (const ann of annotations) {
      const line = findAnnotationLine(editor.document, ann.target.selector);
      if (line !== -1) {
        lineMap.set(ann.id, line);
      }
    }

    treeProvider.setAnnotations(annotations, lineMap, mode);
    draftForgeTreeProvider.setAnnotations(
      annotations.filter((a) => lineMap.has(a.id)),
      lineMap,
    );
  }

  // ── Event listeners ───────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => refresh()),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (vscode.window.activeTextEditor?.document === doc) {
        void refresh();
      }
    }),
  );

  // ── Commands ──────────────────────────────────────────────────────────────

  context.subscriptions.push(
    // Sign in via the Accounts menu is the primary path. This command offers a
    // keyboard-accessible alternative that does the same thing.
    vscode.commands.registerCommand("ietfAnnotations.login", async () => {
      await vscode.authentication.getSession(PROVIDER_ID, [], {
        createIfNone: true,
      });
      await refresh();
    }),

    vscode.commands.registerCommand("ietfAnnotations.logout", async () => {
      const session = await vscode.authentication.getSession(PROVIDER_ID, [], {
        silent: true,
      });
      if (session) {
        await authProvider.removeSession(session.id);
        vscode.window.showInformationMessage("Signed out of IETF Annotations.");
      }
      await refresh();
    }),

    vscode.commands.registerCommand(
      "ietfAnnotations.addAnnotation",
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !isDraftFile(editor.document)) {
          return;
        }
        if (editor.selection.isEmpty) {
          vscode.window.showWarningMessage("Select text to annotate first.");
          return;
        }

        const doc = editor.document;
        const docText = doc.getText();
        const startOffset = doc.offsetAt(editor.selection.start);
        const endOffset = doc.offsetAt(editor.selection.end);
        const exact = docText.slice(startOffset, endOffset);
        const prefix = docText.slice(
          Math.max(0, startOffset - 32),
          startOffset,
        );
        const suffix = docText.slice(
          endOffset,
          Math.min(docText.length, endOffset + 32),
        );

        // Multiline input panel — supports Ctrl/⌘+Enter to submit
        const bodyText = await showMultilineInput("New Annotation");
        if (bodyText === undefined) {
          return;
        }

        const result = await annotationManager.createAnnotation({
          motivation: "commenting",
          body: { type: "TextualBody", value: bodyText, format: "text/plain" },
          target: {
            source: getTargetUrl(doc),
            selector: { type: "TextQuoteSelector", exact, prefix, suffix },
          },
        });

        if (result) {
          vscode.window.setStatusBarMessage("Annotation created.", 3000);
          await refresh();
        }
      },
    ),

    vscode.commands.registerCommand(
      "ietfAnnotations.changeStatus",
      async (annotationId?: string, presetStatus?: AnnotationStatus) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !isDraftFile(editor.document)) {
          return;
        }

        let annotation: W3CAnnotation | undefined;

        if (annotationId) {
          for (const anns of decorationManager.lineAnnotations.values()) {
            annotation = anns.find((a) => a.id === annotationId);
            if (annotation) {
              break;
            }
          }
        } else {
          const line = editor.selection.active.line;
          const anns = decorationManager.lineAnnotations.get(line);
          if (!anns || anns.length === 0) {
            vscode.window.showWarningMessage("No annotation on this line.");
            return;
          }
          if (anns.length === 1) {
            annotation = anns[0];
          } else {
            const pick = await vscode.window.showQuickPick(
              anns.map((a) => ({
                label: `${a.creator.name}: ${a.body.value.slice(0, 50)}`,
                annotation: a,
              })),
              { placeHolder: "Select annotation to update" },
            );
            annotation = pick?.annotation;
          }
        }

        if (!annotation) {
          return;
        }

        // When called from the hover (Resolve / Re-open), the new status is
        // passed directly, so we skip the quickpick.
        let newStatus: AnnotationStatus | undefined = presetStatus;
        if (!newStatus) {
          const statusPick = await vscode.window.showQuickPick(
            ["Open", "Resolved"],
            { placeHolder: "Select new status" },
          );
          if (!statusPick) {
            return;
          }
          newStatus = statusPick.toLowerCase() as AnnotationStatus;
        }

        const result = await annotationManager.updateStatus(
          annotation.id,
          newStatus,
        );
        if (result) {
          await refresh();
        }
      },
    ),

    vscode.commands.registerCommand(
      "ietfAnnotations.deleteAnnotation",
      async (annotationId?: string) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !isDraftFile(editor.document)) {
          return;
        }

        const session = await vscode.authentication.getSession(
          PROVIDER_ID,
          [],
          { silent: true },
        );
        const currentUser = session?.account.label ?? "";

        let annotation: W3CAnnotation | undefined;

        if (annotationId) {
          for (const anns of decorationManager.lineAnnotations.values()) {
            annotation = anns.find((a) => a.id === annotationId);
            if (annotation) {
              break;
            }
          }
        } else {
          const line = editor.selection.active.line;
          const anns = (
            decorationManager.lineAnnotations.get(line) ?? []
          ).filter((a) => !currentUser || a.creator.name === currentUser);
          if (anns.length === 0) {
            vscode.window.showWarningMessage(
              "No annotation by you on this line.",
            );
            return;
          }
          if (anns.length === 1) {
            annotation = anns[0];
          } else {
            const pick = await vscode.window.showQuickPick(
              anns.map((a) => ({
                label: `${a.creator.name}: ${a.body.value.slice(0, 50)}`,
                annotation: a,
              })),
              { placeHolder: "Select annotation to delete" },
            );
            annotation = pick?.annotation;
          }
        }

        if (!annotation) {
          return;
        }

        const confirm = await vscode.window.showWarningMessage(
          "Delete this annotation? This cannot be undone.",
          { modal: true },
          "Confirm",
        );
        if (confirm !== "Confirm") {
          return;
        }

        const success = await annotationManager.deleteAnnotation(annotation.id);
        if (success) {
          await refresh();
        }
      },
    ),

    vscode.commands.registerCommand(
      "ietfAnnotations.editAnnotation",
      async (annotationId?: string) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !isDraftFile(editor.document)) {
          return;
        }

        let annotation: W3CAnnotation | undefined;

        if (annotationId) {
          for (const anns of decorationManager.lineAnnotations.values()) {
            annotation = anns.find((a) => a.id === annotationId);
            if (annotation) {
              break;
            }
          }
        } else {
          const line = editor.selection.active.line;
          const anns = decorationManager.lineAnnotations.get(line);
          if (!anns || anns.length === 0) {
            vscode.window.showWarningMessage("No annotation on this line.");
            return;
          }
          if (anns.length === 1) {
            annotation = anns[0];
          } else {
            const pick = await vscode.window.showQuickPick(
              anns.map((a) => ({
                label: `${a.creator.name}: ${a.body.value.slice(0, 50)}`,
                annotation: a,
              })),
              { placeHolder: "Select annotation to edit" },
            );
            annotation = pick?.annotation;
          }
        }

        if (!annotation) {
          return;
        }

        const newBody = await showMultilineInput(
          "Edit Annotation",
          "Edit your annotation…",
          annotation.body.value,
        );
        if (newBody === undefined) {
          return;
        }

        const result = await annotationManager.editAnnotationBody(
          annotation,
          newBody,
        );
        if (result) {
          vscode.window.setStatusBarMessage("Annotation updated.", 3000);
          await refresh();
        }
      },
    ),

    vscode.commands.registerCommand("ietfAnnotations.refresh", () =>
      refresh(),
    ),

    vscode.commands.registerCommand("ietfAnnotations.showAllVersions", () =>
      refresh("allVersions"),
    ),

    vscode.commands.registerCommand(
      "ietfAnnotations.revealLine",
      (line: number) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          return;
        }
        const position = new vscode.Position(line, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
          new vscode.Range(position, position),
          vscode.TextEditorRevealType.InCenter,
        );
      },
    ),

    vscode.commands.registerCommand(
      "ietfAnnotations.replyToAnnotation",
      async (annotationId?: string) => {
        // Both Reply and Show Thread now open the unified thread panel.
        await vscode.commands.executeCommand(
          "ietfAnnotations.showReplyThread",
          annotationId,
        );
      },
    ),

    vscode.commands.registerCommand(
      "ietfAnnotations.showReplyThread",
      async (annotationId?: string) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !isDraftFile(editor.document)) {
          return;
        }

        let annotation: W3CAnnotation | undefined;

        if (annotationId) {
          for (const anns of decorationManager.lineAnnotations.values()) {
            annotation = anns.find((a) => a.id === annotationId);
            if (annotation) {
              break;
            }
          }
        } else {
          const line = editor.selection.active.line;
          const anns = decorationManager.lineAnnotations.get(line);
          if (!anns || anns.length === 0) {
            vscode.window.showWarningMessage("No annotation on this line.");
            return;
          }
          if (anns.length === 1) {
            annotation = anns[0];
          } else {
            const pick = await vscode.window.showQuickPick(
              anns.map((a) => ({
                label: `${a.creator.name}: ${a.body.value.slice(0, 50)}`,
                annotation: a,
              })),
              { placeHolder: "Select annotation" },
            );
            annotation = pick?.annotation;
          }
        }

        if (!annotation) {
          return;
        }

        const parentAnnotation = annotation;

        /** Fetch current user and replies, then open / refresh the panel. */
        async function openOrRefreshPanel(): Promise<void> {
          let currentUser: string;
          if (isOfflineMode()) {
            const { offlineUsername } = await import("./offlineStore.js");
            currentUser = offlineUsername();
          } else {
            const session = await vscode.authentication.getSession(
              PROVIDER_ID,
              [],
              { silent: true },
            );
            currentUser = session?.account.label ?? "";
          }

          let latestParent: W3CAnnotation;
          try {
            latestParent = await annotationManager.getAnnotation(
              parentAnnotation.id,
              parentAnnotation.target.source,
            );
          } catch {
            // Parent may have been deleted by the user from inside the panel.
            threadPanel.dispose();
            return;
          }

          const response = await annotationManager.getReplies(
            parentAnnotation.id,
            parentAnnotation.target.source,
          );
          const replies = response.annotations;

          if (threadPanel.isOpen) {
            threadPanel.update(latestParent, replies, currentUser);
          } else {
            threadPanel.show(
              latestParent,
              replies,
              currentUser,
              async (msg: ThreadPanelMessage) => {
                if (msg.type === "reply" && msg.value) {
                  const result = await annotationManager.createReply(
                    latestParent,
                    msg.value,
                  );
                  if (result) {
                    vscode.window.setStatusBarMessage("Reply posted.", 3000);
                    await openOrRefreshPanel();
                    await refresh();
                  }
                  return true;
                }

                if (msg.type === "edit" && msg.value) {
                  // Find the annotation to edit — could be parent or a reply.
                  let target: W3CAnnotation | undefined;
                  if (msg.annotationId === parentAnnotation.id) {
                    target = latestParent;
                  } else {
                    target = replies.find((r) => r.id === msg.annotationId);
                  }
                  if (!target) {
                    return false;
                  }
                  const result = await annotationManager.editAnnotationBody(
                    target,
                    msg.value,
                  );
                  if (result) {
                    vscode.window.setStatusBarMessage(
                      "Annotation updated.",
                      3000,
                    );
                    await openOrRefreshPanel();
                    await refresh();
                  }
                  return true;
                }

                if (msg.type === "delete") {
                  const confirm = await vscode.window.showWarningMessage(
                    "Delete this annotation? This cannot be undone.",
                    { modal: true },
                    "Confirm",
                  );
                  if (confirm !== "Confirm") {
                    return false;
                  }
                  const success = await annotationManager.deleteAnnotation(
                    msg.annotationId,
                  );
                  if (success) {
                    if (msg.annotationId === parentAnnotation.id) {
                      // Parent was deleted — close the panel.
                      threadPanel.dispose();
                    } else {
                      await openOrRefreshPanel();
                    }
                    await refresh();
                  }
                  return true;
                }

                return false;
              },
            );
          }
        }

        await openOrRefreshPanel();
      },
    ),
  );

  // ── Initial state ─────────────────────────────────────────────────────────

  const initialEditor = vscode.window.activeTextEditor;
  if (initialEditor && isDraftFile(initialEditor.document)) {
    void refresh();
  } else {
    treeProvider.setNoDocument();
  }
}

export function deactivate(): void {
  // Disposables registered via context.subscriptions are cleaned up automatically.
}
