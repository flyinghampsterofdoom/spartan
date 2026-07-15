import { getSql } from "@/db";
import { writeAuditEvent } from "@/lib/audit";
import { authorizeResource } from "@/lib/auth/authorization";
import { AuthorizationError } from "@/lib/auth/policy";
import type { AuthContext, PermissionScope } from "@/lib/auth/types";
import { listCrews, listEmployees, listProjects } from "@/lib/operations";
import { getOrganizationClock } from "@/lib/timekeeping";

export const EXECUTION_STATUSES = ["not_started", "in_progress", "work_complete"] as const;
export const APPROVAL_STATUSES = ["not_reviewed", "approved", "rework_required"] as const;
export type ExecutionStatus = typeof EXECUTION_STATUSES[number];
export type ApprovalStatus = typeof APPROVAL_STATUSES[number];

export class PunchValidationError extends Error {
  constructor(message: string) { super(message); this.name = "PunchValidationError"; }
}

function uuid(value: FormDataEntryValue | null, label: string, optional = false) {
  const result = String(value ?? "").trim();
  if (!result && optional) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) throw new PunchValidationError(`${label} is invalid.`);
  return result;
}

function text(value: FormDataEntryValue | null, label: string, max = 1000, optional = false) {
  const result = String(value ?? "").trim();
  if (!result && !optional) throw new PunchValidationError(`${label} is required.`);
  if (result.length > max) throw new PunchValidationError(`${label} must be ${max} characters or fewer.`);
  return result || null;
}

