import { getSql } from "@/db";
import { writeAuditEvent } from "@/lib/audit";
import type { AuthContext, PermissionScope } from "@/lib/auth/types";
import { AuthorizationError } from "@/lib/auth/policy";

export const SCHEDULE_STATUSES = [
  ["scheduled_to_work", "Scheduled to Work"], ["day_off", "Day Off"], ["pto", "PTO"],
  ["sick", "Sick"], ["unavailable", "Unavailable"], ["holiday", "Holiday"], ["on_call", "On Call"],
] as const;

export class ScheduleValidationError extends Error {
  constructor(message: string) { super(message); this.name = "ScheduleValidationError"; }
}

function text(value: FormDataEntryValue | null, label: string, required = false, max = 1000) {
  const result = String(value ?? "").trim();
  if (required && !result) throw new ScheduleValidationError(`${label} is required.`);
  if (result.length > max) throw new ScheduleValidationError(`${label} must be ${max} characters or fewer.`);
  return result || null;
}

function uuid(value: FormDataEntryValue | null, label: string, required = false) {
  const result = text(value, label, required, 40);
  if (!result) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) throw new ScheduleValidationError(`${label} is invalid.`);
  return result;
}

export function parseScheduleDate(value: FormDataEntryValue | null, label = "Date") {
  const result = text(value, label, true, 10)!;
  const parsed = new Date(`${result}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) throw new ScheduleValidationError(`${label} is invalid.`);
  return result;
}

function time(value: FormDataEntryValue | null, label: string, required = false) {
  const result = text(value, label, required, 5);
  if (result && !/^([01]\d|2[0-3]):[0-5]\d$/.test(result)) throw new ScheduleValidationError(`${label} is invalid.`);
  return result;
}

export function getWeekStart(value?: string | null) {
  const parsed = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : new Date();
  if (Number.isNaN(parsed.getTime())) throw new ScheduleValidationError("Week is invalid.");
  const day = parsed.getUTCDay();
  parsed.setUTCDate(parsed.getUTCDate() - (day === 0 ? 6 : day - 1));
  return parsed.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function scheduleScope(auth: AuthContext, permission = "schedules.view"): PermissionScope | null {
  const grant = auth.permissions[permission];
  return grant?.allowed ? grant.scope : null;
}

export type ScheduleEntryRecord = {
  id: string; employee_id: string; employee_name: string; employee_number: string; work_date: string; status: string;
  start_time: string | null; end_time: string | null; project_id: string | null; project_name: string | null;
  jobsite_address: string | null; crew_id: string | null; crew_name: string | null; foreman_employee_id: string | null;
  foreman_name: string | null; work_category_id: string | null; category_name: string | null; notes: string | null;
};

export async function listScheduleEntries(auth: AuthContext, weekStart: string) {
  const scope = scheduleScope(auth);
  if (!scope) throw new AuthorizationError("You do not have permission to view schedules.");
  const weekEnd = addDays(weekStart, 6);
  const sql = getSql();
  return sql<ScheduleEntryRecord[]>`
    select s.id, s.employee_id, e.first_name || ' ' || e.last_name as employee_name, e.employee_number,
      s.work_date::text, s.status, s.start_time::text, s.end_time::text, s.project_id, p.name as project_name,
      coalesce(s.jobsite_address, p.jobsite_address) as jobsite_address, s.crew_id, c.name as crew_name,
      s.foreman_employee_id, case when f.id is null then null else f.first_name || ' ' || f.last_name end as foreman_name,
      s.work_category_id, wc.name as category_name, s.notes
    from schedule_entries s
    join employees e on e.id=s.employee_id and e.organization_id=s.organization_id
    left join projects p on p.id=s.project_id and p.organization_id=s.organization_id
    left join crews c on c.id=s.crew_id and c.organization_id=s.organization_id
    left join employees f on f.id=s.foreman_employee_id and f.organization_id=s.organization_id
    left join work_categories wc on wc.id=s.work_category_id and wc.organization_id=s.organization_id
    where s.organization_id=${auth.organizationId} and s.work_date between ${weekStart} and ${weekEnd}
      ${scope === "self" ? sql`and s.employee_id=${auth.employeeId}` : scope === "assigned_project" ? sql`and (s.project_id in (select p2.id from projects p2 where p2.organization_id=${auth.organizationId} and (p2.manager_employee_id=${auth.employeeId} or p2.foreman_employee_id=${auth.employeeId} or exists(select 1 from project_assignments pa where pa.project_id=p2.id and (pa.employee_id=${auth.employeeId} or pa.crew_id in (select cm.crew_id from crew_members cm where cm.employee_id=${auth.employeeId} and cm.ends_on is null))))) or s.crew_id in (select id from crews where organization_id=${auth.organizationId} and foreman_employee_id=${auth.employeeId}))` : scope === "assigned_crew" ? sql`and s.crew_id in (select id from crews where organization_id=${auth.organizationId} and foreman_employee_id=${auth.employeeId})` : sql``}
    order by e.last_name, e.first_name, s.work_date, s.start_time nulls last, s.created_at
  `;
}

export async function listScheduleEmployees(auth: AuthContext) {
  const scope = scheduleScope(auth);
  if (!scope) throw new AuthorizationError();
  const sql = getSql();
  return sql<{ id: string; name: string; employee_number: string; role_name: string }[]>`
    select distinct e.id, e.first_name || ' ' || e.last_name as name, e.employee_number, r.name as role_name
    from employees e join roles r on r.id=e.role_id
    where e.organization_id=${auth.organizationId} and e.active=true
      ${scope === "self" ? sql`and e.id=${auth.employeeId}` : scope === "assigned_project" ? sql`and (e.id=${auth.employeeId} or exists(select 1 from schedule_entries s join projects p on p.id=s.project_id where s.employee_id=e.id and s.organization_id=${auth.organizationId} and (p.manager_employee_id=${auth.employeeId} or p.foreman_employee_id=${auth.employeeId})) or e.id in (select cm.employee_id from crew_members cm join crews c on c.id=cm.crew_id where c.organization_id=${auth.organizationId} and c.foreman_employee_id=${auth.employeeId} and cm.ends_on is null))` : scope === "assigned_crew" ? sql`and e.id in (select cm.employee_id from crew_members cm join crews c on c.id=cm.crew_id where c.organization_id=${auth.organizationId} and c.foreman_employee_id=${auth.employeeId} and cm.ends_on is null)` : sql``}
    order by name
  `;
}

export async function listWorkCategories(auth: AuthContext) {
  return getSql()<{ id: string; name: string }[]>`select id, name from work_categories where organization_id=${auth.organizationId} and active=true order by name`;
}

async function assertScheduleManagement(auth: AuthContext, employeeId: string, crewId: string | null, projectId: string | null) {
  const scope = scheduleScope(auth, "schedules.manage");
  if (!scope) throw new AuthorizationError("You do not have permission to manage schedules.");
  if (scope === "organization") return;
  const sql = getSql();
  if (scope === "assigned_crew" && auth.employeeId && crewId) {
    const rows = await sql<{ allowed: boolean }[]>`select exists(select 1 from crews c join crew_members cm on cm.crew_id=c.id where c.id=${crewId} and c.organization_id=${auth.organizationId} and c.foreman_employee_id=${auth.employeeId} and cm.employee_id=${employeeId} and cm.ends_on is null) as allowed`;
    if (!rows[0]?.allowed) throw new AuthorizationError("You may schedule only workers in crews you manage.");
    if (projectId) {
      const projects = await sql<{ allowed: boolean }[]>`select exists(select 1 from projects p where p.id=${projectId} and p.organization_id=${auth.organizationId} and (p.foreman_employee_id=${auth.employeeId} or p.manager_employee_id=${auth.employeeId} or exists(select 1 from project_assignments pa where pa.project_id=p.id and (pa.employee_id=${auth.employeeId} or pa.crew_id=${crewId})))) as allowed`;
      if (!projects[0]?.allowed) throw new AuthorizationError("You may assign workers only to projects within your scope.");
    }
    return;
  }
  if (scope === "assigned_project" && auth.employeeId && projectId) {
    const rows = await sql<{ allowed: boolean }[]>`select exists(select 1 from projects p where p.id=${projectId} and p.organization_id=${auth.organizationId} and (p.foreman_employee_id=${auth.employeeId} or p.manager_employee_id=${auth.employeeId})) as allowed`;
    if (rows[0]?.allowed) return;
  }
  throw new AuthorizationError("This schedule assignment is outside your authorized scope.");
}

async function validateReferences(auth: AuthContext, employeeId: string, projectId: string | null, crewId: string | null, foremanId: string | null, categoryId: string | null) {
  const sql = getSql();
  const rows = await sql<{ employee_ok: boolean; project_ok: boolean; crew_ok: boolean; foreman_ok: boolean; category_ok: boolean }[]>`
    select exists(select 1 from employees where id=${employeeId} and organization_id=${auth.organizationId} and active=true) employee_ok,
      (${projectId}::uuid is null or exists(select 1 from projects where id=${projectId} and organization_id=${auth.organizationId} and active=true)) project_ok,
      (${crewId}::uuid is null or exists(select 1 from crews where id=${crewId} and organization_id=${auth.organizationId} and active=true)) crew_ok,
      (${foremanId}::uuid is null or exists(select 1 from employees where id=${foremanId} and organization_id=${auth.organizationId} and active=true)) foreman_ok,
      (${categoryId}::uuid is null or exists(select 1 from work_categories where id=${categoryId} and organization_id=${auth.organizationId} and active=true)) category_ok
  `;
  const valid = rows[0];
  if (!valid?.employee_ok || !valid.project_ok || !valid.crew_ok || !valid.foreman_ok || !valid.category_ok) throw new ScheduleValidationError("One or more schedule selections are invalid or inactive.");
}

export async function saveScheduleEntry(auth: AuthContext, form: FormData) {
  const sql = getSql();
  const id = uuid(form.get("id"), "Schedule entry");
  const employeeId = uuid(form.get("employeeId"), "Employee", true)!;
  const workDate = parseScheduleDate(form.get("workDate"));
  const status = text(form.get("status"), "Status", true, 30)!;
  if (!SCHEDULE_STATUSES.some(([value]) => value === status)) throw new ScheduleValidationError("Schedule status is invalid.");
  const scheduled = status === "scheduled_to_work" || status === "on_call";
  const startTime = scheduled ? time(form.get("startTime"), "Start time", true)! : null;
  const endTime = scheduled ? time(form.get("endTime"), "End time", true)! : null;
  if (startTime && endTime && endTime <= startTime) throw new ScheduleValidationError("End time must be after start time.");
  const projectId = status === "scheduled_to_work" ? uuid(form.get("projectId"), "Project", true) : null;
  // Keep crew context on non-work statuses so a scoped foreman can record PTO,
  // sick days, or unavailability for workers in a crew they manage.
  const crewId = uuid(form.get("crewId"), "Crew");
  const foremanId = scheduled ? uuid(form.get("foremanEmployeeId"), "Foreman") : null;
  const categoryId = status === "scheduled_to_work" ? uuid(form.get("workCategoryId"), "Work category") : null;
  const notes = text(form.get("notes"), "Notes", false, 2000);
  await validateReferences(auth, employeeId, projectId, crewId, foremanId, categoryId);
  await assertScheduleManagement(auth, employeeId, crewId, projectId);
  let jobsiteAddress: string | null = null;
  if (projectId) {
    const project = await sql<{ jobsite_address: string }[]>`select jobsite_address from projects where id=${projectId} and organization_id=${auth.organizationId}`;
    jobsiteAddress = project[0]?.jobsite_address ?? null;
  }
  const next = { employeeId, workDate, status, startTime, endTime, projectId, crewId, foremanId, categoryId, notes };
  if (!id) {
    const duplicate = await sql<{ exists: boolean }[]>`select exists(select 1 from schedule_entries where organization_id=${auth.organizationId} and employee_id=${employeeId} and work_date=${workDate} and status=${status} and start_time is not distinct from ${startTime}::time and end_time is not distinct from ${endTime}::time and project_id is not distinct from ${projectId}::uuid) as exists`;
    if (duplicate[0]?.exists) throw new ScheduleValidationError("That employee already has an identical assignment.");
    const rows = await sql<{ id: string }[]>`insert into schedule_entries (organization_id, employee_id, work_date, status, start_time, end_time, project_id, jobsite_address, crew_id, foreman_employee_id, work_category_id, notes, created_by_user_id) values (${auth.organizationId}, ${employeeId}, ${workDate}, ${status}, ${startTime}, ${endTime}, ${projectId}, ${jobsiteAddress}, ${crewId}, ${foremanId}, ${categoryId}, ${notes}, ${auth.userId}) returning id`;
    await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "schedule_entry", entityId: rows[0].id, action: "schedule.created", newValue: next });
    return;
  }
  const before = await sql<Record<string, unknown>[]>`select * from schedule_entries where id=${id} and organization_id=${auth.organizationId}`;
  if (!before[0]) throw new ScheduleValidationError("Schedule entry not found.");
  await assertScheduleManagement(auth, String(before[0].employee_id), before[0].crew_id ? String(before[0].crew_id) : null, before[0].project_id ? String(before[0].project_id) : null);
  await sql`update schedule_entries set employee_id=${employeeId}, work_date=${workDate}, status=${status}, start_time=${startTime}, end_time=${endTime}, project_id=${projectId}, jobsite_address=${jobsiteAddress}, crew_id=${crewId}, foreman_employee_id=${foremanId}, work_category_id=${categoryId}, notes=${notes}, updated_at=now() where id=${id} and organization_id=${auth.organizationId}`;
  await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "schedule_entry", entityId: id, action: "schedule.updated", previousValue: before[0], newValue: next });
}

export async function deleteScheduleEntry(auth: AuthContext, form: FormData) {
  const id = uuid(form.get("id"), "Schedule entry", true)!;
  const sql = getSql();
  const rows = await sql<(Record<string, unknown> & { employee_id: string; crew_id: string | null; project_id: string | null })[]>`select * from schedule_entries where id=${id} and organization_id=${auth.organizationId}`;
  if (!rows[0]) throw new ScheduleValidationError("Schedule entry not found.");
  await assertScheduleManagement(auth, rows[0].employee_id, rows[0].crew_id, rows[0].project_id);
  await sql`delete from schedule_entries where id=${id} and organization_id=${auth.organizationId}`;
  await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "schedule_entry", entityId: id, action: "schedule.deleted", previousValue: rows[0], reason: text(form.get("reason"), "Reason", false, 300) });
}

export async function assignCrewRange(auth: AuthContext, form: FormData) {
  const crewId = uuid(form.get("crewId"), "Crew", true)!;
  const projectId = uuid(form.get("projectId"), "Project", true)!;
  const startDate = parseScheduleDate(form.get("rangeStart"), "Start date");
  const endDate = parseScheduleDate(form.get("rangeEnd"), "End date");
  const startTime = time(form.get("startTime"), "Start time", true)!;
  const endTime = time(form.get("endTime"), "End time", true)!;
  if (endDate < startDate) throw new ScheduleValidationError("End date must be on or after start date.");
  if ((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000 > 62) throw new ScheduleValidationError("Crew assignments are limited to 63 days at a time.");
  if (endTime <= startTime) throw new ScheduleValidationError("End time must be after start time.");
  const categoryId = uuid(form.get("workCategoryId"), "Work category");
  const notes = text(form.get("notes"), "Notes", false, 2000);
  const sql = getSql();
  const members = await sql<{ employee_id: string }[]>`select cm.employee_id from crew_members cm join crews c on c.id=cm.crew_id where c.id=${crewId} and c.organization_id=${auth.organizationId} and c.active=true and cm.ends_on is null`;
  if (!members.length) throw new ScheduleValidationError("This crew has no active members.");
  await validateReferences(auth, members[0].employee_id, projectId, crewId, null, categoryId);
  await assertScheduleManagement(auth, members[0].employee_id, crewId, projectId);
  const inserted = await sql<{ id: string }[]>`
    insert into schedule_entries (organization_id, employee_id, work_date, status, start_time, end_time, project_id, jobsite_address, crew_id, foreman_employee_id, work_category_id, notes, created_by_user_id)
    select ${auth.organizationId}, cm.employee_id, day::date, 'scheduled_to_work', ${startTime}::time, ${endTime}::time,
      p.id, p.jobsite_address, c.id, c.foreman_employee_id, ${categoryId}, ${notes}, ${auth.userId}
    from crews c join projects p on p.id=${projectId} and p.organization_id=c.organization_id
    join crew_members cm on cm.crew_id=c.id
    cross join generate_series(${startDate}::date, ${endDate}::date, interval '1 day') day
    where c.id=${crewId} and c.organization_id=${auth.organizationId} and c.active=true
      and cm.starts_on <= day::date and (cm.ends_on is null or cm.ends_on >= day::date)
      and extract(isodow from day) between 1 and 5
      and not exists(select 1 from schedule_entries existing where existing.organization_id=${auth.organizationId} and existing.employee_id=cm.employee_id and existing.work_date=day::date and existing.project_id=p.id and existing.start_time=${startTime}::time and existing.end_time=${endTime}::time)
    returning id
  `;
  await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "crew", entityId: crewId, action: "schedule.crew_range_assigned", newValue: { projectId, startDate, endDate, startTime, endTime, categoryId, createdEntries: inserted.length } });
  return inserted.length;
}
