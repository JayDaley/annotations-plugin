import * as assert from "assert";
import * as crypto from "crypto";
import { generateCodeVerifier, generateCodeChallenge } from "../auth";

suite("PKCE helpers", () => {
  test("generateCodeVerifier returns a base64url string", () => {
    const verifier = generateCodeVerifier();
    assert.ok(verifier.length > 0, "Should not be empty");
    // base64url characters only — no +, /, or =
    assert.ok(
      /^[A-Za-z0-9_-]+$/.test(verifier),
      `Should be base64url-safe: ${verifier}`,
    );
  });

  test("generateCodeVerifier produces unique values", () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    assert.notStrictEqual(a, b, "Two verifiers should differ");
  });

  test("generateCodeChallenge returns SHA-256 base64url digest", () => {
    const verifier = "test-verifier-value";
    const challenge = generateCodeChallenge(verifier);

    // Compute expected value independently
    const expected = crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64url");

    assert.strictEqual(challenge, expected);
  });

  test("generateCodeChallenge matches the PKCE S256 spec", () => {
    // RFC 7636 Appendix B example (adapted — the RFC uses a specific
    // test vector; here we verify the algorithm independently).
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);

    // The challenge should be a valid base64url string
    assert.ok(
      /^[A-Za-z0-9_-]+$/.test(challenge),
      `Challenge should be base64url-safe: ${challenge}`,
    );

    // Verifying the round-trip: SHA-256 of the verifier matches the challenge
    const digest = crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64url");
    assert.strictEqual(challenge, digest);
  });

  test("different verifiers produce different challenges", () => {
    const v1 = generateCodeVerifier();
    const v2 = generateCodeVerifier();
    const c1 = generateCodeChallenge(v1);
    const c2 = generateCodeChallenge(v2);
    assert.notStrictEqual(c1, c2, "Different verifiers should produce different challenges");
  });
});
