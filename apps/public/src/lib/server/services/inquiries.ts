// The visitor-facing half of the inquiry lifecycle. apps/admin owns reading and handling them;
// both Workers reach the same D1, so neither imports the other.
import { inquiries } from "@app/schema";
import type { DbClient } from "@app/schema/client";
import { ulid } from "@app/schema/ulid";
import type { CreateInquiryInput } from "../validation/inquiries";

export async function createInquiry(db: DbClient, input: CreateInquiryInput) {
  const now = new Date().toISOString();
  const [row] = await db
    .insert(inquiries)
    .values({
      publicId: ulid(),
      companyName: input.companyName ?? null,
      name: input.name,
      email: input.email,
      phone: input.phone ?? null,
      inquiryType: input.inquiryType ?? null,
      content: input.content,
      // Server-set, not client-set: an inbox a visitor could pre-resolve is not an inbox.
      status: "new",
      assigneeId: null,
      memo: null,
      updatedAt: now,
    })
    .returning();
  return { id: row!.publicId };
}
