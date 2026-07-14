CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`visibility` text DEFAULT 'internal' NOT NULL,
	`uploaded_by_user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `attachments_owner_idx` ON `attachments` (`owner_type`,`owner_id`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`previous_value_json` text,
	`new_value_json` text,
	`reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_events` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_actor_idx` ON `audit_events` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `break_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`time_entry_id` text NOT NULL,
	`kind` text DEFAULT 'lunch' NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`paid` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`time_entry_id`) REFERENCES `time_entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `break_time_entry_idx` ON `break_entries` (`time_entry_id`);--> statement-breakpoint
CREATE TABLE `crew_members` (
	`id` text PRIMARY KEY NOT NULL,
	`crew_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text,
	FOREIGN KEY (`crew_id`) REFERENCES `crews`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crew_member_active_uq` ON `crew_members` (`crew_id`,`employee_id`,`starts_on`);--> statement-breakpoint
CREATE TABLE `crews` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`foreman_employee_id` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`foreman_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `employees` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`employee_number` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`phone` text,
	`email` text,
	`active` integer DEFAULT true NOT NULL,
	`role_id` text NOT NULL,
	`default_hourly_wage_cents` integer NOT NULL,
	`wage_effective_date` text NOT NULL,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employee_number_uq` ON `employees` (`employee_number`);--> statement-breakpoint
CREATE INDEX `employees_role_idx` ON `employees` (`role_id`);--> statement-breakpoint
CREATE TABLE `permissions` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`description` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `permissions_key_uq` ON `permissions` (`key`);--> statement-breakpoint
CREATE TABLE `project_areas` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_area_uq` ON `project_areas` (`project_id`,`name`);--> statement-breakpoint
CREATE TABLE `project_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`employee_id` text,
	`crew_id` text,
	`starts_on` text,
	`ends_on` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`crew_id`) REFERENCES `crews`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`project_number` text NOT NULL,
	`name` text NOT NULL,
	`client_name` text NOT NULL,
	`jobsite_address` text NOT NULL,
	`status` text NOT NULL,
	`start_date` text,
	`estimated_completion_date` text,
	`actual_completion_date` text,
	`manager_employee_id` text,
	`foreman_employee_id` text,
	`notes` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`manager_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`foreman_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_number_uq` ON `projects` (`project_number`);--> statement-breakpoint
CREATE INDEX `projects_status_idx` ON `projects` (`status`);--> statement-breakpoint
CREATE TABLE `punch_item_events` (
	`id` text PRIMARY KEY NOT NULL,
	`punch_item_id` text NOT NULL,
	`event_type` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`notes` text,
	`metadata_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`punch_item_id`) REFERENCES `punch_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `punch_events_item_idx` ON `punch_item_events` (`punch_item_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `punch_items` (
	`id` text PRIMARY KEY NOT NULL,
	`item_number` text NOT NULL,
	`project_id` text NOT NULL,
	`punch_list_id` text NOT NULL,
	`area_id` text,
	`work_category_id` text,
	`description` text NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`assigned_employee_id` text,
	`assigned_crew_id` text,
	`assigned_subcontractor_name` text,
	`due_date` text,
	`execution_status` text DEFAULT 'not_started' NOT NULL,
	`verification_status` text DEFAULT 'not_reviewed' NOT NULL,
	`exception_status` text,
	`client_visible` integer DEFAULT false NOT NULL,
	`created_by_user_id` text NOT NULL,
	`completed_at` text,
	`approved_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`punch_list_id`) REFERENCES `punch_lists`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`area_id`) REFERENCES `project_areas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`work_category_id`) REFERENCES `work_categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_crew_id`) REFERENCES `crews`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `punch_item_number_uq` ON `punch_items` (`project_id`,`item_number`);--> statement-breakpoint
CREATE INDEX `punch_status_idx` ON `punch_items` (`project_id`,`execution_status`,`verification_status`);--> statement-breakpoint
CREATE TABLE `punch_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`id` text PRIMARY KEY NOT NULL,
	`role_id` text NOT NULL,
	`permission_id` text NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `role_permission_uq` ON `role_permissions` (`role_id`,`permission_id`);--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_name_uq` ON `roles` (`name`);--> statement-breakpoint
CREATE TABLE `schedule_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`work_date` text NOT NULL,
	`status` text NOT NULL,
	`start_time` text,
	`end_time` text,
	`project_id` text,
	`jobsite_address` text,
	`crew_id` text,
	`foreman_employee_id` text,
	`work_category_id` text,
	`notes` text,
	`created_by_user_id` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`crew_id`) REFERENCES `crews`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`foreman_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`work_category_id`) REFERENCES `work_categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `schedule_employee_date_idx` ON `schedule_entries` (`employee_id`,`work_date`);--> statement-breakpoint
CREATE INDEX `schedule_project_date_idx` ON `schedule_entries` (`project_id`,`work_date`);--> statement-breakpoint
CREATE TABLE `time_correction_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`time_entry_id` text NOT NULL,
	`requested_by_user_id` text NOT NULL,
	`requested_changes_json` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`resolved_by_user_id` text,
	`resolved_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`time_entry_id`) REFERENCES `time_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `time_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`work_date` text NOT NULL,
	`project_id` text NOT NULL,
	`schedule_entry_id` text,
	`work_category_id` text,
	`clock_in_at` text NOT NULL,
	`clock_out_at` text,
	`gross_minutes` integer DEFAULT 0 NOT NULL,
	`unpaid_break_minutes` integer DEFAULT 0 NOT NULL,
	`paid_minutes` integer DEFAULT 0 NOT NULL,
	`regular_minutes` integer DEFAULT 0 NOT NULL,
	`overtime_minutes` integer DEFAULT 0 NOT NULL,
	`wage_snapshot_cents` integer NOT NULL,
	`overtime_multiplier` real DEFAULT 1.5 NOT NULL,
	`labor_cost_cents` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`approved_by_user_id` text,
	`approved_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`schedule_entry_id`) REFERENCES `schedule_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`work_category_id`) REFERENCES `work_categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `time_employee_date_idx` ON `time_entries` (`employee_id`,`work_date`);--> statement-breakpoint
CREATE INDEX `time_project_date_idx` ON `time_entries` (`project_id`,`work_date`);--> statement-breakpoint
CREATE TABLE `user_permission_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`permission_id` text NOT NULL,
	`allowed` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_permission_override_uq` ON `user_permission_overrides` (`user_id`,`permission_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`role_id` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_uq` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `wage_history` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`old_wage_cents` integer,
	`new_wage_cents` integer NOT NULL,
	`effective_date` text NOT NULL,
	`changed_by_user_id` text NOT NULL,
	`reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`changed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `wage_employee_effective_idx` ON `wage_history` (`employee_id`,`effective_date`);--> statement-breakpoint
CREATE TABLE `work_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_category_code_uq` ON `work_categories` (`code`);