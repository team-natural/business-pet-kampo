// Resend is mocked throughout — no test may reach the real API (DEV-10 §9).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readMailConfig } from "../../src/lib/server/mail/client";
import { renderInquiryReceived } from "../../src/lib/server/mail/templates/inquiry-received";

const send = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));

const { sendMail } = await import("../../src/lib/server/mail/send");

const ENV = {
  RESEND_API_KEY: "re_test",
  MAIL_FROM_ADDRESS: "noreply@example.test",
  MAIL_FROM_NAME: "ペット漢方 卸売",
  APP_NAME: "ペット漢方 卸売",
  APP_URL: "https://example.test",
};

const message = () => ({ to: "visitor@example.test", subject: "お問い合わせを受け付けました", html: "<p>本文</p>", text: "本文" });
const noSleep = () => Promise.resolve();

beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue({ data: { id: "provider-id" }, error: null });
});

describe("readMailConfig", () => {
  it("builds the From header from the name and address", () => {
    expect(readMailConfig(ENV).from).toBe("ペット漢方 卸売 <noreply@example.test>");
  });

  it("falls back to the bare address when no display name is set", () => {
    expect(readMailConfig({ ...ENV, MAIL_FROM_NAME: undefined }).from).toBe("noreply@example.test");
  });

  // The same fail-closed rule as SESSION_TTL_DAYS and CF_ACCESS_*: a missing value must not
  // resolve to a silent default (DEV-05 §10).
  it.each(["RESEND_API_KEY", "MAIL_FROM_ADDRESS", "APP_NAME", "APP_URL"])("throws when %s is missing", (key) => {
    expect(() => readMailConfig({ ...ENV, [key]: undefined })).toThrow(key);
  });
});

describe("sendMail", () => {
  it("prefixes the subject with the service name so no template has to remember to", async () => {
    await sendMail(ENV, message, { sleep: noSleep });
    expect(send.mock.calls[0]![0]).toMatchObject({ subject: "【ペット漢方 卸売】お問い合わせを受け付けました", to: "visitor@example.test" });
  });

  it("retries a provider 5xx and reports success once it lands", async () => {
    send.mockResolvedValueOnce({ data: null, error: { statusCode: 503, message: "unavailable" } });

    await expect(sendMail(ENV, message, { sleep: noSleep })).resolves.toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("does not retry a provider 4xx", async () => {
    send.mockResolvedValue({ data: null, error: { statusCode: 422, message: "invalid recipient" } });

    await expect(sendMail(ENV, message, { sleep: noSleep })).resolves.toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  // Callers run this inside ctx.waitUntil(); a throw there would be swallowed, and the visitor's
  // own response must not depend on the provider either way.
  it("reports failure instead of throwing when the config is missing", async () => {
    await expect(sendMail({}, message, { sleep: noSleep })).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("reports failure instead of throwing when the provider is unreachable", async () => {
    send.mockRejectedValue(new TypeError("network error"));
    await expect(sendMail(ENV, message, { sleep: noSleep })).resolves.toBe(false);
  });
});

describe("renderInquiryReceived", () => {
  const context = { appName: "ペット漢方 卸売", appUrl: "https://example.test" };
  const input = { name: "山田 太郎", email: "visitor@example.test", inquiryType: "product", content: "商品について伺います。" };

  it("addresses the sender and echoes the type label, not the stored id", () => {
    const mail = renderInquiryReceived(input, context);

    expect(mail.to).toBe("visitor@example.test");
    expect(mail.text).toContain("山田 太郎 様");
    expect(mail.text).toContain("商品について");
    expect(mail.text).not.toContain("product");
  });

  it("names the type as unspecified rather than printing null", () => {
    const mail = renderInquiryReceived({ ...input, inquiryType: null }, context);
    expect(mail.text).toContain("種別：指定なし");
  });

  // Everything here was typed by an unauthenticated visitor.
  it("escapes markup the visitor typed", () => {
    const mail = renderInquiryReceived({ ...input, name: "<script>alert(1)</script>" }, context);

    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });

  it("carries no service-name prefix of its own — sendMail adds it", () => {
    expect(renderInquiryReceived(input, context).subject).toBe("お問い合わせを受け付けました");
  });
});
