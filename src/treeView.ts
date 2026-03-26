import * as vscode from "vscode";
import { W3CAnnotation, AnnotationStatus } from "./types";

export type TreeViewMode = "single" | "allVersions";

type TreeItemKind = "message" | "version" | "status" | "annotation";

export class AnnotationTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly kind: TreeItemKind,
    public readonly annotation?: W3CAnnotation,
    public readonly annotationLine?: number,
    /** Used by status nodes to hold their child annotations. */
    public readonly childAnnotations?: W3CAnnotation[],
    /** Used by version nodes to identify which version they represent. */
    public readonly versionKey?: string,
  ) {
    super(label, collapsibleState);
    this.contextValue = kind;

    if (kind === "annotation" && annotation && annotationLine !== undefined) {
      this.description = `line ${annotationLine + 1}`;
      this.tooltip = annotation.body.value;
      this.iconPath = new vscode.ThemeIcon("comment");
      this.command = {
        command: "ietfAnnotations.revealLine",
        title: "Reveal Line",
        arguments: [annotationLine],
      };
    }
  }
}

export class AnnotationTreeProvider
  implements vscode.TreeDataProvider<AnnotationTreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    AnnotationTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private annotations: W3CAnnotation[] = [];
  private lineMap = new Map<string, number>();
  private mode: TreeViewMode = "single";
  private showNoDocumentMessage = true;

  setAnnotations(
    annotations: W3CAnnotation[],
    lineMap: Map<string, number>,
    mode: TreeViewMode = "single",
  ): void {
    this.annotations = annotations;
    this.lineMap = lineMap;
    this.mode = mode;
    this.showNoDocumentMessage = false;
    this._onDidChangeTreeData.fire();
  }

  setNoDocument(): void {
    this.annotations = [];
    this.lineMap = new Map();
    this.showNoDocumentMessage = true;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: AnnotationTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: AnnotationTreeItem): AnnotationTreeItem[] {
    if (!element) {
      return this.getRootChildren();
    }

    if (element.kind === "version") {
      const versionAnnotations = this.annotations.filter(
        (a) => this.versionKeyFor(a) === element.versionKey,
      );
      return this.buildStatusGroups(versionAnnotations);
    }

    if (element.kind === "status") {
      return this.buildAnnotationItems(element.childAnnotations ?? []);
    }

    return [];
  }

  private getRootChildren(): AnnotationTreeItem[] {
    if (this.showNoDocumentMessage) {
      return [
        new AnnotationTreeItem(
          "Open a draft-*.txt file to see annotations.",
          vscode.TreeItemCollapsibleState.None,
          "message",
        ),
      ];
    }

    if (this.mode === "allVersions") {
      return this.buildVersionGroups();
    }

    return this.buildStatusGroups(this.annotations);
  }

  private buildVersionGroups(): AnnotationTreeItem[] {
    const seen = new Set<string>();
    const order: string[] = [];
    for (const ann of this.annotations) {
      const key = this.versionKeyFor(ann);
      if (!seen.has(key)) {
        seen.add(key);
        order.push(key);
      }
    }

    return order.map((key) => {
      const item = new AnnotationTreeItem(
        key,
        vscode.TreeItemCollapsibleState.Expanded,
        "version",
        undefined,
        undefined,
        undefined,
        key,
      );
      return item;
    });
  }

  private buildStatusGroups(annotations: W3CAnnotation[]): AnnotationTreeItem[] {
    const statuses: AnnotationStatus[] = ["open", "resolved"];
    return statuses.map((status) => {
      const filtered = annotations.filter((a) => a.status === status);
      const label = `${status.charAt(0).toUpperCase() + status.slice(1)} (${filtered.length})`;
      return new AnnotationTreeItem(
        label,
        filtered.length > 0
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed,
        "status",
        undefined,
        undefined,
        filtered,
      );
    });
  }

  private buildAnnotationItems(
    annotations: W3CAnnotation[],
  ): AnnotationTreeItem[] {
    return annotations.map((ann) => {
      const line = this.lineMap.get(ann.id) ?? -1;
      const bodyExcerpt =
        ann.body.value.length > 50
          ? ann.body.value.slice(0, 50) + "…"
          : ann.body.value;
      let label = `${ann.creator.name}: "${bodyExcerpt}"`;
      if (ann.replyCount > 0) {
        const noun = ann.replyCount === 1 ? "reply" : "replies";
        label += ` (${ann.replyCount} ${noun})`;
      }
      return new AnnotationTreeItem(
        label,
        vscode.TreeItemCollapsibleState.None,
        "annotation",
        ann,
        line === -1 ? undefined : line,
      );
    });
  }

  private versionKeyFor(ann: W3CAnnotation): string {
    // Extract "draft-ietf-foo-bar-03" from ".../draft-ietf-foo-bar-03.txt"
    const match = ann.target.source.match(/\/(draft-[^/]+?)(?:\.txt)?$/);
    return match ? match[1] : ann.target.source;
  }
}
