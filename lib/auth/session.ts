import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSql } from "@/db";
import { createOpaqueToken, hashOpaqueToken, verifyPassword } from "./crypto";
import type { AuthContext, PermissionGrant, PermissionScope } from "./types";
import { writeAuditEvent } from "@/lib/audit";

export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-spartan_session" : "spartan_session";
const SESSION_HOURS = Number(process.env.SESSION_TTL_HOURS ?? "12");

type SessionIdentity = {
  sessionId: string;
  userId: string;
  email: string;
  displayName: string;
  activeOrganizationId: string | null;
  expiresAt: Date;
  platformRoles: string[];
};

export async function authenticateCredentials(email: string, password: string) {
  const sql = getSql();
  const normalizedEmail = email.trim().toLowerCase();
  const rows = await sql<{
    id: string;
    email: string;
    display_name: string;
    password_hash: string | null;
    status: string;
    active: boolean;
  }[]>`
    select id, email, display_name, password_hash, status, active
    from users where lower(email) = ${normalizedEmail} limit 1
  `;
  const user = rows[0];
  const validPassword = await verifyPassword(password, user?.password_hash ?? null);
  if (!user || !validPassword || !user.active || user.status !== "active") return null;
  return user;
}

export async function createSession(userId: string) {
  const sql = getSql();
  const token = createOpaqueToken();
  const tokenHash = hashOpaqueToken(token);
  const requestHeaders = await headers();
  const activeMemberships = await sql<{ organization_id: string }[]>`
    select m.organization_id
    from organization_memberships m
    join organizations o on o.id = m.organization_id
    where m.user_id = ${userId} and m.status = 'active'
      and o.status = 'active' and o.active = true
    order by m.joined_at nulls last, m.created_at
  `;
  const activeOrganizationId = activeMemberships.length === 1 ? activeMemberships[0].organization_id : null;
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  const inserted = await sql<{ id: string }[]>`
    insert into sessions (
      user_id, token_hash, active_organization_id, expires_at, user_agent, ip_address
    ) values (
      ${userId}, ${tokenHash}, ${activeOrganizationId}, ${expiresAt},
      ${requestHeaders.get("user-agent")},
      ${requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null}
    ) returning id
  `;
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return { id: inserted[0].id, activeOrganizationId };
}

export async function getSessionIdentity(): Promise<SessionIdentity | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const sql = getSql();
  const tokenHash = hashOpaqueToken(token);
  const rows = await sql<{
    session_id: string;
    user_id: string;
    email: string;
    display_name: string;
    active_organization_id: string | null;
    expires_at: Date;
    user_status: string;
    user_active: boolean;
  }[]>`
    select s.id as session_id, u.id as user_id, u.email, u.display_name,
      s.active_organization_id, s.expires_at, u.status as user_status, u.active as user_active
    from sessions s
    join users u on u.id = s.user_id
    where s.token_hash = ${tokenHash} and s.revoked_at is null
      and s.expires_at > now()
    limit 1
  `;
  const row = rows[0];
  if (!row || !row.user_active || row.user_status !== "active") return null;
  const platform = await sql<{ role: string }[]>`
    select role from platform_access
    where user_id = ${row.user_id} and status = 'active' and revoked_at is null
  `;
  void sql`update sessions set last_seen_at = now() where id = ${row.session_id} and last_seen_at < now() - interval '5 minutes'`;
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    activeOrganizationId: row.active_organization_id,
    expiresAt: row.expires_at,
    platformRoles: platform.map((item) => item.role),
  };
}

