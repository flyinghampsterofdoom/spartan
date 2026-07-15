import { getSql } from "@/db";
import { can, requirePermission } from "@/lib/auth/policy";
import type { AuthContext, PermissionScope } from "@/lib/auth/types";
import { writeAuditEvent } from "@/lib/audit";

export const PROJECT_STATUSES = ["Planning", "Scheduled", "Active", "On Hold", "Substantially Complete", "Punch", "Complete", "Archived"] as const;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function required(value: FormDataEntryValue | null, label: string, max = 160) {
  const text = String(value ?? "").trim();
  if (!text) throw new ValidationError(`${label} is required.`);
  if (text.length > max) throw new ValidationError(`${label} must be ${max} characters or fewer.`);
  return text;
}

function optional(value: FormDataEntryValue | null, max = 2000) {
  const text = String(value ?? "").trim();
  if (text.length > max) throw new ValidationError(`A field exceeds the ${max} character limit.`);
  return text || null;
}

function uuid(value: FormDataEntryValue | null, label: string, nullable = true) {
  const text = String(value ?? "").trim();
  if (!text && nullable) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) throw new ValidationError(`${label} is invalid.`);
  return text;
}

function isoDate(value: FormDataEntryValue | null, label: string, nullable = true) {
  const text = String(value ?? "").trim();
  if (!text && nullable) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new ValidationError(`${label} is invalid.`);
  return text;
}

export function parseMoneyToCents(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(text)) throw new ValidationError("Hourly wage must be a positive dollar amount with no more than two decimals.");
  const cents = Math.round(Number(text) * 100);
  if (cents < 0 || cents > 1_000_000) throw new ValidationError("Hourly wage is outside the allowed range.");
  return cents;
}

export function operationScope(auth: AuthContext, permission: string): PermissionScope | null {
  const grant = auth.permissions[permission];
  return grant?.allowed ? grant.scope : null;
}

export type EmployeeRecord = {
  id: string; employee_number: string; first_name: string; last_name: string; phone: string | null;
  email: string | null; active: boolean; role_id: string; role_name: string; crew_names: string | null;
  user_email: string | null; notes: string | null; default_hourly_wage_cents: number | null; wage_effective_date: string | null;
};

export async function listEmployees(auth: AuthContext): Promise<EmployeeRecord[]> {
  const scope = operationScope(auth, "employees.view");
  if (!scope) throw new ValidationError("You do not have permission to view employees.");
  const sql = getSql();
  const showWages = can(auth, "wage.view");
  const base = sql<EmployeeRecord[]>`
    select e.id, e.employee_number, e.first_name, e.last_name, e.phone, e.email, e.active,
      e.role_id, r.name as role_name, u.email as user_email, e.notes,
      case when ${showWages} then e.default_hourly_wage_cents else null end as default_hourly_wage_cents,
      case when ${showWages} then e.wage_effective_date::text else null end as wage_effective_date,
      string_agg(distinct c.name, ', ' order by c.name) filter (where c.id is not null and cm.ends_on is null) as crew_names
    from employees e
    join roles r on r.id = e.role_id
    left join users u on u.id = e.user_id
    left join crew_members cm on cm.employee_id = e.id and cm.ends_on is null
    left join crews c on c.id = cm.crew_id and c.organization_id = e.organization_id
    where e.organization_id = ${auth.organizationId}
      ${scope === "self" ? sql`and e.id = ${auth.employeeId}` : scope === "assigned_crew" ? sql`and e.id in (select cm2.employee_id from crew_members cm2 join crews c2 on c2.id = cm2.crew_id where c2.organization_id = ${auth.organizationId} and c2.foreman_employee_id = ${auth.employeeId} and cm2.ends_on is null)` : sql``}
    group by e.id, r.name, u.email
    order by e.active desc, e.last_name, e.first_name
  `;
  return base;
}

export async function listRoles() {
  return getSql()< { id: string; name: string }[]>`select id, name from roles order by case name when 'Owner' then 1 when 'Manager' then 2 when 'Foreman' then 3 when 'Employee' then 4 else 5 end`;
}

