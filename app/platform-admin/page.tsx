/* eslint-disable @next/next/no-html-link-for-pages */
import { redirect } from "next/navigation";
import { getSql } from "@/db";
import { requireAuth } from "@/lib/auth/session";
import { requirePlatformRole } from "@/lib/auth/policy";
import { serverAppUrl } from "@/lib/http/app-url";

export const dynamic = "force-dynamic";

export default async function PlatformAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireAuth();
  try { requirePlatformRole(auth, "PLATFORM_ADMIN", "PLATFORM_SUPPORT"); } catch { redirect(await serverAppUrl("/")); }
  const sql = getSql();
  const [organizations, users, audits, migration] = await Promise.all([
    sql<{ id: string; name: string; status: string; created_at: Date; member_count: number }[]>`
      select o.id, o.name, o.status, o.created_at, count(m.id)::int as member_count
      from organizations o left join organization_memberships m on m.organization_id = o.id and m.status = 'active'
      group by o.id order by o.created_at desc
    `,
    sql<{ id: string; display_name: string; email: string; status: string; membership_count: number }[]>`
      select u.id, u.display_name, u.email, u.status, count(m.id)::int as membership_count
      from users u left join organization_memberships m on m.user_id = u.id
      group by u.id order by u.created_at desc limit 100
    `,
    sql<{ id: string; action: string; entity_type: string; created_at: Date; actor_name: string | null }[]>`
      select a.id, a.action, a.entity_type, a.created_at, u.display_name as actor_name
      from audit_events a left join users u on u.id = a.actor_user_id
      order by a.created_at desc limit 40
    `,
    sql<{ hash: string; created_at: bigint }[]>`select hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`.catch(() => []),
  ]);
  const params = await searchParams;
  return <main className="admin-page platform-page"><header className="admin-header"><div><a href="/" className="back-link">← Spartan</a><p className="section-mark">SPARTAN PLATFORM</p><h1>Platform administration</h1><p>Restricted account, organization, audit, and deployment diagnostics.</p></div><div className="platform-badge">{auth.platformRoles.join(" · ")}</div></header>{params.saved && <div className="form-success">Platform action completed and audited.</div>}<section className="diagnostic-grid"><div className="metric"><div><span>Application version</span><strong>{process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? process.env.APP_VERSION ?? "development"}</strong><small>{process.env.RENDER_SERVICE_NAME ?? "Local runtime"}</small></div></div><div className="metric"><div><span>Migration status</span><strong>{migration[0] ? "Current" : "Unavailable"}</strong><small>{migration[0]?.hash?.slice(0, 12) ?? "No migration metadata"}</small></div></div><div className="metric"><div><span>Organizations</span><strong>{organizations.length}</strong><small>registered workspaces</small></div></div></section><section className="panel admin-panel"><p className="section-mark">TENANTS</p><h2>Organizations</h2><div className="admin-table"><div className="admin-table-head platform-org-cols"><span>Organization</span><span>Members</span><span>Created</span><span>Status</span><span>Action</span></div>{organizations.map(org => <div className="admin-table-row platform-org-cols" key={org.id}><span><strong>{org.name}</strong><small>{org.id}</small></span><span>{org.member_count}</span><span>{new Date(org.created_at).toLocaleDateString()}</span><span>{org.status}</span><form action="/api/platform-admin" method="post"><input type="hidden" name="organizationId" value={org.id} /><button className="secondary compact" name="action" value={org.status === "active" ? "organization_suspend" : "organization_activate"} type="submit">{org.status === "active" ? "Suspend" : "Activate"}</button></form></div>)}</div></section><section className="panel admin-panel"><p className="section-mark">ACCOUNTS</p><h2>Users</h2><div className="admin-table"><div className="admin-table-head platform-user-cols"><span>User</span><span>Memberships</span><span>Status</span><span>Actions</span></div>{users.map(user => <div className="admin-table-row platform-user-cols" key={user.id}><span><strong>{user.display_name}</strong><small>{user.email}</small></span><span>{user.membership_count}</span><span>{user.status}</span><form action="/api/platform-admin" method="post"><input type="hidden" name="userId" value={user.id} /><button className="secondary compact" name="action" value="sessions_revoke" type="submit">Revoke sessions</button><button className="text-button danger-link" name="action" value={user.status === "active" ? "user_disable" : "user_activate"} type="submit">{user.status === "active" ? "Disable" : "Activate"}</button></form></div>)}</div></section><section className="panel admin-panel"><p className="section-mark">DIAGNOSTICS</p><h2>Recent audit events</h2><div className="audit-list">{audits.map(event => <div key={event.id}><strong>{event.action}</strong><span>{event.actor_name ?? "System"} · {event.entity_type}</span><time>{new Date(event.created_at).toLocaleString()}</time></div>)}</div></section></main>;
}