export async function getAuthContext(): Promise<AuthContext | null> {
  const identity = await getSessionIdentity();
  if (!identity?.activeOrganizationId) return null;
  const sql = getSql();
  const memberships = await sql<{
    membership_id: string;
    membership_status: string;
    organization_id: string;
    organization_name: string;
    organization_status: string;
    role_name: string;
    employee_id: string | null;
  }[]>`
    select m.id as membership_id, m.status as membership_status,
      o.id as organization_id, o.name as organization_name, o.status as organization_status,
      r.name as role_name, coalesce(m.employee_id, e.id) as employee_id
    from organization_memberships m
    join organizations o on o.id = m.organization_id
    join roles r on r.id = m.role_id
    left join employees e on e.organization_id = m.organization_id and e.user_id = m.user_id
    where m.user_id = ${identity.userId} and m.organization_id = ${identity.activeOrganizationId}
    limit 1
  `;
  const membership = memberships[0];
  if (!membership || membership.membership_status !== "active" || membership.organization_status !== "active") return null;

  const permissionRows = await sql<{
    key: string;
    role_allowed: boolean;
    role_scope: PermissionScope;
    override_allowed: boolean | null;
    override_scope: PermissionScope | null;
  }[]>`
    select p.key, true as role_allowed, rp.scope as role_scope,
      upo.allowed as override_allowed, upo.scope as override_scope
    from permissions p
    join role_permissions rp on rp.permission_id = p.id and rp.role_id = (
      select role_id from organization_memberships where id = ${membership.membership_id}
    )
    left join user_permission_overrides upo
      on upo.permission_id = p.id and upo.membership_id = ${membership.membership_id}
    union
    select p.key, false as role_allowed, 'organization' as role_scope,
      upo.allowed as override_allowed, upo.scope as override_scope
    from user_permission_overrides upo
    join permissions p on p.id = upo.permission_id
    where upo.membership_id = ${membership.membership_id}
      and not exists (
        select 1 from role_permissions rp
        where rp.role_id = (select role_id from organization_memberships where id = ${membership.membership_id})
          and rp.permission_id = p.id
      )
  `;
  const permissions: Record<string, PermissionGrant> = {};
  for (const row of permissionRows) {
    permissions[row.key] = {
      allowed: row.override_allowed ?? row.role_allowed,
      scope: row.override_scope ?? row.role_scope,
    };
  }
  return {
    ...identity,
    organizationId: membership.organization_id,
    organizationName: membership.organization_name,
    membershipId: membership.membership_id,
    membershipStatus: membership.membership_status,
    roleName: membership.role_name,
    employeeId: membership.employee_id,
    permissions,
  };
}

export async function requireAuth() {
  const identity = await getSessionIdentity();
  if (!identity) redirect("/login");
  if (!identity.activeOrganizationId) redirect("/select-organization");
  const context = await getAuthContext();
  if (!context) redirect("/login?error=access");
  return context;
}

export async function selectOrganization(sessionId: string, userId: string, organizationId: string) {
  const sql = getSql();
  const memberships = await sql<{ id: string }[]>`
    select m.id from organization_memberships m
    join organizations o on o.id = m.organization_id
    where m.user_id = ${userId} and m.organization_id = ${organizationId}
      and m.status = 'active' and o.status = 'active' and o.active = true
    limit 1
  `;
  if (!memberships[0]) return false;
  await sql`update sessions set active_organization_id = ${organizationId} where id = ${sessionId} and user_id = ${userId}`;
  return true;
}

export async function logoutCurrentSession(reason = "user_logout") {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) {
    const sql = getSql();
    const tokenHash = hashOpaqueToken(token);
    const sessions = await sql<{ id: string; user_id: string; active_organization_id: string | null }[]>`
      update sessions set revoked_at = now(), revocation_reason = ${reason}
      where token_hash = ${tokenHash} and revoked_at is null
      returning id, user_id, active_organization_id
    `;
    const session = sessions[0];
    if (session) {
      await writeAuditEvent({
        organizationId: session.active_organization_id,
        actorUserId: session.user_id,
        entityType: "session",
        entityId: session.id,
        action: "auth.logout",
      });
    }
  }
  (await cookies()).delete(SESSION_COOKIE);
}

export async function revokeUserSessions(userId: string, actorUserId: string, reason: string) {
  const sql = getSql();
  const result = await sql<{ id: string }[]>`
    update sessions set revoked_at = now(), revoked_by_user_id = ${actorUserId}, revocation_reason = ${reason}
    where user_id = ${userId} and revoked_at is null and expires_at > now()
    returning id
  `;
  return result.length;
}
