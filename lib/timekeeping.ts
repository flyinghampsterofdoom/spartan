import { getSql } from "@/db";
import { writeAuditEvent } from "@/lib/audit";
import { assertNotSelfApproval } from "@/lib/auth/policy";
import type { AuthContext, PermissionScope } from "@/lib/auth/types";
import { AuthorizationError, authorizeResource } from "@/lib/auth/authorization";

export class TimekeepingValidationError extends Error {
  constructor(message: string) { super(message); this.name = "TimekeepingValidationError"; }
}

function uuid(value: FormDataEntryValue | null, label: string, required = false) {
  const result = String(value ?? "").trim();
  if (!result && !required) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) throw new TimekeepingValidationError(`${label} is invalid.`);
  return result;
}

function note(value: FormDataEntryValue | null, label: string, required = false, max = 1000) {
  const result = String(value ?? "").trim();
  if (required && !result) throw new TimekeepingValidationError(`${label} is required.`);
  if (result.length > max) throw new TimekeepingValidationError(`${label} must be ${max} characters or fewer.`);
  return result || null;
}

function localDateTime(value: FormDataEntryValue | null, label: string, required = false) {
  const result = String(value ?? "").trim();
  if (!result && !required) return null;
  if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(result)) throw new TimekeepingValidationError(`${label} is invalid.`);
  return result;
}

export function timeScope(auth: AuthContext, permission = "time.view"): PermissionScope | null {
  const grant = auth.permissions[permission];
  return grant?.allowed ? grant.scope : null;
}

