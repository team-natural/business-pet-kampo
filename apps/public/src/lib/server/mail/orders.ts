// Notifications for a placed order (F-04-08, F-10-01). Runs inside ctx.waitUntil() after the
// batch committed, and **nothing here may throw**: the order exists and the buyer has already been
// shown their order number, so a missing bank var or an unreachable provider must not turn that
// into a 500 (DEV-10 §3-4).
import { logIntegrationError, newRequestId } from "@app/server-kit/integration";
import { sendMail, type MailEnv } from "@app/server-kit/mail";
import { readBankAccount, type BankAccountEnv } from "../bank-account";
import { renderOrderPlacedAlert } from "./templates/order-placed-alert";
import { renderOrderReceived } from "./templates/order-received";

export interface OrderNotificationEnv extends MailEnv, BankAccountEnv {
  ADMIN_URL?: string;
  MAIL_ADMIN_ALERTS?: string;
}

export interface PlacedOrderNotification {
  publicId: string;
  orderNumber: string;
  total: number;
  paymentMethod: "credit_card" | "bank_transfer";
  paymentDueAt: string | null;
  contactName: string;
  contactEmail: string;
  organizationName: string;
  orgCode: string;
}

export async function notifyOrderPlaced(env: OrderNotificationEnv, order: PlacedOrderNotification): Promise<void> {
  // Independent: the operator is still told even if the buyer's copy fails, and vice versa.
  await Promise.all([sendBuyerCopy(env, order), sendOperatorAlert(env, order)]);
}

async function sendBuyerCopy(env: OrderNotificationEnv, order: PlacedOrderNotification): Promise<void> {
  const bankAccount = readBankAccount(env);

  // Logged as an error rather than passed over: for a bank transfer this means the buyer is told
  // "we will send the account separately", and somebody has to actually do that.
  if (order.paymentMethod === "bank_transfer" && !bankAccount) {
    logIntegrationError({ requestId: newRequestId(), service: "resend", action: "order_received" }, "BANK_* vars are not set; the order confirmation carries no transfer destination", { orderNumber: order.orderNumber });
  }

  await sendMail(env, (context) =>
    renderOrderReceived(
      {
        to: order.contactEmail,
        contactName: order.contactName,
        orderNumber: order.orderNumber,
        total: order.total,
        paymentMethod: order.paymentMethod,
        paymentDueAt: order.paymentDueAt,
        bankAccount,
        orderUrl: `${context.appUrl}/mypage/orders/${order.publicId}`,
      },
      context,
    ),
  );
}

async function sendOperatorAlert(env: OrderNotificationEnv, order: PlacedOrderNotification): Promise<void> {
  const to = env.MAIL_ADMIN_ALERTS;
  const adminUrl = env.ADMIN_URL;
  if (!to || !adminUrl) {
    logIntegrationError({ requestId: newRequestId(), service: "resend", action: "order_alert" }, "MAIL_ADMIN_ALERTS or ADMIN_URL is not set; operator alert not sent");
    return;
  }

  await sendMail(env, (context) =>
    renderOrderPlacedAlert(
      {
        to,
        orderNumber: order.orderNumber,
        organizationName: order.organizationName,
        orgCode: order.orgCode,
        contactName: order.contactName,
        total: order.total,
        paymentMethod: order.paymentMethod,
        paymentDueAt: order.paymentDueAt,
        // The order screen is on the admin subdomain, which APP_URL does not point at.
        adminUrl: `${adminUrl}/orders/${order.publicId}`,
      },
      context,
    ),
  );
}
