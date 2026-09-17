// The visitor-facing half. What matters here is that a form post cannot reach the columns the
// server owns — apps/admin's tests cover everything that happens afterwards.
import { env } from "cloudflare:workers";
import { inquiries } from "@app/schema";
import { createDb } from "@app/schema/client";
import { beforeEach, describe, expect, it } from "vitest";
import { createInquiry } from "../../src/lib/server/services/inquiries";
import { createInquirySchema } from "../../src/lib/server/validation/inquiries";

const db = createDb(env.DB);
const form = { companyName: "テスト商店", name: "Visitor", email: "visitor@example.com", phone: "03-0000-0000", inquiryType: "product" as const, content: "Hello" };

beforeEach(async () => {
  await db.delete(inquiries);
});

describe("createInquirySchema", () => {
  it("drops the columns the server owns", () => {
    // Without the pick, a form post could arrive pre-resolved and pre-assigned.
    const parsed = createInquirySchema.parse({ ...form, status: "resolved", assigneeId: 1, memo: "spoofed", publicId: "spoofed" });
    expect(parsed).toEqual(form);
  });

  it("requires a usable email and a non-empty message", () => {
    expect(createInquirySchema.safeParse({ ...form, email: "not-an-email" }).success).toBe(false);
    expect(createInquirySchema.safeParse({ ...form, content: "" }).success).toBe(false);
    // Bounded so a single request cannot push an arbitrarily large row into D1.
    expect(createInquirySchema.safeParse({ ...form, content: "x".repeat(2001) }).success).toBe(false);
  });

  it("only accepts a type the constant declares", () => {
    // A free-text type would file a row under a category no screen can render (D-024).
    expect(createInquirySchema.safeParse({ ...form, inquiryType: "not-a-type" }).success).toBe(false);
    expect(createInquirySchema.safeParse({ companyName: undefined, name: form.name, email: form.email, content: form.content }).success).toBe(true);
  });
});

describe("createInquiry", () => {
  it("returns only the public id, and files the row as new and unassigned", async () => {
    const created = await createInquiry(db, form);

    expect(created).toEqual({ id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/) });
    const [row] = await db.select().from(inquiries);
    expect(row).toMatchObject({ status: "new", assigneeId: null, memo: null, email: form.email });
  });
});
