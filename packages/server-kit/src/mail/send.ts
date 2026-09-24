// The one place mail leaves either app. Every caller goes through sendMail so the retry rule
// (DEV-10 §1-2), the structured log (DEV-10 §8-1) and the subject convention (DEV-10 §3-4) are
// applied once instead of per call site.
//
// Shared rather than duplicated per app: both apps/public and apps/admin send mail (DEV-10 §3-1),
// and a second copy is where the retry classification or the 【service name】 prefix quietly
// drifts. The templates stay in each app — the copy is theirs, the transport is not.
import { RetryableError, isRetryableStatus, logIntegrationError, logIntegrationInfo, newRequestId, truncateForLog, withRetry } from "../integration";
import { createResendClient, readMailConfig, type MailEnv } from "./client";

export interface MailMessage {
  to: string;
  // Without the 【service name】 prefix; sendMail adds it (DEV-10 §3-4).
  subject: string;
  html: string;
  text: string;
}

// Templates receive the config so they can link back to the site without importing env themselves.
export interface MailTemplateContext {
  appName: string;
  appUrl: string;
}

export interface SendMailOptions {
  // Tests inject a sleep so they do not wait out the real backoff.
  sleep?: (ms: number) => Promise<void>;
}

// Returns rather than throws: callers run this inside ctx.waitUntil(), where an unhandled
// rejection would be swallowed anyway. A failed notification must never change what the visitor
// was told about their own submission.
export async function sendMail(env: MailEnv, build: (context: MailTemplateContext) => MailMessage, options: SendMailOptions = {}): Promise<boolean> {
  const requestId = newRequestId();
  const context = { requestId, service: "resend", action: "send_email" };

  try {
    const config = readMailConfig(env);
    const message = build({ appName: config.appName, appUrl: config.appUrl });
    const resend = createResendClient(config.apiKey);
    // Prefixed here so no template can forget it, and so the name follows APP_NAME (TBD-01).
    const subject = `【${config.appName}】${message.subject}`;

    await withRetry(
      async (attempt) => {
        const { data, error } = await resend.emails.send({ from: config.from, to: message.to, subject, html: message.html, text: message.text });

        if (error) {
          // Resend reports the provider's status here; anything transient earns another attempt,
          // a rejected address does not.
          const status = (error as { statusCode?: number }).statusCode ?? 0;
          const detail = { attempt, status, providerError: truncateForLog(error) };
          if (status === 0 || isRetryableStatus(status)) throw new RetryableError("Resend returned a retryable error", detail);

          logIntegrationError(context, "Mail rejected by provider", detail);
          throw new Error(`Resend rejected the message with status ${status}`);
        }

        logIntegrationInfo(context, "Mail sent", { attempt, providerMessageId: data?.id });
      },
      { sleep: options.sleep },
    );

    return true;
  } catch (error) {
    // The recipient is deliberately absent: DEV-05 §9 forbids personal data in logs.
    logIntegrationError(context, "Mail send failed", { reason: truncateForLog(error instanceof Error ? error.message : error) });
    return false;
  }
}
