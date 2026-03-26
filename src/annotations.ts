import * as vscode from "vscode";
import { AnnotationApiClient, ApiError, NetworkError } from "./api";
import {
  W3CAnnotation,
  CreateAnnotationRequest,
  AnnotationStatus,
} from "./types";

/**
 * Coordinates annotation CRUD operations between the API client and the UI.
 * Authentication is handled via injected callbacks so this class has no
 * direct dependency on the auth provider implementation.
 */
export class AnnotationManager {
  constructor(
    private readonly client: AnnotationApiClient,
    /** Ensure a session exists, prompting for credentials if needed. */
    private readonly ensureAuth: () => Promise<boolean>,
    /** Force a fresh credential prompt, e.g. after a 401 response. */
    private readonly forceReauth: () => Promise<boolean>,
    private readonly output: vscode.OutputChannel,
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

  /**
   * Fetch annotations for a specific target URL (a single draft version).
   * Returns an empty array on error so callers can degrade gracefully.
   *
   * @param targetUrl - The canonical URL of the draft version.
   */
  async fetchAnnotations(targetUrl: string): Promise<W3CAnnotation[]> {
    try {
      const result = await this.client.getAnnotations({ target: targetUrl });
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
   * @param draftName - Base draft name, e.g. `draft-ietf-foo-bar`.
   */
  async fetchAnnotationsForDraft(draftName: string): Promise<W3CAnnotation[]> {
    try {
      const result = await this.client.getAnnotations({ draft: draftName });
      return result.annotations;
    } catch (err) {
      this.output.appendLine(
        `[fetchAnnotationsForDraft] ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  /**
   * Create a new annotation, prompting for authentication if needed.
   * Automatically retries once after a 401 with a fresh credential prompt.
   *
   * @param req - The annotation payload to send.
   * @returns The created annotation, or `undefined` if the operation failed.
   */
  async createAnnotation(
    req: CreateAnnotationRequest,
  ): Promise<W3CAnnotation | undefined> {
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

  /**
   * Delete an annotation by ID.
   * Automatically retries once after a 401 with a fresh credential prompt.
   *
   * @param id - The annotation ID to delete.
   * @returns `true` if the annotation was deleted, `false` otherwise.
   */
  async deleteAnnotation(id: string): Promise<boolean> {
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
}