export type ProjectRecord = {
  id: string; project_number: string; name: string; client_name: string; jobsite_address: string; status: string;
  start_date: string | null; estimated_completion_date: string | null; actual_completion_date: string | null;
  manager_employee_id: string | null; manager_name: string | null; foreman_employee_id: string | null; foreman_name: string | null;
  notes: string | null; active: boolean; assigned_count: number;
};

export async function listProjects(auth: AuthContext): Promise<ProjectRecord[]> {
  const scope = operationScope(auth, "projects.view");
  if (!scope) throw new ValidationError("You do not have permission to view projects.");
  const sql = getSql();
  return sql<ProjectRecord[]>`
    select p.id, p.project_number, p.name, p.client_name, p.jobsite_address, p.status,
      p.start_date::text, p.estimated_completion_date::text, p.actual_completion_date::text,
      p.manager_employee_id, case when m.id is null then null else m.first_name || ' ' || m.last_name end as manager_name,
      p.foreman_employee_id, case when f.id is null then null else f.first_name || ' ' || f.last_name end as foreman_name,
      p.notes, p.active, count(distinct coalesce(pa.employee_id::text, pa.crew_id::text))::int as assigned_count
    from projects p
    left join employees m on m.id = p.manager_employee_id
    left join employees f on f.id = p.foreman_employee_id
    left join project_assignments pa on pa.project_id = p.id
    where p.organization_id = ${auth.organizationId}
      ${scope === "assigned_project" ? sql`and (p.manager_employee_id = ${auth.employeeId} or p.foreman_employee_id = ${auth.employeeId} or exists (select 1 from project_assignments pax where pax.project_id = p.id and (pax.employee_id = ${auth.employeeId} or pax.crew_id in (select cm.crew_id from crew_members cm where cm.employee_id = ${auth.employeeId} and cm.ends_on is null))))` : scope === "self" ? sql`and exists (select 1 from project_assignments pax where pax.project_id = p.id and (pax.employee_id = ${auth.employeeId} or pax.crew_id in (select cm.crew_id from crew_members cm where cm.employee_id = ${auth.employeeId} and cm.ends_on is null)))` : sql``}
    group by p.id, m.id, f.id
    order by p.active desc, p.name
  `;
}

export type CrewRecord = { id: string; name: string; active: boolean; foreman_employee_id: string | null; foreman_name: string | null; member_count: number; member_ids: string[] };

export async function listCrews(auth: AuthContext): Promise<CrewRecord[]> {
  const scope = operationScope(auth, "employees.view");
  if (!scope) throw new ValidationError("You do not have permission to view crews.");
  const sql = getSql();
  return sql<CrewRecord[]>`
    select c.id, c.name, c.active, c.foreman_employee_id,
      case when f.id is null then null else f.first_name || ' ' || f.last_name end as foreman_name,
      count(cm.id) filter (where cm.ends_on is null)::int as member_count,
      coalesce(array_agg(cm.employee_id::text) filter (where cm.ends_on is null), '{}') as member_ids
    from crews c left join employees f on f.id = c.foreman_employee_id
    left join crew_members cm on cm.crew_id = c.id
    where c.organization_id = ${auth.organizationId}
      ${scope === "assigned_crew" ? sql`and c.foreman_employee_id = ${auth.employeeId}` : scope === "self" ? sql`and exists (select 1 from crew_members own where own.crew_id = c.id and own.employee_id = ${auth.employeeId} and own.ends_on is null)` : sql``}
    group by c.id, f.id order by c.active desc, c.name
  `;
}

