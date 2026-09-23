DROP INDEX `uq_memberships_member_id_organization_id`;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_memberships_member_id` ON `memberships` (`member_id`);