// Derived from the table so a column change surfaces here as a type error. status / reviewerId /
// reviewMemo / organizationId are picked off: they belong to the review, not to the form.
import { applications } from "@app/schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const createApplicationSchema = createInsertSchema(applications, {
  companyName: (schema) => schema.min(1).max(100),
  corporateNumber: (schema) => schema.max(13),
  postalCode: (schema) => schema.max(8),
  address: (schema) => schema.min(1).max(255),
  representativeName: (schema) => schema.min(1).max(100),
  contactName: (schema) => schema.min(1).max(100),
  phone: (schema) => schema.min(1).max(20),
  email: () => z.email().max(255),
  website: () => z.url().max(255).optional(),
  notes: (schema) => schema.max(2000),
  // Checked, not merely present: an unchecked box must fail rather than store 0.
  agreedToTerms: () => z.literal(1),
  // The value is compared against the current constant in the service — a stale form must not
  // record consent to wording nobody can reconstruct (DEV-06 §1-1).
  agreedTermsVersion: (schema) => schema.min(1).max(32),
})
  .pick({
    companyName: true,
    corporateNumber: true,
    businessType: true,
    industry: true,
    postalCode: true,
    address: true,
    representativeName: true,
    contactName: true,
    contactDepartment: true,
    phone: true,
    email: true,
    website: true,
    sns: true,
    hasPhysicalStore: true,
    plannedSalesChannels: true,
    desiredProducts: true,
    desiredPaymentMethod: true,
    notes: true,
    agreedToTerms: true,
    agreedTermsVersion: true,
  })
  .partial({
    corporateNumber: true,
    businessType: true,
    industry: true,
    contactDepartment: true,
    website: true,
    sns: true,
    hasPhysicalStore: true,
    plannedSalesChannels: true,
    desiredProducts: true,
    desiredPaymentMethod: true,
    notes: true,
  });

export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;
