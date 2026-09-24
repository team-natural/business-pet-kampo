// Notifications for a trading-status change (DEV-09 §2-2-4). Runs inside ctx.waitUntil() after the
// batch has committed, and **never throws**: the status already moved, so an unreachable provider
// must not turn the operator's 200 into a 500 (DEV-10 §3-4).
import { logIntegrationError, newRequestId } from "@app/server-kit/integration";
import { sendMail, type MailEnv } from "@app/server-kit/mail";
import { renderOrganizationResumed, renderOrganizationSuspended } from "./templates/organization-status";

export interface OrganizationRecipient {
  email: string;
  name: string;
}

export async function notifyOrganizationStatus(env: MailEnv, to: "active" | "suspended", organizationName: string, recipients: OrganizationRecipient[]): Promise<void> {
  if (recipients.length === 0) {
    // Not an error — a partner can be suspended before anyone has been invited into it — but worth
    // a line, because "nobody was told" is otherwise invisible.
    logIntegrationError({ requestId: newRequestId(), service: "resend", action: "organization_status" }, "No active members to notify", { organizationName, to });
    return;
  }

  const render = to === "active" ? renderOrganizationResumed : renderOrganizationSuspended;
  // One mail each, in parallel: sendMail swallows its own failures, so one bad address cannot stop
  // the rest from going out.
  await Promise.all(recipients.map((recipient) => sendMail(env, (context) => render({ to: recipient.email, name: recipient.name, organizationName }, context))));
}
