import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const id = (name = "id") => text(name).primaryKey();
const createdAt = () => text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`);

export const roles = sqliteTable("roles", {
  id: id(), name: text("name").notNull(), description: text("description"),
}, (t) => [uniqueIndex("roles_name_uq").on(t.name)]);

export const permissions = sqliteTable("permissions", {
  id: id(), key: text("key").notNull(), description: text("description"),
}, (t) => [uniqueIndex("permissions_key_uq").on(t.key)]);

export const rolePermissions = sqliteTable("role_permissions", {
  id: id(), roleId: text("role_id").notNull().references(() => roles.id), permissionId: text("permission_id").notNull().references(() => permissions.id),
}, (t) => [uniqueIndex("role_permission_uq").on(t.roleId, t.permissionId)]);

export const users = sqliteTable("users", {
  id: id(), email: text("email").notNull(), displayName: text("display_name").notNull(), roleId: text("role_id").notNull().references(() => roles.id), active: integer("active", { mode: "boolean" }).notNull().default(true), createdAt: createdAt(),
}, (t) => [uniqueIndex("users_email_uq").on(t.email)]);

export const userPermissionOverrides = sqliteTable("user_permission_overrides", {
  id: id(), userId: text("user_id").notNull().references(() => users.id), permissionId: text("permission_id").notNull().references(() => permissions.id), allowed: integer("allowed", { mode: "boolean" }).notNull(),
}, (t) => [uniqueIndex("user_permission_override_uq").on(t.userId, t.permissionId)]);

export const employees = sqliteTable("employees", {
  id: id(), userId: text("user_id").references(() => users.id), employeeNumber: text("employee_number").notNull(), firstName: text("first_name").notNull(), lastName: text("last_name").notNull(), phone: text("phone"), email: text("email"), active: integer("active", { mode: "boolean" }).notNull().default(true), roleId: text("role_id").notNull().references(() => roles.id), defaultHourlyWageCents: integer("default_hourly_wage_cents").notNull(), wageEffectiveDate: text("wage_effective_date").notNull(), notes: text("notes"), createdAt: createdAt(),
}, (t) => [uniqueIndex("employee_number_uq").on(t.employeeNumber), index("employees_role_idx").on(t.roleId)]);

export const crews = sqliteTable("crews", {
  id: id(), name: text("name").notNull(), foremanEmployeeId: text("foreman_employee_id").references(() => employees.id), active: integer("active", { mode: "boolean" }).notNull().default(true), createdAt: createdAt(),
});

export const crewMembers = sqliteTable("crew_members", {
  id: id(), crewId: text("crew_id").notNull().references(() => crews.id), employeeId: text("employee_id").notNull().references(() => employees.id), startsOn: text("starts_on").notNull(), endsOn: text("ends_on"),
}, (t) => [uniqueIndex("crew_member_active_uq").on(t.crewId, t.employeeId, t.startsOn)]);

export const projects = sqliteTable("projects", {
  id: id(), projectNumber: text("project_number").notNull(), name: text("name").notNull(), clientName: text("client_name").notNull(), jobsiteAddress: text("jobsite_address").notNull(), status: text("status").notNull(), startDate: text("start_date"), estimatedCompletionDate: text("estimated_completion_date"), actualCompletionDate: text("actual_completion_date"), managerEmployeeId: text("manager_employee_id").references(() => employees.id), foremanEmployeeId: text("foreman_employee_id").references(() => employees.id), notes: text("notes"), active: integer("active", { mode: "boolean" }).notNull().default(true), createdAt: createdAt(),
}, (t) => [uniqueIndex("project_number_uq").on(t.projectNumber), index("projects_status_idx").on(t.status)]);

export const projectAssignments = sqliteTable("project_assignments", {
  id: id(), projectId: text("project_id").notNull().references(() => projects.id), employeeId: text("employee_id").references(() => employees.id), crewId: text("crew_id").references(() => crews.id), startsOn: text("starts_on"), endsOn: text("ends_on"),
});

export const projectAreas = sqliteTable("project_areas", {
  id: id(), projectId: text("project_id").notNull().references(() => projects.id), name: text("name").notNull(), sortOrder: integer("sort_order").notNull().default(0), active: integer("active", { mode: "boolean" }).notNull().default(true),
}, (t) => [uniqueIndex("project_area_uq").on(t.projectId, t.name)]);

export const workCategories = sqliteTable("work_categories", {
  id: id(), name: text("name").notNull(), code: text("code").notNull(), active: integer("active", { mode: "boolean" }).notNull().default(true),
}, (t) => [uniqueIndex("work_category_code_uq").on(t.code)]);

export const scheduleEntries = sqliteTable("schedule_entries", {
  id: id(), employeeId: text("employee_id").notNull().references(() => employees.id), workDate: text("work_date").notNull(), status: text("status").notNull(), startTime: text("start_time"), endTime: text("end_time"), projectId: text("project_id").references(() => projects.id), jobsiteAddress: text("jobsite_address"), crewId: text("crew_id").references(() => crews.id), foremanEmployeeId: text("foreman_employee_id").references(() => employees.id), workCategoryId: text("work_category_id").references(() => workCategories.id), notes: text("notes"), createdByUserId: text("created_by_user_id").notNull().references(() => users.id), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [index("schedule_employee_date_idx").on(t.employeeId, t.workDate), index("schedule_project_date_idx").on(t.projectId, t.workDate)]);

export const timeEntries = sqliteTable("time_entries", {
  id: id(), employeeId: text("employee_id").notNull().references(() => employees.id), workDate: text("work_date").notNull(), projectId: text("project_id").notNull().references(() => projects.id), scheduleEntryId: text("schedule_entry_id").references(() => scheduleEntries.id), workCategoryId: text("work_category_id").references(() => workCategories.id), clockInAt: text("clock_in_at").notNull(), clockOutAt: text("clock_out_at"), grossMinutes: integer("gross_minutes").notNull().default(0), unpaidBreakMinutes: integer("unpaid_break_minutes").notNull().default(0), paidMinutes: integer("paid_minutes").notNull().default(0), regularMinutes: integer("regular_minutes").notNull().default(0), overtimeMinutes: integer("overtime_minutes").notNull().default(0), wageSnapshotCents: integer("wage_snapshot_cents").notNull(), overtimeMultiplier: real("overtime_multiplier").notNull().default(1.5), laborCostCents: integer("labor_cost_cents").notNull().default(0), status: text("status").notNull().default("active"), approvedByUserId: text("approved_by_user_id").references(() => users.id), approvedAt: text("approved_at"), createdAt: createdAt(),
}, (t) => [index("time_employee_date_idx").on(t.employeeId, t.workDate), index("time_project_date_idx").on(t.projectId, t.workDate)]);

export const breakEntries = sqliteTable("break_entries", {
  id: id(), timeEntryId: text("time_entry_id").notNull().references(() => timeEntries.id), kind: text("kind").notNull().default("lunch"), startedAt: text("started_at").notNull(), endedAt: text("ended_at"), paid: integer("paid", { mode: "boolean" }).notNull().default(false),
}, (t) => [index("break_time_entry_idx").on(t.timeEntryId)]);

export const wageHistory = sqliteTable("wage_history", {
  id: id(), employeeId: text("employee_id").notNull().references(() => employees.id), oldWageCents: integer("old_wage_cents"), newWageCents: integer("new_wage_cents").notNull(), effectiveDate: text("effective_date").notNull(), changedByUserId: text("changed_by_user_id").notNull().references(() => users.id), reason: text("reason"), createdAt: createdAt(),
}, (t) => [index("wage_employee_effective_idx").on(t.employeeId, t.effectiveDate)]);

export const punchLists = sqliteTable("punch_lists", {
  id: id(), projectId: text("project_id").notNull().references(() => projects.id), name: text("name").notNull(), description: text("description"), status: text("status").notNull().default("open"), createdByUserId: text("created_by_user_id").notNull().references(() => users.id), createdAt: createdAt(),
});

export const punchItems = sqliteTable("punch_items", {
  id: id(), itemNumber: text("item_number").notNull(), projectId: text("project_id").notNull().references(() => projects.id), punchListId: text("punch_list_id").notNull().references(() => punchLists.id), areaId: text("area_id").references(() => projectAreas.id), workCategoryId: text("work_category_id").references(() => workCategories.id), description: text("description").notNull(), priority: text("priority").notNull().default("normal"), assignedEmployeeId: text("assigned_employee_id").references(() => employees.id), assignedCrewId: text("assigned_crew_id").references(() => crews.id), assignedSubcontractorName: text("assigned_subcontractor_name"), dueDate: text("due_date"), executionStatus: text("execution_status").notNull().default("not_started"), verificationStatus: text("verification_status").notNull().default("not_reviewed"), exceptionStatus: text("exception_status"), clientVisible: integer("client_visible", { mode: "boolean" }).notNull().default(false), createdByUserId: text("created_by_user_id").notNull().references(() => users.id), completedAt: text("completed_at"), approvedAt: text("approved_at"), createdAt: createdAt(),
}, (t) => [uniqueIndex("punch_item_number_uq").on(t.projectId, t.itemNumber), index("punch_status_idx").on(t.projectId, t.executionStatus, t.verificationStatus)]);

export const punchItemEvents = sqliteTable("punch_item_events", {
  id: id(), punchItemId: text("punch_item_id").notNull().references(() => punchItems.id), eventType: text("event_type").notNull(), actorUserId: text("actor_user_id").notNull().references(() => users.id), notes: text("notes"), metadataJson: text("metadata_json"), createdAt: createdAt(),
}, (t) => [index("punch_events_item_idx").on(t.punchItemId, t.createdAt)]);

export const attachments = sqliteTable("attachments", {
  id: id(), ownerType: text("owner_type").notNull(), ownerId: text("owner_id").notNull(), storageKey: text("storage_key").notNull(), fileName: text("file_name").notNull(), contentType: text("content_type").notNull(), byteSize: integer("byte_size").notNull(), visibility: text("visibility").notNull().default("internal"), uploadedByUserId: text("uploaded_by_user_id").notNull().references(() => users.id), createdAt: createdAt(),
}, (t) => [index("attachments_owner_idx").on(t.ownerType, t.ownerId)]);

export const timeCorrectionRequests = sqliteTable("time_correction_requests", {
  id: id(), timeEntryId: text("time_entry_id").notNull().references(() => timeEntries.id), requestedByUserId: text("requested_by_user_id").notNull().references(() => users.id), requestedChangesJson: text("requested_changes_json").notNull(), reason: text("reason").notNull(), status: text("status").notNull().default("pending"), resolvedByUserId: text("resolved_by_user_id").references(() => users.id), resolvedAt: text("resolved_at"), createdAt: createdAt(),
});

export const auditEvents = sqliteTable("audit_events", {
  id: id(), actorUserId: text("actor_user_id").notNull().references(() => users.id), entityType: text("entity_type").notNull(), entityId: text("entity_id").notNull(), action: text("action").notNull(), previousValueJson: text("previous_value_json"), newValueJson: text("new_value_json"), reason: text("reason"), createdAt: createdAt(),
}, (t) => [index("audit_entity_idx").on(t.entityType, t.entityId, t.createdAt), index("audit_actor_idx").on(t.actorUserId, t.createdAt)]);
