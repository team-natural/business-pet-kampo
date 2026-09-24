import { sql } from "drizzle-orm";
import { type AnySQLiteColumn, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// D1 holds transactional data only. Products, manufacturers, brands, per-organization prices,
// news and the diagnosis rules are Markdown in packages/content (D-017〜D-019), so there is no
// products table for cart_items/order_items to point at.

const createdAt = () =>
  text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);

// A ledger, not a credential store: authentication is Cloudflare Access (D-022). Never add
// password_hash or a session table here — a second door into apps/admin walks around the Access
// policy.
export const adminUsers = sqliteTable(
  "admin_users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    publicId: text("public_id").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    status: text("status", { enum: ["active", "inactive"] }).notNull(),
    lastLoginAt: text("last_login_at"),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("uq_admin_users_public_id").on(table.publicId), uniqueIndex("uq_admin_users_email").on(table.email), index("idx_admin_users_status").on(table.status)],
);

// applications and organizations reference each other: the approval creates the organization and
// records it here. The return type annotation is what keeps that cycle from breaking inference.
export const applications = sqliteTable(
  "applications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    publicId: text("public_id").notNull(),
    companyName: text("company_name").notNull(),
    corporateNumber: text("corporate_number"),
    businessType: text("business_type"),
    industry: text("industry"),
    postalCode: text("postal_code").notNull(),
    address: text("address").notNull(),
    representativeName: text("representative_name").notNull(),
    contactName: text("contact_name").notNull(),
    contactDepartment: text("contact_department"),
    phone: text("phone").notNull(),
    email: text("email").notNull(),
    website: text("website"),
    sns: text("sns"),
    hasPhysicalStore: integer("has_physical_store").notNull().default(0),
    plannedSalesChannels: text("planned_sales_channels"),
    desiredProducts: text("desired_products"),
    desiredPaymentMethod: text("desired_payment_method"),
    notes: text("notes"),
    agreedToTerms: integer("agreed_to_terms").notNull(),
    // Which version they agreed to. The terms themselves are a page, so without this column the
    // agreed wording cannot be reconstructed after a revision.
    agreedTermsVersion: text("agreed_terms_version").notNull(),
    status: text("status", { enum: ["received", "reviewing", "needs_confirmation", "approved", "rejected", "withdrawn"] }).notNull(),
    reviewerId: integer("reviewer_id").references(() => adminUsers.id),
    reviewMemo: text("review_memo"),
    appliedAt: text("applied_at").notNull(),
    reviewedAt: text("reviewed_at"),
    organizationId: integer("organization_id").references((): AnySQLiteColumn => organizations.id),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("uq_applications_public_id").on(table.publicId), index("idx_applications_status").on(table.status), index("idx_applications_email").on(table.email), index("idx_applications_reviewer_id").on(table.reviewerId), index("idx_applications_organization_id").on(table.organizationId)],
);

export const organizations = sqliteTable(
  "organizations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    publicId: text("public_id").notNull(),
    // The key the per-organization price files in packages/content point at (D-019). Immutable
    // once assigned: no foreign key protects it, so a change silently falls back to list price.
    orgCode: text("org_code").notNull(),
    name: text("name").notNull(),
    status: text("status", { enum: ["active", "suspended", "terminated"] }).notNull(),
    orderEnabled: integer("order_enabled").notNull().default(1),
    billingPostalCode: text("billing_postal_code"),
    billingAddress: text("billing_address"),
    memo: text("memo"),
    // The retention clock's start (DEV-07 §10). Separate from updated_at, which a later memo edit
    // would move — and the deletion batch would then keep deferring.
    terminatedAt: text("terminated_at"),
    applicationId: integer("application_id").references(() => applications.id),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("uq_organizations_public_id").on(table.publicId), uniqueIndex("uq_organizations_org_code").on(table.orgCode), index("idx_organizations_status").on(table.status), index("idx_organizations_application_id").on(table.applicationId)],
);

// Members reach orders through memberships → organizations (D-004). Nothing here is shared with
// admin_users: the two are separate account systems with different threat models.
export const members = sqliteTable(
  "members",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    publicId: text("public_id").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    // Null for OAuth-only members (D-004).
    passwordHash: text("password_hash"),
    phone: text("phone"),
    status: text("status", { enum: ["active", "suspended", "deactivated"] }).notNull(),
    lastLoginAt: text("last_login_at"),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("uq_members_public_id").on(table.publicId), uniqueIndex("uq_members_email").on(table.email), index("idx_members_status").on(table.status)],
);

export const memberSessions = sqliteTable(
  "member_sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id),
    sessionToken: text("session_token").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("uq_member_sessions_session_token").on(table.sessionToken), index("idx_member_sessions_member_id").on(table.memberId), index("idx_member_sessions_expires_at").on(table.expiresAt)],
);

export const memberPasswordResetTokens = sqliteTable(
  "member_password_reset_tokens",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id),
    token: text("token").notNull(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("uq_member_password_reset_tokens_token").on(table.token), index("idx_member_password_reset_tokens_member_id").on(table.memberId), index("idx_member_password_reset_tokens_expires_at").on(table.expiresAt)],
);

export const socialAccounts = sqliteTable(
  "social_accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id),
    provider: text("provider", { enum: ["line", "google", "facebook"] }).notNull(),
    providerUserId: text("provider_user_id").notNull(),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("uq_social_accounts_provider_provider_user_id").on(table.provider, table.providerUserId), index("idx_social_accounts_member_id").on(table.memberId)],
);

