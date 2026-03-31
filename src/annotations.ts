import * as vscode from "vscode";
import { AnnotationApiClient, ApiError, NetworkError } from "./api";
import {
  W3CAnnotation,
  AnnotationListResponse,
  CreateAnnotationRequest,
  AnnotationStatus,
} from "./types";
import { OfflineStore, offlineUsername } from "./offlineStore";

/**
 * Coordinates annotation CRUD operations between the API client and the UI.
 * Authentication is handled via injected callbacks so this class has no
 * direct dependency on the auth provider implementation.
 *
 * When `isOffline()` returns `true` (and an `OfflineStore` was provided at
 * construction time) every operation reads/writes the local
 * `.annotations.json` file instead of talking to the server.  The store is
 * responsible for thread-safe JSON file I/O; `AnnotationManager` is
 * responsible for translating results into the same shapes callers expect
 * from the online path.
 *
 * A small `_sourceCache` (id → source URI) is populated during each
 * `fetchAnnotations` call.  Write operations that receive only an annotation
 * ID use this cache to locate the annotations file without needing the full
 * annotation object.
 */
export class AnnotationManager {
  /** Maps annotation ID to its target source URI for offline write ops. */
  private readonly _sourceCache = new Map<string, string>();

  constructor(
    private readonly client: AnnotationApiClient,
    /** Ensure a session exists, prompting for credentials if needed. */
    private readonly ensureAuth: () => Promise<boolean>,
    /** Force a fresh credential prompt, e.g. after a 401 response. */
    private readonly forceReauth: () => Promise<boolean>,
    private readonly output: vscode.OutputChannel,
    private readonly store?: OfflineStore,
    private readonly isOffline: () => boolean = () => false,
  ) {}

  /**
   * Log the error to the output channel and show an appropriate user-facing
   * message.
   *
   * @param err       - The caught error.
   * @param operation - Label used in the output channel log line.
   */
  private handleError(err: unknown, operation: string): void {
    const msg = err instanceof Error ? err.message : String(err);
    this.output.appendLine(`[${operation}] Error: ${msg}`);

    if (err instanceof ApiError) {
      if (err.statusCode === 403) {
        vscode.window.showErrorMessage(
          "You do not have permission to perform this action.",
        );
      } else if (err.statusCode === 404) {
        vscode.window.showErrorMessage("Annotation not found.");
      } else {
        vscode.window.showErrorMessage(`Error: ${msg}`);
      }
    } else if (err instanceof NetworkError) {
      vscode.window.showErrorMessage(`Network error: ${msg}`, "Retry");
    } else {
      this.output.appendLine(`[${operation}] Unexpected format: ${msg}`);
      vscode.window.showErrorMessage(
        "Unexpected error. See IETF Annotations output for details.",
      );
    }
  }

  // ── Fetch ─────────────────────────────────────────────────────────────────

