import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = (name = "id") => uuid(name).primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const roles = pgTable("roles", {
  id: id(),
  name: text("name").notNull(),
  description: text("description"),
}, (t) => [uniqueIndex("roles_name_uq").on(t.name)]);

export const permissions = pgTable("permissions", {
  id: id(),
  key: text("key").notNull(),
  description: text("description"),
}, (t) => [uniqueIndex("permissions_key_uq").on(t.key)]);

export const rolePermissions = pgTable("role_permissions", {
  id: id(),
  roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  permissionId: uuid("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
}, (t) => [uniqueIndex("role_permission_uq").on(t.roleId, t.permissionId)]);

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash"),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`)]);

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("organizations_slug_uq").on(t.slug)]);

export const organizationMemberships = pgTable("organization_memberships", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  roleId: uuid("role_id").notNull().references(() => roles.id),
  status: text("status").notNull().default("active"),
  invitedByUserId: uuid("invited_by_user_id").references(() => users.id),
  joinedAt: timestamp("joined_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("organization_membership_uq").on(t.organizationId, t.userId),
  index("organization_membership_user_idx").on(t.userId),
]);

export const userPermissionOverrides = pgTable("user_permission_overrides", {
  id: id(),
  membershipId: uuid("membership_id").notNull().references(() => organizationMemberships.id, { onDelete: "cascade" }),
  permissionId: uuid("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
  allowed: boolean("allowed").notNull(),
}, (t) => [uniqueIndex("user_permission_override_uq").on(t.membershipId, t.permissionId)]);

export const sessions = pgTable("sessions", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("sessions_token_hash_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)]);

export const invitations = pgTable("invitations", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  roleId: uuid("role_id").notNull().references(() => roles.id),
  tokenHash: text("token_hash").notNull(),
  invitedByUserId: uuid("invited_by_user_id").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("invitations_token_hash_uq").on(t.tokenHash), index("invitations_org_email_idx").on(t.organizationId, t.email)]);

export const employees = pgTable("employees", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id),
  employeeNumber: text("employee_number").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  phone: text("phone"),
  email: text("email"),
  active: boolean("active").notNull().default(true),
  roleId: uuid("role_id").notNull().references(() => roles.id),
  defaultHourlyWageCents: integer("default_hourly_wage_cents").notNull(),
  wageEffectiveDate: date("wage_effective_date").notNull(),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("employee_number_uq").on(t.organizationId, t.employeeNumber),
  index("employees_organization_role_idx").on(t.organizationId, t.roleId),
]);

export const crews = pgTable("crews", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  foremanEmployeeId: uuid("foreman_employee_id").references(() => employees.id),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("crews_name_uq").on(t.organizationId, t.name)]);

export const crewMembers = pgTable("crew_members", {
  id: id(),
  crewId: uuid("crew_id").notNull().references(() => crews.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on"),
}, (t) => [uniqueIndex("crew_member_active_uq").on(t.crewId, t.employeeId, t.startsOn)]);

export const projects = pgTable("projects", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectNumber: text("project_number").notNull(),
  name: text("name").notNull(),
  clientName: text("client_name").notNull(),
  jobsiteAddress: text("jobsite_address").notNull(),
  status: text("status").notNull(),
  startDate: date("start_date"),
  estimatedCompletionDate: date("estimated_completion_date"),
  actualCompletionDate: date("actual_completion_date"),
  managerEmployeeId: uuid("manager_employee_id").references(() => employees.id),
  foremanEmployeeId: uuid("foreman_employee_id").references(() => employees.id),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("project_number_uq").on(t.organizationId, t.projectNumber),
  index("projects_status_idx").on(t.organizationId, t.status),
]);

export const projectAssignments = pgTable("project_assignments", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").references(() => employees.id),
  crewId: uuid("crew_id").references(() => crews.id),
  startsOn: date("starts_on"),
  endsOn: date("ends_on"),
});

export const projectAreas = pgTable("project_areas", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
}, (t) => [uniqueIndex("project_area_uq").on(t.projectId, t.name)]);

export const workCategories = pgTable("work_categories", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  active: boolean("active").notNull().default(true),
}, (t) => [uniqueIndex("work_category_code_uq").on(t.organizationId, t.code)]);

export const scheduleEntries = pgTable("schedule_entries", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  workDate: date("work_date").notNull(),
  status: text("status").notNull(),
  startTime: time("start_time"),
  endTime: time("end_time"),
  projectId: uuid("project_id").references(() => projects.id),
  jobsiteAddress: text("jobsite_address"),
  crewId: uuid("crew_id").references(() => crews.id),
  foremanEmployeeId: uuid("foreman_employee_id").references(() => employees.id),
  workCategoryId: uuid("work_category_id").references(() => workCategories.id),
  notes: text("notes"),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("schedule_employee_date_idx").on(t.employeeId, t.workDate), index("schedule_project_date_idx").on(t.projectId, t.workDate)]);

