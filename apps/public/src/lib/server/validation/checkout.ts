// The order's own numbers are never accepted from the client: the subtotal, tax, shipping fee and
// total are computed server-side from the cart and lib/commerce.ts at checkout time.
import { z } from "zod";
import { PAYMENT_METHODS } from "$lib/commerce";

const paymentMethodIds = PAYMENT_METHODS.map((method) => method.id) as [(typeof PAYMENT_METHODS)[number]["id"], ...(typeof PAYMENT_METHODS)[number]["id"][]];

export const checkoutSchema = z.object({
  // The shipping address's public_id; the service checks it belongs to this organization.
  shippingAddressId: z.string().min(1).max(32),
  paymentMethod: z.enum(paymentMethodIds),
  notes: z.string().max(1000).optional(),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
