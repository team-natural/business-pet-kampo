// organizationId is absent by construction: it comes from the session, and a field that cannot
// be sent cannot be spoofed.
import { shippingAddresses } from "@app/schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const addressSchema = createInsertSchema(shippingAddresses, {
  recipientName: (schema) => schema.min(1).max(100),
  postalCode: (schema) => schema.min(1).max(8),
  address: (schema) => schema.min(1).max(255),
  phone: (schema) => schema.min(1).max(20),
  isDefault: () => z.union([z.literal(0), z.literal(1)]),
})
  .pick({ recipientName: true, postalCode: true, address: true, phone: true, isDefault: true })
  .partial({ isDefault: true });

export type AddressInput = z.infer<typeof addressSchema>;
