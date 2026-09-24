// Neither org_code nor status is here: the first never changes once assigned (D-019), and the
// second is written only by a transition function.
import { organizations } from "@app/schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const updateOrganizationSchema = createInsertSchema(organizations, {
  name: (schema) => schema.min(1).max(100),
  billingPostalCode: (schema) => schema.max(8),
  billingAddress: (schema) => schema.max(255),
  memo: (schema) => schema.max(2000),
  orderEnabled: () => z.union([z.literal(0), z.literal(1)]),
})
  .pick({ name: true, billingPostalCode: true, billingAddress: true, memo: true, orderEnabled: true })
  .partial();

export const terminateOrganizationSchema = z.object({
  reason: z.string().min(1).max(2000),
});

export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type TerminateOrganizationInput = z.infer<typeof terminateOrganizationSchema>;
