// The templates this app owns. The transport they hand their message to (retry, subject prefix,
// fail-closed config) is shared and tested in packages/server-kit/tests/mail.test.ts.
import { describe, expect, it } from "vitest";
import { renderApplicationReceived } from "../../src/lib/server/mail/templates/application-received";
import { renderApplicationSubmittedAlert } from "../../src/lib/server/mail/templates/application-submitted-alert";
import { renderInquiryReceived } from "../../src/lib/server/mail/templates/inquiry-received";

const context = { appName: "ペット漢方 卸売", appUrl: "https://example.test" };

describe("renderInquiryReceived", () => {
  const input = { name: "山田 太郎", email: "visitor@example.test", inquiryType: "product", content: "商品について伺います。" };

  it("addresses the sender and echoes the type label, not the stored id", () => {
    const mail = renderInquiryReceived(input, context);

    expect(mail.to).toBe("visitor@example.test");
    expect(mail.text).toContain("山田 太郎 様");
    expect(mail.text).toContain("商品について");
    expect(mail.text).not.toContain("product");
  });

  it("names the type as unspecified rather than printing null", () => {
    expect(renderInquiryReceived({ ...input, inquiryType: null }, context).text).toContain("種別：指定なし");
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

describe("renderApplicationReceived", () => {
  const input = { companyName: "A 株式会社", contactName: "佐藤 花子", email: "sato@example.test", withdrawalUrl: "https://example.test/apply/cancel/tok" };

  it("carries the withdrawal link, which is the only way back into the application", () => {
    const mail = renderApplicationReceived(input, context);

    expect(mail.to).toBe("sato@example.test");
    expect(mail.text).toContain("https://example.test/apply/cancel/tok");
    expect(mail.html).toContain('href="https://example.test/apply/cancel/tok"');
  });

  it("escapes the company name the applicant typed", () => {
    const mail = renderApplicationReceived({ ...input, companyName: '"><script>x</script>' }, context);
    expect(mail.html).not.toContain("<script>");
  });
});

describe("renderApplicationSubmittedAlert", () => {
  const input = { to: "ops@example.test", publicId: "01HZZZ", companyName: "A 株式会社", contactName: "佐藤 花子", email: "sato@example.test", phone: "0312345678", adminUrl: "https://admin.example.test/applications/01HZZZ" };

  it("goes to the operator address and names the company in the subject", () => {
    const mail = renderApplicationSubmittedAlert(input, context);

    expect(mail.to).toBe("ops@example.test");
    expect(mail.subject).toContain("A 株式会社");
    expect(mail.html).toContain('href="https://admin.example.test/applications/01HZZZ"');
  });
});
