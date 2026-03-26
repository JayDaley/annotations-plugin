import { W3CAnnotation, AnnotationStatus } from "../types";

let _counter = 0;

/**
 * Build a minimal W3CAnnotation for testing.
 * Override any field via the `overrides` parameter.
 */
export function makeAnnotation(
  overrides: Partial<{
    id: string;
    status: AnnotationStatus;
    creatorName: string;
    bodyValue: string;
    exact: string;
    prefix: string;
    suffix: string;
    targetSource: string;
    created: string;
    replyTo: string;
    replyCount: number;
  }> = {},
): W3CAnnotation {
  _counter++;
  const id = overrides.id ?? `ann-${_counter}`;
  const creatorName = overrides.creatorName ?? "alice";

  const ann: W3CAnnotation = {
    "@context": "http://www.w3.org/ns/anno.jsonld",
    id,
    type: "Annotation",
    motivation: "commenting",
    status: overrides.status ?? "open",
    creator: {
      id: `/api/users/${creatorName}`,
      type: "Person",
      name: creatorName,
    },
    created: overrides.created ?? "2026-01-15T10:00:00Z",
    modified: "2026-01-15T10:00:00Z",
    body: {
      type: "TextualBody",
      value: overrides.bodyValue ?? `Test annotation ${id}`,
      format: "text/plain",
    },
    target: {
      source:
        overrides.targetSource ??
        "http://localhost:5000/archive/id/draft-ietf-foo-bar-03.txt",
      selector: {
        type: "TextQuoteSelector",
        exact: overrides.exact ?? `exact-text-${id}`,
        prefix: overrides.prefix ?? "prefix-",
        suffix: overrides.suffix ?? "-suffix",
      },
    },
    replyCount: overrides.replyCount ?? 0,
  };

  if (overrides.replyTo) {
    ann.replyTo = overrides.replyTo;
  }

  return ann;
}
