// Notifications for a reviewed application (F-02-06, F-02-07, F-10-01). Everything here runs
// inside ctx.waitUntil() after the batch has committed, and **nothing here may throw**: the
// decision is already recorded, so a missing signing key or an unreachable provider must not turn
// the reviewer's 200 into a 500 (DEV-10 §3-4).
import { signToken } from "@app/server-kit/auth";
import { logIntegrationError, newRequestId } from "@app/server-kit/integration";
import { sendMail, type MailEnv } from "@app/server-kit/mail";
import { renderApplicationApproved } from "./templates/application-approved";
import { renderApplicationRejected } from "./templates/application-rejected";

// Long enough for an approval that lands on a Friday, short enough that a forwarded inbox does not
// keep a password-setting link alive for months.
const ACTIVATION_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface ApplicationMailEnv extends MailEnv {
  // A Workers Secret, so it is absent from the generated Cloudflare.Env (DEV-10 §1-3).
  SESSION_SIGNING_KEY?: string;
}

export interface ApprovedApplicationMail {
  companyName: string;
  contactName: string;
  email: string;
  orgCode: string;
  memberPublicId: string;
}

export async function notifyApplicationApproved(env: ApplicationMailEnv, application: ApprovedApplicationMail): Promise<void> {
  const context = { requestId: newRequestId(), service: "resend", action: "application_approved" };

  let token: string;
  try {
    // The subject is the member, not the application: the link sets that member's password, and
    // S5's activation endpoint resolves it back to exactly that row.
    token = await signToken(env.SESSION_SIGNING_KEY, "account-activation", application.memberPublicId, ACTIVATION_TOKEN_TTL_SECONDS);
  } catch (error) {
    // An approved partner with no way in is worth an error line, but not a failed request.
    logIntegrationError(context, "Could not mint the activation token; approval mail not sent", { reason: error instanceof Error ? error.message : String(error) });
    return;
  }

  // APP_URL is the public site — activation happens there, not on this subdomain.
  await sendMail(env, (template) => renderApplicationApproved({ ...application, activationUrl: `${template.appUrl}/activate/${token}` }, template));
}

export interface RejectedApplicationMail {
  companyName: string;
  contactName: string;
  email: string;
  reason: string;
}

export async function notifyApplicationRejected(env: ApplicationMailEnv, application: RejectedApplicationMail): Promise<void> {
  await sendMail(env, (template) => renderApplicationRejected(application, template));
}
