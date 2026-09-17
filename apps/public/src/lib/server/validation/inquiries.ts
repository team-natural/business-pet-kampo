// Derived from the table, so a column change surfaces here as a type error. `status`,
// `publicId`, `assigneeId` and `memo` are picked off: they belong to the server, not to a form
// post.
import { inquiries } from "@app/schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { INQUIRY_TYPE_IDS } from "$lib/inquiry";

export const createInquirySchema = createInsertSchema(inquiries, {
  companyName: (schema) => schema.max(100),
  name: (schema) => schema.min(1).max(100),
  email: () => z.email().max(255),
  phone: (schema) => schema.max(20),
  // Constrained to the constant's ids (D-024): a free-text type would let a row name a category
  // no screen can render.
  inquiryType: () => z.enum(INQUIRY_TYPE_IDS),
  content: (schema) => schema.min(1).max(2000),
})
  .pick({ companyName: true, name: true, email: true, phone: true, inquiryType: true, content: true })
  // The nullable columns are optional on the wire too: a form that omits them posts nothing,
  // not an explicit null.
  .partial({ companyName: true, phone: true, inquiryType: true });

export type CreateInquiryInput = z.infer<typeof createInquirySchema>;