export const timeEntries = pgTable("time_entries", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  workDate: date("work_date").notNull(),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  scheduleEntryId: uuid("schedule_entry_id").references(() => scheduleEntries.id),
  workCategoryId: uuid("work_category_id").references(() => workCategories.id),
  clockInAt: timestamp("clock_in_at", { withTimezone: true }).notNull(),
  clockOutAt: timestamp("clock_out_at", { withTimezone: true }),
  grossMinutes: integer("gross_minutes").notNull().default(0),
  unpaidBreakMinutes: integer("unpaid_break_minutes").notNull().default(0),
  paidMinutes: integer("paid_minutes").notNull().default(0),
  regularMinutes: integer("regular_minutes").notNull().default(0),
  overtimeMinutes: integer("overtime_minutes").notNull().default(0),
  wageSnapshotCents: integer("wage_snapshot_cents").notNull(),
  overtimeMultiplier: numeric("overtime_multiplier", { precision: 4, scale: 2 }).notNull().default("1.50"),
  laborCostCents: integer("labor_cost_cents").notNull().default(0),
  status: text("status").notNull().default("active"),
  approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("time_employee_date_idx").on(t.employeeId, t.workDate), index("time_project_date_idx").on(t.projectId, t.workDate)]);

export const breakEntries = pgTable("break_entries", {
  id: id(),
  timeEntryId: uuid("time_entry_id").notNull().references(() => timeEntries.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().default("lunch"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  paid: boolean("paid").notNull().default(false),
}, (t) => [index("break_time_entry_idx").on(t.timeEntryId)]);

export const wageHistory = pgTable("wage_history", {
  id: id(),
  employeeId: uuid("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  oldWageCents: integer("old_wage_cents"),
  newWageCents: integer("new_wage_cents").notNull(),
  effectiveDate: date("effective_date").notNull(),
  changedByUserId: uuid("changed_by_user_id").notNull().references(() => users.id),
  reason: text("reason"),
  createdAt: createdAt(),
}, (t) => [index("wage_employee_effective_idx").on(t.employeeId, t.effectiveDate)]);

export const punchLists = pgTable("punch_lists", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("open"),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const punchItems = pgTable("punch_items", {
  id: id(),
  itemNumber: text("item_number").notNull(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  punchListId: uuid("punch_list_id").notNull().references(() => punchLists.id, { onDelete: "cascade" }),
  areaId: uuid("area_id").references(() => projectAreas.id),
  workCategoryId: uuid("work_category_id").references(() => workCategories.id),
  description: text("description").notNull(),
  priority: text("priority").notNull().default("normal"),
  assignedEmployeeId: uuid("assigned_employee_id").references(() => employees.id),
  assignedCrewId: uuid("assigned_crew_id").references(() => crews.id),
  assignedSubcontractorName: text("assigned_subcontractor_name"),
  dueDate: date("due_date"),
  executionStatus: text("execution_status").notNull().default("not_started"),
  verificationStatus: text("verification_status").notNull().default("not_reviewed"),
  exceptionStatus: text("exception_status"),
  clientVisible: boolean("client_visible").notNull().default(false),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("punch_item_number_uq").on(t.projectId, t.itemNumber), index("punch_status_idx").on(t.projectId, t.executionStatus, t.verificationStatus)]);

export const punchItemEvents = pgTable("punch_item_events", {
  id: id(),
  punchItemId: uuid("punch_item_id").notNull().references(() => punchItems.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  actorUserId: uuid("actor_user_id").notNull().references(() => users.id),
  notes: text("notes"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: createdAt(),
}, (t) => [index("punch_events_item_idx").on(t.punchItemId, t.createdAt)]);

export const attachments = pgTable("attachments", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  ownerType: text("owner_type").notNull(),
  ownerId: uuid("owner_id").notNull(),
  storageKey: text("storage_key").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  visibility: text("visibility").notNull().default("internal"),
  uploadedByUserId: uuid("uploaded_by_user_id").notNull().references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index("attachments_owner_idx").on(t.ownerType, t.ownerId)]);

export const timeCorrectionRequests = pgTable("time_correction_requests", {
  id: id(),
  timeEntryId: uuid("time_entry_id").notNull().references(() => timeEntries.id, { onDelete: "cascade" }),
  requestedByUserId: uuid("requested_by_user_id").notNull().references(() => users.id),
  requestedChanges: jsonb("requested_changes").notNull().$type<Record<string, unknown>>(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending"),
  resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const auditEvents = pgTable("audit_events", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").notNull().references(() => users.id),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  action: text("action").notNull(),
  previousValue: jsonb("previous_value").$type<Record<string, unknown>>(),
  newValue: jsonb("new_value").$type<Record<string, unknown>>(),
  reason: text("reason"),
  createdAt: createdAt(),
}, (t) => [index("audit_entity_idx").on(t.entityType, t.entityId, t.createdAt), index("audit_actor_idx").on(t.actorUserId, t.createdAt)]);
