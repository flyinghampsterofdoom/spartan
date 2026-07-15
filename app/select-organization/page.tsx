import { redirect } from "next/navigation";
import { getSql } from "@/db";
import { getSessionIdentity } from "@/lib/auth/session";
import { serverAppUrl } from "@/lib/http/app-url";

export const dynamic = "force-dynamic";

export default async function OrganizationSelectionPage() {
  const session = await getSessionIdentity();
  if (!session) redirect(await serverAppUrl("/login"));
  const organizations = await getSql()<{ id: string; name: string; role_name: string }[]>`
    select o.id, o.name, r.name as role_name
    from organization_memberships m join organizations o on o.id = m.organization_id join roles r on r.id = m.role_id
    where m.user_id = ${session.userId} and m.status = 'active' and o.status = 'active' and o.active = true
    order by o.name
  `;
  return <main className="auth-page"><section className="auth-card wide"><a className="auth-brand" href="/login"><span>S</span> SPARTAN</a><p className="section-mark">ORGANIZATION</p><h1>Select your workspace</h1><div className="organization-options">{organizations.map(org => <form action="/api/auth/select-organization" method="post" key={org.id}><input type="hidden" name="organizationId" value={org.id} /><button type="submit"><strong>{org.name}</strong><span>{org.role_name}</span><b>›</b></button></form>)}</div>{organizations.length === 0 && <div className="form-alert">You do not have an active organization membership.</div>}<form action="/api/auth/logout" method="post"><button className="auth-link button-link" type="submit">Log out</button></form></section></main>;
}
