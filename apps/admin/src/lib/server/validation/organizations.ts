// org_code と status は含まない。前者は採番後に変えないキー（D-019）、後者は遷移関数だけが書く。
import { organizations } from "@app/schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const updateOrganizationSchema = createInsertSchema(organizations, {
  name: (schema) => schema.min(1).max(100),
  billingPostalCode: (schema) => schema.max(8),
  billingAddress: (schema) => schema.max(255),
  orderEnabled: () => z.union([z.literal(0), z.literal(1)]),
})
  .pick({ name: true, billingPostalCode: true, billingAddress: true, orderEnabled: true })
  .partial();

export const terminateOrganizationSchema = z.object({
  reason: z.string().min(1).max(2000),
});

export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type TerminateOrganizationInput = z.infer<typeof terminateOrganizationSchema>;
