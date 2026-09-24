// The mail transport both apps share (DEV-10 §3). Resend is mocked throughout — no test may reach
// the real API (DEV-10 §9). These live here rather than in an app because the mock and the code
// under test have to resolve the same `resend` module.
import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));

const { readMailConfig, sendMail } = await import("../src/mail/index");

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
