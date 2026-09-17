// email is editable but `status` and `passwordHash` are not: an account cannot reactivate itself,
// and a password change goes through the reset flow so the old one is proven.
import { members } from "@app/schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const updateMemberSchema = createInsertSchema(members, {
  name: (schema) => schema.min(1).max(100),
  email: () => z.email().max(255),
  phone: (schema) => schema.max(20),
})
  .pick({ name: true, email: true, phone: true })
  .partial({ phone: true });

// Company details the operator must confirm before they take effect (PRD-03 F-05-03).
export const companyChangeRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  billingPostalCode: z.string().max(8).optional(),
  billingAddress: z.string().max(255).optional(),
  message: z.string().max(1000).optional(),
});

export const withdrawalSchema = z.object({
  reason: z.string().max(1000).optional(),
});

export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type CompanyChangeRequestInput = z.infer<typeof companyChangeRequestSchema>;
export type WithdrawalInput = z.infer<typeof withdrawalSchema>;
