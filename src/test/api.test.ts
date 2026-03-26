import * as assert from "assert";
import { AnnotationApiClient, ApiError, NetworkError } from "../api";

suite("ApiError", () => {
  test("stores status code and message", () => {
    const err = new ApiError(404, "Not found");
    assert.strictEqual(err.statusCode, 404);
    assert.strictEqual(err.message, "Not found");
    assert.strictEqual(err.name, "ApiError");
  });

  test("is an instance of Error", () => {
    const err = new ApiError(500, "Server error");
    assert.ok(err instanceof Error);
    assert.ok(err instanceof ApiError);
  });
});

suite("NetworkError", () => {
  test("stores message", () => {
    const err = new NetworkError("Connection refused");
    assert.strictEqual(err.message, "Connection refused");
    assert.strictEqual(err.name, "NetworkError");
  });

  test("is an instance of Error", () => {
    const err = new NetworkError("Timeout");
    assert.ok(err instanceof Error);
    assert.ok(err instanceof NetworkError);
  });
});

suite("AnnotationApiClient", () => {
  test("can be constructed with url and token providers", () => {
    const client = new AnnotationApiClient(
      () => "http://localhost:5000",
      async () => "test-token",
    );
    assert.ok(client);
  });

  test("getAnnotations builds correct query string", async () => {
    // We intercept the fetch call to verify the URL is built correctly.
    // Since we're in a real VS Code instance, fetch is available globally.
    let capturedUrl = "";
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (input: string | URL | Request, _init?: RequestInit) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response(
        JSON.stringify({ total: 0, page: 1, per_page: 20, annotations: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    try {
      const client = new AnnotationApiClient(
        () => "http://test-server:5000",
        async () => undefined,
      );

      await client.getAnnotations({
        target: "http://example.com/draft.txt",
        status: "open",
      });

      assert.ok(
        capturedUrl.includes("target="),
        "URL should include target param",
      );
      assert.ok(
        capturedUrl.includes("status=open"),
        "URL should include status param",
      );
      assert.ok(
        capturedUrl.startsWith("http://test-server:5000/api/annotations/"),
        "URL should start with server URL",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("getAnnotations omits empty params", async () => {
    let capturedUrl = "";
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (input: string | URL | Request, _init?: RequestInit) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response(
        JSON.stringify({ total: 0, page: 1, per_page: 20, annotations: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    try {
      const client = new AnnotationApiClient(
        () => "http://test-server:5000",
        async () => undefined,
      );

      await client.getAnnotations({});

      assert.ok(
        !capturedUrl.includes("?"),
        "URL should not have query string when no params",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("throws ApiError on 401 response", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async () => {
      return new Response("Unauthorized", { status: 401 });
    };

    try {
      const client = new AnnotationApiClient(
        () => "http://test-server:5000",
        async () => "bad-token",
      );

      await assert.rejects(
        () => client.getAnnotation("some-id"),
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.strictEqual(err.statusCode, 401);
          return true;
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("throws ApiError on 403 response", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async () => {
      return new Response("Forbidden", { status: 403 });
    };

    try {
      const client = new AnnotationApiClient(
        () => "http://test-server:5000",
        async () => "token",
      );

      await assert.rejects(
        () => client.getAnnotation("some-id"),
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.strictEqual(err.statusCode, 403);
          return true;
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("throws ApiError on 404 response", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async () => {
      return new Response("Not found", { status: 404 });
    };

    try {
      const client = new AnnotationApiClient(
        () => "http://test-server:5000",
        async () => undefined,
      );

      await assert.rejects(
        () => client.getAnnotation("missing-id"),
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.strictEqual(err.statusCode, 404);
          return true;
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("sends Authorization header when token is available", async () => {
    let capturedHeaders: Record<string, string> = {};
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = Object.fromEntries(
        Object.entries(init?.headers ?? {}),
      );
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      const client = new AnnotationApiClient(
        () => "http://test-server:5000",
        async () => "my-secret-token",
      );

      // createAnnotation requires auth
      await client.createAnnotation({
        motivation: "commenting",
        body: { type: "TextualBody", value: "test", format: "text/plain" },
        target: {
          source: "http://example.com/draft.txt",
          selector: {
            type: "TextQuoteSelector",
            exact: "text",
            prefix: "",
            suffix: "",
          },
        },
      });

      assert.strictEqual(
        capturedHeaders["Authorization"],
        "Bearer my-secret-token",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not send Authorization header for unauthenticated requests", async () => {
    let capturedHeaders: Record<string, string> = {};
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = Object.fromEntries(
        Object.entries(init?.headers ?? {}),
      );
      return new Response(
        JSON.stringify({ total: 0, page: 1, per_page: 20, annotations: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    try {
      const client = new AnnotationApiClient(
        () => "http://test-server:5000",
        async () => "some-token",
      );

      // getAnnotations does not require auth
      await client.getAnnotations({});

      assert.strictEqual(
        capturedHeaders["Authorization"],
        undefined,
        "Should not send auth header for public endpoints",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("getReplies builds correct URL for bare ID", async () => {
    let capturedUrl = "";
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (input: string | URL | Request, _init?: RequestInit) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response(
        JSON.stringify({ total: 0, page: 1, per_page: 20, annotations: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    try {
      const client = new AnnotationApiClient(
        () => "http://test-server:5000",
        async () => undefined,
      );

      await client.getReplies("abc-123");

      assert.ok(
        capturedUrl.includes("/api/annotations/abc-123/replies"),
        `URL should contain /api/annotations/abc-123/replies, got: ${capturedUrl}`,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("getReplies strips full URI to extract ID", async () => {
    let capturedUrl = "";
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (input: string | URL | Request, _init?: RequestInit) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response(
        JSON.stringify({ total: 0, page: 1, per_page: 20, annotations: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    try {
      const client = new AnnotationApiClient(
        () => "http://test-server:5000",
        async () => undefined,
      );

      await client.getReplies("http://test-server:5000/api/annotations/xyz-456");

      assert.ok(
        capturedUrl.includes("/api/annotations/xyz-456/replies"),
        `URL should use extracted ID, got: ${capturedUrl}`,
      );
      assert.ok(
        !capturedUrl.includes("http://test-server:5000/api/annotations/http"),
        "Should not nest the full URI in the path",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("getReplies passes pagination params", async () => {
    let capturedUrl = "";
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (input: string | URL | Request, _init?: RequestInit) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response(
        JSON.stringify({ total: 0, page: 2, per_page: 10, annotations: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    try {
      const client = new AnnotationApiClient(
        () => "http://test-server:5000",
        async () => undefined,
      );

      await client.getReplies("abc-123", { page: 2, per_page: 10 });

      assert.ok(
        capturedUrl.includes("page=2"),
        "URL should include page param",
      );
      assert.ok(
        capturedUrl.includes("per_page=10"),
        "URL should include per_page param",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("handles 204 No Content response", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async () => {
      return new Response(null, { status: 204 });
    };

    try {
      const client = new AnnotationApiClient(
        () => "http://test-server:5000",
        async () => "token",
      );

      // deleteAnnotation expects 204
      const result = await client.deleteAnnotation("some-id");
      assert.strictEqual(result, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