// One organization per member (D-031). Widening this back to a composite unique also means giving
// the session a selected organization and a way to switch it — without that, a member in two
// companies orders as whichever row the query happened to return.
export const memberships = sqliteTable(
  "memberships",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id),
    role: text("role", { enum: ["client_user"] }).notNull(),
    status: text("status", { enum: ["active", "suspended"] }).notNull(),
    joinedAt: text("joined_at").notNull(),
    leftAt: text("left_at"),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("uq_memberships_member_id").on(table.memberId), index("idx_memberships_organization_id").on(table.organizationId)],
);

export const shippingAddresses = sqliteTable(
  "shipping_addresses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    publicId: text("public_id").notNull(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id),
    recipientName: text("recipient_name").notNull(),
    postalCode: text("postal_code").notNull(),
    address: text("address").notNull(),
    phone: text("phone").notNull(),
    isDefault: integer("is_default").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("uq_shipping_addresses_public_id").on(table.publicId), index("idx_shipping_addresses_organization_id").on(table.organizationId)],
);

// product_slug points into packages/content, which D1 cannot constrain. The service layer's
// existence check is the only thing standing in for the foreign key (DEV-07 §6-0).
export const cartItems = sqliteTable(
  "cart_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id),
    productSlug: text("product_slug").notNull(),
    quantity: integer("quantity").notNull(),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("uq_cart_items_organization_id_member_id_product_slug").on(table.organizationId, table.memberId, table.productSlug), index("idx_cart_items_organization_id").on(table.organizationId)],
);

export const orders = sqliteTable(
  "orders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    publicId: text("public_id").notNull(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id),
    orderNumber: text("order_number").notNull(),
    status: text("status", { enum: ["received", "confirming", "preparing", "shipped", "completed", "cancelled"] }).notNull(),
    paymentStatus: text("payment_status", { enum: ["unpaid", "awaiting_transfer", "processing", "paid", "failed", "refunded", "partially_refunded"] }).notNull(),
    subtotal: integer("subtotal").notNull(),
    tax: integer("tax").notNull(),
    shippingFee: integer("shipping_fee").notNull(),
    total: integer("total").notNull(),
    shippingAddressSnapshot: text("shipping_address_snapshot").notNull(),
    paymentMethod: text("payment_method", { enum: ["credit_card", "bank_transfer"] }).notNull(),
    notes: text("notes"),
    placedAt: text("placed_at").notNull(),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("uq_orders_public_id").on(table.publicId), uniqueIndex("uq_orders_order_number").on(table.orderNumber), index("idx_orders_organization_id_status").on(table.organizationId, table.status), index("idx_orders_payment_status").on(table.paymentStatus), index("idx_orders_member_id").on(table.memberId)],
);

// Display order lines from the snapshot columns, never by re-reading the Markdown: a price
// revision would otherwise rewrite every past order.
export const orderItems = sqliteTable(
  "order_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id),
    productSlug: text("product_slug").notNull(),
    productNameSnapshot: text("product_name_snapshot").notNull(),
    productCodeSnapshot: text("product_code_snapshot"),
    unitPriceSnapshot: integer("unit_price_snapshot").notNull(),
    taxRateSnapshot: text("tax_rate_snapshot").notNull(),
    quantity: integer("quantity").notNull(),
    subtotal: integer("subtotal").notNull(),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_order_items_order_id").on(table.orderId), index("idx_order_items_product_slug").on(table.productSlug)],
);

export const payments = sqliteTable(
  "payments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id),
    method: text("method", { enum: ["credit_card", "bank_transfer"] }).notNull(),
    status: text("status", { enum: ["unpaid", "awaiting_transfer", "processing", "paid", "failed", "refunded", "partially_refunded"] }).notNull(),
    amount: integer("amount").notNull(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    paidAt: text("paid_at"),
    refundedAt: text("refunded_at"),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_payments_organization_id").on(table.organizationId), index("idx_payments_order_id").on(table.orderId), index("idx_payments_status").on(table.status)],
);

// The unique constraint is the webhook idempotency: a redelivered event fails its second INSERT
// instead of applying the payment state twice.
export const paymentEventLogs = sqliteTable(
  "payment_event_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: text("payload").notNull(),
    processedAt: text("processed_at"),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("uq_payment_event_logs_provider_event_id").on(table.providerEventId)],
);

export const inquiries = sqliteTable(
  "inquiries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    publicId: text("public_id").notNull(),
    companyName: text("company_name"),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    // The id from lib/inquiry.ts, never the label — a reworded label would contradict past rows.
    inquiryType: text("inquiry_type"),
    content: text("content").notNull(),
    status: text("status", { enum: ["new", "in_progress", "resolved"] }).notNull(),
    assigneeId: integer("assignee_id").references(() => adminUsers.id),
    memo: text("memo"),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("uq_inquiries_public_id").on(table.publicId), index("idx_inquiries_status").on(table.status), index("idx_inquiries_assignee_id").on(table.assigneeId), index("idx_inquiries_created_at").on(table.createdAt)],
);

// causer_id is polymorphic (AdminUser or Member) and so carries no foreign key; organization_id
// is null for operations that belong to no organization, such as handling an inquiry.
export const activityLog = sqliteTable(
  "activity_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    logName: text("log_name"),
    description: text("description").notNull(),
    subjectType: text("subject_type"),
    subjectId: integer("subject_id"),
    event: text("event"),
    causerType: text("causer_type"),
    causerId: integer("causer_id"),
    properties: text("properties"),
    batchId: text("batch_id"),
    organizationId: integer("organization_id").references(() => organizations.id),
    createdAt: createdAt(),
  },
  (table) => [index("idx_activity_log_subject").on(table.subjectType, table.subjectId), index("idx_activity_log_causer").on(table.causerType, table.causerId), index("idx_activity_log_log_name").on(table.logName), index("idx_activity_log_organization_id").on(table.organizationId)],
);