  /**
   * Fetch annotations for a specific target URL (a single draft version).
   * Returns an empty array on error so callers can degrade gracefully.
   *
   * In offline mode `source` is a `file://` URI; the store returns all
   * annotations from the shared `.annotations.json` file.
   *
   * @param source - The canonical URL / file URI of the draft version.
   */
  async fetchAnnotations(source: string): Promise<W3CAnnotation[]> {
    if (this.isOffline() && this.store) {
      const annotations = this.store.getAnnotations(source);
      for (const a of annotations) {
        this._sourceCache.set(a.id, source);
      }
      return annotations;
    }

    try {
      const result = await this.client.getAnnotations({ target: source });
      for (const a of result.annotations) {
        this._sourceCache.set(a.id, a.target.source);
      }
      return result.annotations;
    } catch (err) {
      this.output.appendLine(
        `[fetchAnnotations] ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  /**
   * Fetch annotations for all versions of a draft (by base name).
   * Returns an empty array on error so callers can degrade gracefully.
   *
   * In offline mode the store file already contains all versions, so this
   * is equivalent to `fetchAnnotations`.
   *
   * @param draftName - Base draft name, e.g. `draft-ietf-foo-bar`.
   * @param source    - File URI (offline only) to locate the store file.
   */
  async fetchAnnotationsForDraft(
    draftName: string,
    source?: string,
  ): Promise<W3CAnnotation[]> {
    if (this.isOffline() && this.store && source) {
      const annotations = this.store.getAnnotations(source);
      for (const a of annotations) {
        this._sourceCache.set(a.id, source);
      }
      return annotations;
    }

    try {
      const result = await this.client.getAnnotations({ draft: draftName });
      for (const a of result.annotations) {
        this._sourceCache.set(a.id, a.target.source);
      }
      return result.annotations;
    } catch (err) {
      this.output.appendLine(
        `[fetchAnnotationsForDraft] ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  // ── Single annotation / replies ───────────────────────────────────────────

  /**
   * Return a single annotation by ID.
   *
   * In offline mode `source` is required to locate the annotations file.
   * Throws if the annotation cannot be found so callers can handle deletion.
   */
  async getAnnotation(id: string, source?: string): Promise<W3CAnnotation> {
    if (this.isOffline() && this.store) {
      const effectiveSource = source ?? this._sourceCache.get(id);
      if (!effectiveSource) {
        throw new Error(`Annotation ${id} not found in offline store.`);
      }
      const ann = this.store.getAnnotation(id, effectiveSource);
      if (!ann) {
        throw new Error(`Annotation ${id} not found in offline store.`);
      }
      return ann;
    }

    return this.client.getAnnotation(id);
  }

  /**
   * Return all replies for a given parent annotation.
   *
   * In offline mode `source` is required to locate the annotations file.
   */
  async getReplies(
    parentId: string,
    source?: string,
  ): Promise<AnnotationListResponse> {
    if (this.isOffline() && this.store) {
      const effectiveSource = source ?? this._sourceCache.get(parentId);
      if (!effectiveSource) {
        return { total: 0, page: 1, per_page: 0, annotations: [] };
      }
      return this.store.getReplies(parentId, effectiveSource);
    }

    return this.client.getReplies(parentId);
  }

  // ── Create ────────────────────────────────────────────────────────────────

  /**
   * Create a new annotation, prompting for authentication if needed.
   * Automatically retries once after a 401 with a fresh credential prompt.
   *
   * In offline mode the annotation is written directly to the local file
   * without any network round-trip or authentication.
   *
   * @param req - The annotation payload to send.
   * @returns The created annotation, or `undefined` if the operation failed.
   */
  async createAnnotation(
    req: CreateAnnotationRequest,
  ): Promise<W3CAnnotation | undefined> {
    if (this.isOffline() && this.store) {
      const ann = this.store.createAnnotation(req, offlineUsername());
      this._sourceCache.set(ann.id, ann.target.source);
      return ann;
    }

    const authed = await this.ensureAuth();
    if (!authed) {
      return undefined;
    }

    try {
      return await this.client.createAnnotation(req);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        const reauthed = await this.forceReauth();
        if (reauthed) {
          try {
            return await this.client.createAnnotation(req);
          } catch (retryErr) {
            this.handleError(retryErr, "createAnnotation");
          }
        }
      } else {
        this.handleError(err, "createAnnotation");
      }
      return undefined;
    }
  }

  // ── Update status ─────────────────────────────────────────────────────────

  /**
   * Update the status of an existing annotation.
   * Automatically retries once after a 401 with a fresh credential prompt.
   *
   * @param id     - The annotation ID.
   * @param status - The new status value.
   * @returns The updated annotation, or `undefined` if the operation failed.
   */
  async updateStatus(
    id: string,
    status: AnnotationStatus,
  ): Promise<W3CAnnotation | undefined> {
    if (this.isOffline() && this.store) {
      const source = this._sourceCache.get(id);
      if (!source) {
        return undefined;
      }
      return this.store.updateStatus(id, status, source) ?? undefined;
    }

    const authed = await this.ensureAuth();
    if (!authed) {
      return undefined;
    }

    try {
      return await this.client.updateStatus(id, status);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        const reauthed = await this.forceReauth();
        if (reauthed) {
          try {
            return await this.client.updateStatus(id, status);
          } catch (retryErr) {
            this.handleError(retryErr, "updateStatus");
          }
        }
      } else {
        this.handleError(err, "updateStatus");
      }
      return undefined;
    }
  }

  // ── Edit body ─────────────────────────────────────────────────────────────

  /**
   * Update the body text of an existing annotation via PUT.
   * Automatically retries once after a 401 with a fresh credential prompt.
   *
   * @param annotation - The full annotation whose body should be replaced.
   * @param newBody    - The new body text.
   * @returns The updated annotation, or `undefined` if the operation failed.
   */
  async editAnnotationBody(
    annotation: W3CAnnotation,
    newBody: string,
  ): Promise<W3CAnnotation | undefined> {
    if (this.isOffline() && this.store) {
      return (
        this.store.updateAnnotation(
          annotation.id,
          newBody,
          annotation.target.source,
        ) ?? undefined
      );
    }

    const authed = await this.ensureAuth();
    if (!authed) {
      return undefined;
    }

    const req: CreateAnnotationRequest = {
      motivation: annotation.motivation,
      body: { type: "TextualBody", value: newBody, format: "text/plain" },
      target: {
        source: annotation.target.source,
        selector: annotation.target.selector,
      },
    };

    try {
      return await this.client.updateAnnotation(annotation.id, req);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        const reauthed = await this.forceReauth();
        if (reauthed) {
          try {
            return await this.client.updateAnnotation(annotation.id, req);
          } catch (retryErr) {
            this.handleError(retryErr, "editAnnotationBody");
          }
        }
      } else {
        this.handleError(err, "editAnnotationBody");
      }
      return undefined;
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  /**
   * Delete an annotation by ID.
   * Automatically retries once after a 401 with a fresh credential prompt.
   *
   * @param id - The annotation ID to delete.
   * @returns `true` if the annotation was deleted, `false` otherwise.
   */
  async deleteAnnotation(id: string): Promise<boolean> {
    if (this.isOffline() && this.store) {
      const source = this._sourceCache.get(id);
      if (!source) {
        return false;
      }
      return this.store.deleteAnnotation(id, source);
    }

    const authed = await this.ensureAuth();
    if (!authed) {
      return false;
    }

    try {
      await this.client.deleteAnnotation(id);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        const reauthed = await this.forceReauth();
        if (reauthed) {
          try {
            await this.client.deleteAnnotation(id);
            return true;
          } catch (retryErr) {
            this.handleError(retryErr, "deleteAnnotation");
          }
        }
      } else {
        this.handleError(err, "deleteAnnotation");
      }
      return false;
    }
  }

  // ── Reply ─────────────────────────────────────────────────────────────────

  /**
   * Create a reply annotation.
   * Automatically retries once after a 401 with a fresh credential prompt.
   *
   * @param parentAnnotation - The annotation being replied to.
   * @param bodyText         - The reply body text.
   * @returns The created reply annotation, or `undefined` if the operation failed.
   */
  async createReply(
    parentAnnotation: W3CAnnotation,
    bodyText: string,
  ): Promise<W3CAnnotation | undefined> {
    const req: CreateAnnotationRequest = {
      motivation: "replying",
      body: { type: "TextualBody", value: bodyText, format: "text/plain" },
      target: {
        source: parentAnnotation.target.source,
        selector: parentAnnotation.target.selector,
      },
      replyTo: parentAnnotation.id,
    };

    if (this.isOffline() && this.store) {
      const ann = this.store.createAnnotation(req, offlineUsername());
      this._sourceCache.set(ann.id, ann.target.source);
      return ann;
    }

    const authed = await this.ensureAuth();
    if (!authed) {
      return undefined;
    }

    try {
      return await this.client.createAnnotation(req);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        const reauthed = await this.forceReauth();
        if (reauthed) {
          try {
            return await this.client.createAnnotation(req);
          } catch (retryErr) {
            this.handleError(retryErr, "createReply");
          }
        }
      } else if (err instanceof ApiError && err.statusCode === 404) {
        vscode.window.showErrorMessage(
          "The annotation you are replying to no longer exists.",
        );
      } else {
        this.handleError(err, "createReply");
      }
      return undefined;
    }
  }
}
