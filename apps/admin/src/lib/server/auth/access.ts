// Cloudflare Access is the only door into apps/admin (D-022). The identity is read two ways, in
// this order (D-029):
//
//   1. `ctx.access` — what Cloudflare recommends where it is available: Access has already
//      authenticated the request, so there is nothing to parse or verify.
//   2. The `Cf-Access-Jwt-Assertion` header, verified against the team's JWKS and the AUD tag.
//      **This is the path that runs in production here.** A Worker that serves static assets
//      executes behind an internal router Worker, and that router does not pass `ctx.access`
//      through; Astro's adapter always configures assets, so the simple path cannot be the only
//      one. Cloudflare's own guidance for that case is explicit: a self-hosted origin must
//      validate the token, because the header alone is spoofable.
//
// Either way this is fail-closed: no Access context and no valid token means 403, never a
// fallthrough to "some anonymous admin".
import type { APIContext } from "astro";
import { ForbiddenError, UnauthenticatedError } from "@app/server-kit/http";
import { findOrCreateAdminUserByEmail, touchLastLoginIfStale } from "../services/admin-users";

export const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";

const JWKS_TTL_MS = 60 * 60 * 1000;
// An unknown `kid` refetches so a key rotation doesn't wait out the TTL, but not more often than
// this — otherwise a forged `kid` per request turns into a fetch per request.
const JWKS_MIN_REFETCH_MS = 5 * 60 * 1000;

export interface AccessEnv {
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
}

interface AccessConfig {
  issuer: string;
  aud: string;
}

// Only what the JWT path needs; `Astro` and an APIContext both satisfy it.
type AccessRequestContext = Pick<APIContext, "request" | "locals">;

let jwks: { issuer: string; fetchedAt: number; keys: Map<string, CryptoKey> } | null = null;

// Missing config throws instead of defaulting: an undefined team domain would otherwise verify
// against nothing and let every request through.
export function readAccessConfig(env: AccessEnv): AccessConfig {
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN;
  const aud = env.CF_ACCESS_AUD;
  if (!teamDomain) throw new Error("CF_ACCESS_TEAM_DOMAIN is not set.");
  if (!aud) throw new Error("CF_ACCESS_AUD is not set.");

  return { issuer: `https://${teamDomain}`, aud };
}

// Returns a view over a plain ArrayBuffer: crypto.subtle.verify rejects the SharedArrayBuffer-
// capable type that Uint8Array.from infers.
function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "="));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(segment)));
}

async function fetchJwks(issuer: string): Promise<Map<string, CryptoKey>> {
  const response = await fetch(`${issuer}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`Access certs request failed: ${response.status}`);

  const { keys } = (await response.json()) as { keys: (JsonWebKey & { kid?: string })[] };
  const imported = new Map<string, CryptoKey>();
  for (const key of keys ?? []) {
    if (!key.kid) continue;
    imported.set(key.kid, await crypto.subtle.importKey("jwk", key, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
  }
  return imported;
}

async function getSigningKey(issuer: string, kid: string): Promise<CryptoKey> {
  const now = Date.now();
  const stale = !jwks || jwks.issuer !== issuer || now - jwks.fetchedAt > JWKS_TTL_MS;
  const rotated = jwks !== null && !jwks.keys.has(kid) && now - jwks.fetchedAt > JWKS_MIN_REFETCH_MS;

  if (stale || rotated) {
    jwks = { issuer, fetchedAt: now, keys: await fetchJwks(issuer) };
  }

  const key = jwks?.keys.get(kid);
  if (!key) throw new UnauthenticatedError("Access トークンの署名鍵が見つかりません。");
  return key;
}

// Signature, `aud`, `iss` and `exp` are all checked here. Dropping any one of them accepts a
// token minted for another Access application.
export async function verifyAccessJwt(token: string, config: AccessConfig): Promise<string> {
  const invalid = () => new UnauthenticatedError("Access トークンが不正です。");

  const [headerSegment, payloadSegment, signatureSegment] = token.split(".");
  if (!headerSegment || !payloadSegment || !signatureSegment) throw invalid();

  const header = decodeSegment(headerSegment);
  // Pinned, or a token signed with "none" (or an HMAC over the public key) would verify.
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw invalid();

  const key = await getSigningKey(config.issuer, header.kid);
  const signed = new TextEncoder().encode(`${headerSegment}.${payloadSegment}`);
  const verified = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64UrlDecode(signatureSegment), signed);
  if (!verified) throw invalid();

  const payload = decodeSegment(payloadSegment);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(config.aud)) throw invalid();
  if (payload.iss !== config.issuer) throw invalid();

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= now) throw invalid();
  if (typeof payload.nbf === "number" && payload.nbf > now) throw invalid();
  if (typeof payload.email !== "string" || payload.email.length === 0) throw invalid();

  return payload.email;
}

// Called from middleware.ts only — handlers read the result off Astro.locals instead, so that no
// second place can be tempted to pull an identity out of an unverified header.
export async function resolveAccessEmail(context: AccessRequestContext, env: AccessEnv): Promise<string> {
  const access = context.locals.cfContext?.access;
  if (access) {
    const identity = await access.getIdentity();
    if (identity?.email) return identity.email;
    // Access ran but produced no email: a service token, not a person. Nothing to attribute an
    // audit entry to, so it is refused rather than provisioned.
    throw new UnauthenticatedError("Access の identity にメールアドレスがありません。");
  }

  const token = context.request.headers.get(ACCESS_JWT_HEADER);
  if (!token) throw new UnauthenticatedError("Cloudflare Access を経由していないリクエストです。");

  return verifyAccessJwt(token, readAccessConfig(env));
}

// The Service-layer entry point. AdminUser carries no role (D-014), so this is the whole check:
// the identity was established upstream, and the ledger row is active.
export async function requireAdminUser(context: APIContext) {
  const email = context.locals.accessEmail;
  if (!email) throw new UnauthenticatedError();

  const user = await findOrCreateAdminUserByEmail(context.locals.db, email);
  // The second lock for someone removed from the Access policy but left in the ledger.
  if (user.status !== "active") throw new ForbiddenError("このアカウントは無効化されています。");

  await touchLastLoginIfStale(context.locals.db, user);
  return user;
}