export async function saveEmployee(auth: AuthContext, form: FormData) {
  requirePermission(auth, "employees.manage");
  const sql = getSql();
  const id = uuid(form.get("id"), "Employee", true);
  const roleId = uuid(form.get("roleId"), "Role", false)!;
  const data = {
    employeeNumber: required(form.get("employeeNumber"), "Employee ID", 40),
    firstName: required(form.get("firstName"), "First name", 100), lastName: required(form.get("lastName"), "Last name", 100),
    phone: optional(form.get("phone"), 40), email: optional(form.get("email"), 254), roleId, notes: optional(form.get("notes")),
  };
  const validRole = await sql<{ ok: boolean }[]>`select exists(select 1 from roles where id = ${roleId}) as ok`;
  if (!validRole[0]?.ok) throw new ValidationError("Role is invalid.");
  if (!id) {
    const rows = await sql<{ id: string }[]>`insert into employees (organization_id, employee_number, first_name, last_name, phone, email, role_id, default_hourly_wage_cents, wage_effective_date, notes) values (${auth.organizationId}, ${data.employeeNumber}, ${data.firstName}, ${data.lastName}, ${data.phone}, ${data.email}, ${data.roleId}, 0, current_date, ${data.notes}) returning id`;
    await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "employee", entityId: rows[0].id, action: "employee.created", newValue: data });
    return;
  }
  const before = await sql<EmployeeRecord[]>`select e.*, r.name as role_name, null::text as crew_names, null::text as user_email from employees e join roles r on r.id=e.role_id where e.id=${id} and e.organization_id=${auth.organizationId}`;
  if (!before[0]) throw new ValidationError("Employee not found.");
  await sql`update employees set employee_number=${data.employeeNumber}, first_name=${data.firstName}, last_name=${data.lastName}, phone=${data.phone}, email=${data.email}, role_id=${data.roleId}, notes=${data.notes}, updated_at=now() where id=${id} and organization_id=${auth.organizationId}`;
  const priorEmployee = { employeeNumber: before[0].employee_number, firstName: before[0].first_name, lastName: before[0].last_name, phone: before[0].phone, email: before[0].email, roleId: before[0].role_id, notes: before[0].notes };
  await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "employee", entityId: id, action: "employee.updated", previousValue: priorEmployee, newValue: data });
}

export async function saveProject(auth: AuthContext, form: FormData) {
  requirePermission(auth, "projects.manage");
  const sql = getSql();
  const id = uuid(form.get("id"), "Project", true);
  const status = required(form.get("status"), "Status", 40);
  if (!PROJECT_STATUSES.includes(status as (typeof PROJECT_STATUSES)[number])) throw new ValidationError("Project status is invalid.");
  const data = { projectNumber: required(form.get("projectNumber"), "Project ID", 40), name: required(form.get("name"), "Project name"), clientName: required(form.get("clientName"), "Client name"), jobsiteAddress: required(form.get("jobsiteAddress"), "Jobsite address", 300), status, startDate: isoDate(form.get("startDate"), "Start date"), estimatedCompletionDate: isoDate(form.get("estimatedCompletionDate"), "Estimated completion date"), actualCompletionDate: isoDate(form.get("actualCompletionDate"), "Actual completion date"), managerEmployeeId: uuid(form.get("managerEmployeeId"), "Manager"), foremanEmployeeId: uuid(form.get("foremanEmployeeId"), "Foreman"), notes: optional(form.get("notes")) };
  for (const employeeId of [data.managerEmployeeId, data.foremanEmployeeId].filter(Boolean) as string[]) {
    const match = await sql<{ ok: boolean }[]>`select exists(select 1 from employees where id=${employeeId} and organization_id=${auth.organizationId}) as ok`;
    if (!match[0]?.ok) throw new ValidationError("Assigned manager or foreman is invalid.");
  }
  if (!id) {
    const rows = await sql<{ id: string }[]>`insert into projects (organization_id, project_number, name, client_name, jobsite_address, status, start_date, estimated_completion_date, actual_completion_date, manager_employee_id, foreman_employee_id, notes) values (${auth.organizationId}, ${data.projectNumber}, ${data.name}, ${data.clientName}, ${data.jobsiteAddress}, ${data.status}, ${data.startDate}, ${data.estimatedCompletionDate}, ${data.actualCompletionDate}, ${data.managerEmployeeId}, ${data.foremanEmployeeId}, ${data.notes}) returning id`;
    await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "project", entityId: rows[0].id, action: "project.created", newValue: data });
    return;
  }
  const before = await sql<Record<string, unknown>[]>`select * from projects where id=${id} and organization_id=${auth.organizationId}`;
  if (!before[0]) throw new ValidationError("Project not found.");
  await sql`update projects set project_number=${data.projectNumber}, name=${data.name}, client_name=${data.clientName}, jobsite_address=${data.jobsiteAddress}, status=${data.status}, start_date=${data.startDate}, estimated_completion_date=${data.estimatedCompletionDate}, actual_completion_date=${data.actualCompletionDate}, manager_employee_id=${data.managerEmployeeId}, foreman_employee_id=${data.foremanEmployeeId}, notes=${data.notes}, updated_at=now() where id=${id} and organization_id=${auth.organizationId}`;
  await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "project", entityId: id, action: before[0].status === data.status ? "project.updated" : "project.status_changed", previousValue: before[0], newValue: data });
}

