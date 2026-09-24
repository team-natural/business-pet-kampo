// Single-use signed tokens for links that arrive by mail: application withdrawal, account
// activation, password reset. HMAC-SHA256 over Web Crypto — `jose` is not used here, and these are
// not sessions (DEV-01 §2, §3).
//
// The token proves "whoever holds this link was sent it", nothing more. Anything that must not be
// replayable also needs a used_at column checked in the same transaction as the change
// (DEV-07 §5-3); the signature alone cannot express single use.
import { fromBase64Url, toBase64Url } from "./encoding";

// Bound into the signature so a withdrawal link cannot be presented as a password reset.
export type TokenPurpose = "application-withdrawal" | "account-activation" | "password-reset" | "email-change" | "social-link";

interface TokenPayload {
  p: TokenPurpose;
  s: string;
  e: number;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

// Missing config throws rather than signing with an empty key, the same rule the session TTL and
// the Access variables follow (DEV-05 §10).
function requireSecret(secret: string | undefined): string {
  if (!secret) throw new Error("SESSION_SIGNING_KEY is not set.");
  return secret;
}

export async function signToken(secret: string | undefined, purpose: TokenPurpose, subject: string, ttlSeconds: number): Promise<string> {
  const key = await importKey(requireSecret(secret));
  const payload: TokenPayload = { p: purpose, s: subject, e: Math.floor(Date.now() / 1000) + ttlSeconds };

  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

// Returns the subject, or null for every way a token can be unusable — wrong signature, wrong
// purpose, expired, malformed. Callers must not tell those apart in what they send back: a
// withdrawal link that answers differently when expired confirms the application exists
// (DEV-04 §5-3).
export async function verifyToken(secret: string | undefined, purpose: TokenPurpose, token: string): Promise<string | null> {
  try {
    const key = await importKey(requireSecret(secret));
    const [body, signature] = token.split(".");
    if (!body || !signature) return null;

    // crypto.subtle.verify is constant-time, so no separate comparison is needed here.
    if (!(await crypto.subtle.verify("HMAC", key, fromBase64Url(signature), new TextEncoder().encode(body)))) return null;

    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as TokenPayload;
    if (payload.p !== purpose) return null;
    if (typeof payload.e !== "number" || payload.e <= Math.floor(Date.now() / 1000)) return null;
    if (typeof payload.s !== "string" || payload.s.length === 0) return null;

    return payload.s;
  } catch {
    // A malformed token is a failed verification, not a 500 — it is user input.
    return null;
  }
}
