// Signed links that arrive by mail (DEV-01 §2). What these pin is the set of ways a token must
// fail, because every one of them has to be indistinguishable to the caller.
import { describe, expect, it, vi } from "vitest";
import { signToken, verifyToken } from "../src/auth/token";

const SECRET = "test-signing-key";
const HOUR = 60 * 60;

describe("signToken / verifyToken", () => {
  it("round-trips the subject", async () => {
    const token = await signToken(SECRET, "application-withdrawal", "01HZZZ", HOUR);
    await expect(verifyToken(SECRET, "application-withdrawal", token)).resolves.toBe("01HZZZ");
  });

  // The same fail-closed rule as SESSION_TTL_DAYS and CF_ACCESS_* (DEV-05 §10): an unset key must
  // not silently sign with an empty secret.
  it("throws when the signing key is unset", async () => {
    await expect(signToken(undefined, "application-withdrawal", "01HZZZ", HOUR)).rejects.toThrow("SESSION_SIGNING_KEY");
  });

  it("rejects a token signed with a different key", async () => {
    const token = await signToken("another-key", "application-withdrawal", "01HZZZ", HOUR);
    await expect(verifyToken(SECRET, "application-withdrawal", token)).resolves.toBeNull();
  });

  // A withdrawal link must not be presentable as a password reset.
  it("rejects a token minted for a different purpose", async () => {
    const token = await signToken(SECRET, "password-reset", "01HZZZ", HOUR);
    await expect(verifyToken(SECRET, "application-withdrawal", token)).resolves.toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await signToken(SECRET, "application-withdrawal", "01HZZZ", HOUR);

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(Date.now() + 2 * HOUR * 1000));
      await expect(verifyToken(SECRET, "application-withdrawal", token)).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // The payload is base64url of JSON, so it is readable — the signature is what makes it
  // unforgeable. This proves editing the subject invalidates it.
  it("rejects a token whose payload was edited", async () => {
    const token = await signToken(SECRET, "application-withdrawal", "01HZZZ", HOUR);
    const [, signature] = token.split(".");
    const forged = btoa(JSON.stringify({ p: "application-withdrawal", s: "01HAAA", e: Math.floor(Date.now() / 1000) + HOUR }))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");

    await expect(verifyToken(SECRET, "application-withdrawal", `${forged}.${signature}`)).resolves.toBeNull();
  });

  it("returns null rather than throwing for malformed input", async () => {
    for (const token of ["", ".", "not-a-token", "a.b.c", "!!!.???"]) {
      await expect(verifyToken(SECRET, "application-withdrawal", token), token).resolves.toBeNull();
    }
  });
});
