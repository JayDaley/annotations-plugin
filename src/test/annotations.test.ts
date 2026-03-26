import * as assert from "assert";
import { AnnotationApiClient, ApiError } from "../api";
import { AnnotationManager } from "../annotations";
import { makeAnnotation } from "./helpers";

/**
 * Build a mock OutputChannel that silently discards all output.
 */
function mockOutput(): { appendLine: (s: string) => void } {
  return { appendLine: () => {} };
}

/**
 * Build a mock AnnotationApiClient with overridable methods.
 */
function mockClient(
  overrides: Partial<AnnotationApiClient> = {},
): AnnotationApiClient {
  const base = new AnnotationApiClient(
    () => "http://test:5000",
    async () => "token",
  );
  return Object.assign(base, overrides);
}

suite("AnnotationManager", () => {
  suite("fetchAnnotations", () => {
    test("returns annotations from the client", async () => {
      const expected = [makeAnnotation({ id: "a1" })];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            total: 1,
            page: 1,
            per_page: 20,
            annotations: expected,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      };

      try {
        const manager = new AnnotationManager(
          new AnnotationApiClient(
            () => "http://test:5000",
            async () => undefined,
          ),
          async () => true,
          async () => true,
          mockOutput() as any,
        );

        const result = await manager.fetchAnnotations(
          "http://test:5000/archive/id/draft.txt",
        );
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].id, "a1");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test("returns empty array on error", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        throw new Error("Network failure");
      };

      try {
        const manager = new AnnotationManager(
          new AnnotationApiClient(
            () => "http://test:5000",
            async () => undefined,
          ),
          async () => true,
          async () => true,
          mockOutput() as any,
        );

        const result = await manager.fetchAnnotations("http://test:5000/x");
        assert.deepStrictEqual(result, []);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  suite("createAnnotation", () => {
    test("returns undefined when auth fails", async () => {
      const manager = new AnnotationManager(
        new AnnotationApiClient(
          () => "http://test:5000",
          async () => "token",
        ),
        async () => false, // auth fails
        async () => false,
        mockOutput() as any,
      );

      const result = await manager.createAnnotation({
        motivation: "commenting",
        body: { type: "TextualBody", value: "test", format: "text/plain" },
        target: {
          source: "http://test:5000/draft.txt",
          selector: {
            type: "TextQuoteSelector",
            exact: "x",
            prefix: "",
            suffix: "",
          },
        },
      });

      assert.strictEqual(result, undefined);
    });

    test("creates annotation successfully", async () => {
      const created = makeAnnotation({ id: "new-ann" });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        return new Response(JSON.stringify(created), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      };

      try {
        const manager = new AnnotationManager(
          new AnnotationApiClient(
            () => "http://test:5000",
            async () => "token",
          ),
          async () => true,
          async () => true,
          mockOutput() as any,
        );

        const result = await manager.createAnnotation({
          motivation: "commenting",
          body: { type: "TextualBody", value: "test", format: "text/plain" },
          target: {
            source: "http://test:5000/draft.txt",
            selector: {
              type: "TextQuoteSelector",
              exact: "x",
              prefix: "",
              suffix: "",
            },
          },
        });

        assert.ok(result);
        assert.strictEqual(result.id, "new-ann");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  suite("updateStatus", () => {
    test("returns undefined when auth fails", async () => {
      const manager = new AnnotationManager(
        new AnnotationApiClient(
          () => "http://test:5000",
          async () => "token",
        ),
        async () => false,
        async () => false,
        mockOutput() as any,
      );

      const result = await manager.updateStatus("ann-1", "resolved");
      assert.strictEqual(result, undefined);
    });
  });

  suite("deleteAnnotation", () => {
    test("returns false when auth fails", async () => {
      const manager = new AnnotationManager(
        new AnnotationApiClient(
          () => "http://test:5000",
          async () => "token",
        ),
        async () => false,
        async () => false,
        mockOutput() as any,
      );

      const result = await manager.deleteAnnotation("ann-1");
      assert.strictEqual(result, false);
    });

    test("returns true on successful delete", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        return new Response(null, { status: 204 });
      };

      try {
        const manager = new AnnotationManager(
          new AnnotationApiClient(
            () => "http://test:5000",
            async () => "token",
          ),
          async () => true,
          async () => true,
          mockOutput() as any,
        );

        const result = await manager.deleteAnnotation("ann-1");
        assert.strictEqual(result, true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  suite("editAnnotationBody", () => {
    test("returns undefined when auth fails", async () => {
      const manager = new AnnotationManager(
        new AnnotationApiClient(
          () => "http://test:5000",
          async () => "token",
        ),
        async () => false,
        async () => false,
        mockOutput() as any,
      );

      const ann = makeAnnotation({ id: "ann-1" });
      const result = await manager.editAnnotationBody(ann, "new body");
      assert.strictEqual(result, undefined);
    });

    test("sends updated body via PUT", async () => {
      let capturedBody: any;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(
          JSON.stringify(makeAnnotation({ id: "ann-1", bodyValue: "new body" })),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      };

      try {
        const manager = new AnnotationManager(
          new AnnotationApiClient(
            () => "http://test:5000",
            async () => "token",
          ),
          async () => true,
          async () => true,
          mockOutput() as any,
        );

        const ann = makeAnnotation({ id: "ann-1", bodyValue: "old body" });
        const result = await manager.editAnnotationBody(ann, "new body");

        assert.ok(result);
        assert.strictEqual(capturedBody.body.value, "new body");
        assert.strictEqual(capturedBody.body.type, "TextualBody");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
