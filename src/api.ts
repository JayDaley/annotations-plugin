import {
  W3CAnnotation,
  AnnotationListResponse,
  CreateAnnotationRequest,
  AnnotationStatus,
} from "./types";

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

export class AnnotationApiClient {
  constructor(
    private getServerUrl: () => string,
    private getToken: () => Promise<string | undefined>,
  ) {}

  /**
   * Extract the bare UUID from an annotation identifier that may be
   * either a full URI (`http://…/api/annotations/<uuid>`) or already a
   * bare UUID string.
   */
  private normaliseId(id: string): string {
    return id.includes("/") ? id.split("/").pop()! : id;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    requireAuth = false,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (requireAuth) {
      const token = await this.getToken();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }

    try {
      const response = await fetch(`${this.getServerUrl()}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        if (response.status === 401) {
          throw new ApiError(401, text || "Unauthorized");
        }
        if (response.status === 403) {
          throw new ApiError(403, text || "Forbidden");
        }
        if (response.status === 404) {
          throw new ApiError(404, text || "Not found");
        }
        throw new ApiError(response.status, text || `HTTP ${response.status}`);
      }

      if (response.status === 204) {
        return undefined as T;
      }
      return response.json() as Promise<T>;
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof ApiError) {
        throw err;
      }
      if (err instanceof Error && err.name === "AbortError") {
        throw new NetworkError("Request timed out");
      }
      throw new NetworkError(
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  getAnnotations(params: {
    target?: string;
    draft?: string;
    status?: string;
    creator?: string;
  }): Promise<AnnotationListResponse> {
    const qs = new URLSearchParams();
    if (params.target) { qs.set("target", params.target); }
    if (params.draft) { qs.set("draft", params.draft); }
    if (params.status) { qs.set("status", params.status); }
    if (params.creator) { qs.set("creator", params.creator); }
    const query = qs.toString() ? `?${qs.toString()}` : "";
    return this.request("GET", `/api/annotations/${query}`);
  }

  getAnnotation(id: string): Promise<W3CAnnotation> {
    return this.request("GET", `/api/annotations/${this.normaliseId(id)}`);
  }

  createAnnotation(annotation: CreateAnnotationRequest): Promise<W3CAnnotation> {
    return this.request("POST", "/api/annotations/", annotation, true);
  }

  updateAnnotation(
    id: string,
    annotation: CreateAnnotationRequest,
  ): Promise<W3CAnnotation> {
    return this.request("PUT", `/api/annotations/${this.normaliseId(id)}`, annotation, true);
  }

  updateStatus(id: string, status: AnnotationStatus): Promise<W3CAnnotation> {
    return this.request(
      "PATCH",
      `/api/annotations/${this.normaliseId(id)}/status`,
      { status },
      true,
    );
  }

  deleteAnnotation(id: string): Promise<void> {
    return this.request("DELETE", `/api/annotations/${this.normaliseId(id)}`, undefined, true);
  }

  getReplies(
    annotationId: string,
    params?: { page?: number; per_page?: number },
  ): Promise<AnnotationListResponse> {
    const id = this.normaliseId(annotationId);
    const qs = new URLSearchParams();
    if (params?.page) { qs.set("page", String(params.page)); }
    if (params?.per_page) { qs.set("per_page", String(params.per_page)); }
    const query = qs.toString() ? `?${qs.toString()}` : "";
    return this.request("GET", `/api/annotations/${id}/replies${query}`);
  }

  listDrafts(): Promise<
    Array<{ filename: string; name: string; version: string; url: string }>
  > {
    return this.request("GET", "/api/drafts/");
  }
}
