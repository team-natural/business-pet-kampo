// Cloudflare Access is the only door into apps/admin (D-022). Verifying at the edge is not
// enough on its own: a request sent straight to the Worker URL never passed Access and arrives
// without the header, so a missing header is a rejection rather than a fallthrough.
import type { APIContext } from "astro";
import { ForbiddenError, UnauthenticatedError } from "@app/server-kit/http";
import { findOrCreateAdminUserByEmail, touchLastLoginIfStale } from "../services/admin-users";

export const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";

const JWKS_TTL_MS = 60 * 60 * 1000;
// An unknown `kid` refetches so a key rotation doesn't wait out the TTL, but not more often than
// this — otherwise a forged `kid` per request turns into a fetch per request.
const JWKS_MIN_REFETCH_MS = 5 * 60 * 1000;

export interface AccessEnv {
  APP_ENV?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  DEV_ADMIN_EMAIL?: string;
}

interface AccessConfig {
  issuer: string;
  aud: string;
  devAdminEmail: string | null;
}

let jwks: { issuer: string; fetchedAt: number; keys: Map<string, CryptoKey> } | null = null;

// Missing config throws instead of defaulting: an undefined team domain would otherwise verify
// against nothing and let every request through.
export function readAccessConfig(env: AccessEnv): AccessConfig {
  const appEnv = env.APP_ENV;
  if (!appEnv) throw new Error("APP_ENV is not set.");

  const teamDomain = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;
  if (!teamDomain) throw new Error("ACCESS_TEAM_DOMAIN is not set.");
  if (!aud) throw new Error("ACCESS_AUD is not set.");

  return {
    issuer: `https://${teamDomain}`,
    aud,
    // The local/E2E fallback, inert in production no matter what the var holds (D-022).
    devAdminEmail: appEnv === "production" ? null : (env.DEV_ADMIN_EMAIL ?? null),
  };
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
// second place can be tempted to pull `email` out of the header without verifying it.
export async function resolveAccessEmail(request: Request, env: AccessEnv): Promise<string> {
  const config = readAccessConfig(env);
  const token = request.headers.get(ACCESS_JWT_HEADER);

  if (!token) {
    if (config.devAdminEmail) return config.devAdminEmail;
    throw new UnauthenticatedError("Cloudflare Access を経由していないリクエストです。");
  }

  return verifyAccessJwt(token, config);
}

// The Service-layer entry point. AdminUser carries no role (D-014), so this is the whole check:
// the JWT was verified upstream, and the ledger row is active.
export async function requireAdminUser(context: APIContext) {
  const email = context.locals.accessEmail;
  if (!email) throw new UnauthenticatedError();

  const user = await findOrCreateAdminUserByEmail(context.locals.db, email);
  // The second lock for someone removed from the Access policy but left in the ledger.
  if (user.status !== "active") throw new ForbiddenError("このアカウントは無効化されています。");

  await touchLastLoginIfStale(context.locals.db, user);
  return user;
}