export function dateInTimeZone(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function calculateLabor(input: { clockInMs: number; clockOutMs: number; unpaidBreakMinutes: number; priorPaidMinutes?: number; wageCents: number; overtimeMultiplier?: number }) {
  const grossMinutes = Math.max(0, Math.round((input.clockOutMs - input.clockInMs) / 60000));
  const unpaidBreakMinutes = Math.min(grossMinutes, Math.max(0, Math.round(input.unpaidBreakMinutes)));
  const paidMinutes = Math.max(0, grossMinutes - unpaidBreakMinutes);
  const regularCapacity = Math.max(0, 480 - Math.max(0, input.priorPaidMinutes ?? 0));
  const regularMinutes = Math.min(paidMinutes, regularCapacity);
  const overtimeMinutes = Math.max(0, paidMinutes - regularMinutes);
  const overtimeMultiplier = input.overtimeMultiplier ?? 1.5;
  const laborCostCents = Math.round((regularMinutes * input.wageCents + overtimeMinutes * input.wageCents * overtimeMultiplier) / 60);
  return { grossMinutes, unpaidBreakMinutes, paidMinutes, regularMinutes, overtimeMinutes, laborCostCents };
}

export async function getOrganizationClock(auth: AuthContext, now = new Date()) {
  const rows = await getSql()<{ default_timezone: string }[]>`select default_timezone from organizations where id=${auth.organizationId}`;
  const timeZone = rows[0]?.default_timezone ?? "UTC";
  return { nowIso: now.toISOString(), workDate: dateInTimeZone(now, timeZone), timeZone };
}

type RecalculationRow = { id: string; clock_in_at: Date | string; clock_out_at: Date | string | null; wage_snapshot_cents: number; overtime_multiplier: string | number; unpaid_break_minutes: number };

export async function recalculateEmployeeDay(organizationId: string, employeeId: string, workDate: string) {
  const sql = getSql();
  const entries = await sql<RecalculationRow[]>`
    select te.id, te.clock_in_at, te.clock_out_at, te.wage_snapshot_cents, te.overtime_multiplier,
      coalesce(sum(case when b.paid=false and b.ended_at is not null then extract(epoch from (b.ended_at-b.started_at))/60 else 0 end),0)::int as unpaid_break_minutes
    from time_entries te left join break_entries b on b.time_entry_id=te.id
    where te.organization_id=${organizationId} and te.employee_id=${employeeId} and te.work_date=${workDate}
    group by te.id order by te.clock_in_at, te.created_at
  `;
  let priorPaidMinutes = 0;
  for (const entry of entries) {
    if (!entry.clock_out_at) continue;
    const calculated = calculateLabor({
      clockInMs: new Date(entry.clock_in_at).getTime(), clockOutMs: new Date(entry.clock_out_at).getTime(),
      unpaidBreakMinutes: entry.unpaid_break_minutes, priorPaidMinutes, wageCents: entry.wage_snapshot_cents,
      overtimeMultiplier: Number(entry.overtime_multiplier),
    });
    priorPaidMinutes += calculated.paidMinutes;
    await sql`update time_entries set gross_minutes=${calculated.grossMinutes}, unpaid_break_minutes=${calculated.unpaidBreakMinutes}, paid_minutes=${calculated.paidMinutes}, regular_minutes=${calculated.regularMinutes}, overtime_minutes=${calculated.overtimeMinutes}, labor_cost_cents=${calculated.laborCostCents}, updated_at=now() where id=${entry.id} and organization_id=${organizationId}`;
  }
}

export type ClockOption = { schedule_entry_id: string | null; project_id: string; project_name: string; jobsite_address: string; start_time: string | null; end_time: string | null; work_category_id: string | null; category_name: string | null };

export async function listClockOptions(auth: AuthContext, workDate: string) {
  if (!auth.employeeId || !auth.permissions["time.clock"]?.allowed) return [];
  const sql = getSql();
  const scheduled = await sql<ClockOption[]>`
    select s.id as schedule_entry_id, p.id as project_id, p.name as project_name, p.jobsite_address,
      s.start_time::text, s.end_time::text, s.work_category_id, wc.name as category_name
    from schedule_entries s join projects p on p.id=s.project_id and p.organization_id=s.organization_id
    left join work_categories wc on wc.id=s.work_category_id and wc.organization_id=s.organization_id
    where s.organization_id=${auth.organizationId} and s.employee_id=${auth.employeeId} and s.work_date=${workDate}
      and s.status='scheduled_to_work' and p.active=true order by s.start_time
  `;
  if (scheduled.length || auth.permissions["time.clock"].scope !== "organization") return scheduled;
  return sql<ClockOption[]>`select null::uuid as schedule_entry_id, id as project_id, name as project_name, jobsite_address, null::text as start_time, null::text as end_time, null::uuid as work_category_id, null::text as category_name from projects where organization_id=${auth.organizationId} and active=true order by name`;
}

export type TimeEntryRecord = {
  id: string; employee_id: string; employee_name: string; employee_number: string; work_date: string; project_id: string; project_name: string;
  clock_in_at: Date | string; clock_out_at: Date | string | null; gross_minutes: number; unpaid_break_minutes: number; paid_minutes: number;
  regular_minutes: number; overtime_minutes: number; wage_snapshot_cents: number | null; labor_cost_cents: number | null; status: string;
  open_break_id: string | null; break_count: number; pending_correction_count: number;
};

export async function listTimeEntries(auth: AuthContext, startDate: string, endDate: string) {
  const scope = timeScope(auth);
  if (!scope) throw new AuthorizationError("You do not have permission to view time entries.");
  const showWages = Boolean(auth.permissions["wage.view"]?.allowed);
  const sql = getSql();
  return sql<TimeEntryRecord[]>`
    select te.id, te.employee_id, e.first_name || ' ' || e.last_name as employee_name, e.employee_number,
      te.work_date::text, te.project_id, p.name as project_name, te.clock_in_at, te.clock_out_at,
      te.gross_minutes, te.unpaid_break_minutes, te.paid_minutes, te.regular_minutes, te.overtime_minutes,
      case when ${showWages} then te.wage_snapshot_cents else null end as wage_snapshot_cents,
      case when ${showWages} then te.labor_cost_cents else null end as labor_cost_cents, te.status,
      (select id from break_entries where time_entry_id=te.id and ended_at is null order by started_at desc limit 1) as open_break_id,
      (select count(*)::int from break_entries where time_entry_id=te.id) as break_count,
      (select count(*)::int from time_correction_requests where time_entry_id=te.id and status='pending') as pending_correction_count
    from time_entries te join employees e on e.id=te.employee_id and e.organization_id=te.organization_id
    join projects p on p.id=te.project_id and p.organization_id=te.organization_id
    where te.organization_id=${auth.organizationId} and te.work_date between ${startDate} and ${endDate}
      ${scope === "self" ? sql`and te.employee_id=${auth.employeeId}` : scope === "assigned_project" ? sql`and te.project_id in (select p2.id from projects p2 where p2.organization_id=${auth.organizationId} and (p2.manager_employee_id=${auth.employeeId} or p2.foreman_employee_id=${auth.employeeId} or exists(select 1 from project_assignments pa where pa.project_id=p2.id and (pa.employee_id=${auth.employeeId} or pa.crew_id in (select cm.crew_id from crew_members cm where cm.employee_id=${auth.employeeId} and cm.ends_on is null)))))` : scope === "assigned_crew" ? sql`and te.employee_id in (select cm.employee_id from crew_members cm join crews c on c.id=cm.crew_id where c.organization_id=${auth.organizationId} and c.foreman_employee_id=${auth.employeeId} and cm.ends_on is null)` : sql``}
    order by te.work_date desc, te.clock_in_at desc
  `;
}

export async function listCorrectionRequests(auth: AuthContext, entryIds: string[]) {
  if (!entryIds.length) return [];
  const sql = getSql();
  return sql<{ id: string; time_entry_id: string; requested_changes: Record<string, unknown>; reason: string; status: string; created_at: Date | string; requested_by: string }[]>`
    select cr.id, cr.time_entry_id, cr.requested_changes, cr.reason, cr.status, cr.created_at, u.display_name as requested_by
    from time_correction_requests cr join users u on u.id=cr.requested_by_user_id
    where cr.time_entry_id in ${sql(entryIds)} order by cr.created_at desc
  `;
}

async function activeSelfEntry(auth: AuthContext) {
  if (!auth.employeeId) throw new TimekeepingValidationError("Your account is not linked to an employee record.");
  const rows = await getSql()<{ id: string; organization_id: string; employee_id: string; work_date: string; project_id: string; status: string }[]>`select id, organization_id, employee_id, work_date::text, project_id, status from time_entries where organization_id=${auth.organizationId} and employee_id=${auth.employeeId} and status='active' and clock_out_at is null order by clock_in_at desc limit 1`;
  if (!rows[0]) throw new TimekeepingValidationError("No active time entry was found.");
  return rows[0];
}

export async function clockIn(auth: AuthContext, form: FormData, now = new Date()) {
  if (!auth.employeeId || !auth.permissions["time.clock"]?.allowed) throw new AuthorizationError("You do not have permission to clock in.");
  const projectId = uuid(form.get("projectId"), "Project", true)!;
  const scheduleEntryId = uuid(form.get("scheduleEntryId"), "Schedule assignment");
  const workCategoryId = uuid(form.get("workCategoryId"), "Work category");
  const sql = getSql();
  const clock = await getOrganizationClock(auth, now);
  const active = await sql<{ exists: boolean }[]>`select exists(select 1 from time_entries where organization_id=${auth.organizationId} and employee_id=${auth.employeeId} and status='active' and clock_out_at is null) as exists`;
  if (active[0]?.exists) throw new TimekeepingValidationError("You are already clocked in.");
  const project = await sql<{ ok: boolean }[]>`
    select exists(select 1 from projects p where p.id=${projectId} and p.organization_id=${auth.organizationId} and p.active=true and (
      ${auth.permissions["time.clock"].scope === "organization"}
      or exists(select 1 from schedule_entries s where s.organization_id=${auth.organizationId} and s.employee_id=${auth.employeeId} and s.work_date=${clock.workDate} and s.project_id=p.id and (${scheduleEntryId}::uuid is null or s.id=${scheduleEntryId}))
      or exists(select 1 from project_assignments pa where pa.project_id=p.id and (pa.employee_id=${auth.employeeId} or pa.crew_id in (select cm.crew_id from crew_members cm where cm.employee_id=${auth.employeeId} and cm.ends_on is null)))
    )) as ok
  `;
  if (!project[0]?.ok) throw new AuthorizationError("That project is not available for your time entry.");
  if (scheduleEntryId) {
    const schedule = await sql<{ ok: boolean }[]>`select exists(select 1 from schedule_entries where id=${scheduleEntryId} and organization_id=${auth.organizationId} and employee_id=${auth.employeeId} and work_date=${clock.workDate} and project_id=${projectId}) as ok`;
    if (!schedule[0]?.ok) throw new TimekeepingValidationError("The selected schedule assignment is invalid.");
  }
  if (workCategoryId) {
    const category = await sql<{ ok: boolean }[]>`select exists(select 1 from work_categories where id=${workCategoryId} and organization_id=${auth.organizationId} and active=true) as ok`;
    if (!category[0]?.ok) throw new TimekeepingValidationError("The selected work category is invalid.");
  }
  const wage = await sql<{ wage_cents: number }[]>`
    select coalesce((select wh.new_wage_cents from wage_history wh where wh.employee_id=e.id and wh.effective_date<=${clock.workDate} order by wh.effective_date desc, wh.created_at desc limit 1), e.default_hourly_wage_cents) as wage_cents
    from employees e where e.id=${auth.employeeId} and e.organization_id=${auth.organizationId} and e.active=true
  `;
  if (!wage[0]) throw new TimekeepingValidationError("Your employee record is inactive or unavailable.");
  const rows = await sql<{ id: string }[]>`insert into time_entries (organization_id, employee_id, work_date, project_id, schedule_entry_id, work_category_id, clock_in_at, wage_snapshot_cents, status) values (${auth.organizationId}, ${auth.employeeId}, ${clock.workDate}, ${projectId}, ${scheduleEntryId}, ${workCategoryId}, ${clock.nowIso}, ${wage[0].wage_cents}, 'active') returning id`;
  await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "time_entry", entityId: rows[0].id, action: "time.clock_in", newValue: { employeeId: auth.employeeId, projectId, scheduleEntryId, clockInAt: clock.nowIso, workDate: clock.workDate, wageSnapshotCaptured: true } });
}

