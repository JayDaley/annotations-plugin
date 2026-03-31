import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import * as vscode from "vscode";
import {
  W3CAnnotation,
  AnnotationStatus,
  CreateAnnotationRequest,
  AnnotationListResponse,
} from "./types";

// ── File-path helpers ─────────────────────────────────────────────────────────

/**
 * Derive the `.annotations.json` file path for a given document source URI.
 *
 * The version number (e.g. `-00`) is stripped so that all versions of the same
 * Internet Draft share a single annotations file.
 *
 * @example
 * // /path/to/draft-ietf-foo-bar-00.txt  →  /path/to/draft-ietf-foo-bar.annotations.json
 */
export function annotationsFilePath(source: string): string {
  // Accept both file:// URIs and raw file-system paths.
  let fsPath: string;
  if (source.startsWith("file://")) {
    fsPath = vscode.Uri.parse(source).fsPath;
  } else {
    fsPath = source;
  }

  const dir = path.dirname(fsPath);
  const basename = path.basename(fsPath);
  // Strip extension then strip trailing version number (e.g. -00, -03, -12).
  const stem = basename.replace(/\.[^.]+$/, "").replace(/-\d+$/, "");
  return path.join(dir, `${stem}.annotations.json`);
}

// ── Username ──────────────────────────────────────────────────────────────────

/**
 * Return the username to stamp on offline annotations.
 * Uses the `ietfAnnotations.offlineUsername` setting if set; otherwise falls
 * back to the OS user account name.
 */
export function offlineUsername(): string {
  const setting = vscode.workspace
    .getConfiguration("ietfAnnotations")
    .get<string>("offlineUsername");
  return setting?.trim() || os.userInfo().username;
}

// ── Low-level I/O ─────────────────────────────────────────────────────────────

function readAnnotations(filePath: string): W3CAnnotation[] {
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "annotations" in parsed &&
      Array.isArray((parsed as { annotations: unknown }).annotations)
    ) {
      return (parsed as { annotations: W3CAnnotation[] }).annotations;
    }
    return [];
  } catch {
    return [];
  }
}

function writeAnnotations(filePath: string, annotations: W3CAnnotation[]): void {
  fs.writeFileSync(filePath, JSON.stringify({ annotations }, null, 2), "utf-8");
}

// ── OfflineStore ──────────────────────────────────────────────────────────────

/**
 * Provides annotation CRUD backed by a local `.annotations.json` file.
 *
 * All operations are synchronous (the JSON file is small) and are transparent
 * to callers — the store mirrors the shape of the server API responses so that
 * `AnnotationManager` can treat both backends uniformly.
 */
export class OfflineStore {
  /**
   * Return all top-level annotations stored alongside the given source document.
   * Replies (which have `replyTo` set) are excluded.
   *
   * @param source - File URI (`file://…`) or absolute path.
   */
  getAnnotations(source: string): W3CAnnotation[] {
    const all = readAnnotations(annotationsFilePath(source));
    return all.filter((a) => !a.replyTo);
  }

  /**
   * Return a single annotation by ID.
   *
   * @param id     - Bare annotation ID (UUID).
   * @param source - File URI or path — used to locate the annotations file.
   */
  getAnnotation(id: string, source: string): W3CAnnotation | undefined {
    return readAnnotations(annotationsFilePath(source)).find((a) => a.id === id);
  }

  /**
   * Return all replies for a given parent annotation ID.
   *
   * @param parentId - ID of the parent annotation.
   * @param source   - File URI or path — used to locate the annotations file.
   */
  getReplies(parentId: string, source: string): AnnotationListResponse {
    const all = readAnnotations(annotationsFilePath(source));
    const replies = all.filter((a) => a.replyTo === parentId);
    return { total: replies.length, page: 1, per_page: replies.length, annotations: replies };
  }

  /**
   * Create and persist a new annotation (or reply).
   *
   * @param req      - The annotation payload.
   * @param username - The author name to record.
   */
  createAnnotation(req: CreateAnnotationRequest, username: string): W3CAnnotation {
    const filePath = annotationsFilePath(req.target.source);
    const all = readAnnotations(filePath);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const annotation: W3CAnnotation = {
      "@context": "http://www.w3.org/ns/anno.jsonld",
      id,
      type: "Annotation",
      motivation: req.motivation,
      status: "open",
      creator: { id: username, type: "Person", name: username },
      created: now,
      modified: now,
      body: req.body,
      target: req.target,
      replyTo: req.replyTo,
      replyCount: 0,
    };

    // Keep the parent's replyCount in sync.
    if (req.replyTo) {
      const parent = all.find((a) => a.id === req.replyTo);
      if (parent) {
        parent.replyCount++;
      }
    }

    all.push(annotation);
    writeAnnotations(filePath, all);
    return annotation;
  }

  /**
   * Replace the body text of an existing annotation.
   *
   * @param id      - Annotation ID.
   * @param newBody - Replacement body text.
   * @param source  - File URI or path.
   */
  updateAnnotation(
    id: string,
    newBody: string,
    source: string,
  ): W3CAnnotation | undefined {
    const filePath = annotationsFilePath(source);
    const all = readAnnotations(filePath);
    const ann = all.find((a) => a.id === id);
    if (!ann) {
      return undefined;
    }
    ann.body = { ...ann.body, value: newBody };
    ann.modified = new Date().toISOString();
    writeAnnotations(filePath, all);
    return ann;
  }

  /**
   * Change the status of an annotation.
   *
   * @param id     - Annotation ID.
   * @param status - New status value.
   * @param source - File URI or path.
   */
  updateStatus(
    id: string,
    status: AnnotationStatus,
    source: string,
  ): W3CAnnotation | undefined {
    const filePath = annotationsFilePath(source);
    const all = readAnnotations(filePath);
    const ann = all.find((a) => a.id === id);
    if (!ann) {
      return undefined;
    }
    ann.status = status;
    ann.modified = new Date().toISOString();
    writeAnnotations(filePath, all);
    return ann;
  }

  /**
   * Delete an annotation by ID.  If the annotation is a reply, its parent's
   * `replyCount` is decremented.  If the annotation is a parent, all its
   * replies are also removed.
   *
   * @param id     - Annotation ID.
   * @param source - File URI or path.
   */
  deleteAnnotation(id: string, source: string): boolean {
    const filePath = annotationsFilePath(source);
    const all = readAnnotations(filePath);
    const idx = all.findIndex((a) => a.id === id);
    if (idx === -1) {
      return false;
    }

    const ann = all[idx];

    if (ann.replyTo) {
      // It's a reply — decrement parent's replyCount.
      const parent = all.find((a) => a.id === ann.replyTo);
      if (parent && parent.replyCount > 0) {
        parent.replyCount--;
      }
      all.splice(idx, 1);
    } else {
      // It's a parent — remove it and all its replies.
      const idsToRemove = new Set([id, ...all.filter((a) => a.replyTo === id).map((a) => a.id)]);
      const remaining = all.filter((a) => !idsToRemove.has(a.id));
      writeAnnotations(filePath, remaining);
      return true;
    }

    writeAnnotations(filePath, all);
    return true;
  }
}
