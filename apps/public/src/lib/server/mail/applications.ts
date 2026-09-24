// Notifications for a submitted application (F-02-02, F-10-01). Everything here runs inside
// ctx.waitUntil() after the row is committed, and **nothing here may throw**: the application is
// already stored, so a missing signing key or an unreachable provider must not turn the
// applicant's 201 into a 500 (DEV-10 §3-4).
import { signToken } from "@app/server-kit/auth";
import { logIntegrationError, newRequestId } from "@app/server-kit/integration";
import { sendMail, type MailEnv } from "@app/server-kit/mail";
import { WITHDRAWAL_TOKEN_TTL_SECONDS } from "../services/applications";
import { renderApplicationReceived } from "./templates/application-received";
import { renderApplicationSubmittedAlert } from "./templates/application-submitted-alert";

export interface ApplicationNotificationEnv extends MailEnv {
  ADMIN_URL?: string;
  MAIL_ADMIN_ALERTS?: string;
  // A Workers Secret, so it is absent from the generated Cloudflare.Env (DEV-10 §1-3).
  SESSION_SIGNING_KEY?: string;
}

export interface SubmittedApplication {
  publicId: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
}

export async function notifyApplicationSubmitted(env: ApplicationNotificationEnv, application: SubmittedApplication): Promise<void> {
  // The two sends are independent: the operator still gets told even if the applicant's link
  // cannot be minted, and vice versa.
  await Promise.all([sendApplicantAcknowledgement(env, application), sendOperatorAlert(env, application)]);
}

async function sendApplicantAcknowledgement(env: ApplicationNotificationEnv, application: SubmittedApplication): Promise<void> {
  let token: string;
  try {
    token = await signToken(env.SESSION_SIGNING_KEY, "application-withdrawal", application.publicId, WITHDRAWAL_TOKEN_TTL_SECONDS);
  } catch (error) {
    // Caught rather than propagated, but still logged as an error — an unset signing key is a
    // misconfigured deployment, not a routine outcome.
    logIntegrationError({ requestId: newRequestId(), service: "resend", action: "application_received" }, "Could not mint the withdrawal token; acknowledgement not sent", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  await sendMail(env, (context) => renderApplicationReceived({ companyName: application.companyName, contactName: application.contactName, email: application.email, withdrawalUrl: `${context.appUrl}/apply/cancel/${token}` }, context));
}

async function sendOperatorAlert(env: ApplicationNotificationEnv, application: SubmittedApplication): Promise<void> {
  const to = env.MAIL_ADMIN_ALERTS;
  const adminUrl = env.ADMIN_URL;
  if (!to || !adminUrl) {
    logIntegrationError({ requestId: newRequestId(), service: "resend", action: "application_alert" }, "MAIL_ADMIN_ALERTS or ADMIN_URL is not set; operator alert not sent");
    return;
  }

  await sendMail(env, (context) =>
    renderApplicationSubmittedAlert(
      {
        to,
        publicId: application.publicId,
        companyName: application.companyName,
        contactName: application.contactName,
        email: application.email,
        phone: application.phone,
        // The review screen is on the admin subdomain, which APP_URL does not point at.
        adminUrl: `${adminUrl}/applications/${application.publicId}`,
      },
      context,
    ),
  );
}
