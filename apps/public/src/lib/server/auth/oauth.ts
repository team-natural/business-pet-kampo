// The only file that knows about Arctic, and the only one that knows a provider's endpoints
// (DEV-10 §5-2). Everything downstream works in terms of `SocialIdentity`, so replacing the
// library means rewriting this file and nothing else.
//
// Arctic 3.7.0 is published as deprecated — it is the latest release and the flow it implements is
// frozen, but it will not receive fixes (GOV-02 TBD-36). That is why the surface is kept this
// narrow.
import { ArcticFetchError, Facebook, Google, Line, OAuth2RequestError, generateCodeVerifier, generateState } from "arctic";

export const OAUTH_PROVIDERS = ["line", "google", "facebook"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const PROVIDER_LABELS: Record<OAuthProvider, string> = {
  line: "LINE",
  google: "Google",
  facebook: "Facebook",
};

export function isOAuthProvider(value: unknown): value is OAuthProvider {
  return OAUTH_PROVIDERS.includes(value as OAuthProvider);
}

// Client ids and secrets are Workers Secrets, so they are absent from the generated Cloudflare.Env
// (DEV-10 §1-3) — callers widen `env` with this, the same way they do for SESSION_SIGNING_KEY.
type ConfigKey = `${Uppercase<OAuthProvider>}_${"CLIENT_ID" | "CLIENT_SECRET" | "REDIRECT_URI"}`;
export type OAuthEnv = Partial<Record<ConfigKey, string>>;

// What the callback needs from a provider, once. `email` may be absent: a LINE account without the
// email scope granted, or a Facebook account with no confirmed address, returns none.
export interface SocialIdentity {
  providerUserId: string;
  email: string | null;
  name: string | null;
}

interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

function readConfig(env: OAuthEnv, provider: OAuthProvider): ProviderConfig | null {
  const prefix = provider.toUpperCase() as Uppercase<OAuthProvider>;
  const clientId = env[`${prefix}_CLIENT_ID`];
  const clientSecret = env[`${prefix}_CLIENT_SECRET`];
  const redirectUri = env[`${prefix}_REDIRECT_URI`];

  // Missing config disables the provider rather than throwing, unlike SESSION_TTL_DAYS and the
  // Access variables (DEV-05 §10). Those guard something; an absent client id can only stop a
  // login, never weaken one — and the three provider registrations have their own lead time
  // (GOV-01 D-036).
  if (typeof clientId !== "string" || typeof clientSecret !== "string" || typeof redirectUri !== "string") return null;
  if (!clientId || !clientSecret || !redirectUri) return null;

  return { clientId, clientSecret, redirectUri };
}

export function configuredProviders(env: OAuthEnv): OAuthProvider[] {
  return OAUTH_PROVIDERS.filter((provider) => readConfig(env, provider) !== null);
}

// Facebook's flow carries no PKCE verifier — its createAuthorizationURL and
// validateAuthorizationCode take one argument fewer than the other two.
const USES_PKCE: Record<OAuthProvider, boolean> = { line: true, google: true, facebook: false };

const SCOPES: Record<OAuthProvider, string[]> = {
  line: ["openid", "profile", "email"],
  google: ["openid", "profile", "email"],
  facebook: ["email", "public_profile"],
};

function createClient(config: ProviderConfig, provider: OAuthProvider) {
  const { clientId, clientSecret, redirectUri } = config;
  if (provider === "google") return new Google(clientId, clientSecret, redirectUri);
  if (provider === "facebook") return new Facebook(clientId, clientSecret, redirectUri);
  return new Line(clientId, clientSecret, redirectUri);
}

export interface AuthorizationRequest {
  url: string;
  state: string;
  // Empty for Facebook, which does not use PKCE.
  codeVerifier: string;
}

// Returns null when the provider is not configured, so the route can answer 404 — advertising a
// login that cannot complete is worse than not offering it.
export function createAuthorizationRequest(env: OAuthEnv, provider: OAuthProvider): AuthorizationRequest | null {
  const config = readConfig(env, provider);
  if (!config) return null;

  const client = createClient(config, provider);
  const state = generateState();
  const codeVerifier = USES_PKCE[provider] ? generateCodeVerifier() : "";

  const url = provider === "facebook" ? (client as Facebook).createAuthorizationURL(state, SCOPES[provider]) : (client as Google | Line).createAuthorizationURL(state, codeVerifier, SCOPES[provider]);

  return { url: url.toString(), state, codeVerifier };
}

// Thrown for every way the exchange can fail — a refused consent, a replayed code, an unreachable
// provider. The caller turns it into one redirect, because telling them apart tells an attacker
// which half of a forged callback was wrong.
export class OAuthExchangeError extends Error {}

export async function exchangeCode(env: OAuthEnv, provider: OAuthProvider, code: string, codeVerifier: string): Promise<SocialIdentity> {
  const config = readConfig(env, provider);
  if (!config) throw new OAuthExchangeError(`${provider} is not configured.`);

  const client = createClient(config, provider);

  let accessToken: string;
  try {
    const tokens = provider === "facebook" ? await (client as Facebook).validateAuthorizationCode(code) : await (client as Google | Line).validateAuthorizationCode(code, codeVerifier);
    accessToken = tokens.accessToken();
  } catch (error) {
    // Arctic distinguishes a provider-side rejection from a transport failure; neither is
    // something the visitor can act on differently.
    if (error instanceof OAuth2RequestError || error instanceof ArcticFetchError) throw new OAuthExchangeError("The authorization code could not be exchanged.");
    throw new OAuthExchangeError(error instanceof Error ? error.message : String(error));
  }

  return fetchIdentity(provider, accessToken);
}

const USERINFO_URLS: Record<Exclude<OAuthProvider, "facebook">, string> = {
  google: "https://openidconnect.googleapis.com/v1/userinfo",
  line: "https://api.line.me/oauth2/v2.1/userinfo",
};

async function fetchIdentity(provider: OAuthProvider, accessToken: string): Promise<SocialIdentity> {
  const response = provider === "facebook" ? await fetch(`https://graph.facebook.com/me?${new URLSearchParams({ access_token: accessToken, fields: "id,name,email" })}`) : await fetch(USERINFO_URLS[provider], { headers: { Authorization: `Bearer ${accessToken}` } });

  if (!response.ok) throw new OAuthExchangeError(`${provider} returned ${response.status} for the user info request.`);

  const user = (await response.json()) as { sub?: unknown; id?: unknown; email?: unknown; name?: unknown };
  // OpenID Connect calls it `sub`; the Facebook Graph API calls it `id`.
  const providerUserId = typeof user.sub === "string" ? user.sub : typeof user.id === "string" ? user.id : null;
  if (!providerUserId) throw new OAuthExchangeError(`${provider} returned no subject identifier.`);

  return {
    providerUserId,
    email: typeof user.email === "string" && user.email.length > 0 ? user.email.toLowerCase() : null,
    name: typeof user.name === "string" && user.name.length > 0 ? user.name : null,
  };
}
