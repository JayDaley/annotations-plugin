import * as vscode from "vscode";
import { W3CAnnotation, TextQuoteSelector } from "./types";

/**
 * Search the document for the annotation's TextQuoteSelector and return the
 * character range of the matched text. Prefix/suffix context is used to
 * disambiguate when the exact string appears more than once.
 *
 * @param document - The text document to search.
 * @param selector - TextQuoteSelector with `exact`, `prefix`, and `suffix`.
 * @returns The range covering `exact`, or `undefined` if not found.
 */
export function findAnnotationRange(
  document: vscode.TextDocument,
  selector: TextQuoteSelector,
): vscode.Range | undefined {
  const text = document.getText();
  const { exact, prefix, suffix } = selector;

  let searchFrom = 0;
  while (searchFrom < text.length) {
    const idx = text.indexOf(exact, searchFrom);
    if (idx === -1) {
      break;
    }

    const actualPrefix = text.slice(Math.max(0, idx - prefix.length), idx);
    const actualSuffix = text.slice(
      idx + exact.length,
      idx + exact.length + suffix.length,
    );

    const prefixMatches = !prefix || actualPrefix.endsWith(prefix);
    const suffixMatches = !suffix || actualSuffix.startsWith(suffix);

    if (prefixMatches && suffixMatches) {
      return new vscode.Range(
        document.positionAt(idx),
        document.positionAt(idx + exact.length),
      );
    }

    searchFrom = idx + 1;
  }

  // Fallback: first occurrence, ignoring context
  const fallbackIdx = text.indexOf(exact);
  if (fallbackIdx !== -1) {
    return new vscode.Range(
      document.positionAt(fallbackIdx),
      document.positionAt(fallbackIdx + exact.length),
    );
  }

  return undefined;
}

/**
 * Return the 0-based line number of the annotation's matched text, or -1.
 * Delegates to `findAnnotationRange` for the actual search.
 *
 * @param document - The text document to search.
 * @param selector - TextQuoteSelector with `exact`, `prefix`, and `suffix`.
 */
export function findAnnotationLine(
  document: vscode.TextDocument,
  selector: TextQuoteSelector,
): number {
  return findAnnotationRange(document, selector)?.start.line ?? -1;
}

/**
 * Manages the three status-based gutter decorations and the light-green
 * background highlight applied to every annotated text span.
 */
export class DecorationManager implements vscode.Disposable {
  private openDecoration: vscode.TextEditorDecorationType;
  private resolvedDecoration: vscode.TextEditorDecorationType;
  private closedDecoration: vscode.TextEditorDecorationType;
  private highlightDecoration: vscode.TextEditorDecorationType;

  /** Live map: 0-based line number → annotations on that line. */
  public readonly lineAnnotations = new Map<number, W3CAnnotation[]>();

  constructor(extensionUri: vscode.Uri) {
    this.openDecoration = vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.joinPath(
        extensionUri,
        "icons",
        "annotation-open.svg",
      ),
      gutterIconSize: "contain",
      overviewRulerColor: "#f0c040",
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
    this.resolvedDecoration = vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.joinPath(
        extensionUri,
        "icons",
        "annotation-resolved.svg",
      ),
      gutterIconSize: "contain",
      overviewRulerColor: "#40c040",
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
    this.closedDecoration = vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.joinPath(
        extensionUri,
        "icons",
        "annotation-closed.svg",
      ),
      gutterIconSize: "contain",
      overviewRulerColor: "#808080",
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });

    // Light green background applied to the exact annotated text span,
    // regardless of status, so all annotations are immediately visible.
    this.highlightDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: "rgba(144, 238, 144, 0.25)",
      isWholeLine: false,
    });
  }

  /**
   * Apply all decorations to the given editor based on the provided annotations.
   * Clears any previously applied decorations first.
   *
   * @param editor      - The text editor to decorate.
   * @param annotations - The annotations to render.
   */
  apply(editor: vscode.TextEditor, annotations: W3CAnnotation[]): void {
    this.lineAnnotations.clear();

    // Group annotations by line for hover provider and tree view lookup
    for (const ann of annotations) {
      const line = findAnnotationLine(editor.document, ann.target.selector);
      if (line === -1) {
        continue;
      }
      const group = this.lineAnnotations.get(line) ?? [];
      group.push(ann);
      this.lineAnnotations.set(line, group);
    }

    const openRanges: vscode.DecorationOptions[] = [];
    const resolvedRanges: vscode.DecorationOptions[] = [];
    const closedRanges: vscode.DecorationOptions[] = [];
    const highlightRanges: vscode.Range[] = [];

    for (const [line, anns] of this.lineAnnotations) {
      const gutterRange = new vscode.Range(line, 0, line, 0);
      const statuses = anns.map((a) => a.status);

      // Gutter icon priority: open > resolved > closed
      if (statuses.includes("open")) {
        openRanges.push({ range: gutterRange });
      } else if (statuses.includes("resolved")) {
        resolvedRanges.push({ range: gutterRange });
      } else {
        closedRanges.push({ range: gutterRange });
      }

      // Light-green background on the exact annotated text for every annotation
      for (const ann of anns) {
        const range = findAnnotationRange(
          editor.document,
          ann.target.selector,
        );
        if (range) {
          highlightRanges.push(range);
        }
      }
    }

    editor.setDecorations(this.openDecoration, openRanges);
    editor.setDecorations(this.resolvedDecoration, resolvedRanges);
    editor.setDecorations(this.closedDecoration, closedRanges);
    editor.setDecorations(this.highlightDecoration, highlightRanges);
  }

  /**
   * Remove all decorations from the given editor and clear the line map.
   *
   * @param editor - The text editor to clear.
   */
  clear(editor: vscode.TextEditor): void {
    this.lineAnnotations.clear();
    editor.setDecorations(this.openDecoration, []);
    editor.setDecorations(this.resolvedDecoration, []);
    editor.setDecorations(this.closedDecoration, []);
    editor.setDecorations(this.highlightDecoration, []);
  }

  dispose(): void {
    this.openDecoration.dispose();
    this.resolvedDecoration.dispose();
    this.closedDecoration.dispose();
    this.highlightDecoration.dispose();
  }
}
