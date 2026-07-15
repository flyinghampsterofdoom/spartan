import Link from "next/link";
import { OperationsFrame } from "@/components/OperationsFrame";
import { can } from "@/lib/auth/policy";
import { requireAuth } from "@/lib/auth/session";
import { hasWageAdministrationAccess, wagePageData } from "@/lib/wages";

export const dynamic = "force-dynamic";

function money(cents: number | null | undefined) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function dateLabel(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T00:00:00Z`));
}

function timestamp(value: Date | string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default async function WagesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireAuth();
  if (!hasWageAdministrationAccess(auth)) return <OperationsFrame auth={auth} active="/wages"><div className="page"><div className="form-alert">You do not have permission to access wage administration.</div></div></OperationsFrame>;
  const [data, params] = await Promise.all([wagePageData(auth), searchParams]);
  const canView = can(auth, "wage.view");
  const canEdit = can(auth, "wage.edit");
  const canAudit = can(auth, "wage.audit");
  const selectedId = typeof params.employee === "string" ? params.employee : "";
  const options = data.employees.length ? data.employees : data.employeeOptions;
  const selected = options.find(employee => employee.id === selectedId) ?? options[0];
  const visibleHistory = selectedId ? data.history.filter(event => event.employee_id === selectedId) : data.history;
  const activeEmployees = data.employees.filter(employee => employee.active);
  const averageWage = activeEmployees.length ? Math.round(activeEmployees.reduce((sum, employee) => sum + employee.current_wage_cents, 0) / activeEmployees.length) : 0;
  const totalLabor = data.employees.reduce((sum, employee) => sum + employee.snapshotted_labor_cents, 0);
  return <OperationsFrame auth={auth} active="/wages"><div className="page operations-page wage-page">
    <section className="welcome page-title"><div><p className="eyebrow">COMPENSATION SECURITY</p><h1>Wage administration</h1><p>Effective-dated rates, protected visibility, immutable labor snapshots, and a complete change history.</p></div></section>
    {params.saved && <div className="form-success">Wage change saved and added to the audit history.</div>}{typeof params.error === "string" && <div className="form-alert">{params.error}</div>}
    {canView && <section className="wage-metrics"><article className="metric"><div><span>ACTIVE EMPLOYEES</span><strong>{activeEmployees.length}</strong><small>with protected wage records</small></div><span className="metric-icon">◎</span></article><article className="metric"><div><span>AVERAGE HOURLY RATE</span><strong>{money(averageWage)}</strong><small>current active workforce</small></div><span className="metric-icon green">$</span></article><article className="metric"><div><span>FUTURE CHANGES</span><strong>{data.employees.filter(employee => employee.future_wage_cents != null).length}</strong><small>scheduled after {dateLabel(data.today)}</small></div><span className="metric-icon orange">↗</span></article><article className="metric"><div><span>SNAPSHOTTED LABOR</span><strong>{money(totalLabor)}</strong><small>historical time-entry cost</small></div><span className="metric-icon red">◷</span></article></section>}
    <div className="wage-workspace">
      {canView && <section className="panel wage-directory"><div className="panel-head"><div><span className="section-mark">CURRENT RATES</span><h2>{data.employees.length} wage records</h2></div></div><div className="wage-table"><div className="wage-table-head"><span>Employee</span><span>Current rate</span><span>Effective</span><span>Next change</span><span>History</span></div>{data.employees.map(employee => <Link href={`/wages?employee=${employee.id}`} className={`wage-table-row ${selected?.id === employee.id ? "selected" : ""}`} key={employee.id}><span><strong>{employee.first_name} {employee.last_name}</strong><small>{employee.employee_number} · {employee.role_name}</small></span><span><strong>{money(employee.current_wage_cents)}</strong><small>per hour</small></span><span>{dateLabel(employee.current_effective_date)}</span><span>{employee.future_wage_cents != null ? <><strong>{money(employee.future_wage_cents)}</strong><small>{dateLabel(employee.future_effective_date)}</small></> : <small>None scheduled</small>}</span><span>{employee.time_entry_count} snapshots</span></Link>)}</div></section>}
      {canEdit && selected && <section className="panel wage-editor"><span className="section-mark">EFFECTIVE-DATED CHANGE</span><h2>Set an hourly wage</h2><p className="muted">A new history event is created. Existing time entries and their labor costs are never recalculated.</p><form action="/api/wages" method="post" className="operations-form"><input type="hidden" name="action" value="wage_change"/><label>Employee<select name="employeeId" defaultValue={selected.id} required>{options.map(employee => <option value={employee.id} key={employee.id}>{employee.first_name} {employee.last_name} · {employee.employee_number}</option>)}</select></label><div className="form-pair"><label>New hourly wage<input name="wage" inputMode="decimal" placeholder="31.00" required/></label><label>Effective date<input name="effectiveDate" type="date" defaultValue={data.today} required/></label></div><label>Reason for change<textarea name="reason" rows={3} maxLength={500} required placeholder="For example: Annual compensation adjustment"/></label><button className="primary" type="submit">Record wage change</button></form><div className="wage-snapshot-note"><strong>Historical protection</strong><span>Every clock-in stores the wage applicable on that work date. Later raises do not alter approved or past labor costs.</span></div></section>}
    </div>
    {canAudit && <section className="panel wage-audit"><div className="panel-head"><div><span className="section-mark">AUDIT HISTORY</span><h2>{selectedId && selected ? `${selected.first_name} ${selected.last_name}` : "All wage changes"}</h2></div>{selectedId && <Link className="text-button" href="/wages">Show all changes</Link>}</div><div className="audit-timeline">{visibleHistory.map(event => <article className="audit-event" key={event.id}><span className="audit-dot"/><div><div className="audit-event-head"><strong>{event.employee_name}</strong><time>{timestamp(event.created_at)}</time></div><p>{money(event.old_wage_cents)} → <strong>{money(event.new_wage_cents)}</strong> effective {dateLabel(event.effective_date)}</p><small>Changed by {event.changed_by}{event.reason ? ` · ${event.reason}` : ""}</small></div></article>)}{visibleHistory.length === 0 && <div className="empty-state">No wage changes are recorded for this selection.</div>}</div></section>}
  </div></OperationsFrame>;
}
