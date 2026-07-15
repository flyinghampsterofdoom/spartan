import { getSql } from "@/db";
import { writeAuditEvent } from "@/lib/audit";
import { can, requirePermission } from "@/lib/auth/policy";
import type { AuthContext } from "@/lib/auth/types";
import { getOrganizationClock } from "@/lib/timekeeping";

export class WageValidationError extends Error {
  constructor(message: string) { super(message); this.name = "WageValidationError"; }
}

function uuid(value: FormDataEntryValue | null) {
  const result = String(value ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) throw new WageValidationError("Employee is invalid.");
  return result;
}

export function parseWageCents(value: FormDataEntryValue | null) {
  const result = String(value ?? "").trim();
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(result)) throw new WageValidationError("Hourly wage must be a positive dollar amount with no more than two decimals.");
  const cents = Math.round(Number(result) * 100);
  if (cents <= 0 || cents > 1_000_000) throw new WageValidationError("Hourly wage is outside the allowed range.");
  return cents;
}

export function parseWageDate(value: FormDataEntryValue | null) {
  const result = String(value ?? "").trim();
  const parsed = new Date(`${result}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) throw new WageValidationError("Effective date is invalid.");
  return result;
}

export function effectiveWageFromHistory(history: { effectiveDate: string; wageCents: number }[], date: string, fallbackCents: number) {
  return history.filter(item => item.effectiveDate <= date).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0]?.wageCents ?? fallbackCents;
}

export function hasWageAdministrationAccess(auth: AuthContext) {
  return Boolean(auth.permissions["wage.view"]?.allowed || auth.permissions["wage.edit"]?.allowed || auth.permissions["wage.audit"]?.allowed);
}

export type WageEmployeeRecord = {
  id: string; employee_number: string; first_name: string; last_name: string; role_name: string; active: boolean;
  current_wage_cents: number; current_effective_date: string; future_wage_cents: number | null; future_effective_date: string | null;
  time_entry_count: number; snapshotted_labor_cents: number;
};

export async function listWageEmployees(auth: AuthContext, today: string) {
  requirePermission(auth, "wage.view");
  const sql = getSql();
  return sql<WageEmployeeRecord[]>`
    select e.id, e.employee_number, e.first_name, e.last_name, r.name as role_name, e.active,
      coalesce((select wh.new_wage_cents from wage_history wh where wh.employee_id=e.id and wh.effective_date<=${today} order by wh.effective_date desc, wh.created_at desc limit 1), e.default_hourly_wage_cents) as current_wage_cents,
      coalesce((select wh.effective_date::text from wage_history wh where wh.employee_id=e.id and wh.effective_date<=${today} order by wh.effective_date desc, wh.created_at desc limit 1), e.wage_effective_date::text) as current_effective_date,
      (select wh.new_wage_cents from wage_history wh where wh.employee_id=e.id and wh.effective_date>${today} order by wh.effective_date, wh.created_at desc limit 1) as future_wage_cents,
      (select wh.effective_date::text from wage_history wh where wh.employee_id=e.id and wh.effective_date>${today} order by wh.effective_date, wh.created_at desc limit 1) as future_effective_date,
      (select count(*)::int from time_entries te where te.employee_id=e.id) as time_entry_count,
      (select coalesce(sum(te.labor_cost_cents),0)::int from time_entries te where te.employee_id=e.id) as snapshotted_labor_cents
    from employees e join roles r on r.id=e.role_id
    where e.organization_id=${auth.organizationId} order by e.active desc, e.last_name, e.first_name
  `;
}

export type WageEmployeeOption = { id: string; employee_number: string; first_name: string; last_name: string; active: boolean };

export async function listWageEmployeeOptions(auth: AuthContext) {
  requirePermission(auth, "wage.edit");
  const sql = getSql();
  return sql<WageEmployeeOption[]>`
    select id, employee_number, first_name, last_name, active
    from employees where organization_id=${auth.organizationId}
    order by active desc, last_name, first_name
  `;
}

export type WageHistoryRecord = {
  id: string; employee_id: string; employee_name: string; employee_number: string; old_wage_cents: number | null; new_wage_cents: number;
  effective_date: string; changed_by: string; reason: string | null; created_at: Date | string;
};

export async function listWageHistory(auth: AuthContext, employeeId?: string | null) {
  requirePermission(auth, "wage.audit");
  const sql = getSql();
  return sql<WageHistoryRecord[]>`
    select wh.id, wh.employee_id, e.first_name || ' ' || e.last_name as employee_name, e.employee_number,
      wh.old_wage_cents, wh.new_wage_cents, wh.effective_date::text, u.display_name as changed_by, wh.reason, wh.created_at
    from wage_history wh join employees e on e.id=wh.employee_id join users u on u.id=wh.changed_by_user_id
    where e.organization_id=${auth.organizationId} ${employeeId ? sql`and wh.employee_id=${employeeId}` : sql``}
    order by wh.effective_date desc, wh.created_at desc limit 250
  `;
}

export async function setEmployeeWage(auth: AuthContext, form: FormData) {
  requirePermission(auth, "wage.edit");
  const employeeId = uuid(form.get("employeeId"));
  const newWageCents = parseWageCents(form.get("wage"));
  const effectiveDate = parseWageDate(form.get("effectiveDate"));
  const reason = String(form.get("reason") ?? "").trim();
  if (!reason) throw new WageValidationError("Reason is required for the wage audit trail.");
  if (reason.length > 500) throw new WageValidationError("Reason must be 500 characters or fewer.");
  const sql = getSql();
  const employees = await sql<{ id: string; default_hourly_wage_cents: number; wage_effective_date: string }[]>`select id, default_hourly_wage_cents, wage_effective_date::text from employees where id=${employeeId} and organization_id=${auth.organizationId}`;
  const employee = employees[0];
  if (!employee) throw new WageValidationError("Employee not found.");
  const previous = await sql<{ wage_cents: number }[]>`select coalesce((select new_wage_cents from wage_history where employee_id=${employeeId} and effective_date<=${effectiveDate} order by effective_date desc, created_at desc limit 1), ${employee.default_hourly_wage_cents}) as wage_cents`;
  const oldWageCents = previous[0]?.wage_cents ?? employee.default_hourly_wage_cents;
  if (oldWageCents === newWageCents) throw new WageValidationError("The new wage matches the rate already effective on that date.");
  const duplicate = await sql<{ exists: boolean }[]>`select exists(select 1 from wage_history where employee_id=${employeeId} and effective_date=${effectiveDate} and new_wage_cents=${newWageCents}) as exists`;
  if (duplicate[0]?.exists) throw new WageValidationError("That wage change already exists.");
  const rows = await sql<{ id: string }[]>`insert into wage_history (employee_id, old_wage_cents, new_wage_cents, effective_date, changed_by_user_id, reason) values (${employeeId}, ${oldWageCents}, ${newWageCents}, ${effectiveDate}, ${auth.userId}, ${reason}) returning id`;
  const clock = await getOrganizationClock(auth);
  const current = await sql<{ wage_cents: number; effective_date: string }[]>`select new_wage_cents as wage_cents, effective_date::text from wage_history where employee_id=${employeeId} and effective_date<=${clock.workDate} order by effective_date desc, created_at desc limit 1`;
  if (current[0]) await sql`update employees set default_hourly_wage_cents=${current[0].wage_cents}, wage_effective_date=${current[0].effective_date}, updated_at=now() where id=${employeeId} and organization_id=${auth.organizationId}`;
  await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "employee", entityId: employeeId, action: "wage.changed", previousValue: { wageCents: oldWageCents }, newValue: { wageCents: newWageCents, effectiveDate, wageHistoryId: rows[0].id }, reason });
}

export async function wagePageData(auth: AuthContext) {
  if (!hasWageAdministrationAccess(auth)) throw new WageValidationError("Wage administration access is required.");
  const clock = await getOrganizationClock(auth);
  const [employees, employeeOptions, history] = await Promise.all([
    can(auth, "wage.view") ? listWageEmployees(auth, clock.workDate) : Promise.resolve([]),
    can(auth, "wage.edit") && !can(auth, "wage.view") ? listWageEmployeeOptions(auth) : Promise.resolve([]),
    can(auth, "wage.audit") ? listWageHistory(auth) : Promise.resolve([]),
  ]);
  return { today: clock.workDate, employees, employeeOptions, history };
}
