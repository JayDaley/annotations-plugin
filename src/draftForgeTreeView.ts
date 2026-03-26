import * as vscode from "vscode";
import { W3CAnnotation } from "./types";

/**
 * A flat list of annotations for the DraftForge sidebar panel.
 * Each item is labelled with the quoted text the annotation is anchored to.
 * Clicking an item reveals the corresponding line in the active editor.
 */
export class DraftForgeAnnotationTreeProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private annotations: W3CAnnotation[] = [];
  private lineMap = new Map<string, number>();

  setAnnotations(
    annotations: W3CAnnotation[],
    lineMap: Map<string, number>,
  ): void {
    this.annotations = annotations;
    this.lineMap = lineMap;
    this._onDidChangeTreeData.fire();
  }

  clear(): void {
    this.annotations = [];
    this.lineMap = new Map();
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    if (this.annotations.length === 0) {
      const placeholder = new vscode.TreeItem(
        "No annotations",
        vscode.TreeItemCollapsibleState.None,
      );
      placeholder.description = "Open a draft-*.txt file";
      return [placeholder];
    }

    return this.annotations.map((ann) => {
      const exact = ann.target.selector.exact.replace(/\n/g, " ").trim();
      const label =
        exact.length > 60 ? exact.slice(0, 60) + "…" : exact;

      const item = new vscode.TreeItem(
        `"${label}"`,
        vscode.TreeItemCollapsibleState.None,
      );
      item.description = ann.creator.name;
      item.tooltip = ann.body.value;
      item.iconPath = new vscode.ThemeIcon("comment");

      const line = this.lineMap.get(ann.id);
      if (line !== undefined) {
        item.command = {
          command: "ietfAnnotations.revealLine",
          title: "Reveal Annotation",
          arguments: [line],
        };
      }

      return item;
    });
  }
}
