/* eslint-disable @next/next/no-html-link-for-pages */
import { requireAuth } from "@/lib/auth/session";
import { getSql } from "@/db";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const auth = await requireAuth();
  const sessions = await getSql()<{ id: string; created_at: Date; last_seen_at: Date; expires_at: Date; user_agent: string | null }[]>`
    select id, created_at, last_seen_at, expires_at, user_agent from sessions
    where user_id = ${auth.userId} and revoked_at is null and expires_at > now()
    order by last_seen_at desc
  `;
  return <main className="admin-page"><header className="admin-header"><div><a href="/" className="back-link">← Spartan</a><p className="section-mark">YOUR ACCOUNT</p><h1>{auth.displayName}</h1><p>{auth.email} · {auth.organizationName} · {auth.roleName}</p></div><form action="/api/auth/logout" method="post"><button className="secondary" type="submit">Log out</button></form></header><section className="panel admin-panel"><p className="section-mark">SECURITY</p><h2>Active sessions</h2><div className="audit-list">{sessions.map(session => <div key={session.id}><strong>{session.id === auth.sessionId ? "Current session" : "Spartan session"}</strong><span>{session.user_agent?.split(" ").slice(0, 5).join(" ") ?? "Unknown browser"}</span><time>Expires {new Date(session.expires_at).toLocaleString()}</time></div>)}</div><form action="/api/auth/sessions/revoke-all" method="post"><button className="secondary" type="submit">Revoke all sessions</button></form></section></main>;
}
