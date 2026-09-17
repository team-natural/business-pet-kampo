// product_slug has no foreign key to validate against (D-017), so the shape is checked here and
// the existence is checked in the service — that check is the only thing standing in for the
// constraint.
import { cartItems } from "@app/schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const addCartItemSchema = createInsertSchema(cartItems, {
  productSlug: (schema) => schema.min(1).max(120),
  quantity: (schema) => schema.int().positive().max(9999),
}).pick({ productSlug: true, quantity: true });

export const updateCartItemSchema = z.object({
  quantity: z.number().int().positive().max(9999),
});

export type AddCartItemInput = z.infer<typeof addCartItemSchema>;
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;
