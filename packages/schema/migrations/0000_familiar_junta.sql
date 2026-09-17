CREATE TABLE `activity_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`log_name` text,
	`description` text NOT NULL,
	`subject_type` text,
	`subject_id` integer,
	`event` text,
	`causer_type` text,
	`causer_id` integer,
	`properties` text,
	`batch_id` text,
	`organization_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_activity_log_subject` ON `activity_log` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `idx_activity_log_causer` ON `activity_log` (`causer_type`,`causer_id`);--> statement-breakpoint
CREATE INDEX `idx_activity_log_log_name` ON `activity_log` (`log_name`);--> statement-breakpoint
CREATE INDEX `idx_activity_log_organization_id` ON `activity_log` (`organization_id`);--> statement-breakpoint
CREATE TABLE `admin_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`status` text NOT NULL,
	`last_login_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_admin_users_public_id` ON `admin_users` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_admin_users_email` ON `admin_users` (`email`);--> statement-breakpoint
CREATE INDEX `idx_admin_users_status` ON `admin_users` (`status`);--> statement-breakpoint
CREATE TABLE `applications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`company_name` text NOT NULL,
	`corporate_number` text,
	`business_type` text,
	`industry` text,
	`postal_code` text NOT NULL,
	`address` text NOT NULL,
	`representative_name` text NOT NULL,
	`contact_name` text NOT NULL,
	`contact_department` text,
	`phone` text NOT NULL,
	`email` text NOT NULL,
	`website` text,
	`sns` text,
	`has_physical_store` integer DEFAULT 0 NOT NULL,
	`planned_sales_channels` text,
	`desired_products` text,
	`desired_payment_method` text,
	`notes` text,
	`agreed_to_terms` integer NOT NULL,
	`agreed_terms_version` text NOT NULL,
	`status` text NOT NULL,
	`reviewer_id` integer,
	`review_memo` text,
	`applied_at` text NOT NULL,
	`reviewed_at` text,
	`organization_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`reviewer_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_applications_public_id` ON `applications` (`public_id`);--> statement-breakpoint
CREATE INDEX `idx_applications_status` ON `applications` (`status`);--> statement-breakpoint
CREATE INDEX `idx_applications_email` ON `applications` (`email`);--> statement-breakpoint
CREATE INDEX `idx_applications_reviewer_id` ON `applications` (`reviewer_id`);--> statement-breakpoint
CREATE INDEX `idx_applications_organization_id` ON `applications` (`organization_id`);--> statement-breakpoint
CREATE TABLE `cart_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`member_id` integer NOT NULL,
	`product_slug` text NOT NULL,
	`quantity` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_cart_items_organization_id_member_id_product_slug` ON `cart_items` (`organization_id`,`member_id`,`product_slug`);--> statement-breakpoint
CREATE INDEX `idx_cart_items_organization_id` ON `cart_items` (`organization_id`);--> statement-breakpoint
CREATE TABLE `inquiries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`company_name` text,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`inquiry_type` text,
	`content` text NOT NULL,
	`status` text NOT NULL,
	`assignee_id` integer,
	`memo` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`assignee_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_inquiries_public_id` ON `inquiries` (`public_id`);--> statement-breakpoint
CREATE INDEX `idx_inquiries_status` ON `inquiries` (`status`);--> statement-breakpoint
CREATE INDEX `idx_inquiries_assignee_id` ON `inquiries` (`assignee_id`);--> statement-breakpoint
CREATE INDEX `idx_inquiries_created_at` ON `inquiries` (`created_at`);--> statement-breakpoint
CREATE TABLE `member_password_reset_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer NOT NULL,
	`token` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_member_password_reset_tokens_token` ON `member_password_reset_tokens` (`token`);--> statement-breakpoint
CREATE INDEX `idx_member_password_reset_tokens_member_id` ON `member_password_reset_tokens` (`member_id`);--> statement-breakpoint
CREATE INDEX `idx_member_password_reset_tokens_expires_at` ON `member_password_reset_tokens` (`expires_at`);--> statement-breakpoint
CREATE TABLE `member_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer NOT NULL,
	`session_token` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_member_sessions_session_token` ON `member_sessions` (`session_token`);--> statement-breakpoint
