// Resend is the mail provider (DEV-01 §1, DEV-10 §3). The SDK is fetch-based, so it runs in
// workerd without nodejs_compat shims.
import { Resend } from "resend";

export interface MailEnv {
  RESEND_API_KEY?: string;
  MAIL_FROM_ADDRESS?: string;
  MAIL_FROM_NAME?: string;
  APP_NAME?: string;
  APP_URL?: string;
}

export interface MailConfig {
  apiKey: string;
  from: string;
  appName: string;
  appUrl: string;
}

// Missing config throws rather than defaulting, the same rule the session TTL and the Access
// variables follow (DEV-05 §10). A blank sender would otherwise be rejected by Resend on every
// send, and the only trace would be a log line nobody is watching.
export function readMailConfig(env: MailEnv): MailConfig {
  const apiKey = env.RESEND_API_KEY;
  const address = env.MAIL_FROM_ADDRESS;
  const appName = env.APP_NAME;
  const appUrl = env.APP_URL;

  if (!apiKey) throw new Error("RESEND_API_KEY is not set.");
  if (!address) throw new Error("MAIL_FROM_ADDRESS is not set.");
  if (!appName) throw new Error("APP_NAME is not set.");
  if (!appUrl) throw new Error("APP_URL is not set.");

  // `Name <address>` when a display name is configured; Resend accepts the bare address too.
  const from = env.MAIL_FROM_NAME ? `${env.MAIL_FROM_NAME} <${address}>` : address;
  return { apiKey, from, appName, appUrl };
}

export function createResendClient(apiKey: string): Resend {
  return new Resend(apiKey);
}