export async function startBreak(auth: AuthContext, now = new Date()) {
  if (!auth.permissions["time.clock"]?.allowed) throw new AuthorizationError();
  const entry = await activeSelfEntry(auth);
  const sql = getSql();
  const open = await sql<{ exists: boolean }[]>`select exists(select 1 from break_entries where time_entry_id=${entry.id} and ended_at is null) as exists`;
  if (open[0]?.exists) throw new TimekeepingValidationError("A break is already in progress.");
  const rows = await sql<{ id: string }[]>`insert into break_entries (time_entry_id, kind, started_at, paid) values (${entry.id}, 'lunch', ${now.toISOString()}, false) returning id`;
  await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "time_entry", entityId: entry.id, action: "time.break_started", newValue: { breakId: rows[0].id, startedAt: now.toISOString(), kind: "lunch" } });
}

export async function endBreak(auth: AuthContext, now = new Date()) {
  if (!auth.permissions["time.clock"]?.allowed) throw new AuthorizationError();
  const entry = await activeSelfEntry(auth);
  const sql = getSql();
  const rows = await sql<{ id: string; started_at: Date | string }[]>`select id, started_at from break_entries where time_entry_id=${entry.id} and ended_at is null order by started_at desc limit 1`;
  if (!rows[0]) throw new TimekeepingValidationError("No break is currently in progress.");
  const nowIso = now.toISOString();
  await sql`update break_entries set ended_at=${nowIso} where id=${rows[0].id} and time_entry_id=${entry.id}`;
  await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "time_entry", entityId: entry.id, action: "time.break_ended", previousValue: { breakId: rows[0].id, startedAt: rows[0].started_at }, newValue: { endedAt: nowIso } });
}

