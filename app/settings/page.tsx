/* eslint-disable @next/next/no-html-link-for-pages */
import { redirect } from "next/navigation";
import { getSql } from "@/db";
import { requireAuth } from "@/lib/auth/session";
import { can } from "@/lib/auth/policy";

export const dynamic = "force-dynamic";

export default async function CompanySettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireAuth();
  if (!can(auth, "organization.memberships.manage") && !can(auth, "organization.settings.manage")) redirect("/");
  const sql = getSql();
  const [organizations, members, invitations, roles, employees] = await Promise.all([
    sql<{ name: string; default_timezone: string; profile: Record<string, unknown> }[]>`
      select name, default_timezone, profile from organizations where id = ${auth.organizationId}
    `,
    sql<{ id: string; display_name: string; email: string; role_name: string; role_id: string; status: string; employee_name: string | null; user_id: string }[]>`
      select m.id, u.display_name, u.email, r.name as role_name, r.id as role_id, m.status,
        case when e.id is null then null else e.first_name || ' ' || e.last_name end as employee_name,
        u.id as user_id
      from organization_memberships m
      join users u on u.id = m.user_id
      join roles r on r.id = m.role_id
      left join employees e on e.id = coalesce(m.employee_id, (
        select id from employees where organization_id = m.organization_id and user_id = m.user_id limit 1
      ))
      where m.organization_id = ${auth.organizationId}
      order by u.display_name
    `,
    sql<{ id: string; email: string; role_name: string; status: string; expires_at: Date }[]>`
      select i.id, i.email, r.name as role_name, i.status, i.expires_at
      from invitations i join roles r on r.id = i.role_id
      where i.organization_id = ${auth.organizationId}
      order by i.created_at desc limit 30
    `,
    sql<{ id: string; name: string }[]>`
      select id, name from roles
      order by case name when 'Owner' then 1 when 'Manager' then 2 when 'Foreman' then 3 when 'Employee' then 4 else 5 end
    `,
    sql<{ id: string; name: string }[]>`
      select id, first_name || ' ' || last_name as name from employees
      where organization_id = ${auth.organizationId} and user_id is null
      order by last_name, first_name
    `,
  ]);
  const params = await searchParams;
  return <main className="admin-page">
    <header className="admin-header">
      <div><a href="/" className="back-link">← Spartan</a><p className="section-mark">COMPANY ADMINISTRATION</p><h1>{organizations[0].name}</h1><p>Manage account access, invitations, employee links, and organization settings.</p></div>
      <form action="/api/auth/logout" method="post"><button className="secondary" type="submit">Log out</button></form>
    </header>
    {params.saved && <div className="form-success">Changes saved.</div>}
    <section className="admin-grid">
      <div className="panel admin-panel"><h2>Invite a user</h2><form action="/api/admin/company" method="post" className="admin-form"><input type="hidden" name="action" value="invite" /><label>Email<input type="email" name="email" required /></label><label>Initial role<select name="roleId" required>{roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label><label>Link employee (optional)<select name="employeeId"><option value="">No employee link</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label><button className="primary" type="submit">Send invitation</button></form></div>
      <div className="panel admin-panel"><h2>Organization profile</h2><form action="/api/admin/company" method="post" className="admin-form"><input type="hidden" name="action" value="organization" /><label>Organization name<input name="name" defaultValue={organizations[0].name} required /></label><label>Default timezone<input name="timezone" defaultValue={organizations[0].default_timezone} required /></label><label>Phone<input name="phone" defaultValue={String(organizations[0].profile?.phone ?? "")} /></label><button className="primary" type="submit">Save settings</button></form></div>
    </section>
    <section className="panel admin-panel"><div className="panel-head"><div><p className="section-mark">ACCESS</p><h2>Organization users</h2></div></div><div className="admin-table"><div className="admin-table-head"><span>User</span><span>Employee link</span><span>Role</span><span>Status</span><span>Action</span></div>{members.map(member => <div className="admin-table-row" key={member.id}><span><strong>{member.display_name}</strong><small>{member.email}</small></span><span>{member.employee_name ?? "Administrative account"}</span><span><form action="/api/admin/company" method="post" className="inline-role-form"><input type="hidden" name="membershipId" value={member.id} /><input type="hidden" name="action" value="membership_role" /><select name="roleId" defaultValue={member.role_id}>{roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select><button className="secondary compact" type="submit">Save</button></form></span><span className={`status-pill ${member.status === "active" ? "active" : "rework"}`}>{member.status}</span><form action="/api/admin/company" method="post"><input type="hidden" name="membershipId" value={member.id} /><select name="action" defaultValue=""><option value="" disabled>Choose…</option><option value="membership_activate">Activate</option><option value="membership_suspend">Suspend</option><option value="membership_revoke">Revoke</option><option value="sessions_revoke">Revoke sessions</option></select><button className="secondary compact" type="submit">Apply</button></form></div>)}</div></section>
    <section className="panel admin-panel"><p className="section-mark">PENDING ACCESS</p><h2>Invitations</h2><div className="admin-table"><div className="admin-table-head invite-cols"><span>Email</span><span>Role</span><span>Expires</span><span>Status</span><span>Action</span></div>{invitations.map(invitation => <div className="admin-table-row invite-cols" key={invitation.id}><span>{invitation.email}</span><span>{invitation.role_name}</span><span>{new Date(invitation.expires_at).toLocaleDateString()}</span><span>{invitation.status}</span><form action="/api/admin/company" method="post"><input type="hidden" name="invitationId" value={invitation.id} /><button className="secondary compact" name="action" value="invitation_resend" type="submit">Resend</button><button className="text-button danger-link" name="action" value="invitation_revoke" type="submit">Revoke</button></form></div>)}</div></section>
  </main>;
}
