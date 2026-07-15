import Link from "next/link";
import { OperationsFrame } from "@/components/OperationsFrame";
import { requireAuth } from "@/lib/auth/session";
import { can } from "@/lib/auth/policy";
import { listEmployees, listRoles, operationScope } from "@/lib/operations";

export const dynamic = "force-dynamic";

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireAuth();
  if (!operationScope(auth, "employees.view")) return <OperationsFrame auth={auth} active="/employees"><div className="page"><div className="form-alert">You do not have permission to view employees.</div></div></OperationsFrame>;
  const [employees, roles, params] = await Promise.all([listEmployees(auth), listRoles(), searchParams]);
  const editId = typeof params.edit === "string" ? params.edit : "";
  const selected = employees.find(employee => employee.id === editId);
  const manage = can(auth, "employees.manage");
  const wageView = can(auth, "wage.view");
  return <OperationsFrame auth={auth} active="/employees"><div className="page operations-page">
    <section className="welcome page-title"><div><p className="eyebrow">PEOPLE & ACCESS</p><h1>Employees</h1><p>Canonical employee records, login links, organization roles, and crew membership.</p></div>{manage && <Link className="primary button-anchor" href="/employees?new=1#employee-form">＋ Add employee</Link>}</section>
    {params.saved && <div className="form-success">Employee changes saved.</div>}{typeof params.error === "string" && <div className="form-alert">{params.error}</div>}
    <div className="operations-grid">
      <section className="panel record-list"><div className="panel-head"><div><span className="section-mark">DIRECTORY</span><h2>{employees.length} employees</h2></div></div>{employees.map(employee => <Link href={`/employees?edit=${employee.id}#employee-form`} className="record-row" key={employee.id}><span className="avatar slate">{employee.first_name[0]}{employee.last_name[0]}</span><span><strong>{employee.first_name} {employee.last_name}</strong><small>{employee.employee_number} · {employee.role_name}{employee.crew_names ? ` · ${employee.crew_names}` : ""}</small></span><span className={`status-pill ${employee.active ? "active" : "rework"}`}>{employee.active ? "Active" : "Inactive"}</span><b>›</b></Link>)}</section>
      {manage && <section className="panel editor-panel" id="employee-form"><span className="section-mark">{selected ? "EDIT EMPLOYEE" : "NEW EMPLOYEE"}</span><h2>{selected ? `${selected.first_name} ${selected.last_name}` : "Employee details"}</h2><form action="/api/operations" method="post" className="operations-form"><input type="hidden" name="action" value="employee_save"/><input type="hidden" name="id" value={selected?.id ?? ""}/><input type="hidden" name="returnTo" value={selected ? `/employees?edit=${selected.id}` : "/employees"}/><div className="form-pair"><label>Employee ID<input name="employeeNumber" defaultValue={selected?.employee_number} required/></label><label>Role<select name="roleId" defaultValue={selected?.role_id} required>{roles.map(role => <option value={role.id} key={role.id}>{role.name}</option>)}</select></label></div><div className="form-pair"><label>First name<input name="firstName" defaultValue={selected?.first_name} required/></label><label>Last name<input name="lastName" defaultValue={selected?.last_name} required/></label></div><div className="form-pair"><label>Phone<input name="phone" type="tel" defaultValue={selected?.phone ?? ""}/></label><label>Email<input name="email" type="email" defaultValue={selected?.email ?? ""}/></label></div><label>Employment notes<textarea name="notes" defaultValue={selected?.notes ?? ""} rows={4}/></label><button className="primary" type="submit">Save employee</button></form>{selected && wageView && <Link className="secondary wage-admin-link" href={`/wages?employee=${selected.id}`}>View wage administration</Link>}{selected && <form action="/api/operations" method="post" className="state-form"><input type="hidden" name="action" value="state"/><input type="hidden" name="entity" value="employee"/><input type="hidden" name="id" value={selected.id}/><input type="hidden" name="active" value={String(!selected.active)}/><input type="hidden" name="returnTo" value={`/employees?edit=${selected.id}`}/><button type="submit" className="text-button danger-link">{selected.active ? "Deactivate employee" : "Reactivate employee"}</button></form>}</section>}
    </div>{wageView && <p className="security-note">Wage access is isolated from general employee access and managed in the secured <Link href="/wages">Wages workspace</Link>.</p>}
  </div></OperationsFrame>;
}