export async function clockOut(auth: AuthContext, now = new Date()) {
  if (!auth.permissions["time.clock"]?.allowed) throw new AuthorizationError();
  const entry = await activeSelfEntry(auth);
  const sql = getSql();
  const open = await sql<{ exists: boolean }[]>`select exists(select 1 from break_entries where time_entry_id=${entry.id} and ended_at is null) as exists`;
  if (open[0]?.exists) throw new TimekeepingValidationError("End the current break before clocking out.");
  const nowIso = now.toISOString();
  await sql`update time_entries set clock_out_at=${nowIso}, status='submitted', updated_at=now() where id=${entry.id} and organization_id=${auth.organizationId} and clock_out_at is null`;
  await recalculateEmployeeDay(auth.organizationId, entry.employee_id, entry.work_date);
  await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "time_entry", entityId: entry.id, action: "time.clock_out", newValue: { clockOutAt: nowIso, status: "submitted" } });
}

export async function submitCorrectionRequest(auth: AuthContext, form: FormData) {
  const timeEntryId = uuid(form.get("timeEntryId"), "Time entry", true)!;
  const reason = note(form.get("reason"), "Reason", true, 1000)!;
  const requestedClockIn = localDateTime(form.get("requestedClockIn"), "Requested clock-in");
  const requestedClockOut = localDateTime(form.get("requestedClockOut"), "Requested clock-out");
  if (!requestedClockIn && !requestedClockOut) throw new TimekeepingValidationError("Enter at least one requested time change.");
  const sql = getSql();
  const rows = await sql<{ organization_id: string; employee_id: string; project_id: string }[]>`select organization_id, employee_id, project_id from time_entries where id=${timeEntryId}`;
  if (!rows[0]) throw new TimekeepingValidationError("Time entry not found.");
  await authorizeResource(auth, "time.view", { organizationId: rows[0].organization_id, employeeId: rows[0].employee_id, projectId: rows[0].project_id });
  const pending = await sql<{ exists: boolean }[]>`select exists(select 1 from time_correction_requests where time_entry_id=${timeEntryId} and status='pending') as exists`;
  if (pending[0]?.exists) throw new TimekeepingValidationError("A correction request is already pending for this entry.");
  const changes = { clockInLocal: requestedClockIn, clockOutLocal: requestedClockOut };
  const created = await sql<{ id: string }[]>`insert into time_correction_requests (time_entry_id, requested_by_user_id, requested_changes, reason) values (${timeEntryId}, ${auth.userId}, ${JSON.stringify(changes)}::jsonb, ${reason}) returning id`;
  await sql`update time_entries set status='needs_correction', updated_at=now() where id=${timeEntryId} and organization_id=${auth.organizationId} and status not in ('approved','exported')`;
  await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "time_correction_request", entityId: created[0].id, action: "time.correction_requested", newValue: { timeEntryId, changes, reason } });
}

