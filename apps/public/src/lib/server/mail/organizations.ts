// Notifications about a member's own trading account. Runs inside ctx.waitUntil() after the
// audit entry is committed, so nothing here may throw — the member has already been told their
// request was received (DEV-10 §3-4).
import { logIntegrationError, newRequestId } from "@app/server-kit/integration";
import { sendMail, type MailEnv } from "@app/server-kit/mail";
import type { CompanyChangeRequest } from "../services/organizations";
import { renderCompanyChangeAlert } from "./templates/company-change-alert";

export interface OrganizationNotificationEnv extends MailEnv {
  ADMIN_URL?: string;
  MAIL_ADMIN_ALERTS?: string;
}

export async function notifyCompanyChangeRequested(env: OrganizationNotificationEnv, request: CompanyChangeRequest): Promise<void> {
  const to = env.MAIL_ADMIN_ALERTS;
  const adminUrl = env.ADMIN_URL;
  if (!to || !adminUrl) {
    logIntegrationError({ requestId: newRequestId(), service: "resend", action: "company_change_alert" }, "MAIL_ADMIN_ALERTS or ADMIN_URL is not set; operator alert not sent");
    return;
  }

  await sendMail(env, (context) =>
    renderCompanyChangeAlert(
      {
        to,
        organizationName: request.organizationName,
        orgCode: request.orgCode,
        memberName: request.memberName,
        memberEmail: request.memberEmail,
        changes: request.changes,
        message: request.message,
        // The trading-partner screen is on the admin subdomain, which APP_URL does not point at.
        adminUrl: `${adminUrl}/organizations/${request.organizationPublicId}`,
      },
      context,
    ),
  );
}
