import { getSql } from "@/db";
import { hashOpaqueToken } from "@/lib/auth/crypto";

export const dynamic = "force-dynamic";

export default async function InvitationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  const error = typeof params.error === "string";
  let lookupFailed = false;
  let rows: { email: string; organization_name: string; role_name: string; existing_user: boolean }[] = [];
  try {
    rows = token ? await getSql()<{
      email: string; organization_name: string; role_name: string; existing_user: boolean;
    }[]>`
      select i.email, o.name as organization_name, r.name as role_name, (u.id is not null) as existing_user
      from invitations i join organizations o on o.id = i.organization_id join roles r on r.id = i.role_id
      left join users u on lower(u.email) = lower(i.email)
      where i.token_hash = ${hashOpaqueToken(token)} and i.status = 'invited' and i.revoked_at is null and i.accepted_at is null and i.expires_at > now()
      limit 1
    ` : [];
  } catch (lookupError) {
    lookupFailed = true;
    console.error("[auth.invitation.lookup_failed]", lookupError);
  }
  const invitation = rows[0];
  return <main className="auth-page"><section className="auth-card"><a className="auth-brand" href="/login"><span>S</span> SPARTAN</a><p className="section-mark">COMPANY INVITATION</p><h1>{invitation ? `Join ${invitation.organization_name}` : "Invitation unavailable"}</h1>{!invitation ? <><div className="form-alert">{lookupFailed ? "Spartan could not load this invitation. Please try again shortly." : "This invitation is invalid, expired, revoked, or already used."}</div><a className="auth-link" href="/login">Go to login</a></> : <><p>{invitation.email} was invited as {invitation.role_name}.</p>{error && <div className="form-alert">Please check the information and try again.</div>}<form action="/api/auth/invitations/accept" method="post" className="auth-form"><input type="hidden" name="token" value={token} /><label>Your name<input name="displayName" autoComplete="name" required /></label>{!invitation.existing_user && <><label>Create password<input type="password" name="password" autoComplete="new-password" minLength={12} required /></label><label>Confirm password<input type="password" name="confirmPassword" autoComplete="new-password" minLength={12} required /></label></>}<button className="primary full" type="submit">Accept invitation</button></form></>}</section></main>;
}