export async function correctTimeEntry(auth: AuthContext, form: FormData) {
  const timeEntryId = uuid(form.get("timeEntryId"), "Time entry", true)!;
  const reason = note(form.get("reason"), "Reason", true, 1000)!;
  const clockInLocal = localDateTime(form.get("clockInAt"), "Clock-in", true)!;
  const clockOutLocal = localDateTime(form.get("clockOutAt"), "Clock-out", true)!;
  if (clockOutLocal <= clockInLocal) throw new TimekeepingValidationError("Clock-out must be after clock-in.");
  const sql = getSql();
  const rows = await sql<(Record<string, unknown> & { organization_id: string; employee_id: string; project_id: string; work_date: string })[]>`select *, work_date::text as work_date from time_entries where id=${timeEntryId}`;
  const entry = rows[0];
  if (!entry) throw new TimekeepingValidationError("Time entry not found.");
  if (entry.status === "exported") throw new TimekeepingValidationError("Exported time entries cannot be changed.");
  await authorizeResource(auth, "time.edit", { organizationId: entry.organization_id, employeeId: entry.employee_id, projectId: entry.project_id });
  const timezone = await sql<{ default_timezone: string }[]>`select default_timezone from organizations where id=${auth.organizationId}`;
  const zone = timezone[0]?.default_timezone ?? "UTC";
  await sql`update time_entries set clock_in_at=${clockInLocal}::timestamp at time zone ${zone}, clock_out_at=${clockOutLocal}::timestamp at time zone ${zone}, status='reviewed', approved_by_user_id=null, approved_at=null, updated_at=now() where id=${timeEntryId} and organization_id=${auth.organizationId}`;
  const nextWorkDate = clockInLocal.slice(0, 10);
  if (nextWorkDate !== entry.work_date) await sql`update time_entries set work_date=${nextWorkDate} where id=${timeEntryId} and organization_id=${auth.organizationId}`;
  await recalculateEmployeeDay(auth.organizationId, entry.employee_id, entry.work_date);
  if (nextWorkDate !== entry.work_date) await recalculateEmployeeDay(auth.organizationId, entry.employee_id, nextWorkDate);
  await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "time_entry", entityId: timeEntryId, action: "time.corrected", previousValue: entry, newValue: { clockInLocal, clockOutLocal, timeZone: zone, status: "reviewed" }, reason });
}