function date(value: FormDataEntryValue | null, optional = true) {
  const result = String(value ?? "").trim();
  if (!result && optional) return null;
  const parsed = new Date(`${result}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) throw new PunchValidationError("Due date is invalid.");
  return result;
}

export function assertExecutionTransition(current: ExecutionStatus, next: ExecutionStatus, approval: ApprovalStatus) {
  const allowed = (current === "not_started" && next === "in_progress")
    || (current === "in_progress" && next === "work_complete")
    || (current === "work_complete" && next === "in_progress" && approval === "rework_required");
  if (!allowed) throw new PunchValidationError(`Execution cannot move from ${current.replaceAll("_", " ")} to ${next.replaceAll("_", " ")} in the current approval state.`);
}

export function assertApprovalTransition(current: ApprovalStatus, next: ApprovalStatus, execution: ExecutionStatus) {
  if (execution !== "work_complete") throw new PunchValidationError("Approval can change only after the work is marked complete.");
  const allowed = (current === "not_reviewed" && (next === "approved" || next === "rework_required"))
    || (current === "approved" && next === "rework_required")
    || (current === "rework_required" && next === "not_reviewed");
  if (!allowed) throw new PunchValidationError(`Approval cannot move from ${current.replaceAll("_", " ")} to ${next.replaceAll("_", " ")}.`);
}

const ACCESS_PERMISSIONS = ["punch.view", "punch.work", "punch.manage", "punch.approve"];

function bestPermission(auth: AuthContext, permissions = ACCESS_PERMISSIONS) {
  const ranks: PermissionScope[] = ["organization", "assigned_project", "assigned_crew", "self"];
  for (const scope of ranks) {
    const permission = permissions.find(key => auth.permissions[key]?.allowed && auth.permissions[key].scope === scope);
    if (permission) return { permission, scope };
  }
  return null;
}

export function punchAccessScope(auth: AuthContext): PermissionScope | null {
  return bestPermission(auth)?.scope ?? null;
}

export function hasPunchAccess(auth: AuthContext) { return punchAccessScope(auth) !== null; }

export function punchAssignmentBelongsToEmployee(employeeId: string | null, assignedEmployeeId: string | null, assignedCrewMember: boolean) {
  return Boolean(employeeId && (employeeId === assignedEmployeeId || assignedCrewMember));
}

type PunchAccessRow = {
  id: string; organization_id: string; project_id: string; assigned_employee_id: string | null; assigned_crew_id: string | null;
  execution_status: ExecutionStatus; verification_status: ApprovalStatus; exception_status: string | null;
};

async function loadPunchItem(itemId: string) {
  const sql = getSql();
  const rows = await sql<PunchAccessRow[]>`
    select pi.id, p.organization_id, pi.project_id, pi.assigned_employee_id, pi.assigned_crew_id,
      pi.execution_status, pi.verification_status, pi.exception_status
    from punch_items pi join projects p on p.id=pi.project_id where pi.id=${itemId} limit 1
  `;
  return rows[0];
}

async function authorizePunchItem(auth: AuthContext, permission: string, item: PunchAccessRow) {
  if (item.organization_id !== auth.organizationId) throw new AuthorizationError();
  const grant = auth.permissions[permission];
  if (!grant?.allowed) throw new AuthorizationError();
  if (grant.scope === "organization") return;
  if (grant.scope === "self") {
    if (!auth.employeeId) throw new AuthorizationError();
    if (item.assigned_employee_id === auth.employeeId) return;
    if (item.assigned_crew_id) {
      const sql = getSql();
      const rows = await sql<{ allowed: boolean }[]>`select exists(select 1 from crew_members where crew_id=${item.assigned_crew_id} and employee_id=${auth.employeeId} and starts_on<=current_date and (ends_on is null or ends_on>=current_date)) as allowed`;
      if (rows[0]?.allowed) return;
    }
    throw new AuthorizationError();
  }
  await authorizeResource(auth, permission, { organizationId: item.organization_id, projectId: item.project_id, employeeId: item.assigned_employee_id, crewId: item.assigned_crew_id });
}

export async function authorizePunchItemAction(auth: AuthContext, itemId: string, permissions = ACCESS_PERMISSIONS) {
  const item = await loadPunchItem(itemId);
  if (!item) throw new PunchValidationError("Punch item not found.");
  const access = bestPermission(auth, permissions);
  if (!access) throw new AuthorizationError();
  await authorizePunchItem(auth, access.permission, item);
  return item;
}

async function assertNotAssignedWorker(auth: AuthContext, item: PunchAccessRow) {
  if (!auth.employeeId) return;
  if (punchAssignmentBelongsToEmployee(auth.employeeId, item.assigned_employee_id, false)) throw new AuthorizationError("You cannot approve punch work assigned to you.");
  if (item.assigned_crew_id) {
    const sql = getSql();
    const rows = await sql<{ assigned: boolean }[]>`select exists(select 1 from crew_members where crew_id=${item.assigned_crew_id} and employee_id=${auth.employeeId} and starts_on<=current_date and (ends_on is null or ends_on>=current_date)) as assigned`;
    if (punchAssignmentBelongsToEmployee(auth.employeeId, item.assigned_employee_id, Boolean(rows[0]?.assigned))) throw new AuthorizationError("You cannot approve punch work assigned to your crew.");
  }
}

function scopeCondition(auth: AuthContext, scope: PermissionScope) {
  const sql = getSql();
  if (scope === "organization") return sql``;
  if (!auth.employeeId) return sql`and false`;
  if (scope === "self") return sql`and (pi.assigned_employee_id=${auth.employeeId} or exists(select 1 from crew_members own where own.crew_id=pi.assigned_crew_id and own.employee_id=${auth.employeeId} and own.starts_on<=current_date and (own.ends_on is null or own.ends_on>=current_date)))`;
  if (scope === "assigned_crew") return sql`and exists(select 1 from crews managed where managed.id=pi.assigned_crew_id and managed.foreman_employee_id=${auth.employeeId})`;
  return sql`and (p.manager_employee_id=${auth.employeeId} or p.foreman_employee_id=${auth.employeeId} or exists(select 1 from project_assignments pa where pa.project_id=p.id and (pa.employee_id=${auth.employeeId} or pa.crew_id in (select crew_id from crew_members where employee_id=${auth.employeeId} and starts_on<=current_date and (ends_on is null or ends_on>=current_date)))))`;
}

export type PunchItemRecord = PunchAccessRow & {
  item_number: string; punch_list_id: string; punch_list_name: string; project_name: string; project_number: string;
  area_name: string | null; category_name: string | null; description: string; priority: string; due_date: string | null;
  assigned_employee_name: string | null; assigned_crew_name: string | null; completed_at: Date | string | null; approved_at: Date | string | null;
  event_count: number; attachment_count: number;
};

export type PunchEventRecord = { id: string; event_type: string; actor_name: string; notes: string | null; metadata: Record<string, unknown> | null; created_at: Date | string };

export async function listPunchItems(auth: AuthContext) {
  const scope = punchAccessScope(auth);
  if (!scope) throw new AuthorizationError();
  const sql = getSql();
  return sql<PunchItemRecord[]>`
    select pi.id, p.organization_id, pi.project_id, pi.punch_list_id, pi.item_number, pl.name as punch_list_name,
      p.name as project_name, p.project_number, pa.name as area_name, wc.name as category_name, pi.description,
      pi.priority, pi.due_date::text, pi.execution_status, pi.verification_status, pi.exception_status,
      pi.assigned_employee_id, pi.assigned_crew_id,
      case when e.id is null then null else e.first_name || ' ' || e.last_name end as assigned_employee_name,
      c.name as assigned_crew_name, pi.completed_at, pi.approved_at,
      (select count(*)::int from punch_item_events pie where pie.punch_item_id=pi.id) as event_count,
      (select count(*)::int from attachments a where a.owner_type='punch_item' and a.owner_id=pi.id) as attachment_count
    from punch_items pi join projects p on p.id=pi.project_id join punch_lists pl on pl.id=pi.punch_list_id
    left join project_areas pa on pa.id=pi.area_id left join work_categories wc on wc.id=pi.work_category_id
    left join employees e on e.id=pi.assigned_employee_id left join crews c on c.id=pi.assigned_crew_id
    where p.organization_id=${auth.organizationId} ${scopeCondition(auth, scope)}
    order by (pi.verification_status='rework_required') desc, (pi.execution_status='work_complete' and pi.verification_status='not_reviewed') desc,
      pi.due_date nulls last, p.name, pi.item_number
    limit 300
  `;
}

export async function listPunchEvents(auth: AuthContext, item: PunchItemRecord) {
  const access = bestPermission(auth);
  if (!access) throw new AuthorizationError();
  await authorizePunchItem(auth, access.permission, item);
  const sql = getSql();
  return sql<PunchEventRecord[]>`
    select pie.id, pie.event_type, u.display_name as actor_name, pie.notes, pie.metadata, pie.created_at
    from punch_item_events pie join users u on u.id=pie.actor_user_id
    where pie.punch_item_id=${item.id} order by pie.created_at desc
  `;
}

export async function punchPageData(auth: AuthContext, selectedId?: string | null) {
  const [items, clock] = await Promise.all([listPunchItems(auth), getOrganizationClock(auth)]);
  const selected = items.find(item => item.id === selectedId) ?? items[0] ?? null;
  const canManage = Boolean(auth.permissions["punch.manage"]?.allowed);
  const [events, projects, employees, crews, lists, categories, areas] = await Promise.all([
    selected ? listPunchEvents(auth, selected) : Promise.resolve([]),
    canManage ? listProjects(auth) : Promise.resolve([]),
    canManage && auth.permissions["employees.view"]?.allowed ? listEmployees(auth) : Promise.resolve([]),
    canManage && auth.permissions["employees.view"]?.allowed ? listCrews(auth) : Promise.resolve([]),
    listAccessiblePunchLists(auth),
    canManage ? listWorkCategories(auth) : Promise.resolve([]),
    canManage ? listProjectAreas(auth) : Promise.resolve([]),
  ]);
  return { today: clock.workDate, items, selected, events, projects, employees, crews, lists, categories, areas };
}

async function listAccessiblePunchLists(auth: AuthContext) {
  const scope = punchAccessScope(auth);
  if (!scope) return [];
  const sql = getSql();
  const itemClause = scope === "self" || scope === "assigned_crew" ? scopeCondition(auth, scope) : sql``;
  const projectClause = scope === "assigned_project" ? (auth.employeeId ? sql`and (p.manager_employee_id=${auth.employeeId} or p.foreman_employee_id=${auth.employeeId} or exists(select 1 from project_assignments pax where pax.project_id=p.id and (pax.employee_id=${auth.employeeId} or pax.crew_id in (select crew_id from crew_members where employee_id=${auth.employeeId}))))` : sql`and false`) : sql``;
  return sql<{ id: string; name: string; project_id: string; project_name: string; status: string }[]>`
    select distinct pl.id, pl.name, pl.project_id, p.name as project_name, pl.status
    from punch_lists pl join projects p on p.id=pl.project_id
    ${scope === "self" || scope === "assigned_crew" ? sql`join punch_items pi on pi.punch_list_id=pl.id` : sql``}
    where p.organization_id=${auth.organizationId} ${itemClause} ${projectClause}
    order by p.name, pl.name
  `;
}

async function listWorkCategories(auth: AuthContext) {
  const sql = getSql();
  return sql<{ id: string; name: string }[]>`select id, name from work_categories where organization_id=${auth.organizationId} and active=true order by name`;
}

async function listProjectAreas(auth: AuthContext) {
  const sql = getSql();
  return sql<{ id: string; project_id: string; project_name: string; name: string }[]>`select pa.id, pa.project_id, p.name as project_name, pa.name from project_areas pa join projects p on p.id=pa.project_id where p.organization_id=${auth.organizationId} and pa.active=true order by p.name, pa.sort_order, pa.name`;
}

export async function createPunchList(auth: AuthContext, form: FormData) {
  const projectId = uuid(form.get("projectId"), "Project")!;
  await authorizeResource(auth, "punch.manage", { organizationId: auth.organizationId, projectId });
  const name = text(form.get("name"), "Punch-list name", 150)!;
  const description = text(form.get("description"), "Description", 1000, true);
  const sql = getSql();
  const project = await sql<{ id: string }[]>`select id from projects where id=${projectId} and organization_id=${auth.organizationId}`;
  if (!project[0]) throw new PunchValidationError("Project not found.");
  const rows = await sql<{ id: string }[]>`insert into punch_lists (project_id, name, description, created_by_user_id) values (${projectId}, ${name}, ${description}, ${auth.userId}) returning id`;
  await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "punch_list", entityId: rows[0].id, action: "punch_list.created", newValue: { projectId, name, description } });
  return rows[0].id;
}

export async function createPunchItem(auth: AuthContext, form: FormData) {
  const punchListId = uuid(form.get("punchListId"), "Punch list")!;
  const itemNumber = text(form.get("itemNumber"), "Item number", 40)!;
  const description = text(form.get("description"), "Description", 1000)!;
  const priority = String(form.get("priority") ?? "normal");
  if (!["low", "normal", "high", "urgent"].includes(priority)) throw new PunchValidationError("Priority is invalid.");
  const areaId = uuid(form.get("areaId"), "Area", true);
  const workCategoryId = uuid(form.get("workCategoryId"), "Work category", true);
  const assignedEmployeeId = uuid(form.get("assignedEmployeeId"), "Assigned employee", true);
  const assignedCrewId = uuid(form.get("assignedCrewId"), "Assigned crew", true);
  const clientRequestId = uuid(form.get("clientRequestId"), "Submission", true);
  if (assignedEmployeeId && assignedCrewId) throw new PunchValidationError("Assign the item to either an employee or a crew, not both.");
  const dueDate = date(form.get("dueDate"));
  const sql = getSql();
  const lists = await sql<{ project_id: string }[]>`select pl.project_id from punch_lists pl join projects p on p.id=pl.project_id where pl.id=${punchListId} and p.organization_id=${auth.organizationId}`;
  const projectId = lists[0]?.project_id;
  if (!projectId) throw new PunchValidationError("Punch list not found.");
  await authorizeResource(auth, "punch.manage", { organizationId: auth.organizationId, projectId });
  if (clientRequestId) {
    const existing = await sql<{ id: string; event_id: string | null }[]>`
      select pi.id, (select id from punch_item_events where punch_item_id=pi.id and event_type='item.created' order by created_at limit 1) as event_id
      from punch_items pi where pi.project_id=${projectId} and pi.client_request_id=${clientRequestId}
    `;
    if (existing[0]) return { itemId: existing[0].id, eventId: existing[0].event_id, duplicate: true };
  }
  if (areaId) {
    const valid = await sql<{ ok: boolean }[]>`select exists(select 1 from project_areas where id=${areaId} and project_id=${projectId}) as ok`;
    if (!valid[0]?.ok) throw new PunchValidationError("Area does not belong to this project.");
  }
  if (workCategoryId) {
    const valid = await sql<{ ok: boolean }[]>`select exists(select 1 from work_categories where id=${workCategoryId} and organization_id=${auth.organizationId}) as ok`;
    if (!valid[0]?.ok) throw new PunchValidationError("Work category is invalid.");
  }
  if (assignedEmployeeId) {
    const valid = await sql<{ ok: boolean }[]>`select exists(select 1 from employees where id=${assignedEmployeeId} and organization_id=${auth.organizationId}) as ok`;
    if (!valid[0]?.ok) throw new PunchValidationError("Assigned employee is invalid.");
  }
  if (assignedCrewId) {
    const valid = await sql<{ ok: boolean }[]>`select exists(select 1 from crews where id=${assignedCrewId} and organization_id=${auth.organizationId}) as ok`;
    if (!valid[0]?.ok) throw new PunchValidationError("Assigned crew is invalid.");
  }
  const duplicate = await sql<{ exists: boolean }[]>`select exists(select 1 from punch_items where project_id=${projectId} and item_number=${itemNumber}) as exists`;
  if (duplicate[0]?.exists) throw new PunchValidationError("That item number already exists on this project.");
  const state = { executionStatus: "not_started", approvalStatus: "not_reviewed" };
  let itemId = "";
  let eventId = "";
  try {
    await sql.begin(async transaction => {
      const tx = transaction as unknown as typeof sql;
      const rows = await tx<{ id: string }[]>`
        insert into punch_items (item_number, project_id, punch_list_id, area_id, work_category_id, description, priority, assigned_employee_id, assigned_crew_id, due_date, client_request_id, created_by_user_id)
        values (${itemNumber}, ${projectId}, ${punchListId}, ${areaId}, ${workCategoryId}, ${description}, ${priority}, ${assignedEmployeeId}, ${assignedCrewId}, ${dueDate}, ${clientRequestId}, ${auth.userId}) returning id
      `;
      itemId = rows[0].id;
      const events = await tx<{ id: string }[]>`insert into punch_item_events (punch_item_id, event_type, actor_user_id, notes, metadata) values (${itemId}, 'item.created', ${auth.userId}, ${description}, ${JSON.stringify({ ...state, clientRequestId })}::jsonb) returning id`;
      eventId = events[0].id;
    });
  } catch (error) {
    if (clientRequestId && typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      const existing = await sql<{ id: string; event_id: string | null }[]>`
        select pi.id, (select id from punch_item_events where punch_item_id=pi.id and event_type='item.created' order by created_at limit 1) as event_id
        from punch_items pi where pi.project_id=${projectId} and pi.client_request_id=${clientRequestId}
      `;
      if (existing[0]) return { itemId: existing[0].id, eventId: existing[0].event_id, duplicate: true };
    }
    throw error;
  }
  await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "punch_item", entityId: itemId, action: "punch.item_created", newValue: { projectId, punchListId, itemNumber, description, assignedEmployeeId, assignedCrewId, ...state } });
  return { itemId, eventId, duplicate: false };
}

export async function changePunchExecution(auth: AuthContext, form: FormData) {
  const itemId = uuid(form.get("itemId"), "Punch item")!;
  const next = String(form.get("executionStatus")) as ExecutionStatus;
  if (!EXECUTION_STATUSES.includes(next)) throw new PunchValidationError("Execution status is invalid.");
  const notes = text(form.get("notes"), "Work note", 1000, true);
  const item = await loadPunchItem(itemId);
  if (!item) throw new PunchValidationError("Punch item not found.");
  await authorizePunchItem(auth, "punch.work", item);
  assertExecutionTransition(item.execution_status, next, item.verification_status);
  const resubmitting = next === "work_complete" && item.verification_status === "rework_required";
  if (resubmitting) assertApprovalTransition(item.verification_status, "not_reviewed", next);
  const sql = getSql();
  await sql.begin(async transaction => {
    const tx = transaction as unknown as typeof sql;
    const updated = await tx<{ id: string }[]>`update punch_items set execution_status=${next}, verification_status=${resubmitting ? "not_reviewed" : item.verification_status}, exception_status=${resubmitting ? null : item.exception_status}, completed_at=case when ${next}='work_complete' then now() else completed_at end, updated_at=now() where id=${itemId} and execution_status=${item.execution_status} and verification_status=${item.verification_status} returning id`;
    if (!updated[0]) throw new PunchValidationError("This punch item changed while you were working. Refresh and try again.");
    await tx`insert into punch_item_events (punch_item_id, event_type, actor_user_id, notes, metadata) values (${itemId}, ${`execution.${next}`}, ${auth.userId}, ${notes}, ${JSON.stringify({ previous: item.execution_status, next })}::jsonb)`;
    if (resubmitting) await tx`insert into punch_item_events (punch_item_id, event_type, actor_user_id, notes, metadata) values (${itemId}, 'approval.resubmitted', ${auth.userId}, ${notes}, ${JSON.stringify({ previous: "rework_required", next: "not_reviewed" })}::jsonb)`;
  });
  await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "punch_item", entityId: itemId, action: "punch.execution_changed", previousValue: { executionStatus: item.execution_status, approvalStatus: item.verification_status }, newValue: { executionStatus: next, approvalStatus: resubmitting ? "not_reviewed" : item.verification_status }, reason: notes });
}

export async function changePunchApproval(auth: AuthContext, form: FormData) {
  const itemId = uuid(form.get("itemId"), "Punch item")!;
  const next = String(form.get("approvalStatus")) as ApprovalStatus;
  if (next !== "approved" && next !== "rework_required") throw new PunchValidationError("Approval action is invalid.");
  const reason = text(form.get("reason"), "Review note", 1000, next === "approved");
  if (next === "rework_required" && !reason) throw new PunchValidationError("A rework reason is required.");
  const item = await loadPunchItem(itemId);
  if (!item) throw new PunchValidationError("Punch item not found.");
  await authorizePunchItem(auth, "punch.approve", item);
  await assertNotAssignedWorker(auth, item);
  assertApprovalTransition(item.verification_status, next, item.execution_status);
  const sql = getSql();
  await sql.begin(async transaction => {
    const tx = transaction as unknown as typeof sql;
    const updated = await tx<{ id: string }[]>`update punch_items set verification_status=${next}, exception_status=${next === "rework_required" ? "needs_rework" : null}, approved_at=${next === "approved" ? new Date().toISOString() : null}, updated_at=now() where id=${itemId} and execution_status=${item.execution_status} and verification_status=${item.verification_status} returning id`;
    if (!updated[0]) throw new PunchValidationError("This punch item changed while you were reviewing it. Refresh and try again.");
    await tx`insert into punch_item_events (punch_item_id, event_type, actor_user_id, notes, metadata) values (${itemId}, ${`approval.${next}`}, ${auth.userId}, ${reason}, ${JSON.stringify({ previous: item.verification_status, next, executionUnchanged: item.execution_status })}::jsonb)`;
  });
  await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "punch_item", entityId: itemId, action: `punch.approval_${next}`, previousValue: { executionStatus: item.execution_status, approvalStatus: item.verification_status }, newValue: { executionStatus: item.execution_status, approvalStatus: next }, reason });
}

export async function addPunchNote(auth: AuthContext, form: FormData) {
  const itemId = uuid(form.get("itemId"), "Punch item")!;
  const notes = text(form.get("notes"), "Note", 1000)!;
  const item = await loadPunchItem(itemId);
  if (!item) throw new PunchValidationError("Punch item not found.");
  const access = bestPermission(auth, ["punch.work", "punch.manage"]);
  if (!access) throw new AuthorizationError();
  await authorizePunchItem(auth, access.permission, item);
  const sql = getSql();
  await sql`insert into punch_item_events (punch_item_id, event_type, actor_user_id, notes) values (${itemId}, 'note.added', ${auth.userId}, ${notes})`;
  await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "punch_item", entityId: itemId, action: "punch.note_added", reason: notes });
}