CREATE INDEX `idx_member_sessions_member_id` ON `member_sessions` (`member_id`);--> statement-breakpoint
CREATE INDEX `idx_member_sessions_expires_at` ON `member_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text,
	`phone` text,
	`status` text NOT NULL,
	`last_login_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_members_public_id` ON `members` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_members_email` ON `members` (`email`);--> statement-breakpoint
CREATE INDEX `idx_members_status` ON `members` (`status`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer NOT NULL,
	`organization_id` integer NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`joined_at` text NOT NULL,
	`left_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_memberships_member_id_organization_id` ON `memberships` (`member_id`,`organization_id`);--> statement-breakpoint
CREATE INDEX `idx_memberships_organization_id` ON `memberships` (`organization_id`);--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`product_slug` text NOT NULL,
	`product_name_snapshot` text NOT NULL,
	`product_code_snapshot` text,
	`unit_price_snapshot` integer NOT NULL,
	`tax_rate_snapshot` text NOT NULL,
	`quantity` integer NOT NULL,
	`subtotal` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_order_items_order_id` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_order_items_product_slug` ON `order_items` (`product_slug`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`organization_id` integer NOT NULL,
	`member_id` integer NOT NULL,
	`order_number` text NOT NULL,
	`status` text NOT NULL,
	`payment_status` text NOT NULL,
	`subtotal` integer NOT NULL,
	`tax` integer NOT NULL,
	`shipping_fee` integer NOT NULL,
	`total` integer NOT NULL,
	`shipping_address_snapshot` text NOT NULL,
	`payment_method` text NOT NULL,
	`notes` text,
	`placed_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_orders_public_id` ON `orders` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_orders_order_number` ON `orders` (`order_number`);--> statement-breakpoint
CREATE INDEX `idx_orders_organization_id_status` ON `orders` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_orders_payment_status` ON `orders` (`payment_status`);--> statement-breakpoint
CREATE INDEX `idx_orders_member_id` ON `orders` (`member_id`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`org_code` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`order_enabled` integer DEFAULT 1 NOT NULL,
	`billing_postal_code` text,
	`billing_address` text,
	`application_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_organizations_public_id` ON `organizations` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_organizations_org_code` ON `organizations` (`org_code`);--> statement-breakpoint
CREATE INDEX `idx_organizations_status` ON `organizations` (`status`);--> statement-breakpoint
CREATE INDEX `idx_organizations_application_id` ON `organizations` (`application_id`);--> statement-breakpoint
CREATE TABLE `payment_event_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider_event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload` text NOT NULL,
	`processed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payment_event_logs_provider_event_id` ON `payment_event_logs` (`provider_event_id`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`order_id` integer NOT NULL,
	`method` text NOT NULL,
	`status` text NOT NULL,
	`amount` integer NOT NULL,
	`stripe_payment_intent_id` text,
	`paid_at` text,
	`refunded_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_payments_organization_id` ON `payments` (`organization_id`);--> statement-breakpoint
CREATE INDEX `idx_payments_order_id` ON `payments` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_payments_status` ON `payments` (`status`);--> statement-breakpoint
CREATE TABLE `shipping_addresses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`organization_id` integer NOT NULL,
	`recipient_name` text NOT NULL,
	`postal_code` text NOT NULL,
	`address` text NOT NULL,
	`phone` text NOT NULL,
	`is_default` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_shipping_addresses_public_id` ON `shipping_addresses` (`public_id`);--> statement-breakpoint
CREATE INDEX `idx_shipping_addresses_organization_id` ON `shipping_addresses` (`organization_id`);--> statement-breakpoint
CREATE TABLE `social_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer NOT NULL,
	`provider` text NOT NULL,
	`provider_user_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_social_accounts_provider_provider_user_id` ON `social_accounts` (`provider`,`provider_user_id`);--> statement-breakpoint
CREATE INDEX `idx_social_accounts_member_id` ON `social_accounts` (`member_id`);