export async function reviewTimeEntry(auth: AuthContext, timeEntryId: string) {
  const sql = getSql();
  const rows = await sql<{ organization_id: string; employee_id: string; project_id: string; status: string; clock_out_at: Date | string | null }[]>`select organization_id, employee_id, project_id, status, clock_out_at from time_entries where id=${timeEntryId}`;
  const entry = rows[0];
  if (!entry || !entry.clock_out_at) throw new TimekeepingValidationError("A completed time entry is required.");
  if (["approved", "exported"].includes(entry.status)) throw new TimekeepingValidationError("Approved or exported time cannot be returned to review without a documented correction.");
  await authorizeResource(auth, "time.edit", { organizationId: entry.organization_id, employeeId: entry.employee_id, projectId: entry.project_id });
  await sql`update time_entries set status='reviewed', updated_at=now() where id=${timeEntryId} and organization_id=${auth.organizationId}`;
  await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "time_entry", entityId: timeEntryId, action: "time.reviewed", previousValue: { status: entry.status }, newValue: { status: "reviewed" } });
}

export async function approveTime(auth: AuthContext, timeEntryId: string) {
  const sql = getSql();
  const rows = await sql<{ organization_id: string; employee_id: string; project_id: string; status: string; clock_out_at: Date | string | null; pending: number }[]>`select te.organization_id, te.employee_id, te.project_id, te.status, te.clock_out_at, (select count(*)::int from time_correction_requests where time_entry_id=te.id and status='pending') pending from time_entries te where te.id=${timeEntryId}`;
  const entry = rows[0];
  if (!entry || !entry.clock_out_at || !["submitted", "reviewed"].includes(entry.status)) throw new TimekeepingValidationError("Submitted or reviewed time is required for approval.");
  if (entry.pending > 0) throw new TimekeepingValidationError("Resolve pending correction requests before approval.");
  await authorizeResource(auth, "time.approve", { organizationId: entry.organization_id, employeeId: entry.employee_id, projectId: entry.project_id });
  assertNotSelfApproval(auth, entry.employee_id, "time");
  await sql`update time_entries set status='approved', approved_by_user_id=${auth.userId}, approved_at=now(), updated_at=now() where id=${timeEntryId} and organization_id=${auth.organizationId}`;
  await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "time_entry", entityId: timeEntryId, action: "time.approved", previousValue: { status: entry.status }, newValue: { status: "approved" } });
}

export async function resolveCorrectionRequest(auth: AuthContext, form: FormData) {
  const requestId = uuid(form.get("requestId"), "Correction request", true)!;
  const resolution = String(form.get("resolution") ?? "");
  if (!['accepted','rejected'].includes(resolution)) throw new TimekeepingValidationError("Resolution is invalid.");
  const sql = getSql();
  const rows = await sql<{ time_entry_id: string; organization_id: string; employee_id: string; project_id: string; status: string }[]>`select cr.time_entry_id, te.organization_id, te.employee_id, te.project_id, cr.status from time_correction_requests cr join time_entries te on te.id=cr.time_entry_id where cr.id=${requestId}`;
  const request = rows[0];
  if (!request || request.status !== 'pending') throw new TimekeepingValidationError("Pending correction request not found.");
  await authorizeResource(auth, "time.edit", { organizationId: request.organization_id, employeeId: request.employee_id, projectId: request.project_id });
  await sql`update time_correction_requests set status=${resolution}, resolved_by_user_id=${auth.userId}, resolved_at=now(), updated_at=now() where id=${requestId}`;
  if (resolution === 'rejected') await sql`update time_entries set status='reviewed', updated_at=now() where id=${request.time_entry_id} and organization_id=${auth.organizationId} and status='needs_correction'`;
  await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "time_correction_request", entityId: requestId, action: `time.correction_${resolution}`, previousValue: { status: request.status }, newValue: { status: resolution } });
}