export async function saveCrew(auth: AuthContext, form: FormData) {
  requirePermission(auth, "employees.manage");
  const sql = getSql();
  const id = uuid(form.get("id"), "Crew", true);
  const name = required(form.get("name"), "Crew name");
  const foremanEmployeeId = uuid(form.get("foremanEmployeeId"), "Foreman");
  if (foremanEmployeeId) {
    const valid = await sql<{ ok: boolean }[]>`select exists(select 1 from employees where id=${foremanEmployeeId} and organization_id=${auth.organizationId}) as ok`;
    if (!valid[0]?.ok) throw new ValidationError("Foreman is invalid.");
  }
  if (!id) {
    const rows = await sql<{ id: string }[]>`insert into crews (organization_id, name, foreman_employee_id) values (${auth.organizationId}, ${name}, ${foremanEmployeeId}) returning id`;
    await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "crew", entityId: rows[0].id, action: "crew.created", newValue: { name, foremanEmployeeId } });
    return;
  }
  const before = await sql<Record<string, unknown>[]>`select * from crews where id=${id} and organization_id=${auth.organizationId}`;
  if (!before[0]) throw new ValidationError("Crew not found.");
  await sql`update crews set name=${name}, foreman_employee_id=${foremanEmployeeId}, updated_at=now() where id=${id} and organization_id=${auth.organizationId}`;
  await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "crew", entityId: id, action: "crew.updated", previousValue: before[0], newValue: { name, foremanEmployeeId } });
}

export async function updateOperationalState(auth: AuthContext, form: FormData) {
  const entity = required(form.get("entity"), "Entity", 20);
  const id = uuid(form.get("id"), "Record", false)!;
  const active = String(form.get("active")) === "true";
  const sql = getSql();
  if (entity === "project") requirePermission(auth, "projects.manage"); else requirePermission(auth, "employees.manage");
  if (!['employee', 'project', 'crew'].includes(entity)) throw new ValidationError("Unsupported record type.");
  const table = entity === "employee" ? sql`employees` : entity === "project" ? sql`projects` : sql`crews`;
  const rows = await sql<{ id: string; active: boolean }[]>`update ${table} set active=${active}, updated_at=now() where id=${id} and organization_id=${auth.organizationId} returning id, active`;
  if (!rows[0]) throw new ValidationError("Record not found.");
  await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: entity, entityId: id, action: `${entity}.${active ? "activated" : "deactivated"}`, newValue: { active } });
}

export async function updateCrewMember(auth: AuthContext, form: FormData) {
  requirePermission(auth, "employees.manage");
  const sql = getSql();
  const crewId = uuid(form.get("crewId"), "Crew", false)!;
  const employeeId = uuid(form.get("employeeId"), "Employee", false)!;
  const action = required(form.get("memberAction"), "Action", 20);
  const valid = await sql<{ ok: boolean }[]>`select exists(select 1 from crews c join employees e on e.organization_id=c.organization_id where c.id=${crewId} and e.id=${employeeId} and c.organization_id=${auth.organizationId}) as ok`;
  if (!valid[0]?.ok) throw new ValidationError("Crew or employee not found.");
  if (action === "add") {
    const today = new Date().toISOString().slice(0, 10);
    await sql`insert into crew_members (crew_id, employee_id, starts_on) select ${crewId}, ${employeeId}, ${today} where not exists (select 1 from crew_members where crew_id=${crewId} and employee_id=${employeeId} and ends_on is null) on conflict (crew_id, employee_id, starts_on) do update set ends_on=null`;
  } else if (action === "remove") {
    const today = new Date().toISOString().slice(0, 10);
    await sql`update crew_members set ends_on=${today} where crew_id=${crewId} and employee_id=${employeeId} and ends_on is null`;
  } else throw new ValidationError("Crew member action is invalid.");
  await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "crew", entityId: crewId, action: `crew.member_${action === "add" ? "added" : "removed"}`, newValue: { employeeId } });
}